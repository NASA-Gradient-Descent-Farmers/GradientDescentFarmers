"""Hard constraints and priority/Pareto behavior on transparent examples."""
from copy import deepcopy
import pytest

pytest.importorskip("pcse")

from gradientdescentfarmers.optimizer_builder.rotation_mvp.builder import (
    pareto_indices, normalized_scores, heuristic_indicators, RotationOptimizerBuilder,
)
from gradientdescentfarmers.model_builder.wofost_mvp.economics import EconomicReference


def test_pareto_keeps_tradeoffs_and_identical_vectors():
    assert pareto_indices([[1,1], [2,1], [1,2], [0,0], [2,1]]) == [1,2,4]


def test_priorities_change_the_order_and_missing_economics_is_explicit():
    rows = [{"objective_values": {"income": 100., "water": -100.}},
            {"objective_values": {"income": 50., "water": -10.}}]
    normalized_scores(rows, {"income": 90, "water": 10})
    assert rows[0]["priority_score"] > rows[1]["priority_score"]
    normalized_scores(rows, {"income": 10, "water": 90})
    assert rows[1]["priority_score"] > rows[0]["priority_score"]
    rows[0]["objective_values"]["income"] = None
    result = normalized_scores(rows, {"income": 30, "water": 70})
    assert result["not_evaluated_objectives"] == ["income"]
    assert result["effective_weights"] == {"water": 1.}


def test_diversity_proxies_never_claim_measured_pesticide_or_carbon_savings():
    cereals = heuristic_indicators(["maize", "wheat", "sorghum"])
    diverse = heuristic_indicators(["maize", "chickpea", "sorghum"])
    assert diverse["soil_proxy_score"] > cereals["soil_proxy_score"]
    assert diverse["pesticide_pressure_proxy"] < cereals["pesticide_pressure_proxy"]
    assert diverse["pesticide_reduction_pct"] is None
    assert diverse["soil_carbon_change_kg_ha"] is None


def model():
    campaigns = [{"crop": crop, "crop_label": crop, "index": i, "planning_year": 1,
                  "season": "warm" if i != 1 else "cool", "start": "2024-06-15" if i != 1 else "2024-11-15",
                  "marketable_grain_t_ha": 2., "irrigation_gross_mm": 100., "maturity_reached": True}
                 for i,crop in enumerate(["maize", "chickpea", "sorghum"])]
    row = {"simulation_id": "a", "sequence": ["maize", "chickpea", "sorghum"], "campaigns": campaigns,
           "water_regime": "irrigated", "immature_campaigns": 0, "failed_harvests": 0,
           "irrigation_gross_mm": 300., "irrigation_gross_m3_ha": 3000.,
           "evapotranspiration_mm": 500., "water_stress_fraction": .1}
    return {"model_cache_key": "example", "farmer_input": {"constraints": {}, "crop_preferences": []},
            "slots": campaigns, "simulations": [row]}


def test_water_and_crop_restrictions_are_hard_constraints():
    optimizer = RotationOptimizerBuilder(EconomicReference(None, {}, {"economics_applicable": False}))
    result = optimizer.build(model(), {"max_total_irrigation_mm": 200})
    assert result["status"] == "no_feasible_options" and result["options"] == []
    result = optimizer.build(model(), {"excluded_crops": ["maíz"]})
    assert result["status"] == "no_feasible_options"


def test_budget_without_costs_is_not_silently_ignored():
    optimizer = RotationOptimizerBuilder(EconomicReference(None, {}, {"economics_applicable": False}))
    with pytest.raises(ValueError, match="requires crop costs"):
        optimizer.build(model(), {"budget_mxn_ha": 1000})


def test_simultaneous_crops_are_not_disguised_as_independent_monocrops():
    optimizer = RotationOptimizerBuilder(EconomicReference(None, {}, {"economics_applicable": False}))
    value = model()
    value["farmer_input"]["cropping_mode"] = "simultaneous"
    with pytest.raises(ValueError, match="Intercropping"):
        optimizer.build(value, {})
