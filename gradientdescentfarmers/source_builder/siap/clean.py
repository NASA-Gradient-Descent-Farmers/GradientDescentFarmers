"""Conservative cleaning of normalized SIAP tables.

Rules were derived from profiling the 2025 municipal file (35,902 rows) and are documented in
``README.md``. Principles: never impute, never convert units, never silently alter a reported
quantity. Defects are either removed (exact duplicates, records with no activity at all) or
*flagged* in boolean columns so downstream models decide what to do. Everything done is counted
in the returned report, which the store writes to ``manifest.json``.
"""
from __future__ import annotations

import re
import unicodedata

import numpy as np
import pandas as pd

from .schema import FLOAT_COLUMNS, TEXT_COLUMNS

CLEANING_VERSION = 1

# One row per (year, geography, cycle, modality, unit, crop). NOTE: a municipality can span several
# CADERs, so the same municipality/crop legitimately appears more than once; sum them with
# :func:`aggregate_municipality` before comparing municipalities.
GRAIN_COLUMNS = ("year", "state_id", "ddr_id", "cader_id", "municipality_id", "cycle_id",
                 "modality_id", "unit_id", "crop_id")
FLAG_COLUMNS = ("flag_harvested_gt_sown", "flag_yield_mismatch", "flag_value_mismatch", "flag_yield_outlier")
_WS = re.compile(r"\s+")


def _norm_text(s: pd.Series) -> pd.Series:
    return s.map(lambda v: _WS.sub(" ", unicodedata.normalize("NFC", v)).strip() if isinstance(v, str) else v)


def clean(df: pd.DataFrame) -> tuple[pd.DataFrame, dict[str, object]]:
    """Return ``(cleaned_df, report)``. The input frame is not modified."""
    df = df.copy()
    report: dict[str, object] = {"cleaning_version": CLEANING_VERSION, "rows_in": int(len(df))}

    for col in TEXT_COLUMNS:
        if col in df:
            df[col] = _norm_text(df[col])

    # 1. Negative quantities are impossible: null them (none seen in 2025; guards future files).
    neg = {c: int((df[c] < 0).sum()) for c in FLOAT_COLUMNS if c in df and (df[c] < 0).any()}
    for c in neg:
        df.loc[df[c] < 0, c] = np.nan
    report["negative_values_nulled"] = neg

    # 2. SIAP writes 0 for price/yield when nothing was harvested (older years) and nothing when
    #    it is not applicable (2025). Normalize both to NaN: a 0 yield/price is "undefined", not a value.
    zeroed = {}
    for c in ("yield", "price_mxn_per_unit"):
        if c in df:
            mask = df[c] == 0
            zeroed[c] = int(mask.sum())
            df.loc[mask, c] = np.nan
    report["zero_price_yield_to_nan"] = zeroed

    # 3. Exact duplicate rows.
    before = len(df)
    df = df.drop_duplicates()
    report["exact_duplicates_dropped"] = int(before - len(df))

    # 4. Records with no activity whatsoever (nothing sown, harvested or produced).
    activity = ["sown_ha", "harvested_ha", "production_volume"]
    empty = (df[activity].fillna(0) == 0).all(axis=1)
    report["no_activity_rows_dropped"] = int(empty.sum())
    df = df[~empty]

    # 5. Informational columns.
    df["is_tonne_unit"] = df["unit"].str.casefold().eq("tonelada")
    df["has_harvest"] = df["harvested_ha"] > 0

    # 6. Consistency flags (values are left untouched).
    df["flag_harvested_gt_sown"] = df["harvested_ha"] > df["sown_ha"] + 1e-6
    expected_yield = df["production_volume"] / df["harvested_ha"].where(df["harvested_ha"] > 0)
    tol = np.maximum(0.02 * df["yield"].abs(), 0.011)  # yields are published rounded to 2 decimals
    df["flag_yield_mismatch"] = ((expected_yield - df["yield"]).abs() > tol).fillna(False)
    expected_value = df["production_volume"] * df["price_mxn_per_unit"]
    vtol = np.maximum(0.02 * df["production_value_mxn"].abs(), 1.0)
    df["flag_value_mismatch"] = ((expected_value - df["production_value_mxn"]).abs() > vtol).fillna(False)
    # yield outliers within the same crop and unit (log10 distance from median, robust to units like "Planta")
    lg = np.log10(df["yield"].where(df["yield"] > 0))
    grp = [df["crop_id"], df["unit_id"]]
    med = lg.groupby(grp).transform("median")
    mad = (lg - med).abs().groupby(grp).transform("median")
    n = lg.groupby(grp).transform("count")
    limit = np.maximum(1.4826 * mad * 5, 0.7)  # never tighter than a 5x factor
    df["flag_yield_outlier"] = (((lg - med).abs() > limit) & (n >= 10)).fillna(False)

    report["flags"] = {c: int(df[c].sum()) for c in FLAG_COLUMNS}
    report["rows_without_harvest"] = int((~df["has_harvest"]).sum())
    report["non_tonne_unit_rows"] = int((~df["is_tonne_unit"]).sum())

    keys = [c for c in GRAIN_COLUMNS if c in df]
    df = df.sort_values(keys + ["crop"], kind="stable").reset_index(drop=True)
    report["grain_key_duplicates"] = int(df.duplicated(keys, keep=False).sum())
    report["rows_out"] = int(len(df))
    return df, report


def aggregate_municipality(df: pd.DataFrame) -> pd.DataFrame:
    """Collapse CADER splits so each municipality/crop/cycle/modality/unit appears once.

    Areas, volume and value are summed; yield = volume / harvested area and
    price = value / volume are recomputed (weighted), NaN when the denominator is 0.
    Only valid for municipal data; units are part of the key so quantities are never mixed.
    """
    if "municipality_id" not in df:
        raise ValueError("aggregate_municipality needs municipal-level data")
    keys = ["year", "state_id", "state", "municipality_id", "municipality", "cycle_id", "cycle",
            "modality_id", "modality", "unit_id", "unit", "crop_id", "crop", "is_tonne_unit"]
    sums = ["sown_ha", "harvested_ha", "lost_ha", "production_volume", "production_value_mxn"]
    out = df.groupby(keys, as_index=False, dropna=False)[sums].sum(min_count=1)
    out["yield"] = out["production_volume"] / out["harvested_ha"].where(out["harvested_ha"] > 0)
    out["price_mxn_per_unit"] = out["production_value_mxn"] / out["production_volume"].where(out["production_volume"] > 0)
    out["has_harvest"] = out["harvested_ha"] > 0
    return out
