"""What NASA satellites observe in each municipality's farmland, by calendar month.

- MODIS NDVI (MOD13C2 v061, monthly, 0.05 deg, 2003-2025): greenness of cropland, weighted by the MCD12C1
  v061 cropland share (IGBP class 12, plus half of class 14, cropland/natural mosaic) within 15 km of the
  municipality point. It shows when fields are typically green or bare.
- SMAP root-zone soil moisture (SPL4SMGP v008, 0-100 cm, 9 km, 2015-2025): a land-model product that
  assimilates SMAP brightness temperatures, not a field measurement. Median by month, and the
  municipality's own dry and wet references (5th and 95th percentiles of daily values).

Both are read as box subsets through Earthdata OPeNDAP (`core/opendap.py`) and need an Earthdata login.
Method ported from field-shift (`src/rotations/observed.py`, `src/yield_panel/gridded.py`).
"""
from __future__ import annotations

import re
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime
from pathlib import Path

import numpy as np
import pandas as pd

from .common import DistrictSettings, UNIT, boxes_for, district_mean, sample

CMG = 0.05
NDVI_PRODUCT = "MODIS MOD13C2 v061 monthly NDVI (0.05 deg), LP DAAC OPeNDAP"
CROPLAND_PRODUCT = "MODIS MCD12C1 v061 land cover 2015, Land_Cover_Type_1_Percent"
SMAP_PRODUCT = "SMAP L4 SPL4SMGP v008 root-zone soil moisture (9 km), NSIDC OPeNDAP, one 3-hourly granule a day"
SMAP_SHORT, SMAP_VERSION = "SPL4SMGP", "008"
GRANULE_RE = re.compile(r"_(\d{8}T\d{6})_Vv(\d+)_")
DISTRICT_COLUMNS = ["ndvi", "ndvi_p20", "ndvi_p80", "smap_rootzone", "smap_relative"]


def _tag(bbox) -> str:
    return "_".join(f"{v:g}" for v in bbox)


def cmg_window(bbox):
    """Row/column ranges of the global 0.05 deg CMG grid (row 0 at 90N, column 0 at 180W)."""
    r0, r1 = int(round((90 - bbox[1]) / CMG)), int(round((90 - bbox[0]) / CMG)) - 1
    c0, c1 = int(round((bbox[2] + 180) / CMG)), int(round((bbox[3] + 180) / CMG)) - 1
    lat = 90 - CMG * (np.arange(r0, r1 + 1) + 0.5)
    lon = -180 + CMG * (np.arange(c0, c1 + 1) + 0.5)
    return (r0, r1, c0, c1), lat, lon


# --- MODIS NDVI ------------------------------------------------------------------------------------

def fetch_ndvi(years: tuple[int, int], bbox, cache_root: Path, workers: int = 4):
    """Monthly NDVI over the box; snow, cloud and fill pixels set to NaN. (months, cube, lat, lon), cached."""
    from ..core import opendap

    folder = Path(cache_root) / "modis_ndvi"
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / f"mod13c2_{years[0]}_{years[1]}_{_tag(bbox)}.npz"
    (r0, r1, c0, c1), lat, lon = cmg_window(bbox)
    if path.is_file():
        z = np.load(path)
        return pd.to_datetime(z["months"]), z["ndvi"], z["lat"], z["lon"]
    sess = opendap.session()
    granules = opendap.search("MOD13C2", "061", (f"{years[0]}-01-01", f"{years[1]}-12-31"))
    group = "/MOD_Grid_monthly_CMG_VI/Data_Fields/"
    names = ["CMG_0_05_Deg_Monthly_NDVI", "CMG_0_05_Deg_Monthly_pixel_reliability"]

    def one(granule):
        when = pd.Timestamp(granule["umm"]["TemporalExtent"]["RangeDateTime"]["BeginningDateTime"][:10])
        with opendap.dap4(sess, opendap.opendap_link(granule), [f"{group}{n}[{r0}:1:{r1}][{c0}:1:{c1}]" for n in names]) as f:
            ndvi, rel = (f[group.strip("/") + "/" + n][:] for n in names)
        bad = (ndvi == -3000) | (rel < 0) | (rel > 1)          # keep good (0) and marginal (1) pixels
        return when, np.where(bad, np.nan, ndvi * 1e-4).astype(np.float32)

    with ThreadPoolExecutor(workers) as pool:
        results = sorted(pool.map(one, granules), key=lambda r: r[0])
    if not results:
        raise RuntimeError("MOD13C2: no granules found")
    months = pd.DatetimeIndex([r[0] for r in results])
    cube = np.stack([r[1] for r in results])
    tmp = folder / f"{path.stem}.part.npz"
    np.savez_compressed(tmp, months=np.array(months.strftime("%Y-%m-%d"), dtype="U10"), ndvi=cube, lat=lat, lon=lon)
    tmp.replace(path)
    return months, cube, lat, lon


def fetch_cropland(bboxes: list, cache_root: Path, year: int = 2015) -> dict:
    """Cropland share per 0.05 deg cell for each box. MCD12C1 has no OPeNDAP service, so the ~1.2 GB global
    HDF4 file is downloaded once, cut to every box, and deleted. Needs pyhdf (extra `source-modis`)."""
    from ..core import opendap

    folder = Path(cache_root) / "modis_landcover"
    folder.mkdir(parents=True, exist_ok=True)
    out, todo = {}, []
    for bbox in bboxes:
        path = folder / f"mcd12c1_{year}_{_tag(bbox)}.npz"
        if path.is_file():
            out[bbox] = np.load(path)["cropland"]
        else:
            todo.append(bbox)
    if not todo:
        return out
    from pyhdf.SD import SD, SDC

    granules = opendap.search("MCD12C1", "061", (f"{year}-01-01", f"{year}-12-31"))
    files = [opendap.download(granules[0], folder, opendap.session())]
    hdf = SD(str(files[0]), SDC.READ)
    try:
        for bbox in todo:
            (r0, r1, c0, c1), lat, lon = cmg_window(bbox)
            pct = hdf.select("Land_Cover_Type_1_Percent")[r0:r1 + 1, c0:c1 + 1, :].astype(np.float32)
            cropland = (pct[:, :, 12] + 0.5 * pct[:, :, 14]) / 100.0
            np.savez_compressed(folder / f"mcd12c1_{year}_{_tag(bbox)}.npz", cropland=cropland, lat=lat, lon=lon)
            out[bbox] = cropland
    finally:
        hdf.end()
        Path(files[0]).unlink(missing_ok=True)
    return out


def ndvi_monthly(points: pd.DataFrame, s: DistrictSettings, warnings: list | None = None) -> pd.DataFrame:
    """ndvi, ndvi_p20, ndvi_p80 by calendar month per municipality, and whether cropland weighting was used.

    Without pyhdf (extra `source-modis`) the cropland mask cannot be read: NDVI is then the plain mean
    within the radius, `ndvi_cropland_weighted` is False, and a warning says so.
    """
    from ..core import opendap

    opendap.session()                       # fail early, as "missing", when there are no credentials
    boxes = boxes_for(points, s.box_margin_deg)
    try:
        cropland = fetch_cropland([b for b, _ in boxes], s.cache_root)
    except ImportError:
        cropland = {}
        if warnings is not None:
            warnings.append("pyhdf not installed (pip install -e '.[source-modis]'): NDVI is not cropland-weighted")
    rows = []
    for bbox, sub in boxes:
        months, cube, lat, lon = fetch_ndvi(s.ndvi_years, bbox, s.cache_root, s.workers)
        values, used = sample(cube, lat, lon, zip(sub["lat"], sub["lon"]), s.ndvi_radius_km, weights=cropland.get(bbox))
        frame = pd.DataFrame(values, index=months)
        by = frame.groupby(frame.index.month)
        med, p20, p80 = by.median(), by.quantile(0.2), by.quantile(0.8)
        for k, m in enumerate(sub[UNIT].itertuples(index=False)):
            for month in range(1, 13):
                rows.append({"state_id": int(m.state_id), "mun_id": int(m.mun_id), "month": month,
                             "ndvi": med.loc[month, k], "ndvi_p20": p20.loc[month, k], "ndvi_p80": p80.loc[month, k],
                             "ndvi_cropland_weighted": bool(used[k])})
    return pd.DataFrame(rows)


# --- SMAP L4 ---------------------------------------------------------------------------------------

def granule_info(granule):
    """(timestamp UTC, processing build) parsed from the granule name."""
    match = GRANULE_RE.search(granule["umm"]["GranuleUR"])
    return datetime.strptime(match.group(1), "%Y%m%dT%H%M%S"), int(match.group(2))


def latest_builds(granules):
    """One granule per 3-hourly timestamp: the most recent processing build."""
    best = {}
    for g in granules:
        t, build = granule_info(g)
        if t not in best or build > granule_info(best[t])[1]:
            best[t] = g
    return [best[t] for t in sorted(best)]


def smap_years(start: date, end: date, bbox, cache_root: Path, hour: str = "13:30", workers: int = 6, log=print):
    """Yield (days, rootzone cube, lat, lon) per year: the `hour` UTC granule of each day. Cached per year."""
    from ..core import opendap

    folder = Path(cache_root) / "smap_box"
    folder.mkdir(parents=True, exist_ok=True)
    tag = _tag(bbox)
    grid_path = folder / f"grid_{tag}.npz"
    sess = rows = cols = lat = lon = None
    for year in range(start.year, end.year + 1):
        path = folder / f"{year}_{tag}.npz"
        if path.is_file():
            z = np.load(path)
            yield pd.to_datetime(z["days"]), z["rootzone"], z["lat"], z["lon"]
            continue
        sess = sess or opendap.session()
        y0, y1 = max(start, date(year, 1, 1)), min(end, date(year, 12, 31))
        granules = [g for g in latest_builds(opendap.search(SMAP_SHORT, SMAP_VERSION, (str(y0), str(y1))))
                    if granule_info(g)[0].strftime("%H:%M") == hour]
        if not granules:
            continue
        if rows is None:
            if grid_path.is_file():
                z = np.load(grid_path)
                rows, cols, lat, lon = tuple(z["rows"]), tuple(z["cols"]), z["lat"], z["lon"]
            else:
                url = opendap.opendap_link(granules[0])
                # cell_lat and cell_lon share the (y, x) dimensions; one DAP4 request cannot slice a shared
                # dimension two ways, so they are separate requests.
                with opendap.dap4(sess, url, ["/cell_lat[0:1:1623][0:1:0]"]) as f:
                    lats = f["cell_lat"][:, 0]
                with opendap.dap4(sess, url, ["/cell_lon[0:1:0][0:1:3855]"]) as f:
                    lons = f["cell_lon"][0, :]
                iy = np.where((lats >= bbox[0]) & (lats <= bbox[1]))[0]
                ix = np.where((lons >= bbox[2]) & (lons <= bbox[3]))[0]
                rows, cols = (int(iy.min()), int(iy.max())), (int(ix.min()), int(ix.max()))
                lat, lon = lats[rows[0]:rows[1] + 1], lons[cols[0]:cols[1] + 1]
                np.savez(grid_path, rows=rows, cols=cols, lat=lat, lon=lon)
        sl = f"[{rows[0]}:1:{rows[1]}][{cols[0]}:1:{cols[1]}]"

        def one(granule):
            with opendap.dap4(sess, opendap.opendap_link(granule), [f"/Geophysical_Data/sm_rootzone{sl}"]) as f:
                rz = f["Geophysical_Data/sm_rootzone"][:]
            return granule_info(granule)[0], np.where(rz < 0, np.nan, rz).astype(np.float32)

        with ThreadPoolExecutor(workers) as pool:
            results = sorted(pool.map(one, granules), key=lambda r: r[0])
        days = pd.DatetimeIndex([pd.Timestamp(r[0].date()) for r in results])
        rz = np.stack([r[1] for r in results])
        tmp = folder / f"{path.stem}.part.npz"
        np.savez_compressed(tmp, rootzone=rz, lat=lat, lon=lon, days=np.array([str(d.date()) for d in days]))
        tmp.replace(path)
        log(f"SMAP {year} box {bbox}: {len(days)} days")
        yield days, rz, lat, lon


def smap_monthly(points: pd.DataFrame, s: DistrictSettings, log=print) -> pd.DataFrame:
    """smap_rootzone (median of monthly means), smap_dry/smap_wet (5th/95th pct of daily) and smap_relative."""
    start = date.fromisoformat(s.smap_start)
    start = max(start, date(s.smap_years[0], 1, 1))
    end = date(s.smap_years[1], 12, 31)
    rows = []
    for bbox, sub in boxes_for(points, s.box_margin_deg):
        daily_all = []
        for days, rz, lat, lon in smap_years(start, end, bbox, s.cache_root, s.smap_hour_utc, s.workers + 2, log):
            values, _ = sample(rz, lat, lon, zip(sub["lat"], sub["lon"]), s.smap_radius_km)
            daily_all.append(pd.DataFrame(values, index=days))
        if not daily_all:
            continue
        daily = pd.concat(daily_all)
        monthly = daily.groupby([daily.index.year, daily.index.month]).mean()
        med = monthly.groupby(level=1).median()
        dry, wet = daily.quantile(0.05), daily.quantile(0.95)
        for k, m in enumerate(sub[UNIT].itertuples(index=False)):
            for month in range(1, 13):
                rows.append({"state_id": int(m.state_id), "mun_id": int(m.mun_id), "month": month,
                             "smap_rootzone": med.loc[month, k] if month in med.index else np.nan,
                             "smap_dry": dry[k], "smap_wet": wet[k]})
    out = pd.DataFrame(rows, columns=[*UNIT, "month", "smap_rootzone", "smap_dry", "smap_wet"])
    span = (out["smap_wet"] - out["smap_dry"]).where(lambda x: x > 0.01)
    out["smap_relative"] = ((out["smap_rootzone"] - out["smap_dry"]) / span).clip(0, 1)
    return out


def combine(points: pd.DataFrame, weights: pd.DataFrame, ndvi: pd.DataFrame | None, smap: pd.DataFrame | None):
    """observed_municipal and observed_district from whichever of NDVI and SMAP is available."""
    base = pd.DataFrame([{"state_id": int(m.state_id), "mun_id": int(m.mun_id), "month": month}
                         for m in points[UNIT].itertuples(index=False) for month in range(1, 13)])
    ndvi = ndvi if ndvi is not None else pd.DataFrame(columns=[*UNIT, "month", "ndvi", "ndvi_p20", "ndvi_p80",
                                                                "ndvi_cropland_weighted"])
    smap = smap if smap is not None else pd.DataFrame(columns=[*UNIT, "month", "smap_rootzone", "smap_dry",
                                                                "smap_wet", "smap_relative"])
    keys = [*UNIT, "month"]
    municipal = base.merge(ndvi.astype({k: "int64" for k in keys}), on=keys, how="left").merge(
        smap.astype({k: "int64" for k in keys}), on=keys, how="left")
    cols = ["ndvi", "ndvi_p20", "ndvi_p80", "smap_rootzone", "smap_dry", "smap_wet", "smap_relative"]
    municipal[cols] = municipal[cols].astype(float)
    municipal["ndvi_cropland_weighted"] = municipal["ndvi_cropland_weighted"].fillna(False).astype(bool)
    municipal = municipal[[*keys, "ndvi", "ndvi_p20", "ndvi_p80", "ndvi_cropland_weighted",
                           "smap_rootzone", "smap_dry", "smap_wet", "smap_relative"]]
    district = district_mean(municipal, weights, ("month",), DISTRICT_COLUMNS)
    return {"observed_municipal": municipal, "observed_district": district}
