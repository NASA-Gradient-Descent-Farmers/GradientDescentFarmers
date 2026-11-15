"""Model-builder contract and GCS → WOFOST → SIAP → price orchestration."""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, fields
from math import isfinite
from pathlib import Path
from typing import Any, Mapping

import pandas as pd

from .calibration import (
    calibrate_siap_yield, compare_siap_yield, error_metrics, prepare_siap,
)
from .gcs import GCSDataClient
from .price_forecasting import (
    SIAP_PREFIX, add_prices_to_calibrated_wofost, compare_price_models,
    forecast_harvest_prices, load_siap_price_history, rotation_horizon,
    select_price_scope,
)
from .wofost import SUPPORTED_CROPS, run_wofost


DEFAULT_SIAP_CROP_LABELS = {"maize": "Maíz grano", "fababean": "Haba grano"}
DEFAULT_VARIETIES = {"maize": "Grain_maize_202", "fababean": "Faba_bean_801"}


def normalize_rotation_options(config: Mapping[str, Any]) -> list[dict[str, Any]]:
    """Flatten user-supplied alternatives into ordered, identified crop phases."""
    options = config.get("rotation_options")
    if options is None:
        options = [{"rotation_id": "default", "phases": config.get("planned_rotation")}]
    if not isinstance(options, list) or not options:
        raise ValueError("rotation_options must be a nonempty list")
    flattened = []
    seen_ids = set()
    for option in options:
        if not isinstance(option, Mapping):
            raise ValueError("Each rotation option must be a dictionary")
        rotation_id = option.get("rotation_id")
        phases = option.get("phases")
        if not isinstance(rotation_id, str) or not rotation_id.strip() or rotation_id in seen_ids:
            raise ValueError("Each rotation option needs a distinct rotation_id")
        if not isinstance(phases, list) or not phases:
            raise ValueError(f"Rotation {rotation_id} needs at least one phase")
        seen_ids.add(rotation_id)
        previous_end = None
        for step, phase in enumerate(phases, start=1):
            if not isinstance(phase, Mapping) or not {"crop", "sowing_date", "harvest_date"}.issubset(phase):
                raise ValueError(f"Rotation {rotation_id} phase {step} needs crop, sowing_date, and harvest_date")
            start = pd.Timestamp(phase["sowing_date"])
            end = pd.Timestamp(phase["harvest_date"])
            if pd.isna(start) or pd.isna(end) or start >= end:
                raise ValueError(f"Rotation {rotation_id} phase {step} has invalid dates")
            if previous_end is not None and start <= previous_end:
                raise ValueError(f"Rotation {rotation_id} phases must be chronological and nonoverlapping")
            previous_end = end
            flattened.append({**phase, "rotation_id": rotation_id, "rotation_step": step})
    return flattened


@dataclass(frozen=True)
class ModelBuildResult:
    """Valued harvests, the ordered rotation, and all model diagnostics."""

    final_df: pd.DataFrame
    rotation_df: pd.DataFrame
    historical_daily_df: pd.DataFrame
    future_daily_df: pd.DataFrame
    yield_calibration_df: pd.DataFrame
    yield_error_metrics_df: pd.DataFrame
    price_history_df: pd.DataFrame
    price_scope_checks_df: pd.DataFrame
    price_backtest_df: pd.DataFrame
    price_leaderboard_df: pd.DataFrame
    price_model_failures_df: pd.DataFrame
    annual_price_forecast_df: pd.DataFrame
    harvest_price_df: pd.DataFrame
    horizon_months: int

    def save_final_csv(self, path: str | Path) -> Path:
        """Save the single phase-level output, including each phase's daily JSON."""
        destination = Path(path)
        destination.parent.mkdir(parents=True, exist_ok=True)
        self.final_df.to_csv(destination, index=False)
        return destination

    def save_csv_bundle(self, directory: str | Path, *, prefix: str = "model") -> dict[str, Path]:
        """Write every result DataFrame, including unabridged daily WOFOST output."""
        if not prefix or any(character in prefix for character in ("/", "\\")):
            raise ValueError("prefix must be a nonempty filename prefix")
        destination = Path(directory)
        destination.mkdir(parents=True, exist_ok=True)
        paths = {}
        for field in fields(self):
            frame = getattr(self, field.name)
            if isinstance(frame, pd.DataFrame):
                path = destination / f"{prefix}_{field.name}.csv"
                frame.to_csv(path, index=False)
                paths[field.name] = path
        return paths


class ModelBuilder(ABC):
    """Construct a model result from a prepared source and model settings."""

    @abstractmethod
    def build(self, source: Any, config: Mapping[str, Any]) -> Any:
        """Return a model result from the supplied configuration."""


class GuanajuatoModelBuilder(ModelBuilder):
    """Run the complete experimental model pipeline without hidden inputs.

    ``source`` may be an injected GCS-compatible client for testing; ``None``
    creates ``GCSDataClient``. Required config keys are ``run_uri``,
    ``historical_seasons``, ``water_mode``, and ``rotation_options`` (or the legacy
    ``planned_rotation``). Each phase has crop, sowing_date, harvest_date, and area_ha.
    A future_weather DataFrame (or GCS URI) must cover every future season.
    Global water settings may be overridden on an individual season.
    """

    def __init__(self, *, gcs_factory: Any = GCSDataClient, wofost_runner: Any = run_wofost):
        self.gcs_factory = gcs_factory
        self.wofost_runner = wofost_runner

    @staticmethod
    def _weather(client: Any, value: Any, name: str) -> pd.DataFrame:
        if isinstance(value, pd.DataFrame):
            return value
        if isinstance(value, str) and value.startswith("gs://"):
            return client.read_frame(value)
        raise ValueError(f"{name} must be a DataFrame or a gs:// URI")

    @staticmethod
    def _season_year(season: Mapping[str, Any]) -> int:
        return pd.Timestamp(season["harvest_date"]).year

    def _run_season(
        self, weather: pd.DataFrame, season: Mapping[str, Any], *,
        config: Mapping[str, Any], site: Mapping[str, Any],
        elevation_m: float, run_id: str, varieties: Mapping[str, str],
        phase: str, sequence: int, rotation_id: str | None = None,
    ) -> pd.DataFrame:
        crop = str(season["crop"])
        water_mode = season.get("water_mode", config.get("water_mode", "potential"))
        variety = season.get("variety", varieties[crop])
        irrigation_system = season.get("irrigation_system", config.get("irrigation_system"))
        result = self.wofost_runner(
            weather,
            crop=crop,
            variety=variety,
            sowing_date=season["sowing_date"],
            end_date=season["harvest_date"],
            latitude=float(site["latitude"]), longitude=float(site["longitude"]),
            elevation_m=elevation_m, co2_ppm=float(config.get("co2_ppm", 420.0)),
            run_id=run_id, water_mode=water_mode,
            soil_parameters=season.get("soil_parameters", config.get("soil_parameters")),
            initial_available_water_cm=season.get(
                "initial_available_water_cm", config.get("initial_available_water_cm")
            ),
            irrigation_system=irrigation_system,
            irrigation_events=season.get("irrigation_events"),
        )
        result = result.copy()
        result["variety"] = variety
        result["water_mode"] = water_mode
        result["irrigation_system"] = irrigation_system
        result["season_id"] = (
            f"{rotation_id}_{sequence:03d}"
            if phase == "planned" and rotation_id not in (None, "default")
            else f"{phase}_{sequence:03d}"
        )
        result["rotation_id"] = rotation_id if phase == "planned" else None
        result["season_step"] = sequence
        result["rotation_step"] = sequence if phase == "planned" else pd.NA
        result["soil_state_carried_forward"] = False
        result["sowing_date"] = pd.Timestamp(season["sowing_date"]).normalize()
        result["sowing_year"] = pd.Timestamp(season["sowing_date"]).year
        result["year"] = self._season_year(season)  # SIAP reports harvest-year production.
        result["planned_harvest_date"] = pd.Timestamp(season["harvest_date"]).normalize()
        return result

    def build(self, source: Any = None, config: Mapping[str, Any] | None = None) -> ModelBuildResult:
        if config is None:
            raise ValueError("Pass a model-builder config")
        for key in ("run_uri", "historical_seasons", "water_mode", "future_weather"):
            if key not in config:
                raise ValueError(f"Missing model-builder config: {key}")
        historical_seasons = list(config["historical_seasons"])
        planned_rotation = normalize_rotation_options(config)
        if not historical_seasons:
            raise ValueError("Historical seasons must be nonempty")
        for season in [*historical_seasons, *planned_rotation]:
            if not {"crop", "sowing_date", "harvest_date"}.issubset(season):
                raise ValueError("Every season needs crop, sowing_date, and harvest_date")
        for season in planned_rotation:
            try:
                area = float(season["area_ha"])
            except (KeyError, TypeError, ValueError) as error:
                raise ValueError("Every planned crop needs a positive area_ha") from error
            if not isfinite(area) or area <= 0:
                raise ValueError("Every planned crop needs a positive area_ha")

        client = source if source is not None else self.gcs_factory(project=config.get("gcp_project"))
        profile = client.load_profile(config["run_uri"])
        site = profile.manifest["farmer_inputs"]
        elevation = config.get("elevation_m")
        if elevation is None:
            elevation = profile.manifest.get("topography", {}).get("elevation_m")
        if elevation is None:
            raise ValueError("Supply elevation_m when profile topography has no elevation")
        elevation = float(elevation)
        run_id = str(profile.manifest["run_id"])
        historical_source = config.get("historical_weather")
        historical_weather = (profile.table("weather_daily") if historical_source is None
                              else self._weather(client, historical_source, "historical_weather"))
        future_weather = self._weather(client, config["future_weather"], "future_weather")

        labels = dict(config.get("siap_crop_labels", DEFAULT_SIAP_CROP_LABELS))
        varieties = {**DEFAULT_VARIETIES, **config.get("varieties", {})}
        history_years = sorted({self._season_year(season) for season in historical_seasons})
        siap = pd.concat([
            client.read_frame(
                f"{SIAP_PREFIX}/Cierre_agricola_mun_{year}.csv"
            ) for year in history_years
        ], ignore_index=True)

        requested = config.get("selected_products")
        if requested is None:
            candidates = set(labels) & {str(season["crop"]) for season in historical_seasons}
            try:
                municipal = prepare_siap(
                    siap, municipality=str(config.get("municipality", "Valle de Santiago")),
                    crop_labels={crop: labels[crop] for crop in candidates},
                )
            except ValueError as error:
                raise ValueError("No municipal SIAP crop history matches configured seasons") from error
            selected = [crop for crop in sorted(candidates)
                        if municipal.loc[(municipal.crop == crop)
                                         & (municipal.observed_t_ha > 0), "year"].nunique() >= 2]
        else:
            if isinstance(requested, str):
                raise ValueError("selected_products must be a list of crop names")
            selected = list(requested)
        if not selected or len(set(selected)) != len(selected):
            raise ValueError("Select distinct products with at least two SIAP calibration years")
        for crop in selected:
            if crop not in SUPPORTED_CROPS or crop not in labels or crop not in varieties:
                raise ValueError(f"Missing WOFOST/variety/SIAP mapping for selected crop: {crop}")
        if set(selected) != {str(season["crop"]) for season in planned_rotation}:
            raise ValueError("Planned rotation must contain exactly the selected products")
        historical_seasons = [season for season in historical_seasons if season["crop"] in selected]
        if {season["crop"] for season in historical_seasons} != set(selected):
            raise ValueError("Every selected product needs historical WOFOST seasons")

        years = list(config.get("siap_price_years", range(2003, 2026)))
        if not years:
            raise ValueError("siap_price_years must be nonempty")
        last_siap_year = max(years)
        harvests, horizon_months, _ = rotation_horizon(
            selected, planned_rotation, last_siap_year=last_siap_year,
        )
        historical_runs = [
            self._run_season(
                historical_weather, season, config=config, site=site,
                elevation_m=elevation, run_id=run_id, varieties=varieties,
                phase="historical", sequence=sequence,
            ) for sequence, season in enumerate(historical_seasons, start=1)
        ]
        historical_daily = pd.concat(historical_runs, ignore_index=True)

        calibration_frames = []
        calibration_metrics = []
        calibration_factors = {}
        calibration_scopes = {}
        for crop in selected:
            crop_runs = historical_daily[historical_daily.crop == crop]
            failures = []
            for scope in ("municipal", "state"):
                try:
                    comparison = compare_siap_yield(
                        crop_runs, siap,
                        municipality=str(config.get("municipality", "Valle de Santiago")),
                        state=str(config.get("state", "Guanajuato")), scope=scope,
                        crop_labels={crop: labels[crop]},
                    )
                    calibrated = calibrate_siap_yield(comparison)
                    break
                except ValueError as error:
                    if not str(error).startswith((
                        "No SIAP rows match", "No SIAP observation",
                        "At least two distinct SIAP years",
                    )):
                        raise
                    failures.append(f"{scope}: {error}")
            else:
                raise ValueError(f"Cannot calibrate {crop} with SIAP for the simulated years: {failures}")
            calibration_frames.append(calibrated)
            metric = error_metrics(calibrated, prediction_column="loyo_t_ha")
            metric["crop"] = crop
            metric["scope"] = scope
            calibration_metrics.append(metric)
            calibration_factors[crop] = float(calibrated.calibration_factor.iloc[0])
            calibration_scopes[crop] = scope
        yield_calibration = pd.concat(calibration_frames, ignore_index=True)
        yield_metrics = pd.concat(calibration_metrics, ignore_index=True)

        future_runs = [
            self._run_season(
                future_weather, season, config=config, site=site,
                elevation_m=elevation, run_id=run_id, varieties=varieties,
                phase="planned", sequence=season["rotation_step"],
                rotation_id=season["rotation_id"],
            ) for season in planned_rotation
        ]
        future_daily = pd.concat(future_runs, ignore_index=True)
        final_rows = []
        for season, run in zip(planned_rotation, future_runs):
            finals = run.loc[run.is_final_day].copy()
            if len(finals) != 1:
                raise ValueError("Expected one terminal WOFOST row per planned crop")
            finals["wofost_terminal_date"] = pd.to_datetime(finals.date)
            finals["harvest_date"] = pd.Timestamp(season["harvest_date"]).normalize()
            finals["area_ha"] = float(season["area_ha"])
            finals["calibration_factor"] = calibration_factors[season["crop"]]
            finals["calibration_scope"] = calibration_scopes[season["crop"]]
            finals["calibrated_t_ha"] = (
                pd.to_numeric(finals.yield_t_ha, errors="raise") * finals.calibration_factor
            )
            finals["future_weather_source"] = config.get("future_weather_source", "provided")
            finals["wofost_daily_json"] = run.to_json(
                orient="records", date_format="iso", double_precision=15
            )
            final_rows.append(finals)
        calibrated_futures = pd.concat(final_rows, ignore_index=True)

        price_history = load_siap_price_history(
            client, years=years, state=str(config.get("state", "Guanajuato")),
            municipality=str(config.get("municipality", "Valle de Santiago")),
            crop_labels={crop: labels[crop] for crop in selected},
        )
        selected_histories = {}
        price_checks = []
        backtests = []
        leaderboards = {}
        model_failures = []
        for crop in selected:
            crop_harvest_year = int(harvests.loc[harvests.crop == crop, "forecast_year"].max())
            _, price_series, checks = select_price_scope(
                price_history, crop=crop, last_siap_year=last_siap_year,
                horizon_years=crop_harvest_year - last_siap_year,
            )
            selected_histories[crop] = price_series
            price_checks.append(checks)
            effective_horizon = crop_harvest_year - int(price_series.year.max())
            backtest, leaderboard, failures = compare_price_models(
                price_series, horizon_years=effective_horizon,
            )
            backtest["crop"] = crop
            leaderboard["crop"] = crop
            leaderboard["scope"] = price_series.scope.iloc[0]
            leaderboard["forecast_horizon_years"] = effective_horizon
            backtests.append(backtest)
            leaderboards[crop] = leaderboard
            if not failures.empty:
                failures["crop"] = crop
                model_failures.append(failures)
        annual_prices, harvest_prices = forecast_harvest_prices(
            selected_histories, leaderboards, harvests, last_siap_year=last_siap_year,
        )
        unique_prices = harvest_prices.drop_duplicates(["crop", "harvest_date"])
        final_df = add_prices_to_calibrated_wofost(calibrated_futures, unique_prices)
        final_df = final_df.rename(columns={"scope": "price_scope", "model": "price_model"})
        best_mae = {crop: float(board.iloc[0].mae_mxn_t)
                    for crop, board in leaderboards.items()}
        final_df["price_backtest_mae_mxn_t"] = final_df.crop.map(best_mae)
        final_df["yield_loyo_mae_t_ha"] = final_df.crop.map(
            yield_metrics.set_index("crop").mae_t_ha
        )
        final_df["rotation_phase_count"] = final_df.groupby("rotation_id").crop.transform("size")
        final_df["rotation_option_count"] = len({season["rotation_id"] for season in planned_rotation})
        sequences = (final_df.sort_values(["rotation_id", "rotation_step"])
                     .groupby("rotation_id").crop.apply(lambda crops: " -> ".join(crops)))
        final_df["rotation_sequence"] = final_df.rotation_id.map(sequences)
        final_df["rotation_total_estimated_gross_value_mxn"] = (
            final_df.groupby("rotation_id").estimated_gross_value_mxn.transform("sum")
        )
        rotation_columns = [
            "rotation_id", "rotation_step", "rotation_phase_count", "rotation_sequence",
            "season_id", "crop", "variety", "sowing_date",
            "planned_harvest_date", "wofost_terminal_date", "water_mode",
            "irrigation_system", "soil_state_carried_forward", "area_ha",
            "yield_t_ha", "calibrated_t_ha", "estimated_tonnes",
            "estimated_price_mxn_t", "estimated_gross_value_mxn",
        ]
        rotation_df = final_df[rotation_columns].sort_values(
            ["rotation_id", "rotation_step"]
        ).reset_index(drop=True)
        rotation_df["horizon_months"] = horizon_months

        return ModelBuildResult(
            final_df=final_df,
            rotation_df=rotation_df,
            historical_daily_df=historical_daily,
            future_daily_df=future_daily,
            yield_calibration_df=yield_calibration,
            yield_error_metrics_df=yield_metrics,
            price_history_df=price_history,
            price_scope_checks_df=pd.concat(price_checks, ignore_index=True),
            price_backtest_df=pd.concat(backtests, ignore_index=True),
            price_leaderboard_df=pd.concat(leaderboards.values(), ignore_index=True),
            price_model_failures_df=(pd.concat(model_failures, ignore_index=True) if model_failures
                                     else pd.DataFrame(columns=["model", "error", "crop"])),
            annual_price_forecast_df=annual_prices,
            harvest_price_df=harvest_prices,
            horizon_months=horizon_months,
        )
