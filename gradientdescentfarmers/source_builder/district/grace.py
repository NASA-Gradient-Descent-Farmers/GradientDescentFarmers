"""Long-term water-storage change per municipality and district from NASA GRACE and GRACE-FO.

What it measures: the total water stored on and under the land (groundwater, soil moisture, surface water
and reservoirs, snow) as centimetres of equivalent water height, monthly since April 2002. It cannot tell
those stores apart or see anything smaller than roughly 300 km across, so the number describes the region
around a place, never the place itself. In dam-fed irrigated districts a decline can be reservoir storage.

Product: NASA GSFC mascons RL06v2.0 (Loomis, Luthcke & Sabaka 2019, J. Geodesy 93:1381-1398), equal-area
1-arc-degree mascons, no login needed. Method ported unchanged from field-shift (`src/rotations/grace.py`).
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd
import requests

from .common import UNIT, district_mean

URL = "https://earth.gsfc.nasa.gov/sites/default/files/geo/GSFC.glb_.200204_202606_RL06v2.0_OBP-ICE6GD.h5"
PRODUCT = "NASA GSFC GRACE/GRACE-FO mascons RL06v2.0 (200204-202606)"
LAND = 80                      # mascon/location value of land mascons
RECENT_FROM = 2015.0           # start of the "last decade" trend
MEXICO_BOX = (14.0, 33.5, -118.5, -86.0)
COLUMNS = ["mascon", "trend_cm_yr", "trend_se", "trend_recent_cm_yr", "trend_recent_se", "change_cm",
           "leakage_trend_cm_yr", "noise_2sigma_cm", "rank_national", "first_year", "last_year"]


def file_path(cache_root: Path, timeout: int = 300) -> Path:
    path = Path(cache_root) / "grace" / URL.rsplit("/", 1)[1]
    if path.is_file():
        return path
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".part")
    with requests.get(URL, stream=True, timeout=timeout) as r:
        r.raise_for_status()
        with open(tmp, "wb") as f:
            for chunk in r.iter_content(1 << 20):
                f.write(chunk)
    tmp.replace(path)
    return path


def trend(t, y):
    """(slope per year, standard error) of y on decimal years t, with annual and semi-annual cycles.

    The ordinary standard error is widened by sqrt((1+r)/(1-r)), r = lag-1 autocorrelation of the residuals.
    """
    t, y = np.asarray(t, float), np.asarray(y, float)
    ok = np.isfinite(y)
    t, y = t[ok], y[ok]
    if len(y) < 24:
        return np.nan, np.nan
    w = 2 * np.pi * t
    a = np.c_[np.ones_like(t), t - t.mean(), np.sin(w), np.cos(w), np.sin(2 * w), np.cos(2 * w)]
    beta, *_ = np.linalg.lstsq(a, y, rcond=None)
    resid = y - a @ beta
    r = float(np.clip(np.corrcoef(resid[:-1], resid[1:])[0, 1], 0, 0.95))
    sigma2 = resid @ resid / (len(y) - a.shape[1])
    se = float(np.sqrt(sigma2 / ((t - t.mean()) ** 2).sum() * (1 + r) / (1 - r)))
    return float(beta[1]), se


def read_mascons(path: Path, box=MEXICO_BOX):
    """Land mascons in a lat/lon box: (table with one row per mascon, decimal years, cm matrix)."""
    import h5py

    with h5py.File(path, "r") as f:
        lat, lon = f["mascon/lat_center"][0], f["mascon/lon_center"][0]
        lon = np.where(lon > 180, lon - 360, lon)
        keep = np.flatnonzero((lat >= box[0]) & (lat <= box[1]) & (lon >= box[2]) & (lon <= box[3])
                              & (f["mascon/location"][0] == LAND))
        table = pd.DataFrame({
            "mascon": keep, "lat": lat[keep], "lon": lon[keep],
            "lat_span": f["mascon/lat_span"][0][keep], "lon_span": f["mascon/lon_span"][0][keep],
            "leakage_trend_cm_yr": f["uncertainty/leakage_trend"][:, 0][keep],
            "noise_2sigma_cm": f["uncertainty/noise_2sigma"][:][keep].mean(axis=1),
        })
        years = f["time/yyyy_doy_yrplot_middle"][2]
        cm = f["solution/cmwe"][:][keep]
    return table, years, cm


def mascon_trends(table, years, cm) -> pd.DataFrame:
    rows = []
    for k in range(len(table)):
        slope, se = trend(years, cm[k])
        recent = years >= RECENT_FROM
        slope_r, se_r = trend(years[recent], cm[k][recent])
        first, last = cm[k][years < years.min() + 3].mean(), cm[k][years > years.max() - 3].mean()
        rows.append({"trend_cm_yr": slope, "trend_se": se, "trend_recent_cm_yr": slope_r, "trend_recent_se": se_r,
                     "change_cm": last - first})
    out = pd.concat([table.reset_index(drop=True), pd.DataFrame(rows)], axis=1)
    out["first_year"], out["last_year"] = int(np.floor(years.min())), int(np.floor(years.max()))
    # Where this mascon's trend sits among Mexico's land mascons (0 = the steepest decline): national,
    # whatever subset of districts the panel covers.
    out["rank_national"] = out["trend_cm_yr"].rank(pct=True)
    return out


def assign(points, table) -> np.ndarray:
    """Index into `table` of the mascon whose cell contains each (lat, lon); the nearest centre otherwise."""
    lat, lon = table["lat"].to_numpy(), table["lon"].to_numpy()
    half_lat, half_lon = table["lat_span"].to_numpy() / 2, table["lon_span"].to_numpy() / 2
    out = []
    for la, lo in points:
        inside = np.flatnonzero((np.abs(lat - la) <= half_lat) & (np.abs(lon - lo) <= half_lon))
        if len(inside):
            out.append(int(inside[0]))
        else:
            out.append(int(np.argmin((lat - la) ** 2 + ((lon - lo) * np.cos(np.radians(la))) ** 2)))
    return np.array(out)


def build(points: pd.DataFrame, weights: pd.DataFrame, cache_root: Path, timeout: int = 300) -> dict[str, pd.DataFrame]:
    table, years, cm = read_mascons(file_path(cache_root, timeout))
    trends = mascon_trends(table, years, cm)
    idx = assign(zip(points["lat"], points["lon"]), table)
    municipal = pd.concat([points[UNIT].reset_index(drop=True), trends.iloc[idx][COLUMNS].reset_index(drop=True)], axis=1)

    numeric = [c for c in COLUMNS if c not in ("mascon", "first_year", "last_year")]
    district = district_mean(municipal, weights, (), numeric, weighted=False)   # one mascon covers many municipalities
    m = municipal.merge(weights[["state_id", "mun_id", "ddr"]], on=UNIT)
    extra = m.groupby(["state_id", "ddr"]).agg(mascon=("mascon", lambda s: int(s.mode().iloc[0])),
                                               n_mascons=("mascon", "nunique"), first_year=("first_year", "first"),
                                               last_year=("last_year", "first")).reset_index()
    district = district.merge(extra, on=["state_id", "ddr"])

    used = sorted(set(municipal["mascon"]))
    position = {m_id: k for k, m_id in enumerate(table["mascon"])}
    frame = pd.DataFrame(cm[[position[m_id] for m_id in used]].T, columns=used).assign(year=np.floor(years).astype(int))
    yearly = frame.groupby("year").mean().stack().rename("cm").reset_index().rename(columns={"level_1": "mascon"})
    yearly = yearly.merge(frame.groupby("year").size().rename("months").reset_index(), on="year")
    for t in (municipal, district, yearly):
        for c in ("mascon", "first_year", "last_year", "n_mascons", "year", "months"):
            if c in t:
                t[c] = t[c].astype("int64")
    return {"grace_municipal": municipal, "grace_district": district, "grace_years": yearly}
