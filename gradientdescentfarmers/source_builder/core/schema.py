"""Validated, versioned inputs and portable outputs for FarmAdapt V2.

Source basis: FARMER_INPUT and CONFIG in 00_build_farm_profile_earthdata(1).ipynb.
Fields describe a farm, NOT a promise that any crop is biologically feasible.
"""
from __future__ import annotations

from datetime import date, datetime, timezone
from enum import Enum
from typing import Any, Literal
import math

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", validate_assignment=True)


class SourceStatus(str, Enum):
    AVAILABLE = "available"
    PARTIAL = "partial"
    MISSING = "missing"
    ERROR = "error"
    NOT_REQUESTED = "not_requested"


class Planting(StrictModel):
    crop_name: str = Field(min_length=1, max_length=100)
    variety: str | None = None
    planting_date: date | None = None
    harvest_date: date | None = None
    yield_t_ha: float | None = Field(default=None, ge=0)
    planting_density: float | None = Field(default=None, gt=0)
    fertilizer_kg_ha: float | None = Field(default=None, ge=0)
    irrigation_mm: float | None = Field(default=None, ge=0)
    residue_management: Literal["retain", "remove", "incorporate", "burn", "graze", "unknown"] | None = None
    cultivated_area_ha: float | None = Field(default=None, gt=0)
    species_area_fraction: float | None = Field(default=None, gt=0, le=1)

    @model_validator(mode="after")
    def validate_dates(self):
        if self.planting_date and self.harvest_date and self.harvest_date < self.planting_date:
            raise ValueError("harvest_date cannot be before planting_date")
        return self


class Season(StrictModel):
    field_id: str = Field(min_length=1)
    season_id: str = Field(min_length=1)
    planting_system: Literal["monocrop", "intercropping"] = "monocrop"
    plantings: list[Planting] = Field(min_length=1)

    @model_validator(mode="after")
    def check_system(self):
        if self.planting_system == "monocrop" and len(self.plantings) != 1:
            raise ValueError("monocrop season must have exactly one planting")
        if self.planting_system == "intercropping" and len(self.plantings) < 2:
            raise ValueError("intercropping requires at least two plantings")
        crops = [p.crop_name.strip().lower() for p in self.plantings]
        if len(crops) != len(set(crops)):
            raise ValueError("duplicate crop species within a season; use one planting record per species")
        return self


class FieldInput(StrictModel):
    field_id: str = Field(min_length=1)
    area_ha: float = Field(gt=0)
    boundary_geojson: dict[str, Any] | None = None
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)


class SoilTest(StrictModel):
    property: str = Field(min_length=1)
    depth_cm: str
    value: float
    unit: str
    measured_date: date | None = None
    method: str | None = None


class Constraints(StrictModel):
    excluded_crops: list[str] = Field(default_factory=list)
    max_irrigation_mm: float | None = Field(default=None, ge=0)
    allowed_crops: list[str] = Field(default_factory=list)
    min_crops_per_season: int = Field(default=1, ge=1, le=10)
    max_crops_per_season: int = Field(default=3, ge=1, le=10)
    max_rotation_seasons: int = Field(default=3, ge=1, le=10)

    @model_validator(mode="after")
    def coherent(self):
        if self.min_crops_per_season > self.max_crops_per_season:
            raise ValueError("min_crops_per_season exceeds maximum")
        if set(map(str.lower, self.excluded_crops)) & set(map(str.lower, self.allowed_crops)):
            raise ValueError("allowed_crops and excluded_crops overlap")
        return self


DEFAULT_OBJECTIVES = {
    "profit": 30., "downside_risk": 20., "water": 15.,
    "soil_health": 20., "climate_resilience": 15.
}


class FarmerInput(StrictModel):
    farm_id: str = Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$")
    mode: Literal["basic", "advanced"] = "basic"
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    country_iso3: str | None = Field(default=None, pattern=r"^[A-Z]{3}$")
    fields: list[FieldInput] = Field(min_length=1)
    crop_history: list[Season] = Field(default_factory=list)
    irrigation: Literal["rainfed", "irrigated", "mixed", "unknown"] = "unknown"
    irrigation_water_m3_ha: float | None = Field(default=None, ge=0)
    budget: float | None = Field(default=None, ge=0)
    currency: str | None = Field(default=None, pattern=r"^[A-Z]{3}$")
    soil_tests: list[SoilTest] = Field(default_factory=list)
    crop_preferences: list[str] = Field(default_factory=list)
    equipment: list[str] = Field(default_factory=list)
    objective_weights: dict[str, float] = Field(default_factory=lambda: DEFAULT_OBJECTIVES.copy())
    constraints: Constraints = Field(default_factory=Constraints)
    cropping_mode: Literal["single", "simultaneous", "both"] = "both"
    language: Literal["es", "en", "fr"] = "es"
    farmer_notes: str | None = Field(default=None, max_length=2000)

    @model_validator(mode="after")
    def check_integrity(self):
        ids = [f.field_id for f in self.fields]
        if len(ids) != len(set(ids)):
            raise ValueError("field_id must be unique")
        pairs = [(s.field_id, s.season_id) for s in self.crop_history]
        if len(pairs) != len(set(pairs)):
            raise ValueError("season_id must be unique per field")
        by_id = {f.field_id: f for f in self.fields}
        for season in self.crop_history:
            if season.field_id not in by_id:
                raise ValueError(f"unknown field_id in crop_history: {season.field_id}")
            area = by_id[season.field_id].area_ha
            for planting in season.plantings:
                if planting.cultivated_area_ha is not None and planting.cultivated_area_ha > area + 1e-8:
                    raise ValueError("planting area exceeds field area")
            # Intercropping species areas may overlap and must NOT be summed.
        if set(self.objective_weights) != set(DEFAULT_OBJECTIVES):
            raise ValueError("objective_weights must include exactly the five named objectives")
        if any(not math.isfinite(v) or v < 0 for v in self.objective_weights.values()):
            raise ValueError("objective_weights must be finite and nonnegative")
        if abs(sum(self.objective_weights.values()) - 100) > 1e-6:
            raise ValueError("objective_weights must add to 100")
        if self.budget is not None and not self.currency:
            raise ValueError("currency is required when budget is supplied")
        if self.cropping_mode == "single" and any(s.planting_system == "intercropping" for s in self.crop_history):
            # Historical intercropping may exist despite choosing single cropping FUTURE mode.
            pass
        return self


class SourceRecord(StrictModel):
    source: str
    provider: str
    status: SourceStatus
    enabled: bool
    started_utc: datetime | None = None
    finished_utc: datetime | None = None
    duration_s: float | None = Field(default=None, ge=0)
    rows: int = Field(default=0, ge=0)
    tables: list[str] = Field(default_factory=list)
    coverage: float | None = Field(default=None, ge=0, le=1)
    quality: dict[str, Any] = Field(default_factory=dict)
    access: str | None = None
    spatial_resolution: str | None = None
    temporal_resolution: str | None = None
    units: dict[str, str] = Field(default_factory=dict)
    source_url: str | None = None
    error: str | None = None
    warnings: list[str] = Field(default_factory=list)
    alternative_providers: list[str] = Field(default_factory=list)
    used_cache: bool = False


class TableRecord(StrictModel):
    name: str
    relative_path: str | None = None
    format: Literal["parquet", "csv", "memory"] = "memory"
    rows: int = Field(ge=0)
    columns: list[str]
    source: str
    units: dict[str, str] = Field(default_factory=dict)
    temporal_resolution: str | None = None
    spatial_resolution: str | None = None
    schema_version: str = "1.0"
    sha256: str | None = None
    validation: dict[str, Any] = Field(default_factory=dict)


class FarmProfile(StrictModel):
    """Immutable *contract*, mutable in-memory tables are maintained by the Builder.

    This JSON manifest intentionally references separate Parquet/CSV files to
    preserve native temporal and spatial resolutions. No model claims are made.
    """
    schema_version: Literal["2.0.0"] = "2.0.0"
    created_utc: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    farmer_inputs: FarmerInput
    source_status: dict[str, SourceRecord]
    tables: dict[str, TableRecord]
    topography: dict[str, float | None] = Field(default_factory=dict)
    features: dict[str, Any] = Field(default_factory=dict)
    provenance: dict[str, dict[str, Any]] = Field(default_factory=dict)
    model_readiness: dict[str, dict[str, Any]] = Field(default_factory=dict)
    limitations: list[str] = Field(default_factory=list)
    build_state: Literal["complete", "partial", "failed"] = "partial"
    builder_version: str = "0.1.0"
    run_id: str | None = None
