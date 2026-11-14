"""Source-to-PCSE handoff gates: no remote calls or invented crop params."""
from datetime import date, timedelta
import json
from pathlib import Path
import numpy as np
import pandas as pd
import pytest
from gradientdescentfarmers.source_builder.core.handoff import (
    check_weather, check_modis, assess_run,
)
from gradientdescentfarmers.source_builder.core.earthdata import gpm_daily


def weather(start=date(2024, 1, 1), n=731):
    dates=[start+timedelta(days=i) for i in range(n)]
    return pd.DataFrame({
        "date":dates, "tmin_c":[10.0]*n, "tmax_c":[25.0]*n,
        "precip_mm":[1.0]*n, "solar_mj_m2_day":[20.0]*n,
        "rh_pct":[65.0]*n, "wind_m_s":[2.0]*n,
    })


def test_weather_leap_year_and_daily_continuity():
    ok=check_weather(weather())
    assert ok["complete"]
    assert ok["observed_days"]==731
    assert "VAP" in " ".join(ok["pcse_weather_missing"])


def test_weather_missing_day_fails_closed():
    sample=weather().drop(index=30)
    result=check_weather(sample)
    assert not result["complete"]
    assert "missing_days=1" in " ".join(result["errors"])


def test_weather_bad_humidity_fails_closed():
    sample=weather()
    sample.loc[5, "rh_pct"]=120.0
    assert not check_weather(sample)["complete"]


def test_modis_composites_are_not_falsely_complete_with_two_rows():
    sample=pd.DataFrame({"date":["2024-01-01","2024-01-17"],
                         "ndvi_qa":[.5,.6],"evi_qa":[.3,.2]})
    got=check_modis(sample,16,("ndvi_qa","evi_qa"))
    assert got["expected_composites"]==46
    assert got["missing_composites"]==44
    assert got["qa_coverage"]==1
    assert not got["complete"]


def test_modis_rejects_out_of_window_and_has_exact_calendar():
    dates=[date(year,1,1)+timedelta(days=i)
           for year in (2024,2025)
           for i in range(0,(date(year+1,1,1)-date(year,1,1)).days,8)]
    sample=pd.DataFrame({"date":[str(d) for d in dates],
                         "et_qa_mm_period":[1.]*len(dates),
                         "pet_qa_mm_period":[2.]*len(dates)})
    ok=check_modis(sample,8,("et_qa_mm_period","pet_qa_mm_period"))
    assert ok["complete"] and ok["expected_composites"]==92
    sample.loc[len(sample)]={"date":"2023-12-27", "et_qa_mm_period":1.0,
                             "pet_qa_mm_period":2.0}
    assert not check_modis(sample,8,("et_qa_mm_period","pet_qa_mm_period"))["complete"]


def test_gpm_48_distinct_but_shifted_intervals_is_not_complete():
    half=pd.DataFrame({
       "farm_id":["f"]*48,
       "datetime_utc":pd.date_range("2024-07-01T00:01:00Z",periods=48,freq="30min"),
       "precip_30min_mm":[1.0]*48,
    })
    out=gpm_daily(half)
    assert not out.iloc[0]["complete_48_slots"]
    assert np.isnan(out.iloc[0]["precip_total_mm"])


def test_gpm_complete_exact_slots_still_works():
    half=pd.DataFrame({
       "farm_id":["f"]*48,
       "datetime_utc":pd.date_range("2024-07-01T00:00:00Z",periods=48,freq="30min"),
       "precip_30min_mm":[1.0]*48,
    })
    out=gpm_daily(half)
    assert bool(out.iloc[0]["complete_48_slots"])
    assert out.iloc[0]["precip_total_mm"]==48


def test_wofost_gate_does_not_infer_crop_data_from_weather(tmp_path):
    (tmp_path/"farm_profile.json").write_text(json.dumps({
        "run_id":"test", "farm_inputs":{}, "farmer_inputs":{"farm_id":"test"},
        "source_status":{}, "tables":{}, "build_state":"partial",
    }))
    got=assess_run(tmp_path)
    assert not got["wofost_pp_input_ready"]
    assert not got["wofost_wlp_input_ready"]
    assert not got["integrity_ok"]


def test_integrated_config_gpm_one_day_and_modis_earthaccess():
    p=Path(__file__).resolve().parents[2]/"resources/guanajuato_integrated_settings.json"
    cfg=json.loads(p.read_text())
    assert cfg["modis_provider"]=="earthaccess"
    assert cfg["gpm_max_granules"]==48
    assert cfg["source_overrides"]["nasa_power"]
    assert cfg["source_overrides"]["gpm_imerg_v07"]
    assert cfg["source_overrides"]["smap_l4"]
