"""A bounded, explainable rotation optimizer; no stochastic search needed."""
from __future__ import annotations

from copy import deepcopy
import math
import unicodedata

import numpy as np
from pydantic import BaseModel, ConfigDict, Field, model_validator

from ..base import OptimizerBuilder
from ...model_builder.wofost_mvp.economics import EconomicReference
from ...model_builder.wofost_mvp.settings import CROPS
from ...model_builder.wofost_mvp.utils import digest

OBJECTIVES = {"income", "water", "soil", "pesticide", "risk", "climate"}


def crop_key(value):
    def norm(text):
        return "".join(c for c in unicodedata.normalize("NFKD", text.casefold()) if not unicodedata.combining(c)).strip()
    wanted = norm(value)
    for key, crop in CROPS.items():
        if wanted in (norm(key), norm(crop["label"]), norm(crop["siap"])):
            return key
    raise ValueError(f"Crop is outside this MVP catalog: {value}")


class OptimizerSettings(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    weights: dict[str, float] | None = None
    allowed_crops: list[str] | None = None
    excluded_crops: list[str] = Field(default_factory=list)
    preferred_crops: list[str] = Field(default_factory=list)
    water_regimes: list[str] | None = None
    max_total_irrigation_mm: float | None = Field(default=None, ge=0)
    max_irrigation_mm_per_campaign: float | None = Field(default=None, ge=0)
    budget_mxn_ha: float | None = Field(default=None, ge=0)
    costs_mxn_ha: dict[str, float] = Field(default_factory=dict)
    area_confirmed: bool = False
    require_maturity: bool = True
    minimum_positive_harvests: int = Field(default=1, ge=0, le=4)
    options_per_regime: int = Field(default=5, ge=1, le=8)

    @model_validator(mode="after")
    def validate_values(self):
        if self.weights is not None:
            if set(self.weights) != OBJECTIVES or any(not math.isfinite(x) or x < 0 for x in self.weights.values()):
                raise ValueError("weights must contain income, water, soil, pesticide, risk, climate, all finite and nonnegative")
            if abs(sum(self.weights.values()) - 100) > 1e-6:
                raise ValueError("weights must sum to 100")
        self.costs_mxn_ha = {crop_key(key): float(value) for key, value in self.costs_mxn_ha.items()}
        if any(not math.isfinite(value) or value < 0 for value in self.costs_mxn_ha.values()):
            raise ValueError("Crop costs must be finite, nonnegative MXN/ha per campaign")
        if self.water_regimes is not None and (not self.water_regimes or set(self.water_regimes) - {"rainfed", "irrigated"}):
            raise ValueError("Invalid water_regimes")
        return self


def heuristic_indicators(sequence):
    planted = [crop for crop in sequence if crop]
    families = [CROPS[crop]["family"] if crop else None for crop in sequence]
    adjacent = [(a, b) for a, b in zip(families, families[1:]) if a and b]
    repetition = sum(a == b for a, b in adjacent) / max(1, len(adjacent))
    diversity = (len({CROPS[crop]["family"] for crop in planted}) - 1) / max(1, len({c["family"] for c in CROPS.values()}) - 1)
    legumes = sum(CROPS[crop]["family"] == "Fabaceae" for crop in planted) / max(1, len(planted))
    cover_opportunity = len(planted) / len(sequence)
    return {"soil_proxy_score": 100 * (.5*diversity + .25*legumes + .25*cover_opportunity),
            "pesticide_pressure_proxy": 100 * repetition, "legume_campaigns": sum(c == "chickpea" for c in sequence),
            "crop_families": len(set(f for f in families if f)),
            "fallow_campaigns": sum(c is None for c in sequence),
            "pesticide_reduction_pct": None, "soil_carbon_change_kg_ha": None,
            "method": "heuristic family diversity, legume share and crop-cover opportunity; not soil/pest measurements"}


def pareto_indices(matrix):
    """All columns maximize; identical vectors remain nondominated."""
    values = np.asarray(matrix, dtype=float)
    if not np.isfinite(values).all():
        raise ValueError("Pareto metrics must be finite")
    return [index for index, row in enumerate(values)
            if not any(np.all(other >= row) and np.any(other > row)
                       for j, other in enumerate(values) if j != index)]


def normalized_scores(rows, weights):
    used = [name for name in OBJECTIVES if weights.get(name, 0) > 0
            and all(row["objective_values"].get(name) is not None for row in rows)]
    if not used:
        raise ValueError("No requested objective can be evaluated with the available data")
    effective = {name: weights[name] / sum(weights[x] for x in used) for name in used}
    bounds = {name: (min(row["objective_values"][name] for row in rows),
                     max(row["objective_values"][name] for row in rows)) for name in used}
    for row in rows:
        scaled = {name: ((row["objective_values"][name] - lo) / (hi - lo) if hi > lo else .5)
                  for name, (lo, hi) in bounds.items()}
        row["priority_score"] = 100 * sum(scaled[name] * effective[name] for name in used)
        row["objective_scores"] = scaled
    return {"effective_weights": effective, "bounds": bounds,
            "not_evaluated_objectives": sorted(name for name in OBJECTIVES if weights.get(name, 0) > 0 and name not in used)}


def description(option):
    labels = []
    for campaign in option["campaigns"]:
        name = campaign["crop_label"]
        period = ("nov–may" if str(campaign["start"])[5:7] == "11" else "ene–may") if campaign["season"] == "cool" else "jun–oct"
        labels.append(f"año {campaign['planning_year']}: {name.lower()} ({period})")
    return " → ".join(labels)


class RotationOptimizerBuilder(OptimizerBuilder):
    def __init__(self, economics: EconomicReference):
        self.economics = economics

    def build(self, model, config):
        settings = OptimizerSettings.model_validate(config)
        farmer = model["farmer_input"]
        original = farmer.get("constraints", {})
        allowed_input = settings.allowed_crops if settings.allowed_crops is not None else original.get("allowed_crops", [])
        allowed = {crop_key(crop) for crop in allowed_input} if allowed_input else set(CROPS)
        excluded = {crop_key(crop) for crop in settings.excluded_crops + original.get("excluded_crops", [])}
        preferred = {crop_key(crop) for crop in settings.preferred_crops + farmer.get("crop_preferences", [])}
        if not allowed - excluded:
            raise ValueError("Crop restrictions leave no allowed crops")
        if farmer.get("cropping_mode") == "simultaneous" or original.get("min_crops_per_season", 1) > 1:
            raise ValueError("Intercropping requires a separate model; this MVP evaluates one crop per campaign")
        source_weights = farmer.get("objective_weights", {})
        weights = settings.weights or {
            "income": source_weights.get("profit", 30), "water": source_weights.get("water", 15),
            "soil": source_weights.get("soil_health", 20), "risk": source_weights.get("downside_risk", 20),
            "climate": source_weights.get("climate_resilience", 15), "pesticide": 0.,
        }
        irrigation_cap = settings.max_irrigation_mm_per_campaign
        if irrigation_cap is None:
            irrigation_cap = original.get("max_irrigation_mm")
        budget = settings.budget_mxn_ha
        if farmer.get("budget") is not None and budget is None:
            if farmer.get("currency") != "MXN":
                raise ValueError("Budget comparison currently requires MXN; no exchange rate is assumed")
            if not settings.area_confirmed or "synthetic" in (farmer.get("farmer_notes") or "").lower():
                raise ValueError("A total farm budget requires confirmed acreage; supply budget_mxn_ha for a per-ha scenario")
            budget = farmer["budget"] / sum(field["area_ha"] for field in farmer["fields"])
        if budget is not None and not settings.costs_mxn_ha:
            raise ValueError("Budget feasibility requires crop costs; SIAP supplies prices, not production costs")
        references, rows, rejected = {}, [], []
        for simulation in model["simulations"]:
            reasons = []
            sequence, regime = simulation["sequence"], simulation["water_regime"]
            if settings.water_regimes is not None and regime not in settings.water_regimes:
                continue
            if any(crop not in allowed or crop in excluded for crop in sequence if crop):
                reasons.append("crop_restrictions")
            if settings.require_maturity and simulation["immature_campaigns"]:
                reasons.append("crop_not_mature_by_calendar_end")
            positive = sum(c["marketable_grain_t_ha"] > .05 for c in simulation["campaigns"] if c["crop"])
            if positive < settings.minimum_positive_harvests:
                reasons.append("too_few_positive_harvests")
            if irrigation_cap is not None and any(c["irrigation_gross_mm"] > irrigation_cap + 1e-8 for c in simulation["campaigns"]):
                reasons.append("campaign_water_budget")
            if settings.max_total_irrigation_mm is not None and simulation["irrigation_gross_mm"] > settings.max_total_irrigation_mm + 1e-8:
                reasons.append("total_water_budget")
            economic = self.economics.evaluate(simulation, settings.costs_mxn_ha)
            if economic.get("applicable") and not economic.get("available") and weights["income"] > 0:
                reasons.append("price_reference_missing")
            if budget is not None and (not economic["costs_complete"] or economic["cost_mxn_ha"] > budget + 1e-8):
                reasons.append("cost_budget_or_missing_costs")
            proxy = heuristic_indicators(sequence)
            income = economic.get("margin_median_mxn_ha") if economic["costs_complete"] else economic.get("gross_median_mxn_ha")
            water_metric = simulation["irrigation_gross_mm"] if regime == "irrigated" else simulation["evapotranspiration_mm"]
            result = deepcopy(simulation)
            result.update(option_id=digest({"model": model["model_cache_key"], "simulation": simulation["simulation_id"]})[:16], economics=economic, indicators=proxy,
                          objective_values={"income": income, "water": -water_metric,
                                            "soil": proxy["soil_proxy_score"], "pesticide": -proxy["pesticide_pressure_proxy"],
                                            "risk": -economic["downside_fraction"] if economic["downside_fraction"] is not None else None,
                                            "climate": -simulation["water_stress_fraction"]},
                          preferred_crop_campaigns=sum(c in preferred for c in sequence if c),
                          requires_irrigation_confirmation=regime == "irrigated" and farmer.get("irrigation") not in ("irrigated", "mixed"),
                          budget_feasible=True if budget is not None and not reasons else None)
            benchmark = ["wheat" if slot["season"] == "cool" else "maize" for slot in model["slots"]]
            if sequence == benchmark:
                references[regime] = {"sequence": sequence, "simulation_id": simulation["simulation_id"],
                                      "irrigation_gross_mm": simulation["irrigation_gross_mm"],
                                      "gross_median_mxn_ha": economic.get("gross_median_mxn_ha"),
                                      "crop_calendars_mature": simulation["immature_campaigns"] == 0,
                                      "is_observed_farmer_practice": False, "feasible_under_preferences": not reasons}
            if reasons:
                rejected.append({"simulation_id": simulation["simulation_id"], "reasons": reasons})
            else:
                rows.append(result)
        if not rows:
            counts = {}
            for item in rejected:
                for reason in item["reasons"]:
                    counts[reason] = counts.get(reason, 0) + 1
            return {"options": [], "all_feasible_options": [], "status": "no_feasible_options",
                    "rejection_counts": counts, "rejected": rejected, "references": references,
                    "message": "Ninguna opción cumple estas restricciones en el escenario histórico; revisar cultivos, agua, costos o calendario."}
        selected, groups = [], {}
        for regime in sorted({row["water_regime"] for row in rows}):
            group = [row for row in rows if row["water_regime"] == regime]
            if not references.get(regime, {}).get("crop_calendars_mature"):
                priced = [row for row in group if row["economics"].get("gross_median_mxn_ha") is not None]
                if priced:
                    best_income = max(priced, key=lambda row: row["economics"]["gross_median_mxn_ha"])
                    references[regime] = {
                        "sequence": best_income["sequence"], "simulation_id": best_income["simulation_id"],
                        "irrigation_gross_mm": best_income["irrigation_gross_mm"],
                        "gross_median_mxn_ha": best_income["economics"]["gross_median_mxn_ha"],
                        "is_observed_farmer_practice": False, "feasible_under_preferences": True,
                        "crop_calendars_mature": True, "reference_kind": "feasible_highest_gross_income_scenario",
                    }
            scoring = normalized_scores(group, weights)
            dimensions = sorted(name for name in OBJECTIVES if all(row["objective_values"][name] is not None for row in group))
            front = set(pareto_indices([[row["objective_values"][name] for name in dimensions] for row in group]))
            for index, row in enumerate(group):
                row["pareto_efficient"] = index in front
                row["description_es"] = description(row)
                baseline = references.get(regime)
                if baseline and baseline["crop_calendars_mature"] and baseline["irrigation_gross_mm"] > 0:
                    row["irrigation_saving_vs_reference_pct"] = 100 * (1 - row["irrigation_gross_mm"] / baseline["irrigation_gross_mm"])
                else:
                    row["irrigation_saving_vs_reference_pct"] = None
                row["comparison_reference"] = baseline
            ranked = sorted(group, key=lambda row: (-row["priority_score"], -row["preferred_crop_campaigns"], row["option_id"]))
            efficient = [row for row in ranked if row["pareto_efficient"]]
            chosen = []
            # Best weighted, income, water, diversity and pesticide alternatives.
            selectors = [("balance", lambda r: r["priority_score"]),
                         ("income", lambda r: r["objective_values"]["income"] if r["objective_values"]["income"] is not None else -math.inf),
                         ("water", lambda r: r["objective_values"]["water"]),
                         ("soil", lambda r: r["objective_values"]["soil"]),
                         ("pesticide", lambda r: r["objective_values"]["pesticide"])]
            for label, selector in selectors:
                if not efficient:
                    break
                best = max(efficient, key=lambda row: (selector(row), row["priority_score"]))
                if best not in chosen:
                    best["highlight_objectives"] = [label]
                    chosen.append(best)
                else:
                    best["highlight_objectives"].append(label)
            for row in efficient:
                if len(chosen) >= settings.options_per_regime:
                    break
                if row not in chosen:
                    row["highlight_objectives"] = ["tradeoff"]
                    chosen.append(row)
            chosen = chosen[:settings.options_per_regime]
            selected.extend(chosen)
            groups[regime] = {"feasible_candidates": len(group), "pareto_candidates": len(front),
                              "best_by_priorities": chosen[0]["option_id"],
                              "selected_option_ids": [row["option_id"] for row in chosen], **scoring}
        return {"status": "exploratory_options", "options": selected, "all_feasible_options": rows,
                "algorithm": "exhaustive feasible enumeration + Pareto front + normalized farmer priorities",
                "weights_requested": weights, "groups": groups, "rejected": rejected, "references": references,
                "capabilities": {"continuous_crop_water_balance": True, "regional_gross_income_scenarios": True,
                                 "net_profit_without_costs": False, "measured_pesticide_savings": False,
                                 "soil_carbon_forecast": False, "multi_field_allocation": False, "intercropping": False},
                "score_note": "Scores compare only candidates in the same request and water regime; they are not confidence probabilities"}
