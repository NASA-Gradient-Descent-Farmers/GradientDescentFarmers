"""Shared pieces of the district panel: settings, source results, sampling and weighted means.

See DISTRICT_PANEL_CONTRACT.md for the tables these modules produce.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

import numpy as np
import pandas as pd
from pydantic import BaseModel, ConfigDict, Field, model_validator

REFERENCE = Path(__file__).with_name("reference")
UNIT = ["state_id", "mun_id"]
DISTRICT = ["state_id", "ddr"]

SOURCES = ("siap", "power", "chirps", "grace", "ndvi", "smap", "gldas", "igbp")


class Site(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$")
    latitude: float = Field(ge=14.0, le=33.5)       # Mexico
    longitude: float = Field(ge=-118.5, le=-86.0)


class DistrictSettings(BaseModel):
    """Everything a district panel run depends on. Defaults reproduce the field-shift panel's windows."""
    model_config = ConfigDict(extra="forbid")
    sites: list[Site] = Field(default_factory=list)
    all_districts: bool = False                               # every SIAP district, not only the sites' districts
    output_root: Path
    cache_root: Path
    sources: dict[str, bool] = Field(default_factory=dict)   # source -> enabled; missing keys mean enabled
    siap_years: tuple[int, int] = (2003, 2025)
    weight_years: tuple[int, int] = (2016, 2025)
    weather_years: tuple[int, int] = (1982, 2025)             # monthly-by-year climate table
    normal_years: tuple[int, int] = (2001, 2025)              # monthly normals and the CHIRPS ratios
    ndvi_years: tuple[int, int] = (2003, 2025)
    smap_years: tuple[int, int] = (2015, 2025)
    smap_start: str = "2015-04-01"                            # SMAP L4 record starts 31 March 2015
    smap_hour_utc: str = "13:30"                              # one 3-hourly granule per day
    district_membership: Literal["shared", "primary"] = "shared"
    et0_wind: Literal["power", "fao_default"] = "power"
    frost_c: float = 2.0
    heat_c: float = 35.0
    ndvi_radius_km: float = 15.0
    smap_radius_km: float = 10.0
    chirps_radius_km: float = 10.0
    box_margin_deg: float = 0.5
    http_timeout_s: int = Field(default=120, ge=5, le=600)
    workers: int = Field(default=4, ge=1, le=12)

    @model_validator(mode="after")
    def _need_targets(self):
        if not self.sites and not self.all_districts:
            raise ValueError("give at least one site, or set all_districts")
        return self

    def enabled(self, source: str) -> bool:
        return self.sources.get(source, True)


@dataclass
class SourceResult:
    """What one source delivered. `status` follows source_builder: available, partial, missing, error, not_requested."""
    source: str
    status: str = "not_requested"
    tables: dict[str, pd.DataFrame] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    provenance: dict[str, object] = field(default_factory=dict)
    started_utc: str = ""
    seconds: float = 0.0

    def summary(self) -> dict:
        return {"status": self.status, "warnings": self.warnings, "errors": self.errors,
                "tables": {k: int(len(v)) for k, v in self.tables.items()},
                "started_utc": self.started_utc, "seconds": round(self.seconds, 1)}


def utcnow() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def municipalities() -> pd.DataFrame:
    """INEGI municipalities with a representative farmland point (median of rural localities) and altitude."""
    return pd.read_csv(REFERENCE / "municipalities.csv")


def siap_crop_names() -> dict[str, str]:
    """plain SIAP crop name -> engine crop key."""
    t = pd.read_csv(REFERENCE / "siap_crops.csv")
    return {plain(n): k for k, n in zip(t["crop"], t["siap_name"])}


def plain(text) -> str:
    """Lower case without accents, for matching SIAP names."""
    import unicodedata

    text = unicodedata.normalize("NFKD", str(text).strip().casefold())
    return "".join(c for c in text if not unicodedata.combining(c))


def bbox_for(points: pd.DataFrame, margin: float) -> tuple[float, float, float, float]:
    """(lat_min, lat_max, lon_min, lon_max) around the points, rounded outwards to whole degrees."""
    return (float(np.floor(points["lat"].min() - margin)), float(np.ceil(points["lat"].max() + margin)),
            float(np.floor(points["lon"].min() - margin)), float(np.ceil(points["lon"].max() + margin)))


def boxes_for(points: pd.DataFrame, margin: float, gap_deg: float = 3.0) -> list[tuple[tuple, pd.DataFrame]]:
    """Group points that are close together into separate boxes, so far-apart districts do not force
    one huge box (Guanajuato and Sonora would otherwise span 9 x 10 degrees)."""
    # Connected components: two points are linked when both coordinates are within gap_deg. Joining whole
    # components (not the first matching group) keeps a national run to one or two boxes instead of many
    # overlapping ones, each of which would be downloaded separately.
    lat, lon = points["lat"].to_numpy(), points["lon"].to_numpy()
    parent = list(range(len(points)))

    def root(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    order = np.argsort(lon)
    for a_pos, a in enumerate(order):
        for b in order[a_pos + 1:]:
            if lon[b] - lon[a] >= gap_deg:
                break
            if abs(lat[a] - lat[b]) < gap_deg:
                parent[root(a)] = root(b)
    groups: dict[int, list[int]] = {}
    for i in range(len(points)):
        groups.setdefault(root(i), []).append(i)
    groups = list(groups.values())
    out = []
    for g in groups:
        sub = points.iloc[g]
        out.append((bbox_for(sub, margin), sub))
    return out


def sample(cube: np.ndarray, lat, lon, points, radius_km: float, weights=None):
    """Average a (time, lat, lon) cube over the cells within `radius_km` of each (lat, lon) point.

    `weights` (lat, lon), e.g. cropland share, weight the cells; when a point has no weighted cell the
    plain average is used. Returns ((time, n_points) array, bool array: weights used). Same rule as
    field-shift's `src/yield_panel/gridded.sample`.
    """
    lat, lon = np.asarray(lat), np.asarray(lon)
    points = list(points)
    out = np.full((cube.shape[0], len(points)), np.nan, dtype=float)
    used = np.zeros(len(points), bool)
    for k, (plat, plon) in enumerate(points):
        dy = (lat - plat) * 111.0
        dx = (lon - plon) * 111.0 * np.cos(np.radians(plat))
        iy, ix = np.where(np.abs(dy) <= radius_km)[0], np.where(np.abs(dx) <= radius_km)[0]
        if len(iy) == 0 or len(ix) == 0:   # radius smaller than a cell: nearest cell
            iy, ix = np.array([int(np.abs(dy).argmin())]), np.array([int(np.abs(dx).argmin())])
        mask = (dy[iy][:, None] ** 2 + dx[ix][None, :] ** 2) <= max(radius_km, 1e-9) ** 2
        if not mask.any():
            mask[:] = True
        block = cube[:, iy][:, :, ix]
        w = mask.astype(float)
        if weights is not None:
            ww = weights[np.ix_(iy, ix)] * mask
            if np.nansum(ww) > 0:
                w, used[k] = np.nan_to_num(ww), True
        valid = np.isfinite(block)
        num = np.nansum(np.where(valid, block, 0) * w, axis=(1, 2))
        den = np.sum(valid * w, axis=(1, 2))
        out[:, k] = np.where(den > 0, num / np.where(den > 0, den, 1), np.nan)
    return out, used


def district_mean(municipal: pd.DataFrame, weights: pd.DataFrame, keys: tuple[str, ...], columns: list[str],
                  weighted: bool = True) -> pd.DataFrame:
    """District values from municipal ones.

    `weights` has one row per (state_id, mun_id, ddr) with `weight_ha`. Each column is averaged over the
    municipalities with a value, so a missing value never counts as zero. Unweighted when `weighted` is False.
    """
    m = municipal.merge(weights[["state_id", "mun_id", "ddr", "weight_ha"]], on=UNIT)
    if not weighted:
        m["weight_ha"] = 1.0
    cols = [c for c in columns if c in m]
    rows = []
    for key, g in m.groupby([*DISTRICT, *keys], sort=True):
        row = dict(zip([*DISTRICT, *keys], key if isinstance(key, tuple) else (key,)))
        for c in cols:
            ok = g[c].notna()
            row[c] = float(np.average(g.loc[ok, c], weights=g.loc[ok, "weight_ha"])) if ok.any() else np.nan
        rows.append(row)
    return pd.DataFrame(rows, columns=[*DISTRICT, *keys, *cols])
