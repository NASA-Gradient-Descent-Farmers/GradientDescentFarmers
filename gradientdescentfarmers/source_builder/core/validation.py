"""Scientific & structural checks. 'Available' != 'usable' != 'model-ready'."""
from __future__ import annotations
from dataclasses import dataclass,field
from typing import Any
import numpy as np
import pandas as pd
from .schema import SourceStatus


@dataclass
class DataCheck:
    name: str
    passed: bool
    severity: str = "error"
    detail: str = ""


@dataclass
class ValidationResult:
    checks: list[DataCheck] = field(default_factory=list)
    coverage: float | None = None
    usable_rows: int = 0
    warnings: list[str] = field(default_factory=list)

    @property
    def valid(self):
        return not any(not x.passed and x.severity=="error" for x in self.checks)

    def as_dict(self):
        return {"passed":self.valid,"coverage":self.coverage,"usable_rows":self.usable_rows,
                "checks":[vars(x) for x in self.checks],"warnings":self.warnings}


def _check(result,name,condition,detail="",severity="error"):
    result.checks.append(DataCheck(name,bool(condition),severity,detail))


def _has_valid(frame, col):
    return col in frame and pd.to_numeric(frame[col],errors="coerce").notna().any()


def validate_table(name:str, df:pd.DataFrame, expected_rows:int|None=None):
    r=ValidationResult()
    _check(r,"nonempty",not df.empty)
    if df.empty: return r
    _check(r,"duplicate_columns",df.columns.is_unique)
    time_col=next((c for c in ("datetime_utc","date","date_utc") if c in df),None)
    if time_col:
        dates=pd.to_datetime(df[time_col],errors="coerce",utc=True)
        _check(r,"timestamps_present",dates.notna().all())
        if name not in {"crop_seasons","crop_plantings"}:
            _check(r,"no_duplicate_timestamps",not dates.duplicated().any())
    if expected_rows is not None:
        _check(r,"expected_observation_count",len(df)==expected_rows,
               f"observed={len(df)}, expected={expected_rows}",severity="warning")
    if name=="weather_daily":
        required=("tmean_c","tmin_c","tmax_c","precip_mm","solar_mj_m2_day")
        _check(r,"required_weather_columns",set(required).issubset(df))
        if set(required).issubset(df):
            valid=df[list(required)].notna().all(axis=1)
            r.usable_rows=int(valid.sum())
            r.coverage=float(valid.mean())
            _check(r,"some_complete_weather",r.usable_rows>0)
            _check(r,"temperature_order",((df.tmin_c<=df.tmean_c)&(df.tmean_c<=df.tmax_c))[valid].all())
            _check(r,"precip_nonnegative",df.precip_mm.dropna().ge(0).all())
            _check(r,"physical_temp_range",df.tmax_c.dropna().between(-100,80).all())
            _check(r,"solar_nonnegative",df.solar_mj_m2_day.dropna().ge(0).all())
    elif name=="topography_samples":
        _check(r,"five_srtm_samples",len(df)==5)
        _check(r,"at_least_one_elevation",_has_valid(df,"elevation_m"))
        r.usable_rows=int(df.elevation_m.notna().sum()) if "elevation_m" in df else 0
    elif name=="soil_properties_raw":
        for c in ("property","depth","value","unit","coverage"):
            _check(r,f"column_{c}",c in df)
        r.usable_rows=int(pd.to_numeric(df.get("value",pd.Series(dtype=float)),errors="coerce").notna().sum())
        _check(r,"soil_values_available",r.usable_rows>0)
    elif name=="vegetation_timeseries":
        valid=df["ndvi_qa"].notna()&df["evi_qa"].notna()
        r.usable_rows=int(valid.sum()); r.coverage=float(valid.mean())
        _check(r,"some_valid_qa",r.usable_rows>0)
        _check(r,"ndvi_valid_range",df.ndvi.dropna().between(-.2,1).all())
        _check(r,"evi_valid_range",df.evi.dropna().between(-.2,1).all())
    elif name=="land_surface_temperature":
        valid=df["lst_day_qa_c"].notna()&df["lst_night_qa_c"].notna()
        r.usable_rows=int(valid.sum());r.coverage=float(valid.mean())
        _check(r,"some_valid_lst_day",df.lst_day_qa_c.notna().any())
        _check(r,"some_valid_lst_night",df.lst_night_qa_c.notna().any())
        _check(r,"plausible_lst_day",df.lst_day_qa_c.dropna().between(-100,80).all())
        _check(r,"plausible_lst_night",df.lst_night_qa_c.dropna().between(-100,80).all())
    elif name=="evapotranspiration":
        valid=df["et_qa_mm_period"].notna()&df["pet_qa_mm_period"].notna()
        r.usable_rows=int(valid.sum());r.coverage=float(valid.mean())
        _check(r,"some_valid_et_pet",r.usable_rows>0)
        _check(r,"period_1_to_8",df.period_days.between(1,8).all())
        _check(r,"nonnegative_et",df.et_qa_mm_period.dropna().ge(0).all())
        _check(r,"nonnegative_pet",df.pet_qa_mm_period.dropna().ge(0).all())
    elif name=="gpm_half_hourly":
        valid=df.precip_30min_mm.notna()
        r.usable_rows=int(valid.sum());r.coverage=float(valid.mean())
        _check(r,"some_valid_precip",r.usable_rows>0)
        _check(r,"nonnegative_precip",df.precip_30min_mm.dropna().ge(0).all())
    elif name=="gpm_daily":
        valid=df.precip_total_mm.notna()
        r.usable_rows=int(valid.sum());r.coverage=float(valid.mean())
        # Partial is acceptable; no fabricated daily total from two granules.
        _check(r,"complete_utc_day_available",r.usable_rows>0,severity="warning")
    elif name=="soil_moisture_timeseries":
        good=df.soil_moisture_surface_m3_m3.notna() & df.soil_moisture_rootzone_m3_m3.notna()
        r.usable_rows=int(good.sum());r.coverage=float(good.mean())
        _check(r,"some_surface_and_rootzone",r.usable_rows>0)
        for col in ("soil_moisture_surface_m3_m3","soil_moisture_rootzone_m3_m3"):
            _check(r,f"range_{col}",df[col].dropna().between(0,1).all())
        _check(r,"percentile_available",df.soil_moisture_rootzone_percentile.notna().any(),severity="warning")
    else:
        r.usable_rows=len(df)
    if r.coverage is None and len(df): r.coverage=r.usable_rows/len(df)
    return r


def combined_source_status(validations:dict[str,ValidationResult],frames:dict[str,pd.DataFrame],warnings:list[str]):
    """Missing when no rows, error on structural/physical failure, partial when unusable."""
    if not frames or all(x.empty for x in frames.values()):
        return SourceStatus.MISSING
    if any(not v.valid for v in validations.values()):
        return SourceStatus.ERROR
    if warnings or any(v.coverage is not None and v.coverage<1 for v in validations.values()):
        return SourceStatus.PARTIAL
    return SourceStatus.AVAILABLE
