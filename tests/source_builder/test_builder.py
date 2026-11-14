import json
from pathlib import Path
import numpy as np
import pandas as pd
from gradientdescentfarmers.source_builder.core.schema import SourceStatus,FarmProfile
from gradientdescentfarmers.source_builder.core.builder import FarmProfileBuilder
from gradientdescentfarmers.source_builder.core.providers import ProviderPayload
from gradientdescentfarmers.source_builder.core.settings import SOURCE_TABLES


def good_power(ctx):
    dates=pd.date_range("2024-01-01",periods=3)
    return ProviderPayload(tables={"weather_daily":pd.DataFrame({"date":dates,"farm_id":[ctx.farmer.farm_id]*3,
       "tmean_c":[15,17,18],"tmin_c":[10,10,10],"tmax_c":[20,25,26],
       "precip_mm":[0,2,3],"solar_mj_m2_day":[10.,11.,12.]})},
       units={"precip_mm":"mm/day"},source_url="offline-fixture://power")


def bad_provider(ctx):
    raise TimeoutError("mock timeout")


def test_all_sources_in_manifest_offline(farmer,offline_settings):
    builder=FarmProfileBuilder(farmer,offline_settings)
    profile=builder.build(export=True)
    assert all(profile.source_status[x].status==SourceStatus.NOT_REQUESTED for x in SOURCE_TABLES)
    assert profile.build_state=="failed"  # no climate available, NOT disguised as ready
    assert profile.model_readiness["wofost_validated"]["ready"] is False
    p=builder.run_dir/"farm_profile.json"
    assert p.exists()
    back=FarmProfile.model_validate_json(p.read_text())
    assert back.tables["fields"].relative_path=="standardized/fields.csv"
    assert (builder.run_dir/back.tables["fields"].relative_path).exists()
    assert back.tables["crop_parameter_requirements"].validation["passed"]
    assert back.source_status["validated_crop_parameters"].status==SourceStatus.MISSING
    assert "crop_plantings" in profile.tables


def test_partial_source_failure_and_features(farmer,offline_settings):
    settings=offline_settings.model_copy(update={"source_overrides":{**offline_settings.source_overrides,
        "nasa_power":True,"srtm":True}})
    builder=FarmProfileBuilder(farmer,settings,providers={"nasa_power":good_power,"srtm":bad_provider})
    profile=builder.build(export=True)
    assert profile.source_status["nasa_power"].status==SourceStatus.AVAILABLE
    assert profile.source_status["srtm"].status==SourceStatus.ERROR
    assert profile.build_state=="partial"
    assert profile.model_readiness["climate_exploration"]["ready"]
    assert not profile.model_readiness["wofost_validated"]["ready"]
    assert "climate_annual_features" in profile.tables
    assert profile.tables["weather_daily"].sha256
    assert profile.source_status["srtm"].error.startswith("TimeoutError")
    availability=builder.availability_report()
    assert len(availability)==len(profile.source_status)


def test_reentrant_does_not_duplicate_tables(farmer,offline_settings):
    builder=FarmProfileBuilder(farmer,offline_settings)
    builder.build()
    names1=list(builder.tables)
    builder.build()
    assert list(builder.tables)==names1
    assert len(builder.source_status)==len(SOURCE_TABLES)+6


def test_injected_provider_cannot_fake_table_name(farmer,offline_settings):
    cfg=offline_settings.model_copy(update={"source_overrides":{**offline_settings.source_overrides,"nasa_power":True}})
    def malformed(ctx):return ProviderPayload(tables={"unexpected":pd.DataFrame({"x":[1]})})
    result=FarmProfileBuilder(farmer,cfg,providers={"nasa_power":malformed}).build()
    assert result.source_status["nasa_power"].status==SourceStatus.ERROR
    assert "unexpected" not in result.tables

def test_atomic_json_handles_nonfinite_values(tmp_path):
    payload = {
        "ndvi": 0.65,
        "missing": float("nan"),
        "infinity": float("inf"),
        "numpy_nan": np.float64("nan"),
        "pandas_missing": pd.NA,
        "nested": [
            {"value": float("-inf")},
            {"value": 0.42},
        ],
    }

    output = tmp_path / "provenance.json"

    FarmProfileBuilder._atomic_json(output, payload)

    result = json.loads(output.read_text())

    assert result["ndvi"] == 0.65
    assert result["missing"] is None
    assert result["infinity"] is None
    assert result["numpy_nan"] is None
    assert result["pandas_missing"] is None
    assert result["nested"][0]["value"] is None
    assert result["nested"][1]["value"] == 0.42