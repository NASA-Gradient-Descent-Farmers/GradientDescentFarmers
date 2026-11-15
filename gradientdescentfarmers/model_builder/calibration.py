"""Compare and calibrate WOFOST yields with municipal or state SIAP observations."""

from __future__ import annotations

import math
import unicodedata
from collections.abc import Mapping

import pandas as pd


def _key(value: object) -> str:
    text = unicodedata.normalize("NFKD", str(value).strip().casefold())
    return "".join(char for char in text if not unicodedata.combining(char))


def _numeric(frame: pd.DataFrame, column: str) -> pd.Series:
    if column not in frame:
        raise ValueError(f"Missing observation column: {column}")
    return pd.to_numeric(frame[column], errors="coerce")


def prepare_siap(
    frame: pd.DataFrame, *, municipality: str, crop_labels: Mapping[str, str],
    state: str | None = None, scope: str = "municipal",
) -> pd.DataFrame:
    """Use SIAP municipality or state totals; yield is per sown hectare."""
    aliases = {
        "anio": "year", "nommunicipio": "municipality", "nomcultivo": "crop",
        "nomestado": "state", "nomunidad": "unit", "sembrada": "sown_ha",
        "volumenproduccion": "production_volume",
    }
    data = frame.copy()
    data.columns = [str(column).strip().casefold() for column in data.columns]
    if "nomcultivo sin um" in data:
        if "nomcultivo" in data:
            data["nomcultivo"] = data["nomcultivo"].fillna(data["nomcultivo sin um"])
        else:
            data = data.rename(columns={"nomcultivo sin um": "nomcultivo"})
    data = data.rename(columns=aliases)
    for name in ("year", "crop", "unit", "sown_ha", "production_volume"):
        if name not in data:
            raise ValueError(f"Missing SIAP column: {name}")
    if scope == "municipal":
        if "municipality" not in data:
            raise ValueError("Missing SIAP column: municipality")
        data = data[data["municipality"].map(_key) == _key(municipality)].copy()
    elif scope == "state":
        if state is None or "state" not in data:
            raise ValueError("State scope requires state and the SIAP state column")
        data = data[data["state"].map(_key) == _key(state)].copy()
    else:
        raise ValueError("scope must be municipal or state")
    crop_lookup = {_key(label): crop for crop, label in crop_labels.items()}
    data["crop"] = data["crop"].map(lambda value: crop_lookup.get(_key(value)))
    data = data[data["crop"].notna()].copy()
    if data.empty:
        raise ValueError("No SIAP rows match municipality and crop labels")
    # Reject non-tonne crops instead of silently treating another unit as tonnes.
    if not data["unit"].map(_key).isin(("tonelada", "toneladas", "ton", "t")).all():
        raise ValueError("SIAP production units must be tonnes")
    data["year"] = _numeric(data, "year")
    data["sown_ha"] = _numeric(data, "sown_ha")
    data["production_volume"] = _numeric(data, "production_volume")
    if data[["year", "sown_ha", "production_volume"]].isna().any().any():
        raise ValueError("SIAP has missing year, area, or production")
    if (data.sown_ha <= 0).any() or (data.production_volume < 0).any():
        raise ValueError("SIAP has invalid sown area or production")
    grouped = data.groupby(["year", "crop"], as_index=False)[["sown_ha", "production_volume"]].sum()
    grouped["observed_t_ha"] = grouped.production_volume / grouped.sown_ha
    grouped["year"] = grouped.year.astype(int)
    return grouped[["year", "crop", "observed_t_ha", "sown_ha"]]


def compare_siap_yield(
    simulation: pd.DataFrame,
    siap: pd.DataFrame,
    *,
    municipality: str,
    crop_labels: Mapping[str, str],
    state: str | None = None,
    scope: str = "municipal",
) -> pd.DataFrame:
    """Pair final simulated dry-matter yields with SIAP municipal yields.

    SIAP yield is production per sown hectare. Its reported grain moisture
    basis may differ from WOFOST dry matter, so errors are diagnostic only.
    """
    required = {"year", "crop", "yield_t_ha", "is_final_day"}
    missing = required - set(simulation.columns)
    if missing:
        raise ValueError(f"Missing simulation columns: {sorted(missing)}")
    final_flag = simulation["is_final_day"]
    if final_flag.dtype != bool:
        final_flag = final_flag.astype(str).str.casefold().eq("true")
    context_columns = [
        name for name in ("variety", "water_mode", "irrigation_system", "irrigation_applied_mm")
        if name in simulation.columns
    ]
    runs = simulation.loc[final_flag, ["year", "crop", "yield_t_ha", *context_columns]].copy()
    runs["year"] = pd.to_numeric(runs["year"], errors="raise").astype(int)
    runs["simulated_t_ha"] = pd.to_numeric(runs["yield_t_ha"], errors="raise")
    if runs.empty or runs.duplicated(["year", "crop"]).any():
        raise ValueError("Expected one final simulation per year and crop")
    if not runs["simulated_t_ha"].map(math.isfinite).all() or (runs["simulated_t_ha"] <= 0).any():
        raise ValueError("Final simulated yields must be positive and finite")
    observed = prepare_siap(
        siap, municipality=municipality, crop_labels=crop_labels,
        state=state, scope=scope,
    )
    paired = runs[["year", "crop", "simulated_t_ha", *context_columns]].merge(
        observed, on=["year", "crop"], how="left", validate="one_to_one"
    )
    if paired["observed_t_ha"].isna().any():
        missing_years = paired.loc[paired["observed_t_ha"].isna(), ["year", "crop"]]
        raise ValueError(f"No SIAP observation for simulated year/crop: {missing_years.to_dict('records')}")
    if (paired["observed_t_ha"] <= 0).any():
        raise ValueError("SIAP yields must be positive for percentage error metrics")
    paired["municipality"] = municipality if scope == "municipal" else pd.NA
    paired["state"] = state
    paired["observation_scope"] = scope
    paired["raw_error_t_ha"] = paired["simulated_t_ha"] - paired["observed_t_ha"]
    paired["raw_absolute_error_t_ha"] = paired["raw_error_t_ha"].abs()
    paired["raw_absolute_percentage_error"] = 100 * paired["raw_absolute_error_t_ha"] / paired["observed_t_ha"]
    return paired.sort_values(["crop", "year"]).reset_index(drop=True)


def calibrate_siap_yield(comparison: pd.DataFrame) -> pd.DataFrame:
    """Fit a per-crop scale and calculate leave-one-year-out predictions.

    The full-data fit is descriptive, not a validation score. Each held-out
    year is predicted using only the other years for that crop. At least two
    years are required for each crop.
    """
    required = {"year", "crop", "observed_t_ha", "simulated_t_ha", "raw_error_t_ha"}
    missing = required - set(comparison.columns)
    if missing:
        raise ValueError(f"Missing SIAP comparison columns: {sorted(missing)}")
    result = comparison.copy()
    result["calibration_factor"] = float("nan")
    result["loyo_factor"] = float("nan")
    for crop, subset in result.groupby("crop"):
        if subset["year"].nunique() < 2 or subset["year"].duplicated().any():
            raise ValueError(f"At least two distinct SIAP years are required for {crop}")
        simulated = subset["simulated_t_ha"].astype(float)
        observed = subset["observed_t_ha"].astype(float)
        numerator = simulated * observed
        denominator = simulated ** 2
        full_factor = float(numerator.sum() / denominator.sum())
        result.loc[subset.index, "calibration_factor"] = full_factor
        result.loc[subset.index, "loyo_factor"] = (
            (numerator.sum() - numerator) / (denominator.sum() - denominator)
        ).to_numpy()
    result["calibrated_t_ha"] = result["simulated_t_ha"] * result["calibration_factor"]
    result["loyo_t_ha"] = result["simulated_t_ha"] * result["loyo_factor"]
    result["fit_error_t_ha"] = result["calibrated_t_ha"] - result["observed_t_ha"]
    result["loyo_error_t_ha"] = result["loyo_t_ha"] - result["observed_t_ha"]
    return result


def error_metrics(frame: pd.DataFrame, *, prediction_column: str) -> pd.DataFrame:
    """Return MAE, RMSE, mean bias, and MAPE in a one-row DataFrame."""
    if prediction_column not in frame or "observed_t_ha" not in frame:
        raise ValueError("Prediction and observed_t_ha columns are required")
    if frame.empty:
        raise ValueError("Cannot calculate error metrics on an empty DataFrame")
    prediction = pd.to_numeric(frame[prediction_column], errors="raise")
    observed = pd.to_numeric(frame["observed_t_ha"], errors="raise")
    if not prediction.map(math.isfinite).all() or not observed.map(math.isfinite).all():
        raise ValueError("Prediction and observation must be finite")
    if (observed <= 0).any():
        raise ValueError("Observed yield must be positive for MAPE")
    error = prediction - observed
    return pd.DataFrame([{
        "prediction": prediction_column,
        "n_years": len(frame),
        "mae_t_ha": float(error.abs().mean()),
        "rmse_t_ha": float((error.pow(2).mean()) ** 0.5),
        "mean_bias_t_ha": float(error.mean()),
        "mape_pct": float((100 * error.abs() / observed).mean()),
    }])


def prepare_dataverse(
    frame: pd.DataFrame, *, columns: Mapping[str, str], crop_labels: Mapping[str, str]
) -> pd.DataFrame:
    """Normalize field observations with an explicit mapping of actual source columns.

    ``columns`` maps canonical names (year, crop, yield_t_ha, field_id) to
    source names. If only production is available, map production_t and
    harvested_ha instead of yield_t_ha. Units must already be tonnes and ha.
    """
    needed = {"year", "crop", "field_id"}
    if not needed.issubset(columns) or not ({"yield_t_ha"} <= columns.keys() or
                                        {"production_t", "harvested_ha"} <= columns.keys()):
        raise ValueError("Map year, crop, field_id, and yield or production plus harvested area")
    missing = set(columns.values()) - set(frame.columns)
    if missing:
        raise ValueError(f"Missing Dataverse source columns: {sorted(missing)}")
    data = frame.rename(columns={source: target for target, source in columns.items()}).copy()
    data["year"] = _numeric(data, "year")
    data["crop"] = data["crop"].map(
        lambda value: {_key(label): crop for crop, label in crop_labels.items()}.get(_key(value))
    )
    data = data[data.crop.notna()].copy()
    if "yield_t_ha" not in data:
        area = _numeric(data, "harvested_ha")
        data["yield_t_ha"] = _numeric(data, "production_t") / area.where(area > 0)
    data["yield_t_ha"] = _numeric(data, "yield_t_ha")
    if data.empty or data[["year", "yield_t_ha"]].isna().any().any():
        raise ValueError("No usable Dataverse field yields")
    if (data.yield_t_ha < 0).any() or not data.yield_t_ha.map(math.isfinite).all():
        raise ValueError("Invalid Dataverse field yield")
    data["year"] = data.year.astype(int)
    return data[["year", "crop", "field_id", "yield_t_ha"]].rename(
        columns={"yield_t_ha": "observed_t_ha"}
    ).reset_index(drop=True)


def calibrate_yield(
    simulation: pd.DataFrame,
    siap: pd.DataFrame,
    dataverse: pd.DataFrame,
    *,
    municipality: str,
    siap_crop_labels: Mapping[str, str],
    field_crop_labels: Mapping[str, str],
    field_columns: Mapping[str, str],
) -> pd.DataFrame:
    """Fit one no-intercept factor on SIAP; report field comparisons separately.

    The resulting DataFrame is an approximate dry-matter versus reported-yield
    comparison. It does not establish independent or field-level calibration.
    """
    required = {"year", "crop", "yield_t_ha", "is_final_day"}
    if required - set(simulation):
        raise ValueError(f"Missing simulation columns: {sorted(required - set(simulation))}")
    runs = simulation[simulation.is_final_day].copy()
    runs["simulated_t_ha"] = pd.to_numeric(runs.yield_t_ha, errors="coerce")
    if runs.empty or runs.simulated_t_ha.isna().any() or (runs.simulated_t_ha <= 0).any():
        raise ValueError("Final simulated yields must be positive and finite")
    if runs.duplicated(["year", "crop"]).any():
        raise ValueError("Expected one final simulation per year and crop")
    runs = runs[["year", "crop", "simulated_t_ha"]]
    municipal = prepare_siap(siap, municipality=municipality, crop_labels=siap_crop_labels)
    training = municipal.merge(runs, on=["year", "crop"], how="inner", validate="one_to_one")
    if training.empty:
        raise ValueError("No matching municipal observations for calibration")
    factor = float((training.simulated_t_ha * training.observed_t_ha).sum() /
                   (training.simulated_t_ha ** 2).sum())
    if not math.isfinite(factor):
        raise ValueError("Calibration factor is not finite")
    training["level"] = "municipality"
    training["role"] = "fit"
    training["observation_id"] = municipality
    fields = prepare_dataverse(dataverse, columns=field_columns, crop_labels=field_crop_labels)
    comparison = fields.merge(runs, on=["year", "crop"], how="left", validate="many_to_one")
    comparison["level"] = "field"
    comparison["role"] = comparison.simulated_t_ha.notna().map(
        {True: "comparison_only", False: "unmatched_year"}
    )
    comparison["observation_id"] = comparison.field_id
    combined = pd.concat([training, comparison], ignore_index=True)
    combined["calibration_factor"] = factor
    combined["calibrated_t_ha"] = combined.simulated_t_ha * factor
    combined["residual_t_ha"] = combined.observed_t_ha - combined.calibrated_t_ha
    combined["interpretation"] = "experimental_PP; municipal fit, field comparison is not independent validation"
    return combined[["level", "role", "observation_id", "year", "crop", "observed_t_ha",
                     "simulated_t_ha", "calibration_factor", "calibrated_t_ha",
                     "residual_t_ha", "interpretation"]]
