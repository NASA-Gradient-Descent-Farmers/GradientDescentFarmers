"""Explicit scenarios built only from tables in an immutable farm profile."""

from __future__ import annotations

import pandas as pd


def shift_profile_weather(weather: pd.DataFrame, *, years: int) -> pd.DataFrame:
    """Replay observed profile weather in later calendar years as an analog.

    This is a scenario, never a forecast or an observation in the target year.
    Leap days are omitted when their target year has no February 29.
    """
    if years <= 0 or "date" not in weather:
        raise ValueError("Supply profile weather with dates and a positive year shift")
    result = weather.copy()
    dates = pd.to_datetime(result.date, errors="raise").dt.normalize()
    if dates.isna().any() or dates.duplicated().any():
        raise ValueError("Profile weather dates must be present and unique")
    keep = []
    shifted = []
    for index, day in dates.items():
        try:
            target = day.replace(year=day.year + years)
        except ValueError:
            if day.month != 2 or day.day != 29:
                raise
            continue
        keep.append(index)
        shifted.append(target)
    result = result.loc[keep].copy().reset_index(drop=True)
    result["date"] = shifted
    expected = pd.date_range(result.date.min(), result.date.max(), freq="D")
    if len(result) != len(expected) or not result.date.equals(pd.Series(expected)):
        raise ValueError("Shifted profile weather is not a complete daily series")
    return result


def soilgrids_water_proxy(frame: pd.DataFrame) -> tuple[dict[str, float], float]:
    """Build an *exploratory* WLP soil scenario from point SoilGrids layers.

    SoilGrids water content at 33 and 1500 kPa and bulk density anchor three
    values. Particle density, conductivity, critical air, and initial water
    are explicit scenario assumptions, not observed farm measurements.
    """
    required = {"property", "depth", "value", "unit"}
    if not required.issubset(frame):
        raise ValueError(f"SoilGrids table lacks {sorted(required - set(frame))}")
    layers = (("0-5cm", 5), ("5-15cm", 10), ("15-30cm", 15))
    values = frame.set_index(["property", "depth"])

    def layer_mean(property_name: str, unit: str) -> float:
        total = 0.0
        for depth, thickness in layers:
            row = values.loc[(property_name, depth)]
            if isinstance(row, pd.DataFrame) or row["unit"] != unit:
                raise ValueError(f"Ambiguous SoilGrids {property_name}/{depth} or wrong unit")
            total += float(row["value"]) * thickness
        return total / 30.0

    smw = layer_mean("wv1500", "vol%") / 100.0
    smfcf = layer_mean("wv0033", "vol%") / 100.0
    bulk_density = layer_mean("bdod", "kg/dm3")
    sm0 = 1.0 - bulk_density / 2.65
    if not 0 < smw < smfcf < sm0 < 1:
        raise ValueError("SoilGrids proxy violates SMW < SMFCF < SM0")
    soil = {
        "SMW": smw, "SMFCF": smfcf, "SM0": sm0, "RDMSOL": 30.0,
        "CRAIRC": 0.06, "SOPE": 10.0, "KSUB": 10.0, "K0": 10.0,
    }
    initial_available_water_cm = (smfcf - smw) * soil["RDMSOL"]
    return soil, initial_available_water_cm
