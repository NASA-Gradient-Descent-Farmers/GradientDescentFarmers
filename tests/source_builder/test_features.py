import pandas as pd
import numpy as np
from gradientdescentfarmers.source_builder.core.features import weather_features,longest_dry_run
from gradientdescentfarmers.source_builder.core.settings import BuilderSettings

def weather():
    return pd.DataFrame({"farm_id":["x"]*4,"date":pd.date_range("2024-01-01",periods=4),
       "precip_mm":[0.,0.,5.,0.],"tmean_c":[10.,12.,20.,15.],"tmin_c":[1.,2.,3.,4.],
       "tmax_c":[20.,24.,37.,30.],"solar_mj_m2_day":[12.,12.,12.,12.]})

def test_rain_features_partial_year():
    annual,monthly,metadata=weather_features(weather(),BuilderSettings())
    assert annual.iloc[0].total_precip_observed_mm==5
    assert annual.iloc[0].longest_dry_run_days==2
    assert annual.iloc[0].is_full_calendar_year==False
    assert annual.iloc[0].gdd_base10_approx_observed==17
    assert annual.iloc[0].heat_days_observed==1
    assert len(monthly)==1

def test_gap_breaks_dry_run():
    vals=pd.Series([0,0,0])
    days=pd.Series(pd.to_datetime(["2024-01-01","2024-01-03","2024-01-04"]))
    assert longest_dry_run(vals,days,1)==2

def test_missing_is_not_dry():
    d=pd.Series([0,np.nan,0]); dates=pd.Series(pd.date_range("2024-01-01",periods=3))
    assert longest_dry_run(d,dates,1)==1
