"""District panel for the rotation engine: SIAP districts with NASA and other data, built in source_builder.

    from gradientdescentfarmers.source_builder.district import DistrictPanelSourceBuilder
    result = DistrictPanelSourceBuilder().build(config["source"])   # config from resources/district_*.json

See DISTRICT_PANEL_CONTRACT.md for the tables and README.md for how to run it.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Mapping

from ..base import SourceBuilder

REPO_ROOT = Path(__file__).resolve().parents[3]


class DistrictPanelSourceBuilder(SourceBuilder):
    """Team `SourceBuilder` contract around DistrictPanelBuilder.

    config keys: sites (list of {name, latitude, longitude}), output_root, cache_root (both under the
    repository's data/), sources ({source: bool}), settings (any DistrictSettings field), run (bool).
    Without run=True nothing is downloaded: the call validates the configuration and returns the plan.
    """

    def __init__(self, repository_root: Path | None = None):
        self.repository_root = Path(repository_root or REPO_ROOT).resolve()

    def _resolve(self, path) -> Path:
        p = Path(path)
        return p.resolve() if p.is_absolute() else (self.repository_root / p).resolve()

    def settings(self, config: Mapping[str, Any]):
        from .common import DistrictSettings

        root = self.repository_root / "data"
        output = self._resolve(config.get("output_root", "data/processed/districts"))
        cache = self._resolve(config.get("cache_root", "data/cache/districts"))
        for p in (output, cache):
            if not p.is_relative_to(root):
                raise ValueError("District panel output and cache must be under the repository's data/ folder")
        return DistrictSettings.model_validate({**dict(config.get("settings", {})), "sites": config["sites"],
                                                "output_root": output, "cache_root": cache,
                                                "sources": dict(config.get("sources", {}))})

    def build(self, config: Mapping[str, Any]) -> dict[str, Any]:
        if not isinstance(config, Mapping):
            raise TypeError("source config must be a mapping")
        settings = self.settings(config)
        if config.get("run") is not True:
            from .common import SOURCES
            return {"build_state": "preview", "sites": [x.model_dump() for x in settings.sites],
                    "sources": {k: settings.enabled(k) for k in SOURCES},
                    "output_root": str(settings.output_root), "cache_root": str(settings.cache_root),
                    "note": "Preview only: pass run=True (CLI: --run) to download data and build the panel"}
        from .builder import DistrictPanelBuilder
        return DistrictPanelBuilder(settings).build(export=True)


def load_config(path) -> dict:
    obj = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(obj, dict) or not isinstance(obj.get("source"), dict):
        raise ValueError("Expected JSON with a source object")
    return obj["source"]


__all__ = ["DistrictPanelSourceBuilder", "load_config"]
