"""Offline gate for *environmental* WOFOST handoff, not simulation approval.

Checks the specific lean POWER + SRTM + SoilGrids bundle. The legacy full
baseline audit intentionally requires MODIS/WorldBank; it is not a meaningful
QA gate for this lean configuration. Keep SHA checks from audit_profile.
"""
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
import pandas as pd

from .audit import audit_profile
from .handoff import _load_table, check_weather

REQUIRED = {
    "nasa_power": "weather_daily",
    "srtm": "topography_samples",
    "soilgrids_wcs": "soil_properties_raw",
}
SOIL_PROPERTIES = (
    "phh2o", "soc", "clay", "sand", "bdod", "nitrogen", "wv0033", "wv1500"
)
SOIL_DEPTHS = ("0-5cm", "5-15cm", "15-30cm")


def check_topography(df: pd.DataFrame | None) -> dict:
    errors: list[str] = []
    if df is None or df.empty:
        return {"passed": False, "errors": ["topography_samples missing"]}
    required = {"sample", "elevation_m"}
    if not required.issubset(df.columns):
        return {"passed": False, "errors": ["missing topography columns"]}
    names = df["sample"].astype(str).tolist()
    elev = pd.to_numeric(df["elevation_m"], errors="coerce")
    if len(df) != 5 or set(names) != {"center", "north", "south", "east", "west"}:
        errors.append("expected five named SRTM samples")
    if not elev.notna().all() or not elev.map(math.isfinite).all():
        errors.append("SRTM has missing or non-finite elevations")
    center = elev.loc[df["sample"].eq("center")]
    if len(center) != 1 or not center.notna().all():
        errors.append("center elevation missing")
    return {"passed": not errors, "rows": len(df),
            "center_elevation_m": float(center.iloc[0]) if len(center)==1 and pd.notna(center.iloc[0]) else None,
            "errors": errors}


def check_soil(df: pd.DataFrame | None) -> dict:
    if df is None or df.empty:
        return {"passed": False, "errors": ["soil_properties_raw missing"]}
    required={"property", "depth", "statistic", "value", "unit"}
    missing=sorted(required-set(df.columns))
    if missing:
        return {"passed":False,"rows":len(df),"errors":["missing soil columns: "+", ".join(missing)]}
    expected={(p,d) for p in SOIL_PROPERTIES for d in SOIL_DEPTHS}
    raw=df.loc[df["statistic"].astype(str).eq("mean")].copy()
    pairs=list(zip(raw["property"].astype(str),raw["depth"].astype(str)))
    vals=pd.to_numeric(raw["value"],errors="coerce")
    errors=[]
    if len(pairs)!=len(set(pairs)):
        errors.append("duplicate mean soil property/depth combinations")
    absent=expected-set(pairs)
    if absent:
        errors.append(f"missing pilot property/depth combinations: {len(absent)}")
    if len(df)!=len(expected) or len(raw)!=len(expected) or set(pairs)!=expected:
        errors.append("soil table differs from the 24-row pilot contract")
    if not vals.notna().all() or not vals.map(math.isfinite).all():
        errors.append("non-finite soil property values")
    if raw["unit"].isna().any() or raw["unit"].astype(str).str.strip().eq("").any():
        errors.append("missing soil measurement units")
    return {"passed":not errors,"rows":len(df),
            "expected_pilot_rows":len(expected),
            "missing_property_depth":sorted(f"{p}/{d}" for p,d in absent),
            "errors":errors,
            "hydraulic_parameters_wofost_ready":False}


def assess_source_bundle(run_dir: Path) -> dict:
    root=Path(run_dir)
    manifest=json.loads((root/"farm_profile.json").read_text(encoding="utf-8"))
    audit=audit_profile(root,expected_farm_id=manifest["farmer_inputs"]["farm_id"])
    status=manifest.get("source_status",{})
    source_errors={}
    warnings=[]
    for source,table in REQUIRED.items():
        record=status.get(source,{})
        if not record.get("enabled",False) or record.get("status") not in {"available","partial"}:
            source_errors[source]=f"source disabled or not usable: {record.get('status')}"
        if record.get("status")=="partial":
            warnings.append(f"{source} is partial; review its coverage and warnings")
        if manifest.get("tables",{}).get(table,{}).get("validation",{}).get("passed") is not True:
            source_errors[source]=f"table {table} did not pass validation"
    weather=check_weather(_load_table(root,manifest,"weather_daily"))
    weather_df=_load_table(root,manifest,"weather_daily")
    if weather_df is not None and {"tmin_c","tmean_c","tmax_c"}.issubset(weather_df):
        nums=weather_df[["tmin_c","tmean_c","tmax_c"]].apply(pd.to_numeric,errors="coerce")
        if (nums["tmean_c"].lt(nums["tmin_c"]) | nums["tmean_c"].gt(nums["tmax_c"])).any():
            weather["complete"]=False
            weather["errors"].append("TMEAN outside TMIN..TMAX")
        if not nums.map(math.isfinite).all().all():
            weather["complete"]=False
            weather["errors"].append("non-finite temperature measurement")
    if weather_df is not None:
        numeric=weather_df.reindex(columns=["precip_mm","solar_mj_m2_day","rh_pct","wind_m_s"]).apply(pd.to_numeric,errors="coerce")
        if not numeric.map(math.isfinite).all().all():
            weather["complete"]=False
            weather["errors"].append("non-finite meteorological measurement")
    soil=check_soil(_load_table(root,manifest,"soil_properties_raw"))
    topo=check_topography(_load_table(root,manifest,"topography_samples"))
    ready=(audit["integrity_ok"] and not source_errors and weather["complete"]
           and soil["passed"] and topo["passed"])
    return {
        "farm_id":manifest["farmer_inputs"]["farm_id"],
        "run_id":manifest.get("run_id"),
        "integrity_ok":audit["integrity_ok"],
        "integrity_errors":audit["errors"],
        "lean_source_qa_ready":bool(ready),
        "source_errors":source_errors,
        "warnings":warnings,
        "weather":weather,
        "soil":soil,
        "topography":topo,
        "wofost_pp_simulation_ready":False,
        "wofost_wlp_simulation_ready":False,
        "missing_for_pcse":[
            "versioned PCSE weather adapter to produce VAP, E0, ES0, ET0 and correct units",
            "crop and cultivar parameter set compatible with selected PCSE model",
            "site parameters and prospective AgroManagement plan",
            "WLP only: validated hydraulic soil profile, rooting depth and initial water state",
            "independent observations for field calibration/validation"
        ],
        "notes":[
            "lean_source_qa_ready means environmental bundle checked, not model readiness",
            "soil data are regional raster estimates, not laboratory field soil tests",
            "SRTM center point is an estimate, not a verified farm elevation",
            "Farm 1 ha area is a schema placeholder, not an observed acreage",
            "MODIS/GPM/SMAP are intentionally excluded; not required for WOFOST PP weather handoff"
        ]
    }


def main(argv=None) -> int:
    parser=argparse.ArgumentParser(description="Audit lean Guanajuato WOFOST environmental source bundle")
    parser.add_argument("--run-dir",required=True,type=Path)
    parser.add_argument("--output",type=Path)
    args=parser.parse_args(argv)
    report=assess_source_bundle(args.run_dir)
    if args.output:
        args.output.parent.mkdir(parents=True,exist_ok=True)
        args.output.write_text(json.dumps(report,indent=2,ensure_ascii=False),encoding="utf-8")
    print(json.dumps({
        "run_id":report["run_id"],
        "integrity_ok":report["integrity_ok"],
        "lean_source_qa_ready":report["lean_source_qa_ready"],
        "source_errors":report["source_errors"],
        "weather":report["weather"],
        "soil":report["soil"],
        "topography":report["topography"],
        "wofost_pp_simulation_ready":False,
        "wofost_wlp_simulation_ready":False,
    },indent=2,ensure_ascii=False))
    return 0 if report["lean_source_qa_ready"] else 1


if __name__=="__main__":
    raise SystemExit(main())
