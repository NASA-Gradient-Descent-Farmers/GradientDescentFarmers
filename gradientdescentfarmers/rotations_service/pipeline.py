"""Produce a reviewable rotation bundle from an existing FarmProfile."""
from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import shutil
import uuid

import pandas as pd

from ..model_builder.wofost_mvp.builder import WofostModelBuilder
from ..model_builder.wofost_mvp.economics import EconomicReference, prepare_siap_reference
from ..model_builder.wofost_mvp.references import resolve_region
from ..model_builder.wofost_mvp.utils import clean_json, digest, json_bytes, write_json
from ..optimizer_builder.rotation_mvp.builder import RotationOptimizerBuilder


def build_rotations(profile_dir: Path, state_root: Path, reference_root: Path,
                    model_config=None, optimizer_config=None, source_uri=None, progress=None,
                    rotation_run_id=None):
    progress = progress or (lambda **_: None)
    profile_dir, state_root, reference_root = Path(profile_dir), Path(state_root), Path(reference_root)
    model_config, optimizer_config = model_config or {}, optimizer_config or {}
    model = WofostModelBuilder(state_root / "cache", reference_root, progress).build(
        {"profile_dir": str(profile_dir), "source_uri": source_uri}, model_config)
    farmer = model["farmer_input"]
    progress(stage="economics", completed=0, total=1)
    region = resolve_region(reference_root, farmer, model["settings"]["state_id_hint"])
    if region["economics_applicable"]:
        frame, financial_manifest = prepare_siap_reference(reference_root, model["settings"]["siap_years"])
    else:
        frame, financial_manifest = None, {"not_applicable": True, "reason": "Mexico-only SIAP reference"}
    economics = EconomicReference(frame, financial_manifest, region, model["settings"]["minimum_price_years"])
    progress(stage="optimizing", completed=0, total=1)
    result = RotationOptimizerBuilder(economics).build(model, optimizer_config)
    run_id = rotation_run_id or uuid.uuid4().hex[:16]
    directory = state_root / "runs" / farmer["farm_id"] / model["source_run_id"] / run_id
    directory.mkdir(parents=True, exist_ok=True)
    if (directory / "manifest.json").exists():
        raise FileExistsError("Rotation run already finalized; use its existing immutable bundle")
    confidence = {
        "overall": "low", "label_es": "Exploratorio: sin calibración local",
        "probability_of_success": None, "field_validated": False,
        "weather_record_years": model["weather_years"],
        "historical_experiment_start": model["historical_experiment_start"],
        "historical_experiment_end": model["historical_experiment_end"],
        "weather_source_integrity": "verified", "soil_hydraulics": "SoilGrids estimates and stated assumptions",
        "economic_reference": "SIAP state redistribution via DataMX; not cross-verified against unavailable official server"
                              if region["economics_applicable"] else "not_applicable",
        "soil_health_metric": "heuristic proxy", "pesticide_metric": "family repetition proxy",
        "price_interval": "historical sensitivity, not probabilistic confidence interval",
        "reasons_es": [
            "Variedades de referencia sin calibración ni validación independiente en estas parcelas.",
            "Clima histórico 2024–2025: los resultados no son un pronóstico meteorológico o de cosecha.",
            "Profundidad efectiva, drenaje, agua inicial y manejo de riego incluyen supuestos.",
            "No se simulan salinidad, nutrientes, plagas ni cambios medidos del carbono del suelo.",
        ],
    }
    if any(row["immature_campaigns"] for row in model["simulations"]):
        confidence["reasons_es"].append(
            "Se excluyen campañas sin madurez con este calendario y parámetros; no demuestra que el cultivo sea inviable en la región.")
    options = []
    for row in result["options"]:
        option = {key: value for key, value in row.items() if key != "irrigation_events"}
        option["confidence"] = {"level": "low", "label_es": confidence["label_es"], "probability_of_success": None}
        option["planting_system"] = "monocrop"
        option["amounts_basis"] = "per hectare, entire recommended campaign horizon"
        option["advisory_status"] = "high_risk_experiment" if row["failed_harvests"] else "unvalidated_experiment"
        option["highlights_es"] = [
            f"Riego aplicado de escenario: {row['irrigation_gross_m3_ha']:.0f} m³/ha en el horizonte.",
            f"Índice de diversidad/suelo: {row['indicators']['soil_proxy_score']:.0f}/100; es un indicador heurístico.",
        ]
        if row["economics"].get("gross_median_mxn_ha") is not None:
            option["highlights_es"].insert(0,
                f"Ingreso bruto de escenario: {row['economics']['gross_median_mxn_ha']:.0f} MXN/ha; no es utilidad neta garantizada.")
        if row["failed_harvests"]:
            option["highlights_es"].append(
                f"{row['failed_harvests']} campañas con cosecha simulada inferior a 50 kg/ha: escenario de alto riesgo, no plan operativo validado.")
        for campaign in option["campaigns"]:
            if campaign["crop"] and region["economics_applicable"]:
                quote = economics.quote(campaign["crop"], row["water_regime"])
                campaign["price_reference"] = quote
                campaign["gross_at_median_price_mxn_ha"] = (
                    campaign["marketable_grain_t_ha"] * quote["price_median_mxn_t"] if quote else None)
            # UI should display a relative future plan, never the historical
            # experiment's 2024/25 dates as a new sowing instruction.
            campaign["sowing_month_day"] = campaign["start"][5:]
            campaign["calendar_end_month_day"] = campaign["end"][5:]
            campaign["historical_sowing_date"] = campaign.pop("start")
            campaign["historical_calendar_end_date"] = campaign.pop("end")
            campaign["historical_harvest_date"] = campaign.pop("harvest_date", None)
        options.append(option)
    document = clean_json({
        "schema_version": "1.0", "farm_id": farmer["farm_id"] , "source_run_id": model["source_run_id"],
        "rotation_run_id": run_id, "source_dataset_uri": source_uri,
        "status": result["status"], "generated_at": datetime.now(timezone.utc),
        "planning_basis": "Relative campaign plan tested against historical weather; no future weather fabricated",
        "geography": region, "options": options, "confidence": confidence,
        "optimization": {key: value for key, value in result.items() if key not in ("options", "all_feasible_options", "rejected")},
        "model": {key: model[key] for key in ("model", "weather_years", "historical_experiment_start",
                                                "historical_experiment_end", "candidate_sequences", "simulation_seconds",
                                                "field_validated", "forecast", "assumptions")},
        "area_totals_computed": False,
        "area_note": "All amounts are per hectare; source demo acreage is not assumed to be measured",
    })
    write_json(directory / "rotations.json", document)
    write_json(directory / "confidence.json", confidence)
    write_json(directory / "source_validation.json", model["source_audit"])
    write_json(directory / "validation.json", {
        "source_integrity_ok": model["source_audit"]["integrity_ok"],
        "weather_provider_days": model["weather_days_available"],
        "physical_simulations": len(model["simulations"]), "physical_failures": len(model["failures"]),
        "max_water_balance_error_cm": max(abs(row["water_balance_error_cm"]) for row in model["simulations"]),
        "selected_options": len(options), "all_selected_pareto": all(row["pareto_efficient"] for row in options),
        "source_coordinates": {"latitude": farmer["latitude"], "longitude": farmer["longitude"]},
        "field_validated": False, "pesticide_reduction_measured": False,
    })
    write_json(directory / "geography.json", region)
    write_json(directory / "financial_provenance.json", financial_manifest)
    write_json(directory / "crop_parameter_manifest.json", model["crop_parameters"])
    write_json(directory / "simulation_rejections.json", {"model_failures": model["failures"],
                                                         "optimization_rejected": result.get("rejected", [])})
    write_json(directory / "request.json", {"model": model_config, "optimizer": optimizer_config, "source_uri": source_uri})
    write_json(directory / "provenance.json", {
        "source_run_id": model["source_run_id"], "source_profile_sha256": model["source_profile_sha256"],
        "source_dataset_uri": source_uri, "model_cache_key": model["model_cache_key"],
        "source_revision": os.environ.get("ROTATIONS_SOURCE_REVISION", "working_tree"),
        "source_bundle_sha256": os.environ.get("ROTATIONS_SOURCE_SHA256"),
        "reference_bundle_sha256": os.environ.get("ROTATIONS_REFERENCE_SHA256"),
        "crop_parameter_commit": model["settings"]["crop_parameter_commit"],
        "effective_model_settings": model["settings"],
        "optimizer_request_sha256": digest(optimizer_config), "financial_snapshot_sha256": financial_manifest.get("raw_sha256"),
        "versions": {"pcse": "6.0.13", "model": "continuous-wofost72-mvp-v1", "output_schema": "1.0"},
    })
    for filename in ("pcse_weather_daily.csv", "soil_parameters.json"):
        shutil.copyfile(Path(model["model_cache_directory"]) / filename, directory / filename)
    with (directory / "model_evaluations.jsonl").open("w") as output:
        for row in model["simulations"]:
            output.write(json.dumps(clean_json(row), ensure_ascii=False, allow_nan=False) + "\n")
    price_rows = []
    for quote in economics.quotes.values():
        if quote:
            for year, price in quote["annual_price_mxn_t"].items():
                price_rows.append({"crop": quote["crop"], "water_regime": quote["water_regime"], "year": year,
                                   "price_mxn_t": price, "scope": quote["scope"], "state": quote["state"],
                                   "cycle": quote["cycle"], "modality": quote["modality"]})
    pd.DataFrame(price_rows, columns=["crop", "water_regime", "year", "price_mxn_t", "scope", "state", "cycle", "modality"]).to_csv(
        directory / "economic_reference.csv", index=False)
    metric_rows = [{"option_id": row["option_id"], "sequence": " -> ".join(c or "fallow" for c in row["sequence"]),
                    "water_regime": row["water_regime"], "irrigation_gross_m3_ha": row["irrigation_gross_m3_ha"],
                    "evapotranspiration_mm": row["evapotranspiration_mm"],
                    "gross_median_mxn_ha": row["economics"].get("gross_median_mxn_ha"),
                    "margin_median_mxn_ha": row["economics"].get("margin_median_mxn_ha"),
                    "soil_proxy_score": row["indicators"]["soil_proxy_score"],
                    "pesticide_pressure_proxy": row["indicators"]["pesticide_pressure_proxy"],
                    "priority_score": row.get("priority_score"), "pareto_efficient": row.get("pareto_efficient")}
                   for row in result["all_feasible_options"]]
    pd.DataFrame(metric_rows, columns=["option_id", "sequence", "water_regime", "irrigation_gross_m3_ha",
                                      "evapotranspiration_mm", "gross_median_mxn_ha", "margin_median_mxn_ha",
                                      "soil_proxy_score", "pesticide_pressure_proxy", "priority_score", "pareto_efficient"]).to_csv(
        directory / "candidate_metrics.csv", index=False)
    lines = ["Opciones exploratorias de rotación. Confianza baja; requieren revisión local."]
    for option in options:
        economic = option["economics"].get("gross_median_mxn_ha")
        income = f"Ingreso bruto: {economic:,.0f} MXN/ha en el horizonte. " if economic is not None else "Sin evaluación económica. "
        lines.append(f"{option['water_regime']}: {option['description_es']}. {income}Riego: {option['irrigation_gross_m3_ha']:,.0f} m³/ha.")
    if not options:
        lines.append(result["message"])
    lines.append("Precios históricos y clima histórico; no se garantiza cosecha ni utilidad. No se cuantifica ahorro de pesticidas.")
    (directory / "whatsapp_summary.txt").write_text("\n\n".join(lines) + "\n")
    (directory / "README.md").write_text(
        "# Rotaciones exploratorias\n\nAbrir rotations.json para la UI, whatsapp_summary.txt para texto y confidence.json para límites.\n"
        "Montos por hectárea y por horizonte completo. Clima histórico; sin validación local.\n"
        "Suelo y pesticidas usan indicadores heurísticos. Los precios SIAP se obtuvieron vía DataMX.\n"
        "Los percentiles son sensibilidad histórica de precios, no probabilidades de éxito.\n")
    payloads = {path.name: {"sha256": hashlib.sha256(path.read_bytes()).hexdigest(), "bytes": path.stat().st_size}
                for path in sorted(directory.iterdir()) if path.is_file()}
    write_json(directory / "manifest.json", {"schema_version": "1.0", "farm_id": farmer["farm_id"],
                                             "source_run_id": model["source_run_id"], "rotation_run_id": run_id,
                                             "files": payloads})
    progress(stage="prepared", completed=1, total=1)
    return {"directory": str(directory.resolve()), "farm_id": farmer["farm_id"],
            "source_run_id": model["source_run_id"], "rotation_run_id": run_id,
            "status": result["status"], "options": len(options), "model_cache_hit": model["cache_hit"]}
