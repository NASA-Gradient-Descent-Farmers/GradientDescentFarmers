"""Fail-closed source handoff audit for WOFOST/PCSE input preparation.

Distinguishes data acquisition and weather adapter feasibility from agronomic
simulation authorization. Does not infer crop/soil/site parameters.
"""
from __future__ import annotations
import argparse
from datetime import date, timedelta
import json
from pathlib import Path
import pandas as pd

from .audit import audit_profile

REQUIRED_WEATHER = (
    "date", "tmin_c", "tmax_c", "precip_mm",
    "solar_mj_m2_day", "rh_pct", "wind_m_s",
)
MODIS = {
    "modis_mod13q1": ("vegetation_timeseries", 16, ("ndvi_qa", "evi_qa")),
    "modis_mod11a2": ("land_surface_temperature", 8, ("lst_day_qa_c", "lst_night_qa_c")),
    "modis_mod16a2gf": ("evapotranspiration", 8, ("et_qa_mm_period", "pet_qa_mm_period")),
}


def _load_table(root: Path, profile: dict, name: str) -> pd.DataFrame | None:
    item = profile.get("tables", {}).get(name)
    if not item:
        return None
    rel = item.get("relative_path")
    if not isinstance(rel, str):
        return None
    path = (root / rel).resolve()
    if not path.is_relative_to(root.resolve()) or not path.is_file():
        return None
    if item.get("format") == "parquet":
        return pd.read_parquet(path)
    if item.get("format") == "csv":
        return pd.read_csv(path)
    return None


def _calendar(start: date, end: date, step: int = 1) -> set[date]:
    return {start + timedelta(days=i) for i in range(0, (end - start).days + 1, step)}


def check_weather(frame: pd.DataFrame | None,
                  start: date = date(2024, 1, 1),
                  end: date = date(2025, 12, 31)) -> dict:
    if frame is None or frame.empty:
        return {"complete": False, "errors": ["weather_daily unavailable"]}
    missing = sorted(set(REQUIRED_WEATHER) - set(frame.columns))
    if missing:
        return {"complete": False, "errors": ["missing columns: " + ", ".join(missing)]}
    timestamps = pd.to_datetime(frame["date"], utc=True, errors="coerce")
    valid_dates = set(timestamps.dropna().dt.date)
    expected = _calendar(start, end)
    numeric = frame[list(REQUIRED_WEATHER[1:])].apply(pd.to_numeric, errors="coerce")
    errors = []
    if timestamps.isna().any():
        errors.append("unparseable dates")
    if timestamps.duplicated().any():
        errors.append("duplicate daily timestamps")
    if valid_dates != expected:
        errors.append(f"missing_days={len(expected-valid_dates)}; outside_window={len(valid_dates-expected)}")
    if numeric.isna().any().any():
        errors.append("missing meteorological measurements")
    if not numeric.empty and (
        numeric["precip_mm"].lt(0).any() or
        numeric["solar_mj_m2_day"].lt(0).any() or
        numeric["wind_m_s"].lt(0).any() or
        numeric["rh_pct"].lt(0).any() or numeric["rh_pct"].gt(100).any() or
        numeric["tmin_c"].gt(numeric["tmax_c"]).any()
    ):
        errors.append("invalid physical range or temperature order")
    return {
        "complete": not errors,
        "observed_days": len(frame),
        "expected_days": len(expected),
        "first": str(timestamps.min()) if len(timestamps) else None,
        "last": str(timestamps.max()) if len(timestamps) else None,
        "errors": errors,
        "pcse_weather_missing": [
            "VAP (hPa; derive/verify from dewpoint or meteorological data)",
            "E0, ES0, ET0 (cm/day; compute with versioned PCSE reference_ET)",
        ],
        "pcse_unit_conversions": {
            "RAIN": "precip_mm / 10 -> cm/day",
            "IRRAD": "solar_mj_m2_day * 1000000 -> J/m2/day",
            "TMIN_TMAX": "degrees C unchanged",
            "WIND": "m/s unchanged",
        },
    }


def check_modis(frame: pd.DataFrame | None, step: int,
                qa_cols: tuple[str, ...],
                start: date = date(2024, 1, 1),
                end: date = date(2025, 12, 31)) -> dict:
    if frame is None or frame.empty:
        return {"complete": False, "reason": "table missing"}
    if "date" not in frame:
        return {"complete": False, "reason": "date column missing"}
    stamps = pd.to_datetime(frame["date"], utc=True, errors="coerce")
    values = list(stamps.dropna().dt.date)
    expected = set()
    for year in range(start.year, end.year + 1):
        begin = max(start, date(year, 1, 1))
        finish = min(end, date(year, 12, 31))
        # MODIS C6.1 annual composite acquisition starts: DOY 001,
        # then 8/16 days; year-end last composite is shorter.
        start_year = date(year, 1, 1)
        expected |= {d for d in _calendar(start_year, finish, step) if d >= begin}
    observed = set(values)
    quality = frame.reindex(columns=list(qa_cols)).apply(pd.to_numeric, errors="coerce")
    usable = int(quality.notna().all(axis=1).sum())
    return {
        "complete": (observed == expected and len(values) == len(observed)
                     and usable > 0),
        "rows": len(frame),
        "expected_composites": len(expected),
        "unique_dates": len(observed),
        "missing_composites": len(expected - observed),
        "unexpected_dates": [str(d) for d in sorted(observed - expected)][:10],
        "qa_usable_rows": usable,
        "qa_coverage": round(usable / len(frame), 4) if len(frame) else None,
    }


def assess_run(run_dir: Path) -> dict:
    root = Path(run_dir)
    profile = json.loads((root / "farm_profile.json").read_text(encoding="utf-8"))
    integrity = audit_profile(root, expected_farm_id=profile["farmer_inputs"]["farm_id"])
    statuses = {key: value.get("status") for key, value in profile["source_status"].items()}
    weather = check_weather(_load_table(root, profile, "weather_daily"))
    modis = {
        src: check_modis(_load_table(root, profile, name), days, qa)
        for src, (name, days, qa) in MODIS.items()
    }
    rain = _load_table(root, profile, "gpm_daily")
    gpm_day = (rain is not None and "complete_48_slots" in rain.columns
               and rain["complete_48_slots"].astype(str).str.lower().eq("true").any())
    smap = _load_table(root, profile, "soil_moisture_timeseries")
    blockers = {
        "weather_pcse_adapter": "VAP, E0, ES0, ET0 and unit conversions need a versioned PCSE adapter",
        "crop_variety": "validated PCSE crop/variety parameter set absent",
        "site_parameters": "PCSE compatible site parameters/initial conditions absent",
        "agromanagement": "prospective sowing/emergence/harvest calendar and management absent",
        "soil_hydraulics": "required for WLP: validated hydraulics, rooting depth and initial water",
        "observed_calibration": "independent growth/yield observations missing; simulations unvalidated",
    }
    return {
        "farm_id": profile["farmer_inputs"]["farm_id"],
        "run_id": profile.get("run_id"),
        "build_state": profile.get("build_state"),
        "integrity_ok": integrity["integrity_ok"],
        "baseline_qa_ok": integrity["qa_ok"],
        "integrity_errors": integrity["errors"],
        "source_status": statuses,
        "weather_source_ready": weather["complete"],
        "weather_check": weather,
        "modis": modis,
        "gpm_complete_utc_day": bool(gpm_day),
        "smap_snapshot_available": smap is not None and not smap.empty,
        "environmental_inventory_present": all(
            statuses.get(k) in ("available", "partial")
            for k in ("nasa_power", "srtm", "soilgrids_wcs", "modis_mod13q1",
                      "modis_mod11a2", "modis_mod16a2gf", "worldbank_agriculture",
                      "gpm_imerg_v07", "smap_l4")
        ),
        "wofost_pp_input_ready": False,
        "wofost_wlp_input_ready": False,
        "wofost_field_validated": False,
        "wofost_blockers": blockers,
        "notes": [
            "Source availability and PCSE simulation readiness are distinct gates",
            "GPM covers only the requested UTC day; SMAP covers a short snapshot",
            "No observed farm acreage or crop variety; the 1ha schema field is synthetic",
            "Crop, site, soil and management parameters require explicit evidence",
        ],
    }


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Validate FarmProfile source and WOFOST handoff readiness")
    parser.add_argument("--run-dir", required=True, type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args(argv)
    report = assess_run(args.run_dir)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps({
        "run_id": report["run_id"],
        "integrity_ok": report["integrity_ok"],
        "weather_source_ready": report["weather_source_ready"],
        "environmental_inventory_present": report["environmental_inventory_present"],
        "gpm_complete_utc_day": report["gpm_complete_utc_day"],
        "wofost_pp_input_ready": report["wofost_pp_input_ready"],
        "wofost_wlp_input_ready": report["wofost_wlp_input_ready"],
        "wofost_blockers": report["wofost_blockers"],
    }, indent=2))
    return 0 if report["integrity_ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
