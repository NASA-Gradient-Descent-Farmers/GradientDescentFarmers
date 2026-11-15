"""Actual continuous PCSE/WOFOST rotations over observed historical weather."""
from __future__ import annotations

from datetime import date, timedelta
import hashlib
from itertools import product
import json
from pathlib import Path
import time

import pandas as pd

from ..base import ModelBuilder
from ...source_builder.core.audit import audit_profile
from .references import prepare_crop_parameters
from .settings import CROPS, ModelSettings
from .soil import prepare_soil
from .utils import digest, clean_json, write_json
from .weather import prepare_weather


def make_slots(years: list[int], maximum=4) -> list[dict]:
    if len(years) == 1:
        year = years[0]
        periods = [("cool", date(year, 1, 15), date(year, 5, 31)),
                   ("warm", date(year, 6, 15), date(year, 10, 31))]
    else:
        first, second = years[0], years[1]
        periods = [("warm", date(first, 6, 15), date(first, 10, 31)),
                   ("cool", date(first, 11, 15), date(second, 5, 31)),
                   ("warm", date(second, 6, 15), date(second, 10, 31))]
        if maximum >= 4:
            periods.insert(0, ("cool", date(first, 1, 15), date(first, 5, 31)))
    return [{"index": index, "planning_year": start.year - years[0] + 1,
             "planning_year_end": end.year - years[0] + 1,
             "season": season, "start": start, "end": end}
            for index, (season, start, end) in enumerate(periods[:maximum])]


def enumerate_sequences(slots: list[dict], settings: ModelSettings):
    choices = [[crop for crop in settings.crops if CROPS[crop]["season"] == slot["season"]]
               + ([None] if settings.allow_fallow else []) for slot in slots]
    if any(not group for group in choices):
        raise ValueError("The crop catalog leaves an empty planting season")
    return [sequence for sequence in product(*choices)
            if sum(crop is not None for crop in sequence) >= settings.min_planted_campaigns]


def agro_calendar(slots, sequence, first_year, last_year):
    calendar = [{date(first_year, 1, 1): {"CropCalendar": None, "TimedEvents": None, "StateEvents": None}}]
    for slot, crop in zip(slots, sequence):
        crop_calendar = None if crop is None else {
            "crop_name": crop, "variety_name": CROPS[crop]["variety"],
            "crop_start_date": slot["start"], "crop_start_type": "sowing",
            "crop_end_date": slot["end"], "crop_end_type": "earliest",
            "max_duration": (slot["end"] - slot["start"]).days,
        }
        calendar.append({slot["start"]: {"CropCalendar": crop_calendar, "TimedEvents": None, "StateEvents": None}})
    calendar.append({slots[-1]["end"] + timedelta(days=1): None})
    return calendar


def simulate(sequence, slots, regime, weather, soil, cropdata, settings):
    from pcse import signals
    from pcse.base import ParameterProvider
    from pcse.models import Wofost72_WLP_CWB

    years = sorted({slot["start"].year for slot in slots})
    agro = agro_calendar(slots, sequence, years[0], years[-1])
    parameters = ParameterProvider(cropdata=cropdata, soildata=soil["parameters"], sitedata=soil["site"])
    model = Wofost72_WLP_CWB(parameters, weather, agro,
                            output_vars=["TOTIRR", "WTRAT", "EVST", "WWLOW"],
                            terminal_vars=["WBALTT", "WBALRT", "WWLOW"])
    ledger, starts = [], {}
    threshold = soil["parameters"]["SMFCF"] - settings.irrigation_depletion_fraction * (
        soil["parameters"]["SMFCF"] - soil["parameters"]["SMW"])
    while not model.flag_terminate:
        moisture, dvs, depth = (model.get_variable(key) for key in ("SM", "DVS", "RD"))
        if (regime == "irrigated" and dvs is not None and depth is not None
                and dvs < 1.9 and moisture < threshold):
            cm = min(settings.irrigation_max_event_mm / 10,
                     (soil["parameters"]["SMFCF"] - moisture) * depth / settings.irrigation_efficiency)
            model._send_signal(signal=signals.irrigate, amount=cm, efficiency=settings.irrigation_efficiency)
            ledger.append({"day": model.day + timedelta(days=1), "gross_mm": cm * 10,
                           "effective_mm": cm * 10 * settings.irrigation_efficiency})
        model.run(1)
        for slot in slots:
            if model.day == slot["start"]:
                starts[slot["index"]] = model.get_variable("WWLOW") * 10
    summaries = {record["DOS"]: record for record in model.get_summary_output()}
    daily = model.get_output()
    campaigns = []
    for slot, crop in zip(slots, sequence):
        campaign = {**slot, "crop": crop, "crop_label": CROPS[crop]["label"] if crop else "Barbecho",
                    "soil_water_at_start_mm": starts.get(slot["index"])}
        if crop is not None:
            summary = summaries.get(slot["start"])
            if summary is None:
                raise ValueError(f"PCSE did not finish the {crop} campaign")
            end = summary.get("DOM") or summary.get("DOH") or slot["end"]
            within = [record for record in daily if slot["start"] <= record["day"] <= end and record.get("RFTRA") is not None]
            irrigation = sum(event["gross_mm"] for event in ledger if slot["start"] <= event["day"] <= end)
            campaign.update(
                variety=CROPS[crop]["variety"], family=CROPS[crop]["family"], harvest_date=end,
                development_stage=float(summary["DVS"]), maturity_reached=summary["DVS"] >= 1.99,
                storage_organ_dry_kg_ha=float(summary["TWSO"]),
                marketable_grain_t_ha=float(summary["TWSO"]) / 1000 / (1 - CROPS[crop]["moisture"]),
                grain_moisture_fraction_assumed=CROPS[crop]["moisture"],
                aboveground_residue_dry_kg_ha=max(0., float(summary["TAGP"] - summary["TWSO"])),
                irrigation_gross_mm=irrigation,
                crop_et_mm=float(summary["CTRAT"] + summary["CEVST"]) * 10,
                water_stress_days=sum(record["RFTRA"] < .5 for record in within),
                crop_days=len(within),
            )
        else:
            campaign.update(marketable_grain_t_ha=0., irrigation_gross_mm=0., aboveground_residue_dry_kg_ha=0.)
        campaigns.append(campaign)
    terminal = model.get_terminal_output()
    gross = sum(event["gross_mm"] for event in ledger)
    effective = float(terminal["TOTIRR"]) * 10
    if abs(effective - gross * settings.irrigation_efficiency) > 1e-5:
        raise ValueError("Irrigation ledger differs from the PCSE water balance")
    if abs(float(terminal["WBALTT"])) > 1e-5:
        raise ValueError("PCSE total water balance does not close")
    total_days = sum(campaign.get("crop_days", 0) for campaign in campaigns)
    return clean_json({
        "simulation_id": digest({"sequence": sequence, "regime": regime})[:16],
        "sequence": sequence, "water_regime": regime, "campaigns": campaigns,
        "irrigation_gross_mm": gross, "irrigation_effective_mm": effective,
        "irrigation_gross_m3_ha": gross * 10,
        "evapotranspiration_mm": float(terminal["WTRAT"] + terminal["EVST"] + terminal["EVWT"]) * 10,
        "rainfall_mm": float(terminal["RAINT"]) * 10,
        "water_balance_error_cm": float(terminal["WBALTT"]),
        "final_soil_water_mm": float(terminal["WWLOW"]) * 10,
        "water_stress_fraction": sum(c.get("water_stress_days", 0) for c in campaigns) / max(1, total_days),
        "immature_campaigns": sum(not c["maturity_reached"] for c in campaigns if c["crop"]),
        "failed_harvests": sum(c["marketable_grain_t_ha"] <= .05 for c in campaigns if c["crop"]),
        "irrigation_events": ledger,
    })


class WofostModelBuilder(ModelBuilder):
    def __init__(self, work_root: Path, reference_root: Path, progress=None):
        self.work_root, self.reference_root = Path(work_root), Path(reference_root)
        self.progress = progress or (lambda **_: None)

    def build(self, source, config):
        settings = ModelSettings.model_validate(config).validated_catalog()
        source = {"profile_dir": str(source)} if isinstance(source, (str, Path)) else dict(source)
        directory = Path(source["profile_dir"]).resolve()
        audit = audit_profile(directory)
        if not audit["integrity_ok"]:
            raise ValueError("Source FarmProfile failed its integrity audit")
        profile_bytes = (directory / "farm_profile.json").read_bytes()
        profile = json.loads(profile_bytes)
        farmer = profile["farmer_inputs"]
        def load(name):
            record = profile["tables"][name]
            path = directory / record["relative_path"]
            return pd.read_parquet(path) if record["format"] == "parquet" else pd.read_csv(path)
        reference = prepare_crop_parameters(self.reference_root, settings)
        identity = {"source_profile_sha256": hashlib.sha256(profile_bytes).hexdigest(),
                    "settings": settings.model_dump(mode="json"), "crop_files": reference["files"],
                    "model_implementation": "continuous-wofost72-mvp-v1", "pcse": "6.0.13"}
        identity["implementation_sha256"] = digest({name: hashlib.sha256(Path(__file__).with_name(name).read_bytes()).hexdigest()
                                                      for name in ("builder.py", "weather.py", "soil.py", "settings.py")})
        cache = self.work_root / "models" / digest(identity)
        cache.mkdir(parents=True, exist_ok=True)
        cached = cache / "model_result.json"
        if cached.is_file():
            self.progress(stage="model_cache", completed=1, total=1)
            result = json.loads(cached.read_text())
            result["cache_hit"] = True
            return result
        weather_frame = load("weather_daily")
        first, last = pd.to_datetime(weather_frame.date).min().date(), pd.to_datetime(weather_frame.date).max().date()
        years = [year for year in range(first.year, last.year + 1)
                 if first <= date(year, 1, 1) and last >= date(year, 12, 31)][-settings.horizon_years:]
        if len(years) < settings.horizon_years:
            raise ValueError("Need complete historical years for the requested rotation horizon")
        elevation = profile.get("topography", {}).get("elevation_m")
        if elevation is None:
            elevation = float(load("topography_samples").elevation_m.mean())
        weather, standardized = prepare_weather(weather_frame, farmer["latitude"], farmer["longitude"],
                                                 float(elevation), cache / "pcse_weather_daily.csv")
        soil = prepare_soil(load("soil_properties_raw"), settings)
        write_json(cache / "soil_parameters.json", soil)
        from pcse.input import YAMLCropDataProvider
        cropdata = YAMLCropDataProvider(fpath=reference["local_path"], force_reload=True)
        maximum = settings.max_campaigns or farmer.get("constraints", {}).get("max_rotation_seasons", 3)
        slots = make_slots(years, maximum)
        if len(slots) < settings.min_planted_campaigns:
            raise ValueError("Too few campaigns for the minimum planted count")
        sequences = enumerate_sequences(slots, settings)
        total, simulations, failures = len(sequences) * len(settings.water_regimes), [], []
        started = time.monotonic()
        for regime in settings.water_regimes:
            for sequence in sequences:
                try:
                    simulations.append(simulate(sequence, slots, regime, weather, soil, cropdata, settings))
                except Exception as exc:
                    failures.append({"sequence": sequence, "water_regime": regime,
                                     "error": f"{type(exc).__name__}: {exc}"[:500]})
                self.progress(stage="wofost", completed=len(simulations) + len(failures), total=total)
        if not simulations or len(failures) > total / 4:
            raise ValueError(f"Too many PCSE simulation failures: {failures[:3]}")
        result = clean_json({
            "schema_version": "1.0", "model": "PCSE 6.0.13 / WOFOST 7.2 CWB",
            "model_cache_directory": str(cache), "model_cache_key": digest(identity), "cache_hit": False,
            "farm_id": farmer["farm_id"], "source_run_id": profile["run_id"],
            "source_uri": source.get("source_uri"), "source_profile_sha256": identity["source_profile_sha256"],
            "farmer_input": farmer, "source_audit": audit, "settings": settings.model_dump(mode="json"),
            "weather_years": years, "weather_days_available": len(standardized),
            "historical_experiment_start": date(years[0], 1, 1),
            "historical_experiment_end": slots[-1]["end"] + timedelta(days=1),
            "slots": slots, "soil": soil, "crop_parameters": reference,
            "candidate_sequences": len(sequences), "simulations": simulations, "failures": failures,
            "simulation_seconds": round(time.monotonic() - started, 2),
            "field_validated": False, "forecast": False,
            "assumptions": ["Historical weather experiment, not a weather or yield forecast",
                            "Calendar windows Jun15–Oct31 / Nov15–May31 are unvalidated demo management",
                            "Public cultivars are not calibrated for these Mexican fields",
                            "Soil water balance is continuous across crops and fallow periods",
                            "Nutrients, pests, salinity and soil carbon changes are not simulated"],
        })
        write_json(cached, result)
        return result
