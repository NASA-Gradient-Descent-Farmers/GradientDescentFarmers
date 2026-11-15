"""Offline acceptance checks for minimal WOFOST source bundle."""
import json
import pandas as pd

from gradientdescentfarmers.source_builder.core.wofost_source_check import (
    check_soil,check_topography,assess_source_bundle
)

def soil_table():
    return pd.DataFrame([
        {"property":p,"depth":d,"statistic":"mean","value":1.0,"unit":"unit"}
        for p in ("phh2o","soc","clay","sand","bdod","nitrogen","wv0033","wv1500")
        for d in ("0-5cm","5-15cm","15-30cm")
    ])


def test_soil_full_pilot_and_missing_combinations():
    assert check_soil(soil_table())["passed"]
    missing=check_soil(soil_table().iloc[:-1])
    assert not missing["passed"]
    assert missing["missing_property_depth"]


def test_soil_duplicate_and_missing_values():
    d=soil_table()
    d.loc[1,"depth"]="0-5cm"
    assert not check_soil(d)["passed"]
    d=soil_table()
    d.loc[1,"value"]=None
    assert not check_soil(d)["passed"]


def test_topography_requires_five_valid_elevations():
    d=pd.DataFrame({"sample":["center","north","south","east","west"],
                    "elevation_m":[1800.,1802.,1799.,1801.,1801.]})
    assert check_topography(d)["passed"]
    d.loc[0,"elevation_m"]=None
    assert not check_topography(d)["passed"]


def test_missing_bundle_fails_closed(tmp_path):
    (tmp_path/"farm_profile.json").write_text(json.dumps({
        "farmer_inputs":{"farm_id":"test"},"run_id":"abc",
        "source_status":{},"tables":{},"build_state":"partial"
    }))
    report=assess_source_bundle(tmp_path)
    assert not report["lean_source_qa_ready"]
    assert not report["wofost_pp_simulation_ready"]
    assert not report["wofost_wlp_simulation_ready"]
