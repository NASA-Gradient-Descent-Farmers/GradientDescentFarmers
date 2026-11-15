"""Rotation engine: compares a farmer's rotation with alternatives built from what happened in their SIAP district.

Ported from field-shift (NASA-warm-up, branch claude/field-shift, src/rotations/). It reads only the district
panel built by `source_builder.district` (see its DISTRICT_PANEL_CONTRACT.md):

    from gradientdescentfarmers.source_builder.district import DistrictPanelSourceBuilder, load_config
    from gradientdescentfarmers.model_builder.rotations import RotationModelBuilder

    source = DistrictPanelSourceBuilder().build({**load_config("resources/district_three_sites.json"), "run": True})
    engine = RotationModelBuilder().build(source, {})
    result = engine.compare("Bácum", "trigo", estado="Sonora", agua="riego", prioridades=["agua"])

Or point it at an existing run: `RotationModelBuilder().build("data/processed/districts", {})` (the folder with
latest.json, a run folder, or its tables/ folder). With no source at all, `RotationModelBuilder().build(None, {})`
uses the national panel committed in resources/district_panel_national/.

Every number is computed by code from SIAP, NASA and literature tables; a language model only phrases it.
The engine supports farmers' and technicians' judgement and does not replace it.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any, Mapping

from ..base import ModelBuilder
from . import panel

# The national panel committed to the repo (all 191 SIAP districts), used when no other panel is given.
DEFAULT_PANEL = Path(__file__).resolve().parents[3] / "resources" / "district_panel_national"


class RotationEngine:
    """The engine bound to one panel run. `compare` takes the arguments of `compare.comparar_rotaciones`."""

    def __init__(self, run: Path, defaults: Mapping[str, Any] | None = None):
        self.run = panel.use(run)            # select the panel now, so its tables can be read before a comparison
        self.defaults = dict(defaults or {})

    def compare(self, lugar: str, rotacion_actual, **kwargs) -> dict:
        from .compare import comparar_rotaciones

        if panel._RUN != self.run:
            panel.use(self.run)
        return comparar_rotaciones(lugar, rotacion_actual, **{**self.defaults, **kwargs})

    def sites(self):
        """The panel's sites with their municipality and district (to know which places it covers)."""
        if panel._RUN != self.run:
            panel.use(self.run)
        return panel.read("sites")


class RotationModelBuilder(ModelBuilder):
    """Team ModelBuilder contract. `source`: the dict returned by DistrictPanelSourceBuilder (its
    `output_dir`), or a path to a run, its tables/ folder, or an output root with latest.json.
    `config` (the `model` section): optional `panel` path overriding `source`, and `defaults` passed to every
    comparison (e.g. {"escenarios": false} for a chat assistant)."""

    def build(self, source: Any, config: Mapping[str, Any]) -> RotationEngine:
        config = dict(config or {})
        target = config.get("panel") or (source.get("output_dir") if isinstance(source, Mapping) else source)
        if not target:
            if not (DEFAULT_PANEL / "tables").is_dir():
                raise ValueError("No district panel: pass the source builder's result or a run folder")
            target = DEFAULT_PANEL
        if isinstance(source, Mapping) and source.get("build_state") == "failed" and not config.get("panel"):
            raise ValueError(f"The district panel run failed: {source.get('fatal')}")
        return RotationEngine(Path(target), config.get("defaults"))


__all__ = ["DEFAULT_PANEL", "RotationEngine", "RotationModelBuilder", "panel"]
