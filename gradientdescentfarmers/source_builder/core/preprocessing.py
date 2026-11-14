"""Pure scientific transformations from master notebook sections 6, 13–16.

Do NOT merge unrelated temporal/spatial resolutions. Preserve raw columns and
QA flags; NEVER classify crop species, bare months or water stress from NDVI alone.
"""
from __future__ import annotations
import numpy as np
import pandas as pd
from .schema import FarmerInput


def _bits(series: pd.Series, shift: int, mask: int):
    return pd.to_numeric(series, errors="coerce").map(
        lambda x: (int(x) >> shift) & mask if pd.notna(x) else np.nan)


def _safe_scale(frame, field, factor, minimum, maximum, offset=0):
    raw=pd.to_numeric(frame[field],errors="coerce")
    return raw.where(raw.between(minimum,maximum))*factor+offset


def standardize_mod13(frame: pd.DataFrame):
    d=frame[["date","modis_date","farm_id"]].copy()
    mapping={"250m_16_days_NDVI":"ndvi_raw","250m_16_days_EVI":"evi_raw",
             "250m_16_days_VI_Quality":"vi_quality","250m_16_days_pixel_reliability":"pixel_reliability"}
    for k,v in mapping.items():
        d[v]=pd.to_numeric(frame[k],errors="coerce")
    d["ndvi"]=_safe_scale(d,"ndvi_raw",.0001,-2000,10000)
    d["evi"]=_safe_scale(d,"evi_raw",.0001,-2000,10000)
    d["mandatory_qa"]=_bits(d.vi_quality,0,3)
    d["vi_usefulness"]=_bits(d.vi_quality,2,15)
    d["aerosol"]=_bits(d.vi_quality,6,3)
    d["mixed_cloud"]=_bits(d.vi_quality,10,1)
    d["possible_shadow"]=_bits(d.vi_quality,15,1)
    d["qa_pass"]=d.pixel_reliability.eq(0)&d.mandatory_qa.eq(0)&d.mixed_cloud.eq(0)&d.possible_shadow.eq(0)
    for v in ("ndvi","evi"):
        d[f"{v}_qa"]=d[v].where(d.qa_pass)
    return d


def standardize_mod11(frame: pd.DataFrame):
    d=frame[["date","modis_date","farm_id"]].copy()
    for period, band, qa_band in (("day","LST_Day_1km","QC_Day"),("night","LST_Night_1km","QC_Night")):
        d[f"lst_{period}_raw"]=pd.to_numeric(frame[band],errors="coerce")
        d[f"qc_{period}"]=pd.to_numeric(frame[qa_band],errors="coerce")
        d[f"lst_{period}_c"]=_safe_scale(d,f"lst_{period}_raw",.02,7500,65535,-273.15)
        d[f"{period}_mandatory_qa"]=_bits(d[f"qc_{period}"],0,3)
        d[f"{period}_lst_error_class"]=_bits(d[f"qc_{period}"],6,3)
        d[f"{period}_qa_pass"]=(d[f"{period}_mandatory_qa"].eq(0)&
            d[f"{period}_lst_error_class"].isin([0,1])&d[f"lst_{period}_c"].notna())
        d[f"lst_{period}_qa_c"]=d[f"lst_{period}_c"].where(d[f"{period}_qa_pass"])
    return d


def standardize_mod16(frame:pd.DataFrame):
    d=frame[["date","modis_date","farm_id"]].copy()
    # Uniform tz-naive UTC acquisition dates for the 8-day/year-end arithmetic.
    d["date"]=pd.to_datetime(d.date, utc=True).dt.tz_localize(None)
    d["et_qc"]=pd.to_numeric(frame["ET_QC_500m"],errors="coerce")
    d["modland_qa"]=_bits(d.et_qc,0,1)
    d["cloud_state"]=_bits(d.et_qc,3,3)
    d["method_quality"]=_bits(d.et_qc,5,7)
    d["qa_pass"]=d.modland_qa.eq(0)&d.cloud_state.eq(0)&d.method_quality.isin([0,1])
    year_end=pd.to_datetime(d.date.dt.year.astype(str)+"-12-31")+pd.Timedelta(days=1)
    d["period_days"]=(year_end-d.date).dt.days.clip(upper=8)
    for variable,band in (("et","ET_500m"),("pet","PET_500m")):
        d[f"{variable}_raw"]=pd.to_numeric(frame[band],errors="coerce")
        d[f"{variable}_mm_period"]=_safe_scale(d,f"{variable}_raw",.1,-32767,32700)
        d[f"{variable}_mm_day"]=d[f"{variable}_mm_period"]/d.period_days
        d[f"{variable}_qa_mm_period"]=d[f"{variable}_mm_period"].where(d.qa_pass)
        d[f"{variable}_qa_mm_day"]=d[f"{variable}_mm_day"].where(d.qa_pass)
    d["et_pet_ratio"]=(d.et_qa_mm_period/d.pet_qa_mm_period.where(d.pet_qa_mm_period.gt(0)))
    return d


TRANSFORMERS={
 "modis_mod13q1": ("vegetation_timeseries",standardize_mod13),
 "modis_mod11a2": ("land_surface_temperature",standardize_mod11),
 "modis_mod16a2gf": ("evapotranspiration",standardize_mod16),
}


def farmer_tables(farmer: FarmerInput):
    """Normalize nested user input; never aggregate overlapping intercropped areas."""
    f=farmer
    fields=pd.DataFrame([{"farm_id":f.farm_id,**x.model_dump(mode="json")} for x in f.fields])
    seasons,plantings=[],[]
    for s in f.crop_history:
        seasons.append({"farm_id":f.farm_id,"field_id":s.field_id,"season_id":s.season_id,
                        "planting_system":s.planting_system,"species_count":len(s.plantings)})
        for p in s.plantings:
            plantings.append({"farm_id":f.farm_id,"field_id":s.field_id,"season_id":s.season_id,
                              "planting_system":s.planting_system, **p.model_dump(mode="json")})
    result={"fields":fields}
    if seasons: result["crop_seasons"]=pd.DataFrame(seasons)
    if plantings: result["crop_plantings"]=pd.DataFrame(plantings)
    if f.soil_tests:
        result["farmer_soil_tests"]=pd.DataFrame([{"farm_id":f.farm_id,**x.model_dump(mode="json")} for x in f.soil_tests])
    return result


CROP_CANDIDATES=("maize","bean","faba_bean","wheat","barley","soybean","sorghum","alfalfa","cover_crop","fallow")
CROP_PARAMETERS=("crop","cultivar","source","region","sowing_window","harvest_window",
                 "thermal_requirements","root_depth_m","crop_coefficient","water_requirement_mm",
                 "nitrogen_uptake_kg_ha","residue_biomass_t_ha","N_fixation_kg_ha",
                 "family","rotation_break_years","parameter_validation")

def schema_only_tables(farmer:FarmerInput):
    """Notebook's honest missing parameter schemas, NOT simulation-ready data."""
    crop=pd.DataFrame([{**{k:None for k in CROP_PARAMETERS},"crop":c,"parameter_validation":"missing"} for c in CROP_CANDIDATES])
    practices=pd.DataFrame([{"practice":p,"requested_by_farmer":None,"model_parameter_status":"missing"}
        for p in ("cover_crop","legume_inclusion","residue_retention","fallow")])
    economics=pd.DataFrame([{"farm_id":farmer.farm_id,"crop":crop_name,
            "farmgate_price":None,"price_currency":farmer.currency,"input_cost_ha":None,
            "labor_cost_ha":None,"historical_yield_t_ha":None,"status":"missing"} for crop_name in CROP_CANDIDATES])
    return {"crop_parameter_requirements":crop,"management_options":practices,"economic_input_requirements":economics}
