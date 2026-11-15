"""Shared pipeline contract and entry point for the Guanajuato model builder."""

import json
from dataclasses import dataclass
from math import isfinite
from pathlib import Path
from typing import Any, Mapping

import pandas as pd

from .model_builder import GuanajuatoModelBuilder, ModelBuildResult, ModelBuilder
from .model_builder.base import normalize_rotation_options
from .model_builder.gcs import GCSDataClient
from .model_builder.profile_scenarios import shift_profile_weather, soilgrids_water_proxy
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
GUANAJUATO_PROFILE_POINT = (20.4243195, -101.1466639)


class NoPointDataError(ValueError):
    """The pinned profile has no data for the requested coordinates."""


def _validate_profile_point(settings: Mapping[str, Any]) -> None:
    try:
        latitude = float(settings["latitude"])
        longitude = float(settings["longitude"])
    except (KeyError, TypeError, ValueError) as error:
        raise ValueError("latitude and longitude must be numeric model inputs") from error
    if not isfinite(latitude) or not isfinite(longitude):
        raise ValueError("latitude and longitude must be finite")
    expected_latitude, expected_longitude = GUANAJUATO_PROFILE_POINT
    if abs(latitude - expected_latitude) > 1e-6 or abs(longitude - expected_longitude) > 1e-6:
        raise NoPointDataError(
            f"No profile data is available for latitude={latitude}, longitude={longitude}. "
            f"Only the Guanajuato point ({expected_latitude}, {expected_longitude}) "
            "is connected until source_builder is integrated."
        )


def _resolve_profile_inputs(settings: dict[str, Any], client: Any) -> None:
    """Fill unset weather/soil inputs from the pinned profile for this point."""
    needs_weather = settings.get("future_weather") is None
    needs_soil = (settings.get("water_mode") in ("rainfed", "irrigated")
                  and settings.get("soil_parameters") is None
                  and settings.get("initial_available_water_cm") is None)
    if not needs_weather and not needs_soil:
        return
    profile = client.load_profile(settings["run_uri"])
    site = profile.manifest["farmer_inputs"]
    if (abs(float(site["latitude"]) - float(settings["latitude"])) > 1e-6
            or abs(float(site["longitude"]) - float(settings["longitude"])) > 1e-6):
        raise NoPointDataError("No profile data matches the requested latitude/longitude")
    if needs_weather:
        years = settings.get("weather_analog_years")
        if not isinstance(years, int) or isinstance(years, bool) or years <= 0:
            raise ValueError("weather_analog_years must be a positive integer")
        history = profile.table("weather_daily")
        settings["future_weather"] = shift_profile_weather(history, years=years)
        if settings.get("future_weather_source") is None:
            dates = pd.to_datetime(history.date)
            settings["future_weather_source"] = (
                f"GCS_profile_{dates.min().year}_{dates.max().year}_weather_analog_plus_{years}y"
            )
    if needs_soil:
        soil, initial_water = soilgrids_water_proxy(profile.table("soil_properties_raw"))
        settings["soil_parameters"] = soil
        settings["initial_available_water_cm"] = initial_water


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
    as complete values. The pinned Guanajuato point is the only point with
    available profile data. Unset future weather and WLP soil inputs are
    resolved from that profile; future weather is an explicit historical
    analog, not a forecast. Explicit weather DataFrames or gs:// URIs override
    this default.
    """
    if user_parameters is not None and not isinstance(user_parameters, Mapping):
        raise TypeError("user_parameters must be a dictionary of model settings")
    config = PipelineConfig.from_file(config_path)
    settings = {**config.model, **(user_parameters or {})}
    _validate_profile_point(settings)
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
        (settings.get("soil_parameters") is None) !=
        (settings.get("initial_available_water_cm") is None)
    ):
        raise ValueError("Provide both soil_parameters and initial_available_water_cm, or neither")
    if water_mode in ("rainfed", "irrigated") and (
        settings.get("soil_parameters") is None
        or settings.get("initial_available_water_cm") is None
    ) and not settings.get("run_uri"):
        raise ValueError("Water-limited modes require soil inputs or a profile run_uri")
    needs_profile = (settings.get("future_weather") is None or
                     (water_mode in ("rainfed", "irrigated") and
                      settings.get("soil_parameters") is None))
    client = source
    if needs_profile:
        if not settings.get("run_uri"):
            raise ValueError("A pinned run_uri is required to resolve profile inputs")
        client = source if source is not None else GCSDataClient(project=settings.get("gcp_project"))
        _resolve_profile_inputs(settings, client)
    if water_mode in ("rainfed", "irrigated") and (
        settings.get("soil_parameters") is None
        or settings.get("initial_available_water_cm") is None
    ):
        raise ValueError("Water-limited modes require soil_parameters and initial_available_water_cm")
    builder = model_builder if model_builder is not None else GuanajuatoModelBuilder()
    return builder.build(client, settings)
