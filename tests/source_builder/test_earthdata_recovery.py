"""Tests are offline: tiny real HDF5 fixtures and synthetic Earthaccess stubs."""
from pathlib import Path
import h5py
import pytest
from gradientdescentfarmers.source_builder.core.earthdata_recovery import GranuleRecovery

def make_file(path: Path, good=True):
    with h5py.File(path, "w") as h:
        grid = h.create_group("Grid")
        grid.create_dataset("lat",data=[19.53])
        grid.create_dataset("lon",data=[-98.85])
        if good:
            grid.create_dataset("precipitation",data=[0.3])

class Granule:
    def __init__(self,name):
        self.name=name
    def data_links(self,access):
        assert access=="external"
        return [f"https://example.nasa.gov/{self.name}", f"https://example.nasa.gov/{self.name}.xml"]

class FakeDownload:
    def __init__(self):
        self.calls=[]
    def download(self,granules,local_path,threads,show_progress):
        assert threads==1
        self.calls.append([g.name for g in granules])
        output=[]
        for g in granules:
            p=Path(local_path)/g.name
            make_file(p)
            output.append(p)
        return output

def test_recovery_reuses_valid_and_does_not_overwrite_damaged(tmp_path):
    names=["test-00.HDF5","test-01.HDF5","test-02.HDF5"]
    make_file(tmp_path/names[0])
    (tmp_path/names[1]).write_bytes(b"partial-corrupt-file")
    fake=FakeDownload()
    recover=GranuleRecovery(tmp_path,("Grid",))
    paths=recover.acquire(fake,[Granule(n) for n in names])
    assert len(paths)==3
    assert fake.calls==[[names[1]],[names[2]]]
    assert (tmp_path/names[1]).read_bytes()==b"partial-corrupt-file"
    assert paths[1].parent.name.startswith("attempt-")
    assert recover.last_report["reused"]==1
    assert recover.last_report["recovered"]==2
    assert recover.acquire(fake,[Granule(n) for n in names])==paths
    assert len(fake.calls)==2

def test_inspect_does_not_change_files(tmp_path):
    p=tmp_path/"missing-00.HDF5"
    r=GranuleRecovery(tmp_path,("Grid",))
    assert r.inspect([Granule(p.name)])["invalid"]==[p.name]
    assert list(tmp_path.iterdir())==[]

def test_bad_granule_filename_is_rejected(tmp_path):
    class Bad:
        def data_links(self,access):
            return ["https://example.nasa.gov/test-00.HDF5",
                    "https://example.nasa.gov/other-01.HDF5"]
    with pytest.raises(ValueError,match="exactly one"):
        GranuleRecovery(tmp_path,("Grid",)).acquire(FakeDownload(),[Bad()])

def test_invalid_groups_fail_closed(tmp_path):
    make_file(tmp_path/"test-00.HDF5",good=False)
    assert GranuleRecovery(tmp_path,("Grid",)).check(tmp_path/"test-00.HDF5")=="invalid"

def test_unreadable_does_not_redownload_by_default(tmp_path,monkeypatch):
    fake=FakeDownload()
    r=GranuleRecovery(tmp_path,("Grid",))
    monkeypatch.setattr(r,"check",lambda p:"unreadable")
    with pytest.raises(RuntimeError,match="unreadable=1"):
        r.acquire(fake,[Granule("x.HDF5")])
    assert fake.calls==[]
