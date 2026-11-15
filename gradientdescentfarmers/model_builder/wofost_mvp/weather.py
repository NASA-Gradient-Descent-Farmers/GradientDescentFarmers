"""FarmProfile weather -> PCSE units and a real WeatherDataProvider."""
from __future__ import annotations

import math
from pathlib import Path

import numpy as np
import pandas as pd


def vapour_pressure_hpa(tmin: float, tmax: float, relative_humidity: float) -> float:
    """FAO-56 Eq. 19 approximation when only daily mean RH is available."""
    def saturated(temperature):
        return 6.108 * math.exp(17.27 * temperature / (temperature + 237.3))
    return relative_humidity / 100 * (saturated(tmin) + saturated(tmax)) / 2


def prepare_weather(frame: pd.DataFrame, latitude: float, longitude: float,
                    elevation_m: float, destination: Path | None = None):
    from pcse.base import WeatherDataProvider, WeatherDataContainer
    from pcse.util import reference_ET

    class ProfileWeatherProvider(WeatherDataProvider):
        pass

    required = ["date", "tmin_c", "tmax_c", "precip_mm", "solar_mj_m2_day", "rh_pct", "wind_m_s"]
    if not set(required).issubset(frame.columns):
        raise ValueError("FarmProfile weather_daily misses required PCSE inputs")
    daily = frame[required].copy()
    daily["date"] = pd.to_datetime(daily["date"], utc=True, errors="raise").dt.date
    daily = daily.sort_values("date").reset_index(drop=True)
    if daily.empty or daily["date"].duplicated().any():
        raise ValueError("Weather is empty or contains duplicate dates")
    expected = pd.date_range(daily.date.iloc[0], daily.date.iloc[-1]).date
    if list(expected) != list(daily.date):
        raise ValueError("Weather has missing days; no interpolation is performed")
    values = daily[required[1:]].to_numpy(dtype=float)
    if not np.isfinite(values).all():
        raise ValueError("Weather contains missing/nonfinite values")
    if ((daily.tmin_c > daily.tmax_c).any() or (daily.precip_mm < 0).any()
            or (daily.solar_mj_m2_day < 0).any() or (daily.wind_m_s < 0).any()
            or (~daily.rh_pct.between(0, 100)).any()):
        raise ValueError("Weather fails physical range checks")
    provider = ProfileWeatherProvider()
    provider.latitude, provider.longitude, provider.elevation = latitude, longitude, elevation_m
    provider.description = ["FarmProfile POWER daily weather; VAP derived from mean RH, FAO-56 Eq.19"]
    provider.angstA, provider.angstB = 0.29, 0.49
    provider.ETmodel = "PM"
    records = []
    for row in daily.itertuples(index=False):
        record = {"DAY": row.date, "LAT": latitude, "LON": longitude, "ELEV": elevation_m,
                  "TMIN": row.tmin_c, "TMAX": row.tmax_c,
                  "RAIN": row.precip_mm / 10, "IRRAD": row.solar_mj_m2_day * 1e6,
                  "WIND": row.wind_m_s, "VAP": vapour_pressure_hpa(row.tmin_c, row.tmax_c, row.rh_pct)}
        e0, es0, et0 = reference_ET(**record, ANGSTA=0.29, ANGSTB=0.49, ETMODEL="PM")
        record.update(E0=e0 / 10, ES0=es0 / 10, ET0=et0 / 10)
        provider._store_WeatherDataContainer(WeatherDataContainer(**record), row.date)
        records.append(record)
    standardized = pd.DataFrame(records)
    if destination is not None:
        destination.parent.mkdir(parents=True, exist_ok=True)
        standardized.to_csv(destination, index=False)
    return provider, standardized
