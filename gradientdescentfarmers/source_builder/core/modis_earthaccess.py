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


def _subdatasets(path: Path) -> dict[str, str]:
    import rasterio
    # A rasterio/GDAL build WITH HDF4 support is required for the native files.
    try:
        with rasterio.open(path) as ds:
            names = list(ds.subdatasets)
    except Exception as ex:
        raise RuntimeError(
            "Unable to read native MODIS HDF4; verify GDAL HDF4 driver "
            "(e.g. 'rio env --formats' and gdalinfo) in the active environment"
        ) from ex
    if not names:
        raise RuntimeError(f"Missing HDF4 subdatasets in {path.name}")
    return {name.rsplit(":", 1)[-1]: name for name in names}


def extract_point(path: Path, latitude: float, longitude: float, product: str) -> dict:
    import rasterio
    from rasterio.warp import transform

    if product not in LAYERS:
        raise ValueError(f"Unknown MODIS product: {product}")
    names = _subdatasets(path)
    row = {"date": _date_from_filename(path),
           "modis_date": _date_from_filename(path).strftime("A%Y%j"),
           "source_file": path.name}
    for output, layer in LAYERS[product].items():
        if layer not in names:
            raise KeyError(f"{path.name}: MODIS HDF4 layer {layer!r} unavailable")
        with rasterio.open(names[layer]) as ds:
            if ds.crs is None:
                raise ValueError(f"{layer}: missing native CRS; no spatial guessing")
            xs, ys = transform("EPSG:4326", ds.crs, [longitude], [latitude])
            rr, cc = ds.index(xs[0], ys[0])
            if rr < 0 or rr >= ds.height or cc < 0 or cc >= ds.width:
                raise ValueError(f"{path.name}: reference point outside MODIS tile")
            value = ds.read(1, window=((rr, rr + 1), (cc, cc + 1)), masked=True)[0, 0]
            if np.ma.is_masked(value) or not np.isfinite(value):
                row[output] = np.nan
            else:
                # Preserve RAW HDF4 values and QA bits; preprocessing scales/masks.
                row[output] = float(value)
    return row


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
            "native_hdf4": True, "qa_layers_preserved": list(LAYERS[product]),
            "pixel_sampling": "native MODIS sinusoidal CRS; nearest grid cell",
            "coordinate": [f.longitude, f.latitude],
            "requested_max_granules": settings.modis_max_granules,
        },
        warnings=(
            ["Pilot subset only: not continuous two-year MODIS coverage"]
            if len(df) < 20 else []
        ),
    )
