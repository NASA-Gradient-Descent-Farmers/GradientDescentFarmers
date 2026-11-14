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
    # Synthetic history ONLY for testing schemas, NOT Guanajuato farm observations.
    data["fields"][0]["area_ha"] = 1.5  # Synthetic test field only; Guanajuato reference remains 1.0-ha placeholder
    data["crop_history"] = [{
        "field_id": "reference_plot_demo",
        "season_id": "synthetic_milpa_2024",
        "planting_system": "intercropping",
        "plantings": [
            {"crop_name": "maize", "planting_date": "2024-05-15"},
            {"crop_name": "bean", "planting_date": "2024-05-20"},
            {"crop_name": "squash", "planting_date": "2024-05-20"}
        ]
    }]
    return FarmerInput.model_validate(data)

@pytest.fixture
def offline_settings(tmp_path):
    return BuilderSettings(output_root=tmp_path/"out",cache_root=tmp_path/"cache",
        export_format="csv",source_overrides={source:False for source in SOURCE_TABLES})
