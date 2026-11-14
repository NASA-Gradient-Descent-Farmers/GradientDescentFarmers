"""Derived climate features from original daily measurements, never new observations."""
from __future__ import annotations
import calendar
import numpy as np
import pandas as pd
from .settings import BuilderSettings


def longest_dry_run(precip:pd.Series, dates:pd.Series, threshold_mm:float)->int:
    """Missing dates/values BREAK a dry sequence; they are not dry observations."""
    f=pd.DataFrame({"date":pd.to_datetime(dates),"precip":pd.to_numeric(precip,errors="coerce")})
    if f.empty: return 0
    f=f.sort_values("date")
    count=best=0
    prev=None
    for time,value in zip(f.date,f.precip):
        if prev is not None and (time-prev).days!=1: count=0
        if pd.notna(value) and value<threshold_mm:
            count+=1
            best=max(best,count)
        else: count=0
        prev=time
    return best


def weather_features(weather:pd.DataFrame,cfg:BuilderSettings):
    """Return annual, monthly and explicit assumptions; no invented daily records."""
    d=weather.copy()
    d["date"]=pd.to_datetime(d.date)
    d=d.sort_values("date")
    d["year"]=d.date.dt.year
    d["month"]=d.date.dt.month
    d["gdd_approx"]=np.maximum(d.tmean_c-cfg.gdd_base_c,0)
    annually=[]
    for year,chunk in d.groupby("year"):
        rain=chunk.precip_mm
        dates=chunk.date
        is_dry=rain.lt(cfg.dry_threshold_mm)&rain.notna()
        days_in_year=366 if calendar.isleap(int(year)) else 365
        annually.append({"farm_id":chunk.farm_id.iloc[0],"year":int(year),
          "total_precip_observed_mm":float(rain.sum(min_count=1)) if rain.notna().any() else np.nan,
          "rain_valid_days":int(rain.notna().sum()),"expected_calendar_days":days_in_year,
          "rain_coverage_pct":100*rain.notna().sum()/days_in_year,
          "is_full_calendar_year": bool(dates.dt.dayofyear.nunique()==days_in_year and rain.notna().sum()==days_in_year),
          "dry_days_observed":int(is_dry.sum()),
          "longest_dry_run_days":longest_dry_run(rain,dates,cfg.dry_threshold_mm),
          "frost_days_observed":int(chunk.tmin_c.le(cfg.frost_threshold_c).sum()),
          "heat_days_observed":int(chunk.tmax_c.gt(cfg.heat_threshold_c).sum()),
          "gdd_base10_approx_observed":float(chunk.gdd_approx.sum(min_count=1))})
    annual=pd.DataFrame(annually)
    monthly=d.groupby(["farm_id","year","month"],as_index=False).agg(
      precip_observed_mm=("precip_mm",lambda x:x.sum(min_count=1)),
      rain_valid_days=("precip_mm","count"),
      tmean_c=("tmean_c","mean"),tmin_c=("tmin_c","mean"),tmax_c=("tmax_c","mean"))
    p95=d.loc[d.precip_mm.gt(0),"precip_mm"].quantile(.95)
    params={"dry_threshold_mm":cfg.dry_threshold_mm,"frost_threshold_c":cfg.frost_threshold_c,
            "heat_threshold_c":cfg.heat_threshold_c,"gdd_base_c":cfg.gdd_base_c,
            "positive_rain_day_p95_mm":float(p95) if pd.notna(p95) else None,
            "note":"GDD uses approximate mean-temp baseline, not crop phenology; annual sums can be partial"}
    return annual,monthly,params


def model_readiness(tables:dict[str,pd.DataFrame],checks:dict[str,dict]):
    def usable(name):
        return name in tables and not tables[name].empty and checks.get(name,{}).get("usable_rows",0)>0 and checks.get(name,{}).get("passed",False)
    weather=usable("weather_daily")
    soil=usable("soil_properties_raw") or usable("farmer_soil_tests")
    props=usable("validated_crop_parameters")
    prices=usable("local_crop_prices")
    # These outputs denote technical prerequisites, not field-validation of a model.
    return {
      "climate_exploration":{"ready":weather,"reason":"POWER daily with physical QA"},
      "terrain_characterization":{"ready":usable("topography_samples"),"reason":"5-point topography estimate"},
      "soil_characterization":{"ready":soil,"reason":"SoilGrids or laboratory observations"},
      "extreme_rain_analysis":{"ready":usable("gpm_daily"),"reason":"at least one complete 48-slot UTC day"},
      "vegetation_phenology":{"ready":usable("vegetation_timeseries"),"reason":"NDVI/EVI QA observations; no crop identification"},
      "soil_moisture_exploration":{"ready":usable("soil_moisture_timeseries"),"reason":"regional SMAP L4; not parcel measurement"},
      "future_climate_scenarios":{"ready":usable("climate_projections"),"reason":"one scenario not climate robustness"},
      "agronomic_input_available":{"ready":props and weather and soil,
                                   "reason":"parameter file exists but WOFOST calibration is NOT certified"},
      "economic_input_available":{"ready":prices,"reason":"regional prices alone do not equal net farm profit"},
      "wofost_validated":{"ready":False,"reason":"requires independent simulation/calibration/holdout tests"},
      "rotation_optimization_validated":{"ready":False,"reason":"NSGA/Pareto model is separate future milestone"},
      "economic_optimization_ready":{"ready":False,"reason":"needs yields, costs, calibrated uncertainty"}
    }
