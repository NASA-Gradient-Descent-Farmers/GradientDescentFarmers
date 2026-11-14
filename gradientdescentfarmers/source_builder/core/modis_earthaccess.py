"""NASA LP DAAC MODIS Collection 6.1 through earthaccess (no ORNL/GEE).

Downloads original HDF4 granules, samples the MODIS sinusoidal pixel at a
reference point, preserves native integer science/QA layers for the existing
MOD13/MOD11/MOD16 preprocessing. Never treats this as a field measurement.
"""
from __future__ import annotations

from datetime import datetime
from pathlib import Path
import re

import numpy as np
import pandas as pd

from .providers import ProviderContext, ProviderPayload, MODIS_BANDS, MODIS_TABLES
from .earthdata_recovery import GranuleRecovery


COLLECTION = {
    "MOD13Q1": ("MOD13Q1", "061", "16d"),
    "MOD11A2": ("MOD11A2", "061", "8d"),
    "MOD16A2GF": ("MOD16A2GF", "061", "8d"),
}
# LP DAAC HDF4 subdataset names are different from ORNL JSON band identifiers.
LAYERS = {
    "MOD13Q1": {
        "250m_16_days_NDVI": "250m 16 days NDVI",
        "250m_16_days_EVI": "250m 16 days EVI",
        "250m_16_days_VI_Quality": "250m 16 days VI Quality",
        "250m_16_days_pixel_reliability": "250m 16 days pixel reliability",
    },
    "MOD11A2": {band: band for band in MODIS_BANDS["MOD11A2"]},
    "MOD16A2GF": {band: band for band in MODIS_BANDS["MOD16A2GF"]},
}


def _date_from_filename(path: Path) -> pd.Timestamp:
    match = re.search(r"\.A(\d{7})\.", path.name)
    if not match:
        raise ValueError(f"MODIS granule name lacks acquisition YYYYDDD: {path.name}")
    return pd.to_datetime(datetime.strptime(match.group(1), "%Y%j"), utc=True)


# NASA MODLAND sinusoidal grid constants (meters; spherical Earth).
RADIUS_M = 6371007.181
TILE_M = 1111950.5196666666
X_MIN_M = -20015109.354
Y_MAX_M = 10007554.677


def _tile_from_filename(path: Path) -> tuple[int, int]:
    found = re.search(r"\.h(\d{2})v(\d{2})\.", path.name)
    if not found:
        raise ValueError(f"MODIS filename lacks tile hXXvYY: {path.name}")
    h, v = map(int, found.groups())
    if not (0 <= h < 36 and 0 <= v < 18):
        raise ValueError(f"Invalid MODIS tile h{h:02d}v{v:02d}")
    return h, v


def _sinusoidal_xy(latitude: float, longitude: float) -> tuple[float, float]:
    from pyproj import CRS, Transformer
    if not (np.isfinite(latitude) and np.isfinite(longitude)
            and -90 <= latitude <= 90 and -180 <= longitude <= 180):
        raise ValueError("Invalid WGS84 latitude/longitude")
    sinu = CRS.from_proj4(
        "+proj=sinu +a=6371007.181 +b=6371007.181 "
        "+lon_0=0 +x_0=0 +y_0=0 +units=m +no_defs"
    )
    x, y = Transformer.from_crs("EPSG:4326", sinu, always_xy=True).transform(
        longitude, latitude
    )
    if not np.isfinite(x) or not np.isfinite(y):
        raise ValueError("Non-finite MODIS sinusoidal coordinate")
    return float(x), float(y)


def pixel_for_point(path: Path, latitude: float, longitude: float,
                    shape: tuple[int, int]) -> tuple[int, int]:
    """Derive point-containing row/column from the native MODIS tile grid.

    Always verifies the h/v tile named in the file; no guessed CRS or pixels.
    """
    if len(shape) != 2 or shape[0] != shape[1] or shape[0] not in (1200, 2400, 4800):
        raise ValueError(f"Unexpected MODLAND SDS grid dimensions: {shape}")
    x, y = _sinusoidal_xy(latitude, longitude)
    h, v = _tile_from_filename(path)
    expected_h = int(np.floor((x - X_MIN_M) / TILE_M))
    expected_v = int(np.floor((Y_MAX_M - y) / TILE_M))
    if (expected_h, expected_v) != (h, v):
        raise ValueError(
            f"MODIS tile mismatch: file h{h:02d}v{v:02d}, "
            f"coordinate h{expected_h:02d}v{expected_v:02d}"
        )
    cell = TILE_M / shape[0]
    row = int(np.floor((Y_MAX_M - v * TILE_M - y) / cell))
    col = int(np.floor((x - X_MIN_M - h * TILE_M) / cell))
    if not (0 <= row < shape[0] and 0 <= col < shape[1]):
        raise ValueError("Point outside MODIS SDS tile bounds")
    return row, col


def _open_hdf4(path: Path):
    """Use the HDF4 native SD interface, independent of GDAL HDF4 drivers."""
    try:
        from pyhdf.SD import SD, SDC
    except ImportError as exc:
        raise RuntimeError(
            "Install MODIS HDF4 reader: pip install -e '.[source,source-modis]' "
            "or conda install -c conda-forge pyhdf"
        ) from exc
    return SD(str(path), SDC.READ)


def list_science_datasets(path: Path) -> dict[str, tuple[int, ...]]:
    """Inspect SDS names and shapes without loading large image arrays."""
    hdf = _open_hdf4(path)
    try:
        return {name: tuple(meta[1]) for name, meta in hdf.datasets().items()}
    finally:
        hdf.end()


def _read_native_pixel(hdf, name: str, path: Path, latitude: float,
                       longitude: float) -> tuple[float, int, int, tuple[int, int]]:
    dataset = hdf.select(name)
    try:
        shape = tuple(dataset.info()[2])
        row, col = pixel_for_point(path, latitude, longitude, shape)
        raw = dataset.get(start=(row, col), count=(1, 1))
        value = float(np.asarray(raw)[0, 0])
        if not np.isfinite(value):
            value = np.nan
        # QA=0 is often GOOD, not fill. Leave QA bits intact for preprocessing.
        qa = any(word in name.lower() for word in ("quality", "reliability", "qc_", "_qc"))
        if not qa:
            fill = dataset.attributes().get("_FillValue")
            if fill is not None and np.isfinite(value):
                if np.any(np.isclose(value, np.asarray(fill, dtype=float))):
                    value = np.nan
        return value, row, col, shape
    finally:
        dataset.endaccess()


def extract_point(path: Path, latitude: float, longitude: float,
                  product: str) -> dict:
    """Read exactly one HDF4 science/QA pixel per SDS using pyhdf."""
    if product not in LAYERS:
        raise ValueError(f"Unknown MODIS product: {product}")
    date = _date_from_filename(path)
    h, v = _tile_from_filename(path)
    record = {"date": date, "modis_date": date.strftime("A%Y%j"),
              "source_file": path.name, "tile": f"h{h:02d}v{v:02d}"}
    hdf = _open_hdf4(path)
    try:
        available = hdf.datasets()
        for target, sds_name in LAYERS[product].items():
            if sds_name not in available:
                raise KeyError(f"{path.name}: missing SDS {sds_name!r}. "
                               f"Available: {list(available)[:30]}")
            value, row, col, shape = _read_native_pixel(
                hdf, sds_name, path, latitude, longitude
            )
            record[target] = value
            record[f"{target}_row"] = row
            record[f"{target}_col"] = col
            record[f"{target}_shape"] = f"{shape[0]}x{shape[1]}"
    finally:
        hdf.end()
    return record


def get_modis_earthaccess(ctx: ProviderContext, product: str) -> ProviderPayload:
    """Retrieve bounded LP DAAC HDF4 tiles through authenticated Earthdata CMR."""
    if product not in COLLECTION:
        raise ValueError(f"Unknown MODIS product {product}")
    from .auth import login_earthdata
    earthaccess = login_earthdata()
    f, settings = ctx.farmer, ctx.settings
    short_name, version, temporal_resolution = COLLECTION[product]
    # Search by point, not by entire world or neighboring agricultural region.
    granules = earthaccess.search_data(
        short_name=short_name, version=version,
        bounding_box=(f.longitude - .001, f.latitude - .001,
                      f.longitude + .001, f.latitude + .001),
        temporal=(settings.modis_start.isoformat(), settings.modis_end.isoformat()),
        count=settings.modis_max_granules,
    )
    if not granules:
        raise LookupError(f"No CMR granules returned for {product} .061")
    directory = settings.cache_root / "earthdata" / "modis" / product
    directory.mkdir(parents=True, exist_ok=True)
    recovery = GranuleRecovery(directory, required_groups=(), retries=settings.retries)
    paths = recovery.acquire(earthaccess, granules)
    rows = []
    for path in paths:
        row = extract_point(path, f.latitude, f.longitude, product)
        row["farm_id"] = f.farm_id
        rows.append(row)
    df = pd.DataFrame(rows).sort_values("date").reset_index(drop=True)
    if df.modis_date.duplicated().any():
        raise ValueError("CMR returned duplicate MODIS composite dates")
    return ProviderPayload(
        tables={MODIS_TABLES[product]: df},
        source_url="https://data.lpdaac.earthdatacloud.nasa.gov/",
        temporal_resolution=temporal_resolution,
        spatial_resolution={"MOD13Q1": "250m", "MOD11A2": "1km",
                            "MOD16A2GF": "500m"}[product],
        provenance={
            "provider": "NASA LP DAAC via earthaccess",
            "collection": short_name, "version": version,
            "downloaded_files": [p.name for p in paths],
            "native_hdf4": True, "hdf4_reader": "pyhdf.SD", "qa_layers_preserved": list(LAYERS[product]),
            "pixel_sampling": "WGS84 to native MODLAND sinusoidal; containing pixel",
            "coordinate": [f.longitude, f.latitude],
            "requested_max_granules": settings.modis_max_granules,
        },
        warnings=(
            ["CMR query reached the requested max granules; completeness not established"]
            if len(granules) >= settings.modis_max_granules else []
        ),
    )
