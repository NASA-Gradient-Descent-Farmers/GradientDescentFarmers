import numpy as np
import pandas as pd
from pathlib import Path
from gradientdescentfarmers.source_builder.core.earthdata import gpm_daily, smap_grid_point

def test_gpm_48_slots_complete():
    d=pd.DataFrame({"farm_id":["x"]*48,"datetime_utc":pd.date_range("2024-07-01",periods=48,freq="30min",tz="UTC"),
         "precip_30min_mm":[1.0]*48})
    out=gpm_daily(d)
    assert out.iloc[0].complete_48_slots
    assert out.iloc[0].precip_total_mm==48

def test_gpm_missing_one_slot_does_not_zero_fill():
    d=pd.DataFrame({"farm_id":["x"]*47,"datetime_utc":pd.date_range("2024-07-01",periods=47,freq="30min",tz="UTC"),
         "precip_30min_mm":[1.0]*47})
    out=gpm_daily(d)
    assert not out.iloc[0].complete_48_slots
    assert np.isnan(out.iloc[0].precip_total_mm)

def test_smap_grid_texcoco():
    row,col,lat,lon=smap_grid_point(19.53,-98.85)
    assert 0<=row<1624 and 0<=col<3856
    assert abs(lat-19.53)<.2 and abs(lon+98.85)<.2

def test_hdf5_aux_files_filter(tmp_path):
    import h5py
    from gradientdescentfarmers.source_builder.core.transport import validate_local_hdf5
    p=tmp_path/"scientific.h5"
    with h5py.File(p,"w") as h:h.create_group("Geophysical_Data")
    xml=tmp_path/"scientific.h5.xml";xml.write_text("test")
    qa=tmp_path/"scientific.qa";qa.write_text("checksum")
    assert validate_local_hdf5([p,xml,qa])==[p]
