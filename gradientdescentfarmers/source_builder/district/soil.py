"""Map soil per municipality, for context only: it never enters a calculation (the farmer's own answer does).

- GLDAS / Noah soil texture class and sand, silt and clay fractions, 0.25 deg (~28 km), public
  (https://ldas.gsfc.nasa.gov/gldas/soils). Nearest cell to the municipality point.
- IGBP-DIS available water capacity and soil carbon of the top metre, 5 arc-min (~9 km), ORNL DAAC
  (doi:10.3334/ORNLDAAC/569), Earthdata login. Cell containing the point; 0 and negative values are no data.

A cell that size mixes many soils, so the map describes the area, never a field.
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd
import requests

from .common import UNIT

GLDAS_URL = "https://ldas.gsfc.nasa.gov/sites/default/files/ldas/gldas/SOILS"
GLDAS_FILES = {"texture": "GLDASp5_soiltexture_025d.nc4", "fraction": "GLDASp4_soilfraction_025d.nc4"}
GLDAS_VARIABLES = {"texture_class": ("texture", "GLDAS_soiltex"), "sand": ("fraction", "GLDAS_soilfraction_sand"),
                   "silt": ("fraction", "GLDAS_soilfraction_silt"), "clay": ("fraction", "GLDAS_soilfraction_clay")}
GLDAS_FILL = -9999.0
GLDAS_PRODUCT = "GLDAS soil texture (Noah, 0.25 deg) and soil fractions"
IGBP_DOI = "10.3334/ORNLDAAC/569"
IGBP_COLLECTION = "C2216863098-ORNL_CLOUD"
IGBP_PRODUCT = "IGBP-DIS SoilData surface products (5 arc-min), ORNL DAAC"
IGBP_LAYERS = {"pawc": "profile_available_water_capacity", "soilcarb": "soil_carbon_density"}
COLUMNS = ["texture_class", "sand", "silt", "clay", "profile_available_water_capacity", "soil_carbon_density"]


def gldas(points: pd.DataFrame, cache_root: Path, timeout: int = 60) -> pd.DataFrame:
    import h5py

    folder = Path(cache_root) / "gldas"
    folder.mkdir(parents=True, exist_ok=True)
    for name in GLDAS_FILES.values():
        path = folder / name
        if not path.is_file():
            r = requests.get(f"{GLDAS_URL}/{name}", timeout=timeout)
            r.raise_for_status()
            path.with_suffix(".part").write_bytes(r.content)
            path.with_suffix(".part").replace(path)
    handles = {k: h5py.File(folder / n, "r") for k, n in GLDAS_FILES.items()}
    try:
        lats, lons = handles["texture"]["lat"][:], handles["texture"]["lon"][:]
        rows = []
        for m in points.itertuples(index=False):
            i, j = int(np.abs(lats - m.lat).argmin()), int(np.abs(lons - m.lon).argmin())
            row = {"state_id": int(m.state_id), "mun_id": int(m.mun_id)}
            for col, (key, var) in GLDAS_VARIABLES.items():
                v = float(handles[key][var][0, i, j])
                row[col] = np.nan if v == GLDAS_FILL else v
            rows.append(row)
    finally:
        for h in handles.values():
            h.close()
    out = pd.DataFrame(rows)
    out["texture_class"] = out["texture_class"].round()       # stored as floats with rounding noise
    return out


def _read_ascii_grid(path: Path):
    header = {}
    with open(path) as f:
        while True:
            position = f.tell()
            parts = f.readline().split()
            if not parts or not parts[0][0].isalpha():
                f.seek(position)
                break
            header[parts[0].lower()] = float(parts[1])
        values = np.array(f.read().split(), dtype=np.float32)
    grid = values.reshape(int(header["nrows"]), int(header["ncols"]))
    if "nodata_value" in header:
        grid[grid == header["nodata_value"]] = np.nan
    return header, grid


def _grid_value(header, grid, lat, lon):
    size = header["cellsize"]
    x0 = header["xllcorner"] if "xllcorner" in header else header["xllcenter"] - size / 2
    y0 = header["yllcorner"] if "yllcorner" in header else header["yllcenter"] - size / 2
    top = y0 + grid.shape[0] * size
    row, col = int((top - lat) // size), int((lon - x0) // size)
    if 0 <= row < grid.shape[0] and 0 <= col < grid.shape[1]:
        return float(grid[row, col])
    return np.nan


def igbp(points: pd.DataFrame, cache_root: Path) -> pd.DataFrame:
    from ..core import opendap

    folder = Path(cache_root) / "igbp"
    folder.mkdir(parents=True, exist_ok=True)
    key = lambda g: g["umm"]["GranuleUR"].split(".")[1]
    if not all((folder / f"{k}.dat").is_file() for k in IGBP_LAYERS):
        sess = opendap.session()
        for g in opendap.search(concept_id=IGBP_COLLECTION):
            if key(g) in IGBP_LAYERS and not (folder / f"{key(g)}.dat").is_file():
                path = opendap.download(g, folder, sess)
                path.replace(folder / f"{key(g)}.dat")
    out = points[UNIT].copy().astype("int64")
    for k, col in IGBP_LAYERS.items():
        header, grid = _read_ascii_grid(folder / f"{k}.dat")
        values = np.array([_grid_value(header, grid, la, lo) for la, lo in zip(points["lat"], points["lon"])])
        out[col] = np.where(values > 0, values, np.nan)
    return out
