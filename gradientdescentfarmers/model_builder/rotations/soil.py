"""Local soil information: what global soil maps say about the municipality, and what the farmer says.

Two sources, kept apart:

1. Maps (context only). GLDAS / Noah soil texture class and sand-silt-clay fractions on a 0.25 degree grid
   (~28 km), and the IGBP-DIS available water capacity and soil carbon of the top metre on a 5 arc-minute grid
   (~9 km; ORNL DAAC, doi:10.3334/ORNLDAAC/569). Both were sampled at each municipality's centre for the
   yield panel (src/yield_panel/enrich.py), which is where this module reads them. A cell that size mixes many
   soils, so the map describes the area, never a field, and it does not enter any calculation.

2. The farmer (used). "arenoso", "franco" or "arcilloso" sets how much water a metre of soil can hold for
   plants, which the water balance uses for crops sown on residual moisture. Without an answer the tool
   assumes a loam and says so.

    Panel table: soil_municipal (source_builder.district.soil).
"""

import numpy as np

from . import panel

# Plant-available water per metre of soil, mm. Checked on 15 Nov 2026 against FAO-56 (Allen et al. 1998) Table 19
# (field capacity and wilting point ranges, p. 300): the difference of the range midpoints is ~75 mm/m for sand,
# ~120 for sandy loam and ~130 for loam, and ~140 for clay (clay's range reaches 200). "arenoso" 70 and "franco" 120
# sit at those midpoints; "arcilloso" 170 is inside clay's range but above its midpoint. Used only for crops sown on
# residual moisture.
AVAILABLE_WATER = {"arenoso": 70.0, "franco": 120.0, "arcilloso": 170.0}
LABELS = {"arenoso": "arenoso (suelto, se seca pronto)", "franco": "franco (ni suelto ni pesado)",
          "arcilloso": "arcilloso (pesado, guarda humedad)"}
# Noah / FAO texture classes used by GLDAS -> Spanish name and the farmer's word closest to it.
TEXTURES = {1: ("arena", "arenoso"), 2: ("arena franca", "arenoso"), 3: ("franco arenoso", "arenoso"),
            4: ("franco limoso", "franco"), 5: ("limo", "franco"), 6: ("franco", "franco"),
            7: ("franco arcillo-arenoso", "franco"), 8: ("franco arcillo-limoso", "arcilloso"),
            9: ("franco arcilloso", "arcilloso"), 10: ("arcilla arenosa", "arcilloso"),
            11: ("arcilla limosa", "arcilloso"), 12: ("arcilla", "arcilloso")}
COLUMNS = ["texture_class", "sand", "silt", "clay", "profile_available_water_capacity", "soil_carbon_density"]


def from_maps(state_id, mun_id=None, mun_ids=()):
    """Map soil for a municipality, or the most common texture and the mean values over a district's municipalities."""
    try:
        soil = panel.read("soil_municipal")
    except FileNotFoundError:
        return None
    rows = soil[(soil["state_id"] == state_id) & soil["mun_id"].isin([mun_id] if mun_id is not None else list(mun_ids))]
    if rows.empty:
        return None
    textures = rows["texture_class"].dropna()
    if textures.empty:
        return None
    texture = int(textures.mode().iloc[0])
    if texture not in TEXTURES or not all(panel.finite(rows[c].mean()) for c in ("sand", "silt", "clay")):
        return None
    name, group = TEXTURES[texture]
    # Each value is averaged over the municipalities that have it; a map value that is missing (IGBP-DIS needs
    # an Earthdata login, and has no data over water or cities) is left out rather than guessed.
    mean = rows[["sand", "silt", "clay", "profile_available_water_capacity", "soil_carbon_density"]].mean()
    water, carbon = mean["profile_available_water_capacity"], mean["soil_carbon_density"]
    return {"textura": name, "parecido_a": group, "arena_pct": round(100 * float(mean["sand"])),
            "limo_pct": round(100 * float(mean["silt"])), "arcilla_pct": round(100 * float(mean["clay"])),
            "agua_disponible_mapa_mm": round(float(water)) if panel.finite(water) else None,
            "carbono_kg_m2": round(float(carbon), 1) if panel.finite(carbon) else None, "municipios": int(len(rows)),
            "fuente": "GLDAS/Noah (textura, celdas de unos 28 km)" + (
                " e IGBP-DIS (agua y carbono del primer metro, celdas de unos 9 km)" if panel.finite(water) else "")}


def summary(place, chosen=None):
    """What is known about the soil and what the water balance uses. `chosen` is the farmer's answer or None."""
    if chosen is not None and chosen not in AVAILABLE_WATER:
        raise ValueError(f"suelo debe ser uno de {sorted(AVAILABLE_WATER)}")
    maps = from_maps(place.state_id, place.mun_id, place.mun_ids)
    used = chosen or "franco"
    lines = []
    if maps:
        lines.append(f"Suelo de tu zona según mapas mundiales: {maps['textura']} (arena {maps['arena_pct']}%, limo "
                     f"{maps['limo_pct']}%, arcilla {maps['arcilla_pct']}%). Son cuadros de 9 a 28 km: describen la "
                     "zona, no tu parcela, y no entran en los cálculos.")
    if chosen:
        lines.append(f"Suelo que nos dijiste: {LABELS[chosen]}. Con eso se calcula el agua que guarda el suelo para un "
                     f"cultivo sembrado con humedad residual (unos {AVAILABLE_WATER[chosen]:.0f} mm por metro de suelo)."
                     .replace("metre", "metro"))
        if maps and maps["parecido_a"] != chosen:
            lines.append(f"Tu respuesta no coincide con el mapa ({maps['textura']}). Vale la tuya: tú conoces tu parcela.")
    else:
        lines.append("No nos dijiste cómo es tu suelo: se supuso un suelo franco (unos 120 mm de agua aprovechable por "
                     "metro). Si es arenoso o arcilloso, dilo: cambia el agua para cultivos de humedad residual. Un "
                     "análisis de suelo dice más que cualquier mapa.")
    return {"mapa": maps, "dicho_por_el_agricultor": chosen, "usado": used, "agua_aprovechable_mm_m": AVAILABLE_WATER[used],
            "tipo_mapa": "observado (mapas mundiales, solo contexto)",
            "tipo_usado": "dato del agricultor" if chosen else "supuesto", "lineas": lines}
