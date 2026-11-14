"""Pure synthetic tests for MODIS HDF4 extraction logic (no NASA network)."""
from pathlib import Path
import pandas as pd
import pytest
from gradientdescentfarmers.source_builder.core.modis_earthaccess import (
    _date_from_filename, LAYERS, COLLECTION, extract_point)
from gradientdescentfarmers.source_builder.core.preprocessing import (
    standardize_mod13, standardize_mod11, standardize_mod16)

def test_official_collection_contract():
    assert set(COLLECTION) == {"MOD13Q1", "MOD11A2", "MOD16A2GF"}
    assert all(version == "061" for _, version, _ in COLLECTION.values())

def test_modis_date_hdf_filename():
    timestamp = _date_from_filename(Path("MOD13Q1.A2024185.h08v07.061.foo.hdf"))
    assert timestamp == pd.Timestamp("2024-07-03", tz="UTC")

@pytest.mark.parametrize("product,raw,transformer,outcol", [
    ("MOD13Q1", {
        "250m_16_days_NDVI": 5000,
        "250m_16_days_EVI": 3500,
        "250m_16_days_VI_Quality": 0,
        "250m_16_days_pixel_reliability": 0,
    },standardize_mod13,"ndvi_qa"),
    ("MOD11A2", {
        "LST_Day_1km": 15000, "LST_Night_1km": 14500,
        "QC_Day": 0, "QC_Night": 0,
    },standardize_mod11,"lst_day_qa_c"),
    ("MOD16A2GF", {
        "ET_500m": 200, "PET_500m": 300, "ET_QC_500m": 0,
    },standardize_mod16,"et_qa_mm_period"),
])
def test_raw_values_feed_existing_qa(product, raw, transformer, outcol):
    assert set(raw) == set(LAYERS[product])
    frame=pd.DataFrame([{
        "date":pd.Timestamp("2024-07-03",tz="UTC"),
        "modis_date":"A2024185","farm_id":"synthetic",**raw,
    }])
    standardized=transformer(frame)
    assert pd.notna(standardized.loc[0,outcol])
