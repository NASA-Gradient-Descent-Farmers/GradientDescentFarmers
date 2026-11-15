"""No-network contract tests for the actual team adapter."""
import json
from pathlib import Path
import pytest

from gradientdescentfarmers.source_builder import NASAProfileSourceBuilder, SourceBuilder
from gradientdescentfarmers.source_builder.adapter import load_source_config, REPO_ROOT

def test_adapter_implements_team_contract():
    assert issubclass(NASAProfileSourceBuilder,SourceBuilder)

def test_reference_coordinates_and_configs():
    d=json.loads((REPO_ROOT/"resources/guanajuato_reference.json").read_text())
    assert d["latitude"]==20.4243195
    assert d["longitude"]==-101.1466639
    c=load_source_config(REPO_ROOT/"resources/guanajuato_integrated.json")
    assert c["output_root"]=="data/integrated_guanajuato"

def test_preview_disables_downloads(tmp_path,monkeypatch):
    from gradientdescentfarmers.source_builder.core import builder as core_builder
    def disallow(self):
        raise AssertionError("Preview attempted remote provider acquisition")
    # Build uses data_retrieval() even when sources disabled: assert no upstream raw sources are invoked.
    original=core_builder.FarmProfileBuilder.data_retrieval
    def check(self):
        assert not any(self.settings.enabled(s,self.farmer.mode) for s in __import__(
            "gradientdescentfarmers.source_builder.core.settings",
            fromlist=["SOURCE_TABLES"]).SOURCE_TABLES)
        return original(self)
    monkeypatch.setattr(core_builder.FarmProfileBuilder,"data_retrieval",check)
    src=json.loads((REPO_ROOT/"resources/guanajuato_reference.json").read_text())
    (tmp_path/"data").mkdir()
    result=NASAProfileSourceBuilder(tmp_path).build({"farmer_input":src,"run":False})
    assert result["source_status"]["nasa_power"]=="not_requested"
    assert Path(result["profile_path"]).is_file()
    assert Path(result["profile_path"]).is_relative_to(tmp_path/"data")

def test_source_path_restrictions(tmp_path):
    src=json.loads((REPO_ROOT/"resources/guanajuato_reference.json").read_text())
    with pytest.raises(ValueError,match="under repository-root"):
        NASAProfileSourceBuilder(tmp_path).build({"farmer_input":src,"output_root":"../outside","run":False})
