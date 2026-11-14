"""Team SourceBuilder adapter around the validated scientific FarmProfileBuilder.

Explicit run=True allows network requests. All generated files stay below root data/.
"""
from __future__ import annotations
import json
from pathlib import Path
from typing import Any, Mapping
from .base import SourceBuilder

REPO_ROOT = Path(__file__).resolve().parents[2]

def load_source_config(path: str | Path) -> dict[str, Any]:
    obj = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(obj, dict) or not isinstance(obj.get("source"), dict):
        raise ValueError("Expected JSON with a source object")
    return obj["source"]

class NASAProfileSourceBuilder(SourceBuilder):
    def __init__(self, repository_root: Path | None = None):
        self.repository_root = Path(repository_root or REPO_ROOT).resolve()

    def _resolve(self, path: str | Path) -> Path:
        p = Path(path)
        return p.resolve() if p.is_absolute() else (self.repository_root / p).resolve()

    def build(self, config: Mapping[str, Any]) -> dict[str, Any]:
        if not isinstance(config, Mapping):
            raise TypeError("source config must be a mapping")
        from .core.builder import FarmProfileBuilder
        from .core.schema import FarmerInput
        from .core.settings import BuilderSettings, SOURCE_TABLES

        if "farmer_input" in config:
            farmer_dict = config["farmer_input"]
        elif config.get("farmer_input_file"):
            farmer_dict = json.loads(self._resolve(config["farmer_input_file"]).read_text(encoding="utf-8"))
        else:
            raise ValueError("Specify farmer_input or farmer_input_file")
        farmer = FarmerInput.model_validate(farmer_dict)

        if "settings" in config:
            settings_dict = dict(config["settings"])
        elif config.get("settings_file"):
            settings_dict = json.loads(self._resolve(config["settings_file"]).read_text(encoding="utf-8"))
        else:
            settings_dict = {}
        root = self.repository_root / "data"
        output = self._resolve(config.get("output_root", "data/processed"))
        cache = self._resolve(config.get("cache_root", "data/cache"))
        for p in (output, cache):
            if not p.is_relative_to(root):
                raise ValueError("Scientific output/cache must reside under repository-root data/")
        settings_dict.update(output_root=str(output), cache_root=str(cache),
                             input_files_root=str(self._resolve(config.get("input_files_root", "data/farm_inputs"))))
        if config.get("run") is not True:
            settings_dict["source_overrides"] = {key: False for key in SOURCE_TABLES}
        settings = BuilderSettings.model_validate(settings_dict)
        builder = FarmProfileBuilder(farmer, settings)
        profile = builder.build(export=True)
        return {
            "farm_id": farmer.farm_id,
            "run_id": profile.run_id,
            "build_state": profile.build_state,
            "profile_path": str(builder.run_dir / "farm_profile.json"),
            "output_dir": str(builder.run_dir),
            "tables": {
                name: {
                    "path": str(builder.run_dir / record.relative_path) if record.relative_path else None,
                    "rows": record.rows, "columns": record.columns,
                    "units": record.units, "source": record.source,
                    "validation": record.validation,
                } for name, record in profile.tables.items()
            },
            "source_status": {name: rec.status.value for name,rec in profile.source_status.items()},
            "model_readiness": profile.model_readiness,
            "warning": "Scientific input data only; not validated crop-yield or rotation predictions",
        }
