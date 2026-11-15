"""Summarize point SoilGrids observations for a compact phase output."""

from __future__ import annotations

import pandas as pd


DEPTHS_CM = {"0-5cm": 5, "5-15cm": 10, "15-30cm": 15}
PROPERTY_UNITS = {"nitrogen": "g/kg", "soc": "g/kg", "bdod": "kg/dm3", "phh2o": "pH"}
SOIL_COLUMNS = (
    "soil_total_n_0_30cm_g_kg", "soil_organic_carbon_0_30cm_g_kg",
    "soil_ph_0_5cm", "soil_context_source",
)


def summarize_soil_context(frame: pd.DataFrame | None) -> dict[str, float | str | None]:
    """Return observed soil properties, mass-weighted over the upper 30 cm.

    SoilGrids total N is not plant-available mineral N. Missing observations
    stay missing; the profile's sparse SMAP series is not used here.
    """
    result: dict[str, float | str | None] = {column: None for column in SOIL_COLUMNS}
    result["soil_context_source"] = "unavailable"
    if frame is None or frame.empty:
        return result
    required = {"property", "depth", "value", "unit"}
    if not required.issubset(frame):
        raise ValueError(f"soil_properties_raw is missing columns: {sorted(required - set(frame))}")
    data = frame.copy()
    data["property"] = data["property"].astype(str).str.lower()
    data["depth"] = data["depth"].astype(str).str.replace(" ", "", regex=False)
    data = data[data.property.isin(PROPERTY_UNITS) & data.depth.isin(DEPTHS_CM)]
    if data.empty:
        return result
    for row in data.itertuples():
        if row.unit != PROPERTY_UNITS[row.property]:
            raise ValueError(f"Unexpected SoilGrids unit for {row.property}: {row.unit}")
    if data.duplicated(["property", "depth"]).any():
        raise ValueError("soil_properties_raw has ambiguous property/depth duplicates")
    data["value"] = pd.to_numeric(data.value, errors="raise")
    data = data.set_index(["property", "depth"])

    def observed(property_name: str, depth: str) -> float | None:
        key = (property_name, depth)
        if key not in data.index:
            return None
        value = data.loc[key, "value"]
        return float(value) if pd.notna(value) else None

    bulk_density = [observed("bdod", depth) for depth in DEPTHS_CM]
    if all(value is not None and value > 0 for value in bulk_density):
        weights = [thickness * density for thickness, density in
                   zip(DEPTHS_CM.values(), bulk_density)]
        for property_name, column in (
            ("nitrogen", "soil_total_n_0_30cm_g_kg"),
            ("soc", "soil_organic_carbon_0_30cm_g_kg"),
        ):
            values = [observed(property_name, depth) for depth in DEPTHS_CM]
            if all(value is not None for value in values):
                result[column] = sum(value * weight for value, weight in
                                     zip(values, weights)) / sum(weights)
    result["soil_ph_0_5cm"] = observed("phh2o", "0-5cm")
    result["soil_context_source"] = "SoilGrids_profile"
    return result
