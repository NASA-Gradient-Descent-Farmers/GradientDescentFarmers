"""Shared scientific source-builder fixtures for migrated regression tests."""
import json
from pathlib import Path
import pytest
from gradientdescentfarmers.source_builder.core.schema import FarmerInput
from gradientdescentfarmers.source_builder.core.settings import BuilderSettings, SOURCE_TABLES

@pytest.fixture
def farmer():
    root=Path(__file__).resolve().parents[1]
    data=json.loads((root / "resources" / "guanajuato_reference.json").read_text(encoding="utf-8"))
    return FarmerInput.model_validate(data)

@pytest.fixture
def offline_settings(tmp_path):
    return BuilderSettings(output_root=tmp_path/"out",cache_root=tmp_path/"cache",
        export_format="csv",source_overrides={source:False for source in SOURCE_TABLES})
