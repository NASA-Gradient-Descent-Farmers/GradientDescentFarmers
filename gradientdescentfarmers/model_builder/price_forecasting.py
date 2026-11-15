"""Exploratory SIAP producer-price forecasts at planned crop harvests.

SIAP municipal files are annual. Forecasts therefore have annual resolution;
the harvest month selects the forecast year but is not a learned seasonal effect.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from math import isfinite
import unicodedata
import warnings

import numpy as np
import pandas as pd


SIAP_PREFIX = "gs://data_dump_samples/SIAP_Agricultural_Production_2000_2025/Municipal (2003_2025)"
MODEL_NAMES = ("last_value", "holt_damped", "arima_110", "ridge_lags", "random_forest_lags")


def _key(value: object) -> str:
    normalized = unicodedata.normalize("NFKD", str(value).strip().casefold())
    return "".join(char for char in normalized if not unicodedata.combining(char))


def prepare_siap_price_year(
    frame: pd.DataFrame, *, state: str, municipality: str,
    crop_labels: Mapping[str, str],
) -> pd.DataFrame:
    """Aggregate one SIAP annual file into production-weighted MXN/t series.

    Returns both municipal and state series. Years 2015–2020 use the alternate
    ``Nomcultivo sin UM`` heading; both formats are accepted. Non-tonne rows
    are excluded, and a year with zero total production has no defined price.
    """
    if not crop_labels or len({_key(label) for label in crop_labels.values()}) != len(crop_labels):
        raise ValueError("crop_labels must map distinct crops to distinct SIAP labels")
    data = frame.copy()
    data.columns = [str(column).strip().casefold() for column in data.columns]
    if "nomcultivo sin um" in data:
        if "nomcultivo" in data:
            data["nomcultivo"] = data["nomcultivo"].fillna(data["nomcultivo sin um"])
        else:
            data = data.rename(columns={"nomcultivo sin um": "nomcultivo"})
    required = {"anio", "nomestado", "nommunicipio", "nomcultivo", "nomunidad",
                "volumenproduccion", "valorproduccion"}
    missing = required - set(data.columns)
    if missing:
        raise ValueError(f"Missing SIAP price columns: {sorted(missing)}")
    labels = {_key(label): crop for crop, label in crop_labels.items()}
    data = data[data.nomestado.map(_key).eq(_key(state))].copy()
    data["crop"] = data.nomcultivo.map(lambda value: labels.get(_key(value)))
    data = data[data.crop.notna() & data.nomunidad.map(_key).isin(("tonelada", "toneladas", "ton", "t"))]
    if data.empty:
        return pd.DataFrame(columns=["year", "crop", "scope", "production_t", "value_mxn", "price_mxn_t"])
    for column in ("anio", "volumenproduccion", "valorproduccion"):
        data[column] = pd.to_numeric(data[column], errors="coerce")
    if data[["anio", "volumenproduccion", "valorproduccion"]].isna().any().any():
        raise ValueError("Selected SIAP price rows contain nonnumeric year, volume, or value")
    if (data.volumenproduccion < 0).any() or (data.valorproduccion < 0).any():
        raise ValueError("Selected SIAP price rows contain negative volume or value")
    data["year"] = data.anio.astype(int)

    def aggregate(rows: pd.DataFrame, scope: str) -> pd.DataFrame:
        grouped = rows.groupby(["year", "crop"], as_index=False)[
            ["volumenproduccion", "valorproduccion"]
        ].sum()
        grouped = grouped[(grouped.volumenproduccion > 0) & (grouped.valorproduccion > 0)].copy()
        grouped["scope"] = scope
        grouped["price_mxn_t"] = grouped.valorproduccion / grouped.volumenproduccion
        return grouped.rename(columns={
            "volumenproduccion": "production_t", "valorproduccion": "value_mxn"
        })[["year", "crop", "scope", "production_t", "value_mxn", "price_mxn_t"]]

    municipal = data[data.nommunicipio.map(_key).eq(_key(municipality))]
    return pd.concat([aggregate(municipal, "municipal"), aggregate(data, "state")],
                     ignore_index=True).sort_values(["crop", "scope", "year"]).reset_index(drop=True)


def load_siap_price_history(
    client: object, *, years: Sequence[int], state: str, municipality: str,
    crop_labels: Mapping[str, str], prefix: str = SIAP_PREFIX,
) -> pd.DataFrame:
    """Read SIAP annual closing files and retain only requested crops and region."""
    if not years or len(set(years)) != len(years):
        raise ValueError("years must be a nonempty sequence without duplicates")
    frames = []
    for year in sorted(years):
        uri = f"{prefix}/Cierre_agricola_mun_{year}.csv"
        part = prepare_siap_price_year(
            client.read_frame(uri), state=state, municipality=municipality,
            crop_labels=crop_labels,
        )
        if not part.empty and not part.year.eq(year).all():
            raise ValueError(f"SIAP file year differs from its URI: {uri}")
        if not part.empty:
            frames.append(part)
    if not frames:
        raise ValueError("No SIAP tonne prices found for the selected products and state")
    result = pd.concat(frames, ignore_index=True)
    if result.duplicated(["year", "crop", "scope"]).any():
        raise ValueError("Duplicate SIAP year/crop/scope rows")
    return result.sort_values(["crop", "scope", "year"]).reset_index(drop=True)


def rotation_horizon(
    selected_products: Sequence[str], rotation: Sequence[Mapping[str, object]], *,
    last_siap_year: int,
) -> tuple[pd.DataFrame, int, int]:
    """Return planned harvests and the months/annual steps through the last one."""
    selected = set(selected_products)
    if not selected or len(selected) != len(selected_products) or not rotation:
        raise ValueError("Select distinct products and provide a nonempty crop rotation")
    harvests = pd.DataFrame(rotation)
    if not {"crop", "harvest_date"}.issubset(harvests):
        raise ValueError("Each rotation item needs crop and harvest_date")
    if harvests.crop.isna().any() or not set(harvests.crop).issubset(selected):
        raise ValueError("Rotation crops must be selected products")
    if set(harvests.crop) != selected:
        raise ValueError("Each selected product needs at least one planned harvest")
    harvests = harvests.copy()
    harvests["harvest_date"] = pd.to_datetime(harvests.harvest_date, errors="raise").dt.normalize()
    identity = ["rotation_id", "crop", "harvest_date"] if "rotation_id" in harvests else ["crop", "harvest_date"]
    if harvests.harvest_date.isna().any() or harvests.duplicated(identity).any():
        raise ValueError("Harvest dates must be present and unique per crop within each rotation")
    as_of = pd.Timestamp(year=last_siap_year, month=12, day=31)
    if (harvests.harvest_date <= as_of).any():
        raise ValueError("Planned harvests must follow the last SIAP year")
    harvests["forecast_year"] = harvests.harvest_date.dt.year
    harvests["months_ahead"] = (
        (harvests.harvest_date.dt.year - last_siap_year) * 12
        + harvests.harvest_date.dt.month - 12
    )
    last = harvests.harvest_date.max()
    horizon_months = (last.year - last_siap_year) * 12 + last.month - 12
    horizon_years = last.year - last_siap_year
    return harvests.sort_values("harvest_date").reset_index(drop=True), horizon_months, horizon_years


def _backtest_origins(
    history: pd.DataFrame, *, horizon_years: int, min_train_years: int,
    max_origins: int,
) -> list[int]:
    years = sorted(history.year.astype(int).tolist())
    known = set(years)
    return [year for index, year in enumerate(years)
            if index + 1 >= min_train_years and year + horizon_years in known][-max_origins:]


def select_price_scope(
    prices: pd.DataFrame, *, crop: str, last_siap_year: int,
    horizon_years: int, min_history_years: int = 10,
    min_backtest_origins: int = 3, max_staleness_years: int = 2,
    max_missing_fraction: float = 0.25,
) -> tuple[str, pd.DataFrame, pd.DataFrame]:
    """Use municipal prices when viable, otherwise state prices, or fail.

    Eligibility requires enough observed years, recent coverage, a mostly
    complete annual sequence, and time-ordered backtest origins that reach
    the requested forecast horizon.
    """
    if horizon_years < 1:
        raise ValueError("horizon_years must be positive")
    diagnostics = []
    for scope in ("municipal", "state"):
        history = prices[(prices.crop == crop) & (prices.scope == scope)].sort_values("year").copy()
        if history.duplicated("year").any():
            raise ValueError(f"Duplicate {scope} price years for {crop}")
        count = len(history)
        newest = int(history.year.max()) if count else None
        latest_volume = (float(history.iloc[-1].production_t)
                         if count and "production_t" in history else float("nan"))
        span = int(newest - history.year.min() + 1) if count else 0
        missing_fraction = 1 - count / span if span else 1.0
        effective_horizon = last_siap_year + horizon_years - newest if count else None
        origins = _backtest_origins(history, horizon_years=effective_horizon,
                                    min_train_years=min_history_years,
                                    max_origins=5) if count else []
        eligible = (count >= min_history_years
                    and newest >= last_siap_year - max_staleness_years
                    and missing_fraction <= max_missing_fraction
                    and len(origins) >= min_backtest_origins)
        diagnostics.append({"crop": crop, "scope": scope, "observed_years": count,
                            "last_observed_year": newest, "last_production_t": latest_volume,
                            "missing_year_fraction": missing_fraction,
                            "forecast_horizon_years": effective_horizon,
                            "backtest_origins": len(origins), "eligible": eligible})
        if eligible:
            return scope, history.reset_index(drop=True), pd.DataFrame(diagnostics)
    raise ValueError(f"Neither municipal nor state SIAP prices are sufficient for {crop}: {diagnostics}")


def _forecast_model(model_name: str, history: pd.DataFrame, horizon_years: int) -> np.ndarray:
    """Fit one model on information available at this forecast origin only."""
    if model_name not in MODEL_NAMES:
        raise ValueError(f"Unknown model: {model_name}")
    observed = history.sort_values("year")
    years = observed.year.to_numpy(dtype=int)
    values = observed.price_mxn_t.to_numpy(dtype=float)
    if len(years) < 3 or not np.isfinite(values).all() or (values <= 0).any():
        raise ValueError("A model needs at least three positive, finite observed prices")
    if model_name == "last_value":
        forecast = np.repeat(values[-1], horizon_years)
    elif model_name in ("holt_damped", "arima_110"):
        regular = pd.Series(values, index=years).reindex(range(years[0], years[-1] + 1))
        regular = regular.interpolate(method="linear")
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            if model_name == "holt_damped":
                from statsmodels.tsa.holtwinters import ExponentialSmoothing
                fitted = ExponentialSmoothing(
                    regular.to_numpy(), trend="add", damped_trend=True,
                    initialization_method="estimated",
                ).fit(optimized=True)
            else:
                from statsmodels.tsa.arima.model import ARIMA
                fitted = ARIMA(regular.to_numpy(), order=(1, 1, 0), trend="t").fit()
            forecast = np.asarray(fitted.forecast(horizon_years), dtype=float)
    else:
        from sklearn.ensemble import RandomForestRegressor
        from sklearn.linear_model import Ridge
        from sklearn.pipeline import make_pipeline
        from sklearn.preprocessing import StandardScaler

        x_train = np.array([
            [years[i] - years[0], values[i - 1], values[i - 2],
             years[i] - years[i - 1], years[i - 1] - years[i - 2]]
            for i in range(2, len(years))
        ], dtype=float)
        y_train = values[2:]
        if model_name == "ridge_lags":
            model = make_pipeline(StandardScaler(), Ridge(alpha=1.0))
        else:
            model = RandomForestRegressor(
                n_estimators=100, max_depth=4, min_samples_leaf=2,
                random_state=42, n_jobs=1,
            )
        model.fit(x_train, y_train)
        forecasts = []
        past_years = years.tolist()
        past_values = values.tolist()
        for step in range(1, horizon_years + 1):
            target_year = years[-1] + step
            features = np.array([[
                target_year - years[0], past_values[-1], past_values[-2],
                target_year - past_years[-1], past_years[-1] - past_years[-2],
            ]], dtype=float)
            prediction = max(float(model.predict(features)[0]), 0.01)
            forecasts.append(prediction)
            past_years.append(target_year)
            past_values.append(prediction)
        forecast = np.asarray(forecasts)
    if len(forecast) != horizon_years or not np.isfinite(forecast).all():
        raise ValueError(f"{model_name} produced invalid forecasts")
    return np.maximum(forecast, 0.01)


def compare_price_models(
    history: pd.DataFrame, *, horizon_years: int, min_train_years: int = 10,
    max_origins: int = 5,
) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    """Expanding-origin, multi-step backtest with one common MAE in MXN/t.

    Every model is scored at the requested full horizon on the same
    origin/target-year pairs. Missing SIAP years are never treated as observed
    holdouts. Holt and ARIMA interpolate internal missing years within each
    training fold. Model failures are returned instead of silently omitted.
    """
    history = history.sort_values("year").copy()
    if history.duplicated("year").any():
        raise ValueError("Price history contains duplicate years")
    origins = _backtest_origins(history, horizon_years=horizon_years,
                                min_train_years=min_train_years, max_origins=max_origins)
    if len(origins) < 3:
        raise ValueError("At least three complete-horizon backtest origins are required")
    actuals = history.set_index("year").price_mxn_t.to_dict()
    predictions = []
    failures = []
    for name in MODEL_NAMES:
        model_rows = []
        try:
            for origin in origins:
                train = history[history.year <= origin]
                forecast = _forecast_model(name, train, horizon_years)
                target_year = origin + horizon_years
                model_rows.append({"model": name, "origin_year": origin,
                                   "target_year": target_year,
                                   "horizon_years": horizon_years,
                                   "actual_mxn_t": float(actuals[target_year]),
                                   "predicted_mxn_t": float(forecast[-1])})
        except (ValueError, ArithmeticError, RuntimeError, np.linalg.LinAlgError) as error:
            failures.append({"model": name, "error": str(error)})
            continue
        predictions.extend(model_rows)
    backtest = pd.DataFrame(predictions)
    if backtest.empty:
        raise ValueError(f"All models failed: {failures}")
    counts = backtest.groupby("model").size()
    if counts.nunique() != 1:
        raise ValueError("Models were not evaluated on the same number of holdouts")
    backtest["absolute_error_mxn_t"] = (backtest.predicted_mxn_t - backtest.actual_mxn_t).abs()
    leaderboard = backtest.groupby("model", as_index=False).agg(
        mae_mxn_t=("absolute_error_mxn_t", "mean"),
        holdout_points=("absolute_error_mxn_t", "size"),
        backtest_origins=("origin_year", "nunique"),
    ).sort_values(["mae_mxn_t", "model"]).reset_index(drop=True)
    return backtest, leaderboard, pd.DataFrame(failures, columns=["model", "error"])


def forecast_harvest_prices(
    histories: Mapping[str, pd.DataFrame], leaderboards: Mapping[str, pd.DataFrame],
    harvests: pd.DataFrame, *, last_siap_year: int,
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Forecast annual prices through the last crop harvest and join each date."""
    annual = []
    for crop, history in histories.items():
        board = leaderboards[crop]
        if board.empty:
            raise ValueError(f"No successful model for {crop}")
        name = str(board.iloc[0].model)
        last_observed_year = int(history.year.max())
        latest_volume = (float(history.iloc[-1].production_t)
                         if "production_t" in history else float("nan"))
        crop_harvests = harvests[harvests.crop == crop]
        if crop_harvests.empty:
            raise ValueError(f"No planned harvest for {crop}")
        last_harvest_year = int(crop_harvests.forecast_year.max())
        forecast = _forecast_model(name, history, last_harvest_year - last_observed_year)
        for step, price in enumerate(forecast, start=1):
            forecast_year = last_observed_year + step
            if forecast_year <= last_siap_year:
                continue
            annual.append({"crop": crop, "forecast_year": forecast_year,
                           "estimated_price_mxn_t": float(price),
                           "scope": str(history.scope.iloc[0]), "model": name,
                           "last_siap_year": last_siap_year,
                           "last_observed_year": last_observed_year,
                           "last_production_t": latest_volume,
                           "forecast_step_years": step})
    annual_df = pd.DataFrame(annual)
    harvest_prices = harvests.merge(
        annual_df, on=["crop", "forecast_year"], how="left", validate="many_to_one"
    )
    if harvest_prices.estimated_price_mxn_t.isna().any():
        raise ValueError("A selected harvest has no price forecast")
    return annual_df, harvest_prices


def add_prices_to_calibrated_wofost(
    calibrated: pd.DataFrame, harvest_prices: pd.DataFrame,
) -> pd.DataFrame:
    """Join prices to calibrated yields and calculate nominal gross crop value.

    Supply ``estimated_tonnes`` directly, or both ``calibrated_t_ha`` and
    ``area_ha``. This is gross value, before costs, losses, and moisture basis
    adjustments; it is not a profit forecast.
    """
    if not {"crop", "harvest_date"}.issubset(calibrated):
        raise ValueError("Calibrated WOFOST output needs crop and harvest_date")
    if not {"crop", "harvest_date", "estimated_price_mxn_t"}.issubset(harvest_prices):
        raise ValueError("Harvest prices need crop, harvest_date, and estimated_price_mxn_t")
    if harvest_prices.duplicated(["crop", "harvest_date"]).any():
        raise ValueError("Harvest prices must be unique per crop and date")
    result = calibrated.copy()
    result["harvest_date"] = pd.to_datetime(result.harvest_date).dt.normalize()
    prices = harvest_prices.copy()
    prices["harvest_date"] = pd.to_datetime(prices.harvest_date).dt.normalize()
    price_columns = ["crop", "harvest_date", "estimated_price_mxn_t"]
    price_columns += [name for name in (
        "scope", "model", "months_ahead", "last_siap_year", "last_observed_year",
        "last_production_t", "forecast_step_years",
    ) if name in prices]
    result = result.merge(
        prices[price_columns],
        on=["crop", "harvest_date"], how="left", validate="many_to_one"
    )
    if result.estimated_price_mxn_t.isna().any():
        raise ValueError("Calibrated WOFOST output has crop/harvest dates without prices")
    prices_numeric = pd.to_numeric(result.estimated_price_mxn_t, errors="raise")
    if not prices_numeric.map(isfinite).all() or (prices_numeric <= 0).any():
        raise ValueError("Forecast prices must be positive and finite")
    result["estimated_price_mxn_t"] = prices_numeric
    if "estimated_tonnes" in result:
        tonnes = pd.to_numeric(result.estimated_tonnes, errors="raise")
    elif {"calibrated_t_ha", "area_ha"}.issubset(result):
        yield_t_ha = pd.to_numeric(result.calibrated_t_ha, errors="raise")
        area_ha = pd.to_numeric(result.area_ha, errors="raise")
        if area_ha.isna().any() or (area_ha <= 0).any():
            raise ValueError("area_ha must be positive")
        tonnes = yield_t_ha * area_ha
    else:
        raise ValueError("Supply estimated_tonnes or calibrated_t_ha plus area_ha")
    if tonnes.isna().any() or not tonnes.map(isfinite).all() or (tonnes < 0).any():
        raise ValueError("Estimated tonnes must be finite and nonnegative")
    result["estimated_tonnes"] = tonnes
    result["estimated_gross_value_mxn"] = tonnes * result.estimated_price_mxn_t
    return result
