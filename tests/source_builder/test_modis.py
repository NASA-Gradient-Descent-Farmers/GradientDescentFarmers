import numpy as np
import pandas as pd
from gradientdescentfarmers.source_builder.core.preprocessing import standardize_mod13,standardize_mod11,standardize_mod16
from gradientdescentfarmers.source_builder.core.validation import validate_table

BASIC={"date":pd.to_datetime(["2024-01-01"]),"modis_date":["A2024001"],"farm_id":["texcoco"]}

def test_ndvi_scale_and_qa():
    d=pd.DataFrame({**BASIC,"250m_16_days_NDVI":[3167],"250m_16_days_EVI":[1845],
      "250m_16_days_VI_Quality":[2116],"250m_16_days_pixel_reliability":[0]})
    out=standardize_mod13(d)
    assert abs(out.iloc[0].ndvi_qa-.3167)<1e-9
    assert abs(out.iloc[0].evi_qa-.1845)<1e-9
    assert out.iloc[0].qa_pass
    assert validate_table("vegetation_timeseries",out).valid

def test_ndvi_qa_fail_keeps_raw():
    d=pd.DataFrame({**BASIC,"250m_16_days_NDVI":[3167],"250m_16_days_EVI":[1845],
      "250m_16_days_VI_Quality":[2116],"250m_16_days_pixel_reliability":[3]})
    out=standardize_mod13(d)
    assert np.isnan(out.iloc[0].ndvi_qa)
    assert out.iloc[0].ndvi_raw==3167
    assert not validate_table("vegetation_timeseries",out).valid

def test_lst_day_and_night_qa_independent():
    d=pd.DataFrame({**BASIC,"LST_Day_1km":[15000],"LST_Night_1km":[14000],
                     "QC_Day":[0],"QC_Night":[3]})
    out=standardize_mod11(d)
    assert abs(out.iloc[0].lst_day_qa_c-26.85)<1e-8
    assert pd.isna(out.iloc[0].lst_night_qa_c)

def test_et_last_composite_duration():
    d=pd.DataFrame({"date":pd.to_datetime(["2024-12-26"]),"modis_date":["A2024361"],"farm_id":["f"],
       "ET_500m":[40],"PET_500m":[100],"ET_QC_500m":[0]})
    out=standardize_mod16(d)
    assert out.iloc[0].period_days==6
    assert out.iloc[0].et_mm_period==4.0
    assert abs(out.iloc[0].et_mm_day-4/6)<1e-9
