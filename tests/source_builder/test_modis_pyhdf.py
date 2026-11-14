"""No-NASA tests for HDF4 pixel extraction, geolocation and original QA."""
from pathlib import Path
import numpy as np
import pandas as pd
import pytest
from gradientdescentfarmers.source_builder.core import modis_earthaccess as modis
from gradientdescentfarmers.source_builder.core.earthdata_recovery import GranuleRecovery
from gradientdescentfarmers.source_builder.core.preprocessing import (
    standardize_mod13, standardize_mod11, standardize_mod16,
)

LAT, LON = 20.4243195, -101.1466639


def point_tile():
    x, y = modis._sinusoidal_xy(LAT, LON)
    h = int(np.floor((x - modis.X_MIN_M) / modis.TILE_M))
    v = int(np.floor((modis.Y_MAX_M - y) / modis.TILE_M))
    return h, v


def filename(product):
    h, v = point_tile()
    return Path(f"{product}.A2024185.h{h:02d}v{v:02d}.061.TEST.hdf")


class FakeSDS:
    def __init__(self, name, value, shape):
        self.name, self.value, self.shape = name, value, shape
        self.calls = []
    def info(self):
        return (self.name, 2, self.shape, 22, 1)
    def get(self, start=None, count=None):
        self.calls.append((start, count))
        assert count == (1, 1), "do not load a full MODIS tile into RAM"
        assert len(start) == 2
        return np.array([[self.value]])
    def attributes(self):
        return {"_FillValue": -3000}
    def endaccess(self):
        pass


class FakeHDF:
    def __init__(self, bands, shape):
        self.sds = {name: FakeSDS(name, value, shape) for name, value in bands.items()}
        self.closed = False
    def datasets(self):
        return {name: (i, d.shape, 22, 1) for i, (name, d) in enumerate(self.sds.items())}
    def select(self, name):
        return self.sds[name]
    def end(self):
        self.closed = True


@pytest.mark.parametrize("resolution", (1200, 2400, 4800))
def test_geolocation_native_modland_grid(resolution):
    file = filename("MOD13Q1")
    row, col = modis.pixel_for_point(file, LAT, LON, (resolution, resolution))
    assert 0 <= row < resolution and 0 <= col < resolution
    h, v = point_tile()
    bad_file = Path(f"MOD13Q1.A2024185.h{(h+1):02d}v{v:02d}.061.hdf")
    with pytest.raises(ValueError, match="tile mismatch"):
        modis.pixel_for_point(bad_file, LAT, LON, (resolution, resolution))


def test_refuse_unexpected_shape_and_date():
    with pytest.raises(ValueError, match="dimensions"):
        modis.pixel_for_point(filename("MOD13Q1"), LAT, LON, (100, 100))
    assert modis._date_from_filename(filename("MOD13Q1")) == pd.Timestamp(
        "2024-07-03", tz="UTC"
    )


@pytest.mark.parametrize("product,bands,shape,transformer,expected", [
    ("MOD13Q1", {
        "250m 16 days NDVI": 5000, "250m 16 days EVI": 3500,
        "250m 16 days VI Quality": 0, "250m 16 days pixel reliability": 0,
    }, 4800, standardize_mod13, "ndvi_qa"),
    ("MOD11A2", {
        "LST_Day_1km": 15000, "LST_Night_1km": 14500,
        "QC_Day": 0, "QC_Night": 0,
    }, 1200, standardize_mod11, "lst_day_qa_c"),
    ("MOD16A2GF", {
        "ET_500m": 200, "PET_500m": 300, "ET_QC_500m": 0,
    }, 2400, standardize_mod16, "et_qa_mm_period"),
])
def test_single_pixel_extraction_and_original_qa(
    monkeypatch, product, bands, shape, transformer, expected
):
    hdf = FakeHDF(bands, (shape, shape))
    monkeypatch.setattr(modis, "_open_hdf4", lambda path: hdf)
    record = modis.extract_point(filename(product), LAT, LON, product)
    record["farm_id"] = "synthetic"
    assert all(len(sds.calls) == 1 for sds in hdf.sds.values())
    assert hdf.closed
    normalized = transformer(pd.DataFrame([record]))
    assert pd.notna(normalized.loc[0, expected])


def test_raw_fill_masked_but_zero_quality_remains(monkeypatch):
    bands = {
        "250m 16 days NDVI": -3000, "250m 16 days EVI": 3500,
        "250m 16 days VI Quality": 0, "250m 16 days pixel reliability": 0,
    }
    monkeypatch.setattr(modis, "_open_hdf4",
                        lambda path: FakeHDF(bands, (4800, 4800)))
    row = modis.extract_point(filename("MOD13Q1"), LAT, LON, "MOD13Q1")
    assert np.isnan(row["250m_16_days_NDVI"])
    assert row["250m_16_days_VI_Quality"] == 0
    assert row["250m_16_days_pixel_reliability"] == 0


def test_recovery_hdf4_validation_uses_pyhdf_not_rasterio(tmp_path, monkeypatch):
    path = tmp_path / filename("MOD13Q1").name
    path.write_bytes(b"fake" * 1100)
    monkeypatch.setattr(modis, "list_science_datasets",
                        lambda file: {"250m 16 days NDVI": (4800, 4800)})
    assert GranuleRecovery(tmp_path, required_groups=()).check(path) == "valid"


def test_real_pyhdf_sds_catalog_roundtrip(tmp_path):
    """Exercise the actual HDF4 library, not only fake SDS objects."""
    pytest.importorskip("pyhdf")
    from pyhdf.SD import SD, SDC
    path = tmp_path / "small_synthetic.hdf"
    writer = SD(str(path), SDC.WRITE | SDC.CREATE)
    ds = writer.create("sample", SDC.INT16, (2, 3))
    ds.set(np.array([[1, 2, 3], [4, 5, 6]], dtype=np.int16))
    ds.endaccess()
    writer.end()
    assert modis.list_science_datasets(path) == {"sample": (2, 3)}


def test_malformed_hdf4_cache_is_invalid_not_exception(tmp_path):
    pytest.importorskip("pyhdf")
    path = tmp_path / "truncated.hdf"
    path.write_bytes(b"Not HDF4" * 600)
    assert GranuleRecovery(tmp_path, required_groups=()).check(path) == "invalid"
