"""Monthly climate per municipality and district from NASA POWER daily data, rain corrected with CHIRPS.

Per municipality, POWER is read at the centre of the MERRA-2 cell (0.5 x 0.625 deg) that contains the
municipality's farmland point, through source_builder's own provider (`core.providers.get_power`).
Two tables come out of the same daily series:
- monthly values by year, 1982-2025: rain, FAO-56 reference ET (ET0), mean Tmin and Tmax, frost nights
  (Tmin <= 2 C), heat days (Tmax >= 35 C). The engine computes trends from this table over each crop's
  own season, and water balances over 2001-2025;
- monthly normals, 2001-2025, plus the share of years with frost in each month and the 20th percentile
  of monthly rain.

Rain correction: POWER rain is MERRA-2 corrected precipitation on a ~55 x 65 km cell; CHIRPS blends
satellite rain with station gauges at 0.05 deg. Per municipality, the ratio of CHIRPS to POWER mean rain
over 2001-2025 is computed for May-October and for November-April (clipped to 0.3-3) and applied to that
municipality's rain in every year. One fixed ratio per season keeps the 1982-2025 series free of a step
at 1999, when CHIRPS starts, so trends are not distorted.
"""
from __future__ import annotations

import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd

from .common import DistrictSettings, UNIT, boxes_for, district_mean, sample

LAT_STEP, LON_STEP = 0.5, 0.625
FAO_WIND = 2.0
SEASON_MONTHS = range(5, 11)
CHIRPS_COG = "https://data.chc.ucsb.edu/products/CHIRPS/v2.0/global_monthly/cogs/chirps-v2.0.{year}.{month:02d}.cog"
POWER_PRODUCT = "NASA POWER daily point API, AG community (MERRA-2 meteorology)"
CHIRPS_PRODUCT = "CHIRPS v2.0 monthly, 0.05 deg (Cloud-Optimized GeoTIFF)"
NORMAL_COLUMNS = ["rain", "et0", "tmin", "tmax", "frost_prob", "frost_nights", "heat_days", "rain_p20"]
YEAR_COLUMNS = ["rain", "et0", "tmin", "tmax", "frost_nights", "heat_days"]


def snap(lat, lon):
    """Centre of the MERRA-2 / POWER meteorology cell containing (lat, lon)."""
    lat_c = np.round(np.asarray(lat, float) / LAT_STEP) * LAT_STEP
    lon_c = np.round((np.asarray(lon, float) + 180) / LON_STEP) * LON_STEP - 180
    return np.round(lat_c, 3), np.round(lon_c, 3)


def et0_penman_monteith(daily: pd.DataFrame, lat_deg: float, elevation_m: float, wind=None) -> pd.Series:
    """FAO-56 eq. 6 (Allen et al. 1998) from daily Tmax, Tmin, RH (%), all-sky shortwave (MJ m-2 d-1).

    `wind` is the 2 m wind speed (m/s): a daily Series, or None for the FAO-56 default of 2 m/s.
    """
    tmax, tmin = daily["tmax_c"].to_numpy(float), daily["tmin_c"].to_numpy(float)
    tmean = (tmax + tmin) / 2
    rs = daily["solar_mj_m2_day"].to_numpy(float)
    rh = daily["rh_pct"].to_numpy(float)
    u2 = np.full(len(daily), FAO_WIND) if wind is None else np.asarray(wind, float)
    doy = daily.index.dayofyear.to_numpy()

    pressure = 101.3 * ((293 - 0.0065 * elevation_m) / 293) ** 5.26
    gamma = 0.000665 * pressure
    e_sat = lambda t: 0.6108 * np.exp(17.27 * t / (t + 237.3))
    es = (e_sat(tmax) + e_sat(tmin)) / 2
    ea = np.clip(rh / 100, 0, 1) * es
    delta = 4098 * e_sat(tmean) / (tmean + 237.3) ** 2

    phi = np.radians(lat_deg)
    dr = 1 + 0.033 * np.cos(2 * np.pi * doy / 365)
    decl = 0.409 * np.sin(2 * np.pi * doy / 365 - 1.39)
    ws = np.arccos(np.clip(-np.tan(phi) * np.tan(decl), -1, 1))
    ra = 24 * 60 / np.pi * 0.0820 * dr * (ws * np.sin(phi) * np.sin(decl) + np.cos(phi) * np.cos(decl) * np.sin(ws))
    rso = (0.75 + 2e-5 * elevation_m) * ra
    rns = 0.77 * rs
    ratio = np.clip(rs / np.where(rso > 0, rso, np.nan), 0.25, 1.0)
    rnl = 4.903e-9 * ((tmax + 273.16) ** 4 + (tmin + 273.16) ** 4) / 2 * (0.34 - 0.14 * np.sqrt(ea)) * (1.35 * ratio - 0.35)
    rn = rns - rnl
    et0 = (0.408 * delta * rn + gamma * 900 / (tmean + 273) * u2 * (es - ea)) / (delta + gamma * (1 + 0.34 * u2))
    return pd.Series(np.maximum(et0, 0), index=daily.index)


def monthly(daily: pd.DataFrame, lat: float, elevation_m: float, years: tuple[int, int], s: DistrictSettings):
    """(monthly values by year, monthly normals) over `years` from one daily POWER series."""
    d = daily.loc[f"{years[0]}-01-01":f"{years[1]}-12-31"].copy()
    wind = d["wind_m_s"] if s.et0_wind == "power" else None
    d["et0"] = et0_penman_monteith(d, lat, elevation_m, wind)
    # A few days lack radiation (or wind): fill ET0 with that calendar month's mean so monthly sums stay comparable.
    d["et0"] = d["et0"].fillna(d.groupby(d.index.month)["et0"].transform("mean"))
    d["frost"] = d["tmin_c"] <= s.frost_c
    d["heat"] = d["tmax_c"] >= s.heat_c
    by = d.groupby([d.index.year.rename("year"), d.index.month.rename("month")])
    per_year = by.agg(rain=("precip_mm", "sum"), et0=("et0", "sum"), tmin=("tmin_c", "mean"),
                      tmax=("tmax_c", "mean"), frost_nights=("frost", "sum"), heat_days=("heat", "sum"))
    per_year["frost_year"] = per_year["frost_nights"] > 0
    normals = per_year.groupby("month").agg(rain=("rain", "mean"), et0=("et0", "mean"), tmin=("tmin", "mean"),
                                            tmax=("tmax", "mean"), frost_prob=("frost_year", "mean"),
                                            frost_nights=("frost_nights", "mean"), heat_days=("heat_days", "mean"),
                                            rain_p20=("rain", lambda x: x.quantile(0.2)))
    per_year = per_year.drop(columns="frost_year").reset_index()
    per_year[["frost_nights", "heat_days"]] = per_year[["frost_nights", "heat_days"]].astype(float)
    return per_year, normals.reset_index()


def power_context(lat: float, lon: float, s: DistrictSettings, http, run_dir: Path):
    """A source_builder ProviderContext for one POWER cell, so `get_power` is reused unchanged."""
    from ..core.providers import ProviderContext
    from ..core.schema import FarmerInput
    from ..core.settings import BuilderSettings

    tag = f"{lat:+08.3f}_{lon:+09.3f}".replace("+", "p").replace("-", "m").replace(".", "d")
    farmer = FarmerInput.model_validate({"farm_id": f"power_cell_{tag}", "latitude": lat, "longitude": lon,
                                         "fields": [{"field_id": "cell", "area_ha": 1}]})
    settings = BuilderSettings(output_root=s.output_root, cache_root=s.cache_root,
                               weather_start=date(s.weather_years[0], 1, 1), weather_end=date(s.weather_years[1], 12, 31),
                               http_timeout_s=min(s.http_timeout_s, 300))
    return ProviderContext(farmer=farmer, settings=settings, http=http, run_dir=run_dir)


def fetch_power_cells(cells: list[tuple[float, float]], s: DistrictSettings, run_dir: Path, log=print) -> dict:
    """Daily POWER per cell (date index), via core.providers.get_power and its on-disk HTTP cache."""
    from ..core.providers import get_power
    from ..core.transport import CachedHTTP

    http = CachedHTTP(Path(s.cache_root), timeout=min(s.http_timeout_s, 300), retries=3, ttl_hours=24 * 365 * 5)
    out = {}
    for lat, lon in cells:
        payload = get_power(power_context(lat, lon, s, http, run_dir))
        daily = payload.tables["weather_daily"].set_index("date").sort_index()
        out[(lat, lon)] = daily
        log(f"POWER cell {lat:+.3f},{lon:+.3f}: {len(daily):,} days")
    return out


# --- CHIRPS ----------------------------------------------------------------------------------------

def read_chirps_month(year: int, month: int, bbox, cache_root: Path, retries: int = 5):
    """One CHIRPS monthly box (mm), cached as .npz. bbox = (lat_min, lat_max, lon_min, lon_max)."""
    import rasterio
    from rasterio.windows import from_bounds

    folder = Path(cache_root) / "chirps_monthly"
    folder.mkdir(parents=True, exist_ok=True)
    tag = "_".join(f"{v:g}" for v in bbox)
    path = folder / f"{year}_{month:02d}_{tag}.npz"
    if path.is_file():
        z = np.load(path)
        return z["rain"], z["lat"], z["lon"]
    url = CHIRPS_COG.format(year=year, month=month)
    last = None
    for attempt in range(retries):
        try:
            with rasterio.Env(GDAL_HTTP_MAX_RETRY="4", GDAL_HTTP_RETRY_DELAY="3",
                              GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".cog"):
                with rasterio.open(url) as src:
                    window = from_bounds(bbox[2], bbox[0], bbox[3], bbox[1], src.transform).round_offsets().round_lengths()
                    rain = src.read(1, window=window).astype(np.float32)
                    t = src.window_transform(window)
            break
        except Exception as exc:     # rate limits (429) and transient network errors
            last = exc
            time.sleep(3 * 2 ** attempt)
    else:
        raise RuntimeError(f"CHIRPS {year}-{month:02d}: {last!r}")
    rain[rain < 0] = np.nan
    lat = t.f + t.e * (np.arange(rain.shape[0]) + 0.5)
    lon = t.c + t.a * (np.arange(rain.shape[1]) + 0.5)
    tmp = folder / f"{path.stem}.part.npz"
    np.savez_compressed(tmp, rain=rain, lat=lat, lon=lon)
    tmp.replace(path)
    return rain, lat, lon


def chirps_monthly(points: pd.DataFrame, s: DistrictSettings, first: tuple[int, int], last: tuple[int, int],
                   log=print) -> pd.DataFrame:
    """Monthly CHIRPS rain (mm) per municipality point: plain mean within `chirps_radius_km`."""
    months = pd.period_range(f"{first[0]}-{first[1]:02d}", f"{last[0]}-{last[1]:02d}", freq="M")
    parts = []
    for bbox, sub in boxes_for(points, s.box_margin_deg):
        def one(p):
            return p, read_chirps_month(p.year, p.month, bbox, s.cache_root)

        with ThreadPoolExecutor(min(s.workers, 3)) as pool:     # the server rate-limits; stay polite
            results = list(pool.map(one, months))
        cube = np.stack([r[1][0] for r in results])
        lat, lon = results[0][1][1], results[0][1][2]
        values, _ = sample(cube, lat, lon, zip(sub["lat"], sub["lon"]), s.chirps_radius_km)
        for k, m in enumerate(sub[UNIT].itertuples(index=False)):
            parts.append(pd.DataFrame({"state_id": int(m.state_id), "mun_id": int(m.mun_id),
                                       "year": [p.year for p in months], "month": [p.month for p in months],
                                       "chirps_rain": values[:, k]}))
        log(f"CHIRPS box {bbox}: {len(months)} months x {len(sub)} municipalities")
    return pd.concat(parts, ignore_index=True)


def season_sums(monthly_rain: pd.DataFrame, column: str, years: tuple[int, int]) -> pd.DataFrame:
    """Per municipality and year: May-October rain and the preceding November-April rain."""
    m = monthly_rain
    rows = []
    for (sid, mid), g in m.groupby(UNIT):
        series = g.set_index(pd.PeriodIndex.from_fields(year=g["year"], month=g["month"], freq="M"))[column]
        for year in range(years[0], years[1] + 1):
            season = series.reindex(pd.period_range(f"{year}-05", f"{year}-10", freq="M"))
            pre = series.reindex(pd.period_range(f"{year - 1}-11", f"{year}-04", freq="M"))
            rows.append({"state_id": sid, "mun_id": mid, "year": year,
                         "season": season.sum() if season.notna().all() else np.nan,
                         "pre": pre.sum() if pre.notna().all() else np.nan})
    return pd.DataFrame(rows)


def rain_ratios(power_years: pd.DataFrame, chirps: pd.DataFrame, years: tuple[int, int]) -> pd.DataFrame:
    """Per municipality CHIRPS/POWER mean-rain ratios, May-Oct and Nov-Apr, clipped to [0.3, 3].

    Same rule as field-shift (`src/rotations/climate.rain_correction`): the off-season ratio is used only
    where POWER's November-April rain averages more than 20 mm; elsewhere it is 1.
    """
    p = season_sums(power_years, "rain", years)
    c = season_sums(chirps, "chirps_rain", years)
    m = p.merge(c, on=["state_id", "mun_id", "year"], suffixes=("_power", "_chirps")).dropna()
    g = m.groupby(UNIT)[["season_chirps", "season_power", "pre_chirps", "pre_power"]].mean()
    return pd.DataFrame({
        "ratio_season": (g["season_chirps"] / g["season_power"]).clip(0.3, 3),
        "ratio_off": (g["pre_chirps"] / g["pre_power"].where(g["pre_power"] > 20)).clip(0.3, 3),
    }).fillna(1.0).reset_index()


def apply_correction(frame: pd.DataFrame, ratios: pd.DataFrame) -> pd.DataFrame:
    out = frame.merge(ratios, on=UNIT, how="left")
    out["rain_corrected"] = out["ratio_season"].notna()
    factor = np.where(out["month"].isin(SEASON_MONTHS), out["ratio_season"].fillna(1.0), out["ratio_off"].fillna(1.0))
    for col in ("rain", "rain_p20"):
        if col in out:
            out[col] = out[col] * factor
    return out.drop(columns=["ratio_season", "ratio_off"])


# --- Build -----------------------------------------------------------------------------------------

def build_municipal(points: pd.DataFrame, s: DistrictSettings, run_dir: Path, log=print):
    """(climate_municipal normals, climate_municipal_years) for the points, before rain correction."""
    pts = points.copy()
    pts["cell_lat"], pts["cell_lon"] = snap(pts["lat"], pts["lon"])
    cells = sorted(set(zip(pts["cell_lat"], pts["cell_lon"])))
    daily = fetch_power_cells(cells, s, run_dir, log)
    normals, yearly = [], []
    for m in pts.itertuples(index=False):
        d = daily[(m.cell_lat, m.cell_lon)]
        alt = float(m.alt_m) if np.isfinite(m.alt_m) else 0.0
        per_year_full, _ = monthly(d, m.lat, alt, s.weather_years, s)
        per_year_norm, norm = monthly(d, m.lat, alt, s.normal_years, s)
        # Years inside the normals window come from the same computation as the normals (as in field-shift).
        per_year = pd.concat([per_year_full[~per_year_full["year"].between(*s.normal_years)], per_year_norm],
                             ignore_index=True).sort_values(["year", "month"])
        for frame, out in ((norm, normals), (per_year, yearly)):
            frame.insert(0, "mun_id", int(m.mun_id))
            frame.insert(0, "state_id", int(m.state_id))
            out.append(frame)
    cell_table = pts[[*UNIT, "lat", "lon", "cell_lat", "cell_lon"]]
    return pd.concat(normals, ignore_index=True), pd.concat(yearly, ignore_index=True), cell_table


def build(points: pd.DataFrame, weights: pd.DataFrame, s: DistrictSettings, run_dir: Path, log=print):
    """All climate tables plus a CHIRPS status: (tables, chirps_ok, chirps_error)."""
    normals, yearly, cells = build_municipal(points, s, run_dir, log)
    chirps_ok, chirps_error, chirps = False, None, None
    if s.enabled("chirps"):
        try:
            first = (s.normal_years[0] - 1, 11)
            chirps = chirps_monthly(points, s, first, (s.normal_years[1], 12), log)
            ratios = rain_ratios(yearly, chirps, s.normal_years)
            normals, yearly = apply_correction(normals, ratios), apply_correction(yearly, ratios)
            chirps_ok = True
        except Exception as exc:
            chirps_error = repr(exc)
    if not chirps_ok:
        normals["rain_corrected"], yearly["rain_corrected"] = False, False
    normals = normals[[*UNIT, "month", *NORMAL_COLUMNS, "rain_corrected"]]
    yearly = yearly[[*UNIT, "year", "month", *YEAR_COLUMNS, "rain_corrected"]]
    tables = {
        "climate_municipal": normals,
        "climate_municipal_years": yearly,
        "climate_district": district_mean(normals, weights, ("month",), NORMAL_COLUMNS),
        "climate_district_years": district_mean(yearly, weights, ("year", "month"), YEAR_COLUMNS),
        "power_cells": cells,
    }
    if chirps_ok:
        # Kept so the engine can check the sign of rain trends against an independent, gauge-based product.
        tables["chirps_municipal_years"] = chirps
        tables["chirps_district_years"] = district_mean(chirps, weights, ("year", "month"), ["chirps_rain"])
    return tables, chirps_ok, chirps_error
