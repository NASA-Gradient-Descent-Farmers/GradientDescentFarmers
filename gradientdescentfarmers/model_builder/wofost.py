"""Experimental WOFOST 8.1 potential and water-limited crop scenarios."""

from __future__ import annotations

from datetime import date
from math import exp, isfinite
from typing import Any, Mapping, Sequence

import pandas as pd


CATALOG_URL = "https://raw.githubusercontent.com/ajwdewit/WOFOST_crop_parameters/wofost81/crops.yaml"
SUPPORTED_CROPS = (
    "barley", "cassava", "chickpea", "cotton", "cowpea", "fababean",
    "groundnut", "maize", "mungbean", "pigeonpea", "potato", "rapeseed",
    "rice", "soybean", "sugarbeet", "sunflower", "sweetpotato", "tobacco",
    "wheat", "seed_onion",
)
WEATHER_COLUMNS = (
    "date", "tmin_c", "tmax_c", "precip_mm", "rh_pct", "wind_m_s", "solar_mj_m2_day"
)
SOIL_KEYS = ("SMW", "SMFCF", "SM0", "RDMSOL", "CRAIRC", "SOPE", "KSUB", "K0")


def available_crop_varieties(crop_data: Any) -> dict[str, list[str]]:
    """Expose crop and variety choices from the selected PCSE provider."""
    catalog = crop_data.get_crops_varieties()
    return {crop: sorted(catalog[crop]) for crop in SUPPORTED_CROPS if crop in catalog}


def _water_inputs(
    mode: str, start: date, end: date, soil: Mapping[str, float] | None,
    initial_water_cm: float | None, system: str | None,
    events: Sequence[Mapping[str, Any]] | None,
) -> tuple[dict[str, float] | None, list[dict[date, dict[str, float]]]]:
    if mode not in ("potential", "rainfed", "irrigated"):
        raise ValueError("water_mode must be potential, rainfed, or irrigated")
    events = list(events or [])
    if mode == "potential":
        if soil is not None or initial_water_cm is not None or system or events:
            raise ValueError("Water inputs require rainfed or irrigated WLP mode")
        return None, []
    if soil is None or initial_water_cm is None:
        raise ValueError("WLP requires soil_parameters and initial_available_water_cm")
    missing = set(SOIL_KEYS) - set(soil)
    if missing:
        raise ValueError(f"Missing WLP soil parameters: {sorted(missing)}")
    values = {}
    for key in SOIL_KEYS:
        try:
            values[key] = float(soil[key])
        except (TypeError, ValueError) as error:
            raise ValueError(f"WLP soil parameter {key} must be numeric") from error
    if not all(isfinite(value) for value in values.values()):
        raise ValueError("WLP soil parameters must be finite")
    if not (0 <= values["SMW"] < values["SMFCF"] < values["SM0"] <= 1):
        raise ValueError("Soil moisture must satisfy SMW < SMFCF < SM0")
    if not (0 < values["CRAIRC"] < 1):
        raise ValueError("CRAIRC must be a fraction between 0 and 1")
    if any(values[key] <= 0 for key in ("RDMSOL", "SOPE", "KSUB", "K0")):
        raise ValueError("Soil depth and conductivity/percolation values must be positive")
    try:
        water = float(initial_water_cm)
    except (TypeError, ValueError) as error:
        raise ValueError("initial_available_water_cm must be numeric") from error
    if not isfinite(water) or water < 0:
        raise ValueError("initial_available_water_cm must be nonnegative and finite")
    if mode == "rainfed":
        if system or events:
            raise ValueError("Rainfed mode cannot include an irrigation system or events")
        return values, []
    if not isinstance(system, str) or not system.strip() or not events:
        raise ValueError("Irrigated mode requires irrigation_system and irrigation_events")
    normalized = []
    used_dates = set()
    for event in events:
        if not all(key in event for key in ("date", "amount_mm", "efficiency")):
            raise ValueError("Each irrigation event needs date, amount_mm, and efficiency")
        day = pd.Timestamp(event["date"]).date()
        try:
            amount = float(event["amount_mm"])
            efficiency = float(event["efficiency"])
        except (TypeError, ValueError) as error:
            raise ValueError("Irrigation amount_mm and efficiency must be numeric") from error
        if not start <= day <= end or day in used_dates:
            raise ValueError("Irrigation dates must be unique and within the season")
        if not isfinite(amount) or amount <= 0 or not isfinite(efficiency) or not 0 < efficiency <= 1:
            raise ValueError("Irrigation amount must be positive and efficiency in (0, 1]")
        used_dates.add(day)
        normalized.append({day: {"amount": amount / 10, "efficiency": efficiency}})
    return values, sorted(normalized, key=lambda item: next(iter(item)))


def validate_weather(weather: pd.DataFrame, start: date, end: date) -> pd.DataFrame:
    """Reject missing dates, impossible inputs, or incomplete simulation windows."""
    missing = set(WEATHER_COLUMNS) - set(weather.columns)
    if missing:
        raise ValueError(f"Missing weather columns: {sorted(missing)}")
    data = weather.copy()
    data["date"] = pd.to_datetime(data["date"], errors="raise").dt.date
    if data["date"].duplicated().any():
        raise ValueError("Duplicate weather dates")
    data = data.sort_values("date")
    expected = set(pd.date_range(start, end).date)
    if not expected.issubset(set(data["date"])):
        raise ValueError("Weather does not cover every simulation day")
    data = data[data["date"].isin(expected)].copy()
    for column in WEATHER_COLUMNS[1:]:
        data[column] = pd.to_numeric(data[column], errors="raise")
        if not data[column].map(isfinite).all():
            raise ValueError(f"Non-finite weather value in {column}")
    if (data.tmin_c > data.tmax_c).any():
        raise ValueError("tmin_c exceeds tmax_c")
    if (data.precip_mm < 0).any() or (data.solar_mj_m2_day < 0).any():
        raise ValueError("Negative rain or radiation")
    if not data.rh_pct.between(0, 100).all() or (data.wind_m_s < 0).any():
        raise ValueError("Invalid humidity or wind")
    return data.reset_index(drop=True)


def weather_provider(weather: pd.DataFrame, latitude: float, longitude: float,
                     elevation_m: float, start: date, end: date) -> Any:
    """Convert SourceBuilder units and derive vapor pressure and reference ET."""
    from pcse.base import WeatherDataContainer, WeatherDataProvider
    from pcse.util import reference_ET

    if not all(isfinite(float(x)) for x in (latitude, longitude, elevation_m)):
        raise ValueError("Finite latitude, longitude, and elevation are required")
    data = validate_weather(weather, start, end)

    class DailyProvider(WeatherDataProvider):
        pass

    provider = DailyProvider()
    provider.latitude = latitude
    provider.longitude = longitude
    provider.elevation = elevation_m
    for row in data.itertuples(index=False):
        # Saturation vapor pressure (hPa) at mean air temperature, scaled by RH.
        tmean = (row.tmin_c + row.tmax_c) / 2
        vap = max(0.06, row.rh_pct / 100 * 6.108 * exp(17.27 * tmean / (tmean + 237.3)))
        irrad = row.solar_mj_m2_day * 1_000_000
        e0, es0, et0 = reference_ET(
            row.date, latitude, elevation_m, row.tmin_c, row.tmax_c,
            irrad, vap, row.wind_m_s, ANGSTA=0.29, ANGSTB=0.49,
        )
        container = WeatherDataContainer(
            DAY=row.date, LAT=latitude, LON=longitude, ELEV=elevation_m,
            TMIN=row.tmin_c, TMAX=row.tmax_c, TEMP=tmean,
            IRRAD=irrad, RAIN=row.precip_mm / 10, WIND=row.wind_m_s,
            VAP=vap, E0=e0 / 10, ES0=es0 / 10, ET0=et0 / 10,
        )
        provider._store_WeatherDataContainer(container, row.date)
    return provider


def run_wofost(
    weather: pd.DataFrame,
    *,
    crop: str,
    variety: str,
    sowing_date: str | date,
    end_date: str | date,
    latitude: float = 20.4243195,
    longitude: float = -101.1466639,
    elevation_m: float,
    co2_ppm: float = 420.0,
    crop_data: Any = None,
    run_id: str = "manual",
    water_mode: str = "potential",
    soil_parameters: Mapping[str, float] | None = None,
    initial_available_water_cm: float | None = None,
    irrigation_system: str | None = None,
    irrigation_events: Sequence[Mapping[str, Any]] | None = None,
) -> pd.DataFrame:
    """Run WOFOST PP or classic-water-balance WLP and return a daily DataFrame.

    PP assumes unlimited water. WLP requires explicit hydraulic soil inputs
    and initial water. Irrigated WLP also requires dated water applications;
    the system name is provenance, not a PCSE parameter.
    """
    from pcse.base import ParameterProvider
    from pcse.input import DummySoilDataProvider, WOFOST81SiteDataProvider_Classic, YAMLCropDataProvider
    from pcse.models import Wofost81_PP, Wofost81_WLP_CWB

    if crop not in SUPPORTED_CROPS:
        raise ValueError(f"Crop is absent from the WOFOST 8.1 catalog: {crop}")
    start = pd.Timestamp(sowing_date).date()
    end = pd.Timestamp(end_date).date()
    if end <= start or (end - start).days > 365:
        raise ValueError("end_date must follow sowing_date by at most 365 days")
    soil_values, timed_irrigation = _water_inputs(
        water_mode, start, end, soil_parameters, initial_available_water_cm,
        irrigation_system, irrigation_events,
    )
    model_class = Wofost81_PP if water_mode == "potential" else Wofost81_WLP_CWB
    provider = weather_provider(weather, latitude, longitude, elevation_m, start, end)
    crop_data = crop_data if crop_data is not None else YAMLCropDataProvider(model=model_class)
    crop_data.set_active_crop(crop, variety)
    soil_data = DummySoilDataProvider()
    if soil_values is not None:
        soil_data.update(soil_values)
    parameters = ParameterProvider(
        cropdata=crop_data,
        soildata=soil_data,
        sitedata=WOFOST81SiteDataProvider_Classic(
            WAV=10.0 if initial_available_water_cm is None else initial_available_water_cm,
            NAVAILI=10.0, CO2=co2_ppm,
        ),
    )
    agromanagement = [{start: {
        "CropCalendar": {
            "crop_name": crop, "variety_name": variety,
            "crop_start_date": start, "crop_start_type": "sowing",
            "crop_end_date": end, "crop_end_type": "harvest",
            "max_duration": min(365, (end - start).days + 1),
        },
        "TimedEvents": [{
            "event_signal": "irrigate",
            "name": f"{irrigation_system} irrigation",
            "comment": "Application depth in cm; field efficiency supplied per event",
            "events_table": timed_irrigation,
        }] if timed_irrigation else None,
        "StateEvents": None,
    }}]
    model = model_class(parameters, provider, agromanagement)
    model.run_till_terminate()
    result = pd.DataFrame(model.get_output())
    summary = model.get_summary_output()
    terminal = model.get_terminal_output() or {}
    if result.empty or not summary or summary[-1].get("TWSO") is None:
        raise ValueError("WOFOST returned no terminal TWSO summary")
    if len(summary) != 1:
        raise ValueError("Expected one WOFOST crop summary for a single-season run")
    result = result.rename(columns={"day": "date"})
    result["crop"] = crop
    result["variety"] = variety
    result["year"] = start.year
    result["run_id"] = run_id
    result["latitude"] = latitude
    result["longitude"] = longitude
    result["scenario"] = "experimental_PP" if water_mode == "potential" else "experimental_WLP"
    result["water_mode"] = water_mode
    result["irrigation_system"] = irrigation_system
    result["irrigation_applied_mm"] = sum(
        next(iter(event.values()))["amount"] * 10 for event in timed_irrigation
    )
    result["input_elevation_m"] = elevation_m
    result["input_co2_ppm"] = co2_ppm
    result["input_initial_available_water_cm"] = initial_available_water_cm
    result["input_site_NAVAILI_kg_ha"] = 10.0
    for name in SOIL_KEYS:
        result[f"input_soil_{name}"] = None if soil_values is None else soil_values[name]
    result["is_final_day"] = False
    result.loc[result.index[-1], "is_final_day"] = True
    # Preserve every variable exposed by the configured PCSE model. Summary
    # and terminal values belong to the season end, not to each daily step.
    for prefix, values in (("summary", summary[0]), ("terminal", terminal)):
        for name, value in values.items():
            result[f"{prefix}_{name}"] = pd.Series(
                [None] * (len(result) - 1) + [value], index=result.index
            )
    if "TWSO" not in result:
        result["TWSO"] = pd.NA
    result.loc[result.index[-1], "TWSO"] = float(summary[-1]["TWSO"])
    result["yield_t_ha"] = pd.NA
    result.loc[result.index[-1], "yield_t_ha"] = float(summary[-1]["TWSO"]) / 1000
    return result
