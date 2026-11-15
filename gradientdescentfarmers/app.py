"""Shared pipeline contract and entry point for the Guanajuato model builder."""

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping

from .model_builder import GuanajuatoModelBuilder, ModelBuildResult, ModelBuilder
from .model_builder.base import normalize_rotation_options
from .optimizer_builder import OptimizerBuilder
from .source_builder import SourceBuilder


@dataclass(frozen=True)
class PipelineConfig:
    source: Mapping[str, Any]
    model: Mapping[str, Any]
    optimizer: Mapping[str, Any]

    @classmethod
    def from_file(cls, path: str | Path) -> "PipelineConfig":
        """Read the shared JSON configuration and check its three sections."""
        with Path(path).open(encoding="utf-8") as config_file:
            data = json.load(config_file)
        if not isinstance(data, dict):
            raise ValueError("Configuration must be a JSON object")
        sections = {}
        for name in ("source", "model", "optimizer"):
            value = data.get(name)
            if not isinstance(value, dict):
                raise ValueError(f"The '{name}' section must be a JSON object")
            sections[name] = value
        return cls(**sections)


@dataclass(frozen=True)
class PipelineComponents:
    source: Any
    model: Any
    optimizer: Any


@dataclass(frozen=True)
class Pipeline:
    source_builder: SourceBuilder
    model_builder: ModelBuilder
    optimizer_builder: OptimizerBuilder

    def build(self, config: PipelineConfig) -> PipelineComponents:
        """Build components in dependency order."""
        source = self.source_builder.build(config.source)
        model = self.model_builder.build(source, config.model)
        optimizer = self.optimizer_builder.build(model, config.optimizer)
        return PipelineComponents(source, model, optimizer)


DEFAULT_APPLICATION_CONFIG = Path(__file__).resolve().parents[1] / "resources" / "application.conf"


def run_model_app(
    user_parameters: Mapping[str, Any] | None = None,
    *,
    config_path: str | Path = DEFAULT_APPLICATION_CONFIG,
    source: Any = None,
    model_builder: GuanajuatoModelBuilder | None = None,
) -> ModelBuildResult:
    """Run the concrete model flow with JSON defaults and user overrides.

    ``user_parameters`` uses the keys of the ``model`` section in
    application.conf. Lists and nested dictionaries replace their defaults
    as complete values. DataFrames may be supplied here for historical or
    future weather; JSON configuration can instead hold a gs:// URI.
    """
    if user_parameters is not None and not isinstance(user_parameters, Mapping):
        raise TypeError("user_parameters must be a dictionary of model settings")
    config = PipelineConfig.from_file(config_path)
    settings = {**config.model, **(user_parameters or {})}
    planned_phases = normalize_rotation_options(settings)
    products = settings.get("selected_products")
    if products is not None and (
        not isinstance(products, list) or not products
        or any(not isinstance(crop, str) or not crop.strip() for crop in products)
    ):
        raise ValueError("selected_products must be null or a nonempty list of crop names")
    water_mode = settings.get("water_mode")
    if water_mode not in ("potential", "rainfed", "irrigated"):
        raise ValueError("water_mode must be potential, rainfed, or irrigated")
    irrigation_system = settings.get("irrigation_system")
    if water_mode == "irrigated":
        if not isinstance(irrigation_system, str) or not irrigation_system.strip():
            raise ValueError("irrigated mode requires irrigation_system")
        for season in [*settings.get("historical_seasons", []),
                       *planned_phases]:
            if not season.get("irrigation_events"):
                raise ValueError("Each irrigated season needs irrigation_events")
    elif irrigation_system is not None:
        raise ValueError("irrigation_system is only used with irrigated mode")
    if water_mode in ("rainfed", "irrigated") and (
        settings.get("soil_parameters") is None
        or settings.get("initial_available_water_cm") is None
    ):
        raise ValueError("Water-limited modes require soil_parameters and initial_available_water_cm")
    builder = model_builder if model_builder is not None else GuanajuatoModelBuilder()
    return builder.build(source, settings)
