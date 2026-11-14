"""Default direct providers from the exploratory master notebook.

Providers only retrieve source data: they do not calculate agronomic claims or
choose crops. All remote access is bounded by BuilderSettings; failures are
recorded by the builder without silently substituting fabricated values.
"""
from __future__ import annotations
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
import hashlib
import json
import math
import os

import numpy as np
import pandas as pd

from .schema import FarmerInput
from .settings import BuilderSettings
from .transport import CachedHTTP


@dataclass
class ProviderPayload:
    tables: dict[str, pd.DataFrame] = field(default_factory=dict)
    provenance: dict[str, object] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)
    units: dict[str, str] = field(default_factory=dict)
    spatial_resolution: str = ""
    temporal_resolution: str = ""
    source_url: str = ""
    extra: dict[str, object] = field(default_factory=dict)


@dataclass
class ProviderContext:
    farmer: FarmerInput
    settings: BuilderSettings
    http: CachedHTTP
    run_dir: Path


POWER_URL = "https://power.larc.nasa.gov/api/temporal/daily/point"
POWER_PARAMETERS = ("T2M", "T2M_MIN", "T2M_MAX", "PRECTOTCORR", "RH2M", "ALLSKY_SFC_SW_DWN", "WS2M")


def get_power(ctx: ProviderContext) -> ProviderPayload:
    f, cfg = ctx.farmer, ctx.settings
    payload = ctx.http.json(POWER_URL, {
        "parameters": ",".join(POWER_PARAMETERS), "community": "AG", "longitude": f.longitude,
        "latitude": f.latitude, "start": cfg.weather_start.strftime("%Y%m%d"),
        "end": cfg.weather_end.strftime("%Y%m%d"), "format": "JSON"}, timeout=90)
    params = payload.get("properties", {}).get("parameter", {})
    if set(POWER_PARAMETERS) - set(params):
        raise ValueError(f"POWER missing expected parameters: {set(POWER_PARAMETERS)-set(params)}")
    columns = {k: pd.Series(v, dtype=float) for k, v in params.items()}
    df = pd.DataFrame(columns)
    df.index = pd.to_datetime(df.index, format="%Y%m%d", errors="raise")
    df.index.name = "date"
    df = df.reset_index().rename(columns={
        "T2M": "tmean_c", "T2M_MIN": "tmin_c", "T2M_MAX": "tmax_c", "PRECTOTCORR": "precip_mm",
        "RH2M": "rh_pct", "WS2M": "wind_m_s", "ALLSKY_SFC_SW_DWN": "solar_raw"})
    numeric = df.select_dtypes(include="number").columns
    df[numeric] = df[numeric].replace([-999.0, -9999.0], np.nan)
    solar_meta = payload.get("parameters", {}).get("ALLSKY_SFC_SW_DWN", {})
    solar_unit = str(solar_meta.get("units", "")).strip().lower().replace("²", "^2")
    if solar_unit in {"mj/m^2/day", "mj/m2/day"}:
        df["solar_mj_m2_day"] = df["solar_raw"]
    elif solar_unit in {"kwh/m^2/day", "kwh/m2/day", "kw-hr/m^2/day"}:
        df["solar_mj_m2_day"] = df["solar_raw"] * 3.6
    else:
        raise ValueError(f"Unrecognized POWER solar unit {solar_unit!r}: refuse silent conversion")
    df = df.drop(columns=["solar_raw"])
    df["farm_id"] = f.farm_id
    return ProviderPayload(tables={"weather_daily": df}, units={
        "tmean_c": "°C", "tmin_c": "°C", "tmax_c": "°C", "precip_mm": "mm/day",
        "rh_pct": "%", "wind_m_s": "m/s", "solar_mj_m2_day": "MJ/m²/day"},
        temporal_resolution="daily", spatial_resolution="POWER grid, variable-dependent ~0.5°",
        source_url=POWER_URL, provenance={"original_solar_unit": solar_unit, "power_meta": payload.get("parameters", {})})


def get_srtm(ctx: ProviderContext) -> ProviderPayload:
    lat, lon = ctx.farmer.latitude, ctx.farmer.longitude
    dlat, dlon = 0.00030, 0.00030 / max(0.3, math.cos(math.radians(lat)))
    locations = [(lat, lon), (lat+dlat, lon), (lat-dlat, lon), (lat, lon+dlon), (lat, lon-dlon)]
    url = "https://api.opentopodata.org/v1/srtm30m"
    payload = ctx.http.json(url, {"locations": "|".join(f"{a:.6f},{b:.6f}" for a, b in locations)})
    results = payload.get("results", [])
    if len(results) != 5:
        raise ValueError("SRTM must return five elevation samples")
    df = pd.DataFrame([{"sample": name, "lat": r["location"]["lat"], "lon": r["location"]["lng"],
                        "elevation_m": r.get("elevation"), "farm_id": ctx.farmer.farm_id}
                       for name, r in zip(("center", "north", "south", "east", "west"), results)])
    elev = pd.to_numeric(df.elevation_m, errors="coerce")
    topo: dict[str, float | None] = {"elevation_m": float(elev.iloc[0]) if pd.notna(elev.iloc[0]) else None,
                                     "slope_deg_approx": None}
    if elev.notna().all():
        dy, dx = 2*dlat*111_320, 2*dlon*111_320*math.cos(math.radians(lat))
        dzdy = (elev.iloc[1]-elev.iloc[2]) / dy
        dzdx = (elev.iloc[3]-elev.iloc[4]) / dx
        topo["slope_deg_approx"] = math.degrees(math.atan(math.hypot(dzdx, dzdy)))
    return ProviderPayload(tables={"topography_samples": df}, extra={"topography": topo},
       units={"elevation_m": "m", "slope_deg_approx": "degrees"}, spatial_resolution="SRTM30m / approximate local slope",
       source_url=url, provenance={"method": "5-point centered finite difference; not a parcel-level survey"})


SOIL_SPECS = {
    "bdod": (100., "kg/dm3"), "cec": (10., "cmol(c)/kg"), "cfvo": (10., "vol%"),
    "clay": (10., "%"), "nitrogen": (100., "g/kg"), "phh2o": (10., "pH"),
    "sand": (10., "%"), "silt": (10., "%"), "soc": (10., "g/kg"),
    "wv0010": (10., "vol%"), "wv0033": (10., "vol%"), "wv1500": (10., "vol%")
}
SOIL_PILOT = ("phh2o", "soc", "clay", "sand", "bdod", "nitrogen", "wv0033", "wv1500")
SOIL_DEPTHS = ("0-5cm", "5-15cm", "15-30cm", "30-60cm", "60-100cm", "100-200cm")


def get_soilgrids(ctx: ProviderContext) -> ProviderPayload:
    """ISRIC WCS 1.0 point rasters; optional dependency; never infer unavailable coverages."""
    from owslib.wcs import WebCoverageService
    from rasterio.io import MemoryFile
    from pyproj import CRS
    f, cfg = ctx.farmer, ctx.settings
    lat, lon = f.latitude, f.longitude
    bbox = (lon-0.004, lat-0.004, lon+0.004, lat+0.004)
    target = CRS.from_epsg(4326)
    properties = SOIL_PILOT if cfg.soil_scope == "pilot" else tuple(SOIL_SPECS)
    depths = SOIL_DEPTHS[:3] if cfg.soil_scope == "pilot" else SOIL_DEPTHS
    stats = ("mean",) if cfg.soil_scope == "pilot" else ("mean", "Q0.05", "Q0.5", "Q0.95")
    out, failures, attempts = [], [], 0
    cache_dir = cfg.cache_root / "soilgrids"
    cache_dir.mkdir(parents=True, exist_ok=True)
    for prop in properties:
        service = f"https://maps.isric.org/mapserv?map=/map/{prop}.map"
        try:
            wcs = WebCoverageService(service, version="1.0.0", timeout=min(90, cfg.http_timeout_s*2))
            offered = set(wcs.contents)
        except Exception as ex:
            failures.append(f"{prop}: metadata unavailable ({type(ex).__name__})")
            continue
        for depth in depths:
            for stat in stats:
                cid = f"{prop}_{depth}_{stat}"
                if cid not in offered:
                    continue
                if attempts >= cfg.soil_max_requests:
                    failures.append("soil_max_requests reached")
                    break
                attempts += 1
                signature = hashlib.sha256(json.dumps([cid, bbox, 0.002]).encode()).hexdigest()[:16]
                path = cache_dir / f"{cid}_{signature}.tif"
                try:
                    if cfg.cache_enabled and path.exists():
                        payload = path.read_bytes()
                    else:
                        payload = wcs.getCoverage(identifier=cid, crs="urn:ogc:def:crs:EPSG::4326",
                                  bbox=bbox, resx=0.002, resy=0.002, format="GEOTIFF_INT16").read()
                    with MemoryFile(payload) as m:
                        with m.open() as ds:
                            if ds.crs is None or not CRS.from_wkt(ds.crs.to_wkt()).equals(target, ignore_axis_order=True):
                                raise ValueError("unexpected CRS")
                            if not (ds.bounds.left <= lon <= ds.bounds.right and ds.bounds.bottom <= lat <= ds.bounds.top):
                                raise ValueError("raster does not contain requested coordinates")
                            row, col = ds.index(lon, lat)
                            raw = ds.read(1, masked=True)[row, col]
                            if np.ma.is_masked(raw):
                                continue
                            scalar = float(raw)
                    if cfg.cache_enabled and not path.exists():
                        path.write_bytes(payload)
                    divisor, unit = SOIL_SPECS[prop]
                    out.append({"farm_id": f.farm_id, "property": prop, "depth": depth,
                                "statistic": stat, "coverage": cid, "raw_pixel": scalar,
                                "value": scalar/divisor, "unit": unit, "lat": lat, "lon": lon})
                except Exception as exc:
                    failures.append(f"{cid}: {type(exc).__name__}: {str(exc)[:80]}")
    if not out:
        raise ValueError("SoilGrids returned no valid coverages; " + "; ".join(failures[:4]))
    return ProviderPayload(tables={"soil_properties_raw": pd.DataFrame(out)},
       warnings=failures, units={k: unit for k, (_, unit) in SOIL_SPECS.items()},
       spatial_resolution="SoilGrids nominal 250 m; WCS sample request 0.002°", source_url="https://maps.isric.org/",
       provenance={"attempted_coverages": attempts, "retrieved_coverages": len(out), "scope": cfg.soil_scope})


ORNL = "https://modis.ornl.gov/rst/api/v1"
MODIS_BANDS = {
    "MOD13Q1": ("250m_16_days_NDVI", "250m_16_days_EVI", "250m_16_days_VI_Quality", "250m_16_days_pixel_reliability"),
    "MOD11A2": ("LST_Day_1km", "LST_Night_1km", "QC_Day", "QC_Night"),
    "MOD16A2GF": ("ET_500m", "PET_500m", "ET_QC_500m"),
}
MODIS_TABLES = {"MOD13Q1": "vegetation_timeseries", "MOD11A2": "land_surface_temperature", "MOD16A2GF": "evapotranspiration"}


def get_modis(ctx: ProviderContext, product: str) -> ProviderPayload:
    """Discover -> bounded 10-date retrieval -> native raw table (scaling later)."""
    if product not in MODIS_BANDS:
        raise ValueError(f"unknown MODIS product: {product}")
    f, cfg = ctx.farmer, ctx.settings
    bands = ctx.http.json(f"{ORNL}/{product}/bands")
    dates = ctx.http.json(f"{ORNL}/{product}/dates", {"latitude": f.latitude, "longitude": f.longitude})
    bdf = pd.DataFrame(bands["bands"] if isinstance(bands, dict) else bands)
    calendar = pd.DataFrame(dates["dates"] if isinstance(dates, dict) else dates)
    required = {"modis_date", "calendar_date"}
    if not required.issubset(calendar):
        raise ValueError(f"MODIS date response missing {required-set(calendar)}")
    calendar["calendar_date"] = pd.to_datetime(calendar["calendar_date"], errors="raise")
    filtered = calendar.loc[calendar.calendar_date.between(pd.Timestamp(cfg.modis_start), pd.Timestamp(cfg.modis_end))].sort_values("calendar_date")
    if filtered.empty:
        raise ValueError("no MODIS dates within requested window")
    rows=[]
    for i in range(0, len(filtered), 10):
        b = filtered.iloc[i:i+10]
        res = ctx.http.json(f"{ORNL}/{product}/subset", {
            "latitude": f.latitude, "longitude": f.longitude, "startDate": b.iloc[0]["modis_date"],
            "endDate": b.iloc[-1]["modis_date"], "kmAboveBelow": 0, "kmLeftRight": 0})
        if (int(res.get("nrows", 0)), int(res.get("ncols", 0))) != (1, 1):
            raise ValueError("MODIS subset expected 1x1 pixel")
        for item in res.get("subset", []):
            if item.get("band") not in MODIS_BANDS[product]:
                continue
            values = item.get("data", [])
            if len(values) != 1:
                raise ValueError("unexpected MODIS pixel count")
            rows.append({"modis_date": item["modis_date"], "band": item["band"], "raw": values[0]})
    raw = pd.DataFrame(rows)
    if raw.empty:
        raise ValueError("MODIS subset empty")
    if raw.duplicated(subset=["modis_date", "band"]).any():
        raise ValueError("duplicate MODIS date/band combination")
    frame=raw.pivot(index="modis_date", columns="band", values="raw").reset_index()
    frame=frame.merge(filtered[["modis_date", "calendar_date"]], on="modis_date", how="left", validate="one_to_one")
    frame=frame.rename(columns={"calendar_date": "date"}).sort_values("date").reset_index(drop=True)
    frame["farm_id"] = f.farm_id
    return ProviderPayload(tables={MODIS_TABLES[product]: frame},
       source_url=f"{ORNL}/{product}/subset", temporal_resolution="16d" if product=="MOD13Q1" else "8d",
       spatial_resolution={"MOD13Q1":"250m","MOD11A2":"1km","MOD16A2GF":"500m"}[product],
       provenance={"product": product, "bands_metadata": bdf.to_dict(orient="records"), "expected_dates": len(filtered)})


WB_CODES={"AG.PRD.CROP.XD":"crop_production_index", "AG.LND.AGRI.ZS":"agricultural_land_share_pct", "AG.YLD.CREL.KG":"cereal_yield_kg_ha"}

def get_worldbank(ctx: ProviderContext) -> ProviderPayload:
    country = ctx.farmer.country_iso3
    if not country:
        raise ValueError("country_iso3 absent")
    records=[]
    for code, label in WB_CODES.items():
        data=ctx.http.json(f"https://api.worldbank.org/v2/country/{country}/indicator/{code}",
                           {"format":"json","per_page":100})
        if not isinstance(data, list) or len(data)<2:
            raise ValueError("unexpected WorldBank schema")
        for row in (data[1] or []):
            if row.get("value") is not None:
                records.append({"farm_id":ctx.farmer.farm_id,"country":country,"year":int(row["date"]),
                                "indicator":label,"value":float(row["value"]),"unit":"see indicator definition"})
    return ProviderPayload(tables={"country_agriculture_context":pd.DataFrame(records)},
                           source_url="https://api.worldbank.org/v2/", spatial_resolution="country",temporal_resolution="annual")


def get_usda(ctx: ProviderContext) -> ProviderPayload:
    key=os.getenv("USDA_NASS_API_KEY")
    if not key:
        raise ValueError("USDA_NASS_API_KEY is not configured")
    data=ctx.http.json("https://quickstats.nass.usda.gov/api/api_GET/",{
        "key":key,"source_desc":"SURVEY","sector_desc":"CROPS","commodity_desc":"CORN",
        "statisticcat_desc":"YIELD","agg_level_desc":"STATE","state_alpha":"IA",
        "year__GE":"2020","format":"JSON"})
    if not isinstance(data.get("data"), list):
        raise ValueError("unexpected USDA response")
    return ProviderPayload(tables={"usda_iowa_yield":pd.DataFrame(data["data"])},
                           source_url="https://quickstats.nass.usda.gov/api/",spatial_resolution="Iowa state")


def get_faostat(ctx: ProviderContext, domain: str) -> ProviderPayload:
    token = os.getenv("FAOSTAT_JWT")
    if not token:
        raise ValueError("FAOSTAT_JWT not set")
    if not ctx.farmer.country_iso3:
        raise ValueError("country_iso3 is required")
    # Portal-specific authentication; a 401 is reported as error, never falls back to invented data.
    url=f"https://faostatservices.fao.org/api/v1/en/data/{domain}"
    response=ctx.http.session.get(url,params={"area":ctx.farmer.country_iso3,"year":"2022,2023,2024",
                  "page":1,"page_size":100},headers={"Authorization":f"Bearer {token}","Accept":"application/json"},
                  timeout=ctx.settings.http_timeout_s)
    response.raise_for_status()
    rows=response.json().get("data")
    if not isinstance(rows,list):
        raise ValueError("unrecognized FAOSTAT response")
    name="faostat_production" if domain=="QCL" else "faostat_prices"
    return ProviderPayload(tables={name:pd.DataFrame(rows)},source_url=url,spatial_resolution="country")


DEFAULT_FUNCTIONS = {
    "nasa_power": get_power,
    "srtm": get_srtm,
    "soilgrids_wcs": get_soilgrids,
    "modis_mod13q1": lambda c:get_modis(c,"MOD13Q1"),
    "modis_mod11a2": lambda c:get_modis(c,"MOD11A2"),
    "modis_mod16a2gf": lambda c:get_modis(c,"MOD16A2GF"),
    "worldbank_agriculture": get_worldbank,
    "usda_quickstats": get_usda,
    "faostat_production": lambda c:get_faostat(c,"QCL"),
    "faostat_prices": lambda c:get_faostat(c,"PP"),
}
