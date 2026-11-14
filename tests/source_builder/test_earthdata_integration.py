"""Offline integration: Earthdata _download uses resumable granule recovery."""
from pathlib import Path
from types import SimpleNamespace
import h5py
import pytest

from gradientdescentfarmers.source_builder.core import earthdata

class FakeGranule:
    def __init__(self, name):
        self.name=name
    def data_links(self, access):
        return [f"https://example.org/{self.name}"]

class FakeEarthaccess:
    def __init__(self):
        self.calls=[]
        self.granules=[FakeGranule("A.HDF5"),FakeGranule("B.HDF5")]
    def search_data(self, **kwargs):
        return self.granules[:kwargs["count"]]
    def download(self, granules, local_path, threads, show_progress):
        self.calls.append([g.name for g in granules])
        out=[]
        for g in granules:
            path=Path(local_path)/g.name
            with h5py.File(path, "w") as f:
                grid=f.create_group("Grid")
                grid.create_dataset("lat",data=[20.4243195])
                grid.create_dataset("lon",data=[-101.1466639])
                grid.create_dataset("precipitation",data=[1.0])
            out.append(path)
        return out

def test_download_reuses_valid_and_recovers_broken(monkeypatch,tmp_path):
    fake=FakeEarthaccess()
    monkeypatch.setattr(earthdata,"_login",lambda:fake)
    folder=tmp_path/"earthdata"/"gpm"
    folder.mkdir(parents=True)
    damaged=folder/"A.HDF5"
    damaged.write_bytes(b"truncated original")
    ctx=SimpleNamespace(
        farmer=SimpleNamespace(latitude=20.4243195,longitude=-101.1466639),
        settings=SimpleNamespace(cache_root=tmp_path,retries=1))
    result=earthdata._download(ctx,"GPM_3IMERGHH","07","2024-07-01","2024-07-02",2,"gpm",("Grid",))
    assert len(result)==2
    assert len(fake.calls)==2
    assert damaged.read_bytes()==b"truncated original"
    assert all(path.parent.name.startswith("attempt-") for path in result)
    result2=earthdata._download(ctx,"GPM_3IMERGHH","07","2024-07-01","2024-07-02",2,"gpm",("Grid",))
    assert result2==result
    assert len(fake.calls)==2
