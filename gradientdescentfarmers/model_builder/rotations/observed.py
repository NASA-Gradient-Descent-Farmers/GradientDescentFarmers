"""Reading what NASA satellites observe in a place's farmland, by calendar month (panel tables
`observed_municipal` / `observed_district`, built by source_builder.district.observed).

- MODIS NDVI (MOD13C2 v061, 0.05 deg, 2003-2025), cropland-weighted: when fields are typically green or bare.
- SMAP root-zone soil moisture (SPL4SMGP v008, 9 km, 2015-2025) and its relative wetness between the
  municipality's own dry and wet references: how much stored water a crop sown on residual moisture can count on.
"""

import numpy as np

from . import panel


def load(level="district"):
    return panel.observed(level)


# --- Reading the observations ------------------------------------------------------------------------

def low_green_months(observed):
    """Months whose median NDVI is in the lowest quarter of the year's range: fields typically bare or dry."""
    ndvi = observed.sort_values("month")["ndvi"].to_numpy()
    if not np.isfinite(ndvi).any():
        return [], []
    lo, hi = np.nanmin(ndvi), np.nanmax(ndvi)
    rel = (ndvi - lo) / max(hi - lo, 1e-6)
    return [m + 1 for m in range(12) if rel[m] <= 0.25], [m + 1 for m in range(12) if rel[m] >= 0.75]


def relative_moisture(observed, month):
    """SMAP relative wetness (0 = the municipality's dry reference, 1 = its wet reference) in a month."""
    if observed is None or "smap_relative" not in observed:
        return None
    row = observed[observed["month"] == month]
    value = float(row["smap_relative"].iloc[0]) if len(row) else np.nan
    return value if np.isfinite(value) else None
