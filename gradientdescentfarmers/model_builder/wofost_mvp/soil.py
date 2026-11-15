"""Explicit pedotransfer estimates, never presented as measured soil hydraulics."""
from __future__ import annotations

import math
import pandas as pd

from .settings import ModelSettings


def hydraulic_parameters(sand_fraction: float, clay_fraction: float,
                         organic_matter_pct: float, bulk_density_g_cm3: float) -> dict:
    s, c, om, bd = sand_fraction, clay_fraction, organic_matter_pct, bulk_density_g_cm3
    if not all(math.isfinite(x) for x in (s, c, om, bd)):
        raise ValueError("nonfinite soil inputs")
    if not (0 <= s <= 1 and 0 <= c <= 1 and s + c <= 1.05 and 0 <= om <= 20 and 0.5 <= bd <= 2.2):
        raise ValueError("Soil outside supported pedotransfer domain")
    # Saxton & Rawls (2006), Table 1: S,C mass fractions; OM percent by mass.
    wp_t = -0.024*s + 0.487*c + 0.006*om + 0.005*s*om - 0.013*c*om + 0.068*s*c + 0.031
    wp = wp_t + 0.14*wp_t - 0.02
    fc_t = -0.251*s + 0.195*c + 0.011*om + 0.006*s*om - 0.027*c*om + 0.452*s*c + 0.299
    fc = fc_t + 1.283*fc_t**2 - 0.374*fc_t - 0.015
    saturation = 1 - bd / 2.65  # mineral particle density is an assumption
    if not 0 < wp < fc < saturation < 0.8:
        raise ValueError("Pedotransfer produced inconsistent water limits; provide soil measurements")
    return {"SMW": wp, "SMFCF": fc, "SM0": saturation}


def prepare_soil(frame: pd.DataFrame, settings: ModelSettings):
    thickness = {"0-5cm": 5, "5-15cm": 10, "15-30cm": 15}
    def weighted(prop):
        subset = frame[(frame.property == prop) & frame.depth.isin(thickness)].copy()
        if set(subset.depth) != set(thickness) or len(subset) != 3:
            raise ValueError(f"Need three valid SoilGrids depths for {prop}")
        if subset.value.isna().any():
            raise ValueError(f"SoilGrids {prop} has missing values")
        return sum(float(row.value) * thickness[row.depth] for row in subset.itertuples()) / 30
    # Source_builder already converts texture to percent and retention to vol%.
    inputs = {"sand_fraction": weighted("sand") / 100,
              "clay_fraction": weighted("clay") / 100,
              "organic_matter_pct": weighted("soc") * 0.1724,
              "bulk_density_g_cm3": weighted("bdod")}
    retention = {"wv0033", "wv1500"}.issubset(set(frame.property))
    if retention:
        parameters = {"SMW": weighted("wv1500") / 100,
                      "SMFCF": weighted("wv0033") / 100,
                      "SM0": 1 - inputs["bulk_density_g_cm3"] / 2.65}
        if not 0 < parameters["SMW"] < parameters["SMFCF"] < parameters["SM0"] < 0.8:
            raise ValueError("Inconsistent SoilGrids water retention; provide soil measurements")
    else:
        parameters = hydraulic_parameters(**inputs)
    parameters.update(CRAIRC=0.06, SOPE=settings.soil_percolation_cm_day,
                      KSUB=settings.subsoil_drainage_cm_day, RDMSOL=settings.rootable_depth_cm)
    available = (parameters["SMFCF"] - parameters["SMW"]) * settings.rootable_depth_cm
    site = {"WAV": available * settings.initial_available_water_fraction,
            "SMLIM": parameters["SMFCF"], "IFUNRN": 0, "NOTINF": 0., "SSI": 0., "SSMAX": 0.}
    return {"parameters": parameters, "site": site, "inputs": inputs,
            "method": ("SoilGrids wv0033/wv1500 water retention; saturation from bulk density"
                       if retention else "Saxton-Rawls-2006 topsoil PTF; saturation from bulk density"),
            "source": ("https://www.isric.org/explore/soilgrids" if retention
                       else "https://www.atmos.illinois.edu/~sshu3/model/saxton2006.pdf"),
            "assumptions": ["0–30 cm texture extrapolated to assumed rootable depth",
                            "Rootable depth, drainage, initial water and particle density are not measured",
                            "Salinity, groundwater, compaction and nutrients are not calibrated"],
            "field_validated": False}
