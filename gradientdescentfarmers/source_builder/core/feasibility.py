"""Conservative, auditable preflight for FarmAdapt crop-shift decisions.

No recommendations or simulations happen here. The assessment NEVER infers
model/soil/economic validity from a source's presence alone. Explicit external
evidence is required to approve simulation or optimization.
"""
from __future__ import annotations

from enum import Enum
from pathlib import Path
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator
from .schema import FarmProfile, SourceStatus

class DecisionLevel(str, Enum):
    INVENTORY = "inventory"
    EXPLORATION = "exploration"
    SIMULATION = "simulation"
    OPTIMIZATION = "optimization"

class ScenarioSpec(BaseModel):
    """Proposed prospective scenario, not crop-history observations."""
    model_config = ConfigDict(extra="forbid")
    field_id: str = Field(min_length=1)
    crop_codes: list[str] = Field(min_length=1)
    season_id: str = Field(min_length=1)
    planting_date: str
    harvest_date: str
    production_system: Literal["monocrop", "intercropping"] = "monocrop"
    water_regime: Literal["rainfed", "irrigated"] = "rainfed"
    evaluate_profit: bool = False
    is_rotation: bool = False

    @model_validator(mode="after")
    def coherent(self):
        from datetime import date
        start, end = date.fromisoformat(self.planting_date), date.fromisoformat(self.harvest_date)
        if end <= start:
            raise ValueError("harvest_date must follow planting_date")
        if len(set(self.crop_codes)) != len(self.crop_codes):
            raise ValueError("duplicate crop codes")
        if self.production_system == "monocrop" and len(self.crop_codes) != 1:
            raise ValueError("monocrop requires exactly one crop")
        if self.production_system == "intercropping" and len(self.crop_codes) < 2:
            raise ValueError("intercropping requires at least two crops")
        return self

class VerifiedInputs(BaseModel):
    """Evidence *declared and independently checked* by another component.

    Values must NOT be set True just because a CSV, API response, or field is present.
    Versioned evidence references must accompany positive flags. Feasibility
    consumes these attestations; validation of their truth is a separate task.
    """
    model_config = ConfigDict(extra="forbid")
    calendar_checked: bool = False
    regional_crop_parameters_validated: bool = False
    daily_weather_pcse_ready: bool = False
    site_parameters_ready: bool = False
    hydraulic_soil_parameters_ready: bool = False
    initial_soil_water_ready: bool = False
    agromanagement_ready: bool = False
    field_water_access_verified: bool = False
    operational_constraints_checked: bool = False
    environmental_legal_constraints_checked: bool = False
    crop_interaction_model_validated: bool = False
    rotation_state_transitions_validated: bool = False
    yield_model_out_of_sample_validated: bool = False
    yield_uncertainty_quantified: bool = False
    price_cost_data_verified: bool = False
    risk_scenarios_validated: bool = False
    evidence_refs: dict[str, str] = Field(default_factory=dict)

    @model_validator(mode="after")
    def refs_for_positive_flags(self):
        for name in type(self).model_fields:
            if name == "evidence_refs":
                continue
            if getattr(self, name) and not self.evidence_refs.get(name, "").strip():
                raise ValueError(f"Missing evidence_refs for {name}")
        return self

class Finding(BaseModel):
    code: str
    message: str
    source: str | None = None

class FeasibilityAssessment(BaseModel):
    model_config = ConfigDict(extra="forbid")
    farm_id: str
    farm_profile_run_id: str
    scenario: ScenarioSpec
    max_level: DecisionLevel
    exploration_allowed: bool
    simulation_allowed: bool
    optimization_allowed: bool
    blocking_issues: dict[str, list[Finding]]
    warnings: list[Finding]
    evidence_refs: dict[str, str]
    policy_version: str = "0.1.0"
    note: str = "Technical preflight only; not field agronomic certification or crop advice."


def assess_feasibility(profile: FarmProfile, scenario: ScenarioSpec,
                       verified: VerifiedInputs | None = None) -> FeasibilityAssessment:
    """Gate increasing levels; no positive flags are inferred from profile status."""
    verified = verified or VerifiedInputs()
    issues: dict[str, list[Finding]] = {"exploration": [], "simulation": [], "optimization": []}
    warnings: list[Finding] = []

    def block(level, code, message, source=None):
        issues[level].append(Finding(code=code, message=message, source=source))

    field_ids = {f.field_id for f in profile.farmer_inputs.fields}
    if scenario.field_id not in field_ids:
        block("exploration", "unknown_field", "Field is absent from FarmerInput")
    allowed = set(profile.farmer_inputs.constraints.allowed_crops)
    excluded = set(profile.farmer_inputs.constraints.excluded_crops)
    if allowed and any(c not in allowed for c in scenario.crop_codes):
        block("exploration", "not_allowed", "Candidate is not in allowed_crops")
    if any(c in excluded for c in scenario.crop_codes):
        block("exploration", "excluded_crop", "Candidate is explicitly excluded")
    if not verified.calendar_checked:
        block("exploration", "calendar_unchecked", "Local planting/harvest calendar has not been checked")
    if not verified.environmental_legal_constraints_checked:
        block("exploration", "environmental_unchecked", "Environmental and legal constraints have not been checked")
    if scenario.production_system == "intercropping" and not verified.crop_interaction_model_validated:
        block("simulation", "intercropping_unvalidated", "No validated crop interaction model")
    if scenario.is_rotation and not verified.rotation_state_transitions_validated:
        block("simulation", "rotation_state_unvalidated", "State transitions between seasons not validated")
    for key, msg in (
        ("regional_crop_parameters_validated", "Region-specific crop parameters not validated"),
        ("daily_weather_pcse_ready", "PCSE daily weather adapter/continuity not validated"),
        ("site_parameters_ready", "PCSE site parameters unavailable"),
        ("agromanagement_ready", "Prospective agronomic management plan unavailable"),
    ):
        if not getattr(verified, key):
            block("simulation", key, msg)
    if scenario.water_regime == "rainfed":
        for key in ("hydraulic_soil_parameters_ready", "initial_soil_water_ready"):
            if not getattr(verified, key):
                block("simulation", key, "Water-limited rainfed simulation requires verified soil/water state")
    else:
        for key in ("hydraulic_soil_parameters_ready", "initial_soil_water_ready",
                    "field_water_access_verified"):
            if not getattr(verified, key):
                block("simulation", key, "Irrigated water-limited simulation requires verified water inputs")

    for key, msg in (
        ("operational_constraints_checked", "Operational feasibility not checked"),
        ("yield_model_out_of_sample_validated", "Yield model lacks independent validation"),
        ("yield_uncertainty_quantified", "Yield uncertainty not quantified"),
        ("risk_scenarios_validated", "Risk and scenario evaluation not validated"),
    ):
        if not getattr(verified, key):
            block("optimization", key, msg)
    # Current FarmAdapt optimization objectives include profit even when the
    # caller is only inspecting a non-economic scenario. Do not silently
    # authorize optimization with missing economics.
    if not verified.price_cost_data_verified:
        block("optimization", "price_cost_data_verified", "Local costs and prices not verified")

    if not profile.run_id:
        block("exploration", "missing_run_id", "Profile has no versioned run_id")
    environmental = ("nasa_power", "soilgrids_wcs")
    for name in environmental:
        status = profile.source_status.get(name)
        if status is None or status.status not in (SourceStatus.AVAILABLE, SourceStatus.PARTIAL):
            warnings.append(Finding(code=f"{name}_unusable", message="Environmental source missing or failed", source=name))
        elif status.status == SourceStatus.PARTIAL:
            warnings.append(Finding(code=f"{name}_partial", message="Review coverage and uncertainty", source=name))
    if profile.build_state == "failed":
        warnings.append(Finding(code="profile_failed", message="Environmental acquisition did not succeed"))
    if scenario.production_system == "intercropping":
        warnings.append(Finding(code="association", message="Species interactions cannot be inferred from monocrop yields"))
    # Additional implicit gate: no simulation approval on missing environmental climate.
    power = profile.source_status.get("nasa_power")
    if power is None or power.status not in (SourceStatus.AVAILABLE, SourceStatus.PARTIAL):
        block("simulation", "weather_source_unavailable", "NASA POWER weather is not usable in this profile")
    # Experimental simulation can be approved despite SoilGrids failure only if separately
    # validated site/hydraulic evidence exists. A missing SoilGrids row is never auto-filled.
    explore = not issues["exploration"]
    simulate = explore and not issues["simulation"]
    optimize = simulate and not issues["optimization"]
    level = (DecisionLevel.OPTIMIZATION if optimize else DecisionLevel.SIMULATION
             if simulate else DecisionLevel.EXPLORATION if explore else DecisionLevel.INVENTORY)
    return FeasibilityAssessment(
        farm_id=profile.farmer_inputs.farm_id,
        farm_profile_run_id=profile.run_id or "",
        scenario=scenario,
        max_level=level,
        exploration_allowed=explore,
        simulation_allowed=simulate,
        optimization_allowed=optimize,
        blocking_issues=issues,
        warnings=warnings,
        evidence_refs=verified.evidence_refs,
    )


def assess_exported_profile(run_directory: str | Path, scenario: ScenarioSpec,
                            verified: VerifiedInputs | None = None) -> FeasibilityAssessment:
    """Verify table hashes before assessing a versioned profile on disk."""
    from .storage import GCSStorage
    # The existing bundle validator is a pure local filesystem check; no GCS
    # client or network is created. It checks table hashes and required reports.
    manifest, _files = GCSStorage._bundle_files(None, Path(run_directory))
    profile = FarmProfile.model_validate(manifest)
    return assess_feasibility(profile, scenario, verified)


class OptimizationBlocked(RuntimeError):
    """Cannot start an optimization with this assessment."""


def require_optimization_approval(assessment: FeasibilityAssessment) -> None:
    """Fail closed; call at the future optimization worker boundary.

    This does NOT start or implement NSGA-II, WOFOST, or any other model.
    Real services must independently verify the evidence_ref attestations
    and run identity, rather than trusting arbitrary client-side JSON.
    """
    if not assessment.optimization_allowed or assessment.max_level != DecisionLevel.OPTIMIZATION:
        blockers = [
            finding.code
            for findings in assessment.blocking_issues.values()
            for finding in findings
        ]
        raise OptimizationBlocked(
            "Optimization not authorized by feasibility preflight: "
            + ", ".join(blockers)
        )
