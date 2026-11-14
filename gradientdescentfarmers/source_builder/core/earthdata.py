"""NASA Earthdata GPM + SMAP, based solely on master notebook sections 8 and 10.

Caveats: GPM CMR searches do NOT spatially subset global HDF5; SMAP is
9-km gridded model-assimilation output. Use bounded windows / cache / async jobs.
"""
from __future__ import annotations
from pathlib import Path
from datetime import datetime
import re
import numpy as np
import pandas as pd

from .providers import ProviderContext, ProviderPayload
from .transport import validate_local_hdf5


def _login():
    """NASA Earthdata authentication shared by GPM and SMAP."""
    from .auth import login_earthdata
    return login_earthdata()


def _download(ctx: ProviderContext, short_name: str, version: str, start: str, end: str,
              max_granules: int, subdir: str, required_groups: tuple[str, ...]):
    earthaccess = _login()
    lat, lon = ctx.farmer.latitude, ctx.farmer.longitude
    bb = (lon-0.05, lat-0.05, lon+0.05, lat+0.05)
    found = earthaccess.search_data(short_name=short_name, version=version, bounding_box=bb,
                                    temporal=(start, end), count=max_granules)
    if not found:
        raise LookupError(f"no {short_name} granules found")
    folder = ctx.settings.cache_root / "earthdata" / subdir
    folder.mkdir(parents=True, exist_ok=True)
    # Resumable, one-granule-at-a-time downloads to NEW paths. Never overwrite
    # original cache objects, even when an HDF5 is truncated.
    from .earthdata_recovery import GranuleRecovery
    recover = GranuleRecovery(folder, required_groups=required_groups,
                              retries=ctx.settings.retries)
    return recover.acquire(earthaccess, found[:max_granules])


def _read_rate(ds, index):
    value=float(ds[index])
    for key in ("_FillValue", "missing_value"):
        if key in ds.attrs and any(np.isclose(value, float(x)) for x in np.asarray(ds.attrs[key]).reshape(-1)):
            return np.nan
    factor = float(np.asarray(ds.attrs.get("scale_factor", 1)).reshape(-1)[0])
    offset = float(np.asarray(ds.attrs.get("add_offset", 0)).reshape(-1)[0])
    return value*factor+offset


def _attr_str(ds, key):
    x = ds.attrs.get(key, "")
    if isinstance(x, np.ndarray): x=x.reshape(-1)[0]
    if isinstance(x, bytes): x=x.decode()
    return str(x).strip()


def extract_gpm_point(path: Path, lat: float, lon: float):
    """Decode a single IMERG V07 half-hourly global pixel; inspect HDF5 layout."""
    import h5py
    with h5py.File(path, "r") as h:
        grid=h["Grid"]
        lats=np.asarray(grid["lat"][:], dtype=float)
        lons=np.asarray(grid["lon"][:], dtype=float)
        if lats.ndim!=1 or lons.ndim!=1:
            raise ValueError("GPM coordinates must be 1D")
        ilat=int(np.argmin(abs(lats-lat)))
        # Support either -180..180 or 0..360 longitude convention.
        ilon=int(np.argmin(abs(((lons-lon+180)%360)-180)))
        name=next((n for n in ("precipitation", "precipitationCal") if n in grid), None)
        if not name:
            raise KeyError("GPM precipitation band missing")
        ds=grid[name]
        lat_axes=[i for i,n in enumerate(ds.shape) if n==len(lats)]
        lon_axes=[i for i,n in enumerate(ds.shape) if n==len(lons)]
        if len(lat_axes)!=1 or len(lon_axes)!=1 or lat_axes[0]==lon_axes[0]:
            raise ValueError("ambiguous IMERG lat/lon axis order")
        index=[0]*ds.ndim
        index[lat_axes[0]]=ilat
        index[lon_axes[0]]=ilon
        rate=_read_rate(ds, tuple(index))
        units=_attr_str(ds,"units").lower()
        if units not in {"mm/hr","mm/h","mm hour-1","mm/hour","mm hr-1"}:
            raise ValueError(f"unknown IMERG precipitation rate unit: {units!r}")
    m=re.search(r"(20\d{6})-S(\d{6})-E(\d{6})", path.name)
    if not m:
        raise ValueError("IME RG timestamp not found in granule filename")
    timestamp=pd.to_datetime(m.group(1)+m.group(2), format="%Y%m%d%H%M%S", utc=True)
    return {"datetime_utc":timestamp, "cell_lat":float(lats[ilat]), "cell_lon":float(lons[ilon]),
            "precip_rate_mm_h":rate, "precip_30min_mm":rate*0.5 if pd.notna(rate) else np.nan,
            "source_file":path.name}


def gpm_daily(half_hourly: pd.DataFrame):
    """Daily UTC totals only for complete 48/48 valid slots; NOT zero-fill."""
    if half_hourly.empty: return pd.DataFrame()
    frame=half_hourly.copy()
    frame["date_utc"]=pd.to_datetime(frame["datetime_utc"], utc=True).dt.floor("D")
    out=frame.groupby("date_utc",as_index=False).agg(
        farm_id=("farm_id","first"), slots=("datetime_utc","nunique"),
        valid_slots=("precip_30min_mm","count"),
        precip_sum_valid_mm=("precip_30min_mm",lambda x:x.sum(min_count=1)),
        max_30min_mm=("precip_30min_mm","max"))
    out["complete_48_slots"] = out.slots.eq(48) & out.valid_slots.eq(48)
    out["precip_total_mm"] = out.precip_sum_valid_mm.where(out.complete_48_slots)
    return out


def get_gpm(ctx: ProviderContext):
    cfg=ctx.settings
    paths=_download(ctx,"GPM_3IMERGHH","07",cfg.gpm_start,cfg.gpm_end,cfg.gpm_max_granules,
                    "gpm",("Grid",))
    rows=[]
    for path in paths:
        item=extract_gpm_point(path,ctx.farmer.latitude,ctx.farmer.longitude)
        item["farm_id"]=ctx.farmer.farm_id
        rows.append(item)
    half=pd.DataFrame(rows).sort_values("datetime_utc").reset_index(drop=True)
    if half.datetime_utc.duplicated().any():
        raise ValueError("GPM duplicate UTC slots")
    daily=gpm_daily(half)
    warnings=[]
    if daily.empty or not daily.complete_48_slots.any():
        warnings.append("No complete UTC days (48 valid slots); daily totals remain missing")
    return ProviderPayload(tables={"gpm_half_hourly":half,"gpm_daily":daily}, warnings=warnings,
       units={"precip_rate_mm_h":"mm/h", "precip_30min_mm":"mm/30min", "precip_total_mm":"mm/day"},
       temporal_resolution="30 minutes / UTC day aggregation", spatial_resolution="0.1° (~10 km)",
       source_url="https://disc.gsfc.nasa.gov/datasets/GPM_3IMERGHH_07/summary",
       provenance={"granules_downloaded":len(paths),"sample_complete_days":int(daily.complete_48_slots.sum())})


# Official EASE2_M09km grid definition, checked against NSIDC SPL4SMGP v008.
X_MIN=-17367530.4451615
Y_MAX=7314540.8306386
CELL_SIZE=9008.055210146
SMAP_SHAPE=(1624, 3856)


def smap_grid_point(lat: float, lon: float):
    from pyproj import Transformer
    to_ease=Transformer.from_crs("EPSG:4326","EPSG:6933",always_xy=True)
    x,y=to_ease.transform(lon,lat)
    col=int(np.floor((x-X_MIN)/CELL_SIZE))
    row=int(np.floor((Y_MAX-y)/CELL_SIZE))
    if not (0<=row<SMAP_SHAPE[0] and 0<=col<SMAP_SHAPE[1]):
        raise ValueError("SMAP projected index out of global grid")
    inverse=Transformer.from_crs("EPSG:6933","EPSG:4326",always_xy=True)
    cell_lon,cell_lat=inverse.transform(X_MIN+(col+.5)*CELL_SIZE,Y_MAX-(row+.5)*CELL_SIZE)
    return row,col,float(cell_lat),float(cell_lon)


def _smap_scalar(ds, row: int, col: int, valid_range=(0,1)):
    value=float(ds[row,col])
    for attr in ("_FillValue", "missing_value"):
        if attr in ds.attrs and any(np.isclose(value,float(x)) for x in np.asarray(ds.attrs[attr]).reshape(-1)):
            return np.nan
    return value if np.isfinite(value) and valid_range[0]<=value<=valid_range[1] else np.nan


def extract_smap_point(path: Path, row:int, col:int):
    import h5py
    with h5py.File(path,"r") as h:
        grp=h["Geophysical_Data"]
        fields={"sm_surface":("soil_moisture_surface_m3_m3",(0,1)),
                "sm_rootzone":("soil_moisture_rootzone_m3_m3",(0,1)),
                "sm_rootzone_pctl":("soil_moisture_rootzone_percentile",(0,100))}
        result={}
        for field,(target,bounds) in fields.items():
            ds=grp[field]
            if ds.shape != SMAP_SHAPE:
                raise ValueError(f"SMAP unexpected shape: {field}={ds.shape}")
            result[target]=_smap_scalar(ds,row,col,bounds)
    match=re.search(r"gph_(\d{8}T\d{6})",path.name)
    if not match:
        raise ValueError("SMAP filename lacks recognizable UTC timestamp")
    result["datetime_utc"]=pd.to_datetime(match.group(1),format="%Y%m%dT%H%M%S",utc=True)
    result["source_file"]=path.name
    return result


def get_smap(ctx: ProviderContext):
    cfg=ctx.settings
    paths=_download(ctx,"SPL4SMGP","008",cfg.smap_start,cfg.smap_end,cfg.smap_max_granules,
                    "smap",("Geophysical_Data",))
    row,col,cell_lat,cell_lon=smap_grid_point(ctx.farmer.latitude,ctx.farmer.longitude)
    rows=[]
    for path in paths:
        item=extract_smap_point(path,row,col)
        item.update({"farm_id":ctx.farmer.farm_id,"cell_row":row,"cell_col":col,
                     "cell_lat":cell_lat,"cell_lon":cell_lon})
        rows.append(item)
    frame=pd.DataFrame(rows).sort_values("datetime_utc").reset_index(drop=True)
    if frame.datetime_utc.duplicated().any():
        raise ValueError("SMAP duplicate timestamps")
    warnings=[]
    if frame.soil_moisture_rootzone_percentile.isna().all():
        warnings.append("SMAP root-zone percentile unavailable (e.g. -9999), not imputed")
    return ProviderPayload(tables={"soil_moisture_timeseries":frame}, warnings=warnings,
       units={"soil_moisture_surface_m3_m3":"m3/m3", "soil_moisture_rootzone_m3_m3":"m3/m3",
              "soil_moisture_rootzone_percentile":"percentile"},
       spatial_resolution="EASE-Grid 2.0 nominal 9 km",temporal_resolution="3 hours",
       source_url="https://nsidc.org/data/spl4smgp/versions/8",
       provenance={"granules_downloaded":len(paths),"cell_row":row,"cell_col":col,
                   "cell_lat":cell_lat,"cell_lon":cell_lon,"method":"land-model data assimilation"})
