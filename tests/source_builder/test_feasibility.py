"""Offline safety tests for crop-shift decision gating."""
import json
import pytest
from pydantic import ValidationError
from gradientdescentfarmers.source_builder.core.builder import FarmProfileBuilder
from gradientdescentfarmers.source_builder.core.feasibility import (
    ScenarioSpec, VerifiedInputs, DecisionLevel,
    assess_feasibility, assess_exported_profile,
)
from gradientdescentfarmers.source_builder.core.schema import SourceStatus
from gradientdescentfarmers.source_builder.core.providers import ProviderPayload
import pandas as pd


def scenario():
    return ScenarioSpec(
        field_id="field_01", crop_codes=["maize"], season_id="2027_spring",
        planting_date="2027-04-01", harvest_date="2027-10-01",
        water_regime="rainfed", evaluate_profit=True
    )


def evidence(*keys):
    return VerifiedInputs(**{**{key: True for key in keys},
                            "evidence_refs": {key: f"evidence://{key}/v1" for key in keys}})


def test_default_is_conservative(farmer, offline_settings):
    profile = FarmProfileBuilder(farmer, offline_settings).build()
    s = scenario().model_copy(update={"field_id": farmer.fields[0].field_id})
    result = assess_feasibility(profile, s)
    assert result.max_level == DecisionLevel.INVENTORY
    assert not result.exploration_allowed
    assert not result.simulation_allowed
    assert not result.optimization_allowed
    assert result.blocking_issues["simulation"]


def test_exploration_only_with_calendar_and_legal_evidence(farmer, offline_settings):
    profile = FarmProfileBuilder(farmer, offline_settings).build()
    s = scenario().model_copy(update={"field_id": farmer.fields[0].field_id})
    result = assess_feasibility(profile, s, evidence("calendar_checked", "environmental_legal_constraints_checked"))
    assert result.max_level == DecisionLevel.EXPLORATION
    assert result.exploration_allowed
    assert not result.simulation_allowed


def test_evidence_must_be_referenced():
    with pytest.raises(ValidationError, match="Missing evidence_refs"):
        VerifiedInputs(calendar_checked=True)


def test_future_crop_is_not_inferred_from_history(farmer, offline_settings):
    profile = FarmProfileBuilder(farmer, offline_settings).build()
    s = scenario().model_copy(update={"field_id": "nonexistent_field"})
    result = assess_feasibility(profile, s, evidence("calendar_checked","environmental_legal_constraints_checked"))
    assert not result.exploration_allowed
    assert any(x.code == "unknown_field" for x in result.blocking_issues["exploration"])


def test_disallow_unvalidated_intercropping(farmer, offline_settings):
    profile = FarmProfileBuilder(farmer, offline_settings).build()
    s = ScenarioSpec(field_id=farmer.fields[0].field_id, crop_codes=["maize","bean"],
        season_id="future", planting_date="2027-04-01", harvest_date="2027-10-01",
        production_system="intercropping")
    result = assess_feasibility(profile, s, evidence("calendar_checked", "environmental_legal_constraints_checked"))
    assert not result.simulation_allowed
    assert any(x.code == "intercropping_unvalidated" for x in result.blocking_issues["simulation"])


def test_scenario_rejects_invalid_calendar():
    with pytest.raises(ValidationError):
        ScenarioSpec(field_id="f1",crop_codes=["maize"],season_id="y1",
            planting_date="2027-10-01",harvest_date="2027-04-01")


def test_exported_profile_hash_verified(farmer,offline_settings):
    builder = FarmProfileBuilder(farmer, offline_settings)
    builder.build(export=True)
    s = scenario().model_copy(update={"field_id": farmer.fields[0].field_id})
    result = assess_exported_profile(builder.run_dir, s)
    assert result.farm_profile_run_id == builder.run_id
    manifest = json.loads((builder.run_dir/"farm_profile.json").read_text())
    path = builder.run_dir / manifest["tables"]["fields"]["relative_path"]
    path.write_text("tampered")
    with pytest.raises(ValueError, match="checksum mismatch"):
        assess_exported_profile(builder.run_dir, s)


def test_optimization_requires_separate_economics_even_with_other_flags(farmer, offline_settings):
    profile = FarmProfileBuilder(farmer, offline_settings).build()
    s = scenario().model_copy(update={"field_id": farmer.fields[0].field_id})
    result = assess_feasibility(profile,s,evidence(
        "calendar_checked", "environmental_legal_constraints_checked",
        "regional_crop_parameters_validated","daily_weather_pcse_ready",
        "site_parameters_ready","agromanagement_ready",
        "hydraulic_soil_parameters_ready","initial_soil_water_ready",
        "operational_constraints_checked", "yield_model_out_of_sample_validated",
        "yield_uncertainty_quantified","risk_scenarios_validated"))
    assert not result.optimization_allowed
    assert any(x.code == "price_cost_data_verified" for x in result.blocking_issues["optimization"])
