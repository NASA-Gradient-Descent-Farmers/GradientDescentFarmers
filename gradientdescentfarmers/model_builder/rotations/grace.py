"""Long-term water-storage change per municipality and district from NASA GRACE and GRACE-FO.

What it measures: the two satellite pairs weigh changes in the *total* water stored on and under the land
(groundwater + soil moisture + surface water + snow), as centimetres of equivalent water height, monthly
since April 2002. What it cannot do: tell those stores apart, or see anything smaller than roughly
300 km across. A farmer's well, an aquifer or a single irrigation district are below that resolution, so
the number describes the region around the place, never the place itself.

Product: NASA GSFC mascons RL06v2.0 (Loomis, Luthcke & Sabaka 2019, J. Geodesy 93:1381-1398), 41,168
equal-area 1-arc-degree mascons (~12,400 km2 each), no login needed:
https://earth.gsfc.nasa.gov/geo/data/grace-mascons

    Panel tables: grace_municipal, grace_district, grace_years (source_builder.district.grace).

Tables (data/rotations/, exported to data/shared/ with the `rotations_` prefix):
  grace_municipal  one row per municipality: its mascon and that mascon's trend
  grace_district   district means (unweighted over the district's municipalities; a mascon covers many)
  grace_years      mascon x year mean anomaly, for the chart

Trend: least squares on the monthly series with an annual and a semi-annual cycle, so a record that starts
in a wet month and ends in a dry one does not fake a trend. The standard error is widened for the
month-to-month memory of the residuals (lag-1 autocorrelation). The product's own leakage-trend estimate
(signal that bleeds in from neighbouring mascons) is added to it in quadrature, and a trend is called clear
only when it exceeds 1.64 times that combined error. GRACE ended in October 2017 and GRACE-FO started in
June 2018: those 11 months have no data.

What "clear" does not mean: a 24-year record that ends in several dry years (2020-2025 in much of Mexico)
shows a decline even where aquifers are stable, because soil moisture and reservoirs are part of what
GRACE weighs. The farmer-facing text says so every time a decline is reported.
"""

import numpy as np

from . import panel

RECENT_FROM = 2015.0
CLEAR_Z = 1.64                 # a trend is called clear when |trend| > 1.64 x its combined error (90%)


def storage(state_id, ddr, mun_id=None):
    """Water-storage summary for a municipality (if given and present) or a district; None without the tables."""
    try:
        municipal, district, yearly = (panel.read(n) for n in ("grace_municipal", "grace_district", "grace_years"))
    except FileNotFoundError:
        return None
    row = None
    if mun_id is not None:
        hit = municipal[(municipal.state_id == state_id) & (municipal.mun_id == mun_id)]
        row = hit.iloc[0] if len(hit) else None
    if row is None:
        hit = district[(district.state_id == state_id) & (district.ddr == ddr)]
        if hit.empty:
            return None
        row = hit.iloc[0]
    series = yearly[(yearly["mascon"] == int(row["mascon"])) & (yearly["months"] >= 6)].sort_values("year")
    # The fit's error and the product's leakage-trend estimate are combined: a trend has to stand clear of both.
    leak = abs(float(row["leakage_trend_cm_yr"]))
    clear = lambda slope, se: bool(np.isfinite(se) and abs(slope) > CLEAR_Z * np.hypot(se, leak))
    return {
        "tendencia_cm_año": round(float(row["trend_cm_yr"]), 2),
        "error_estandar": round(float(np.hypot(row["trend_se"], leak)), 2),
        "clara": clear(row["trend_cm_yr"], row["trend_se"]),
        "tendencia_reciente_cm_año": round(float(row["trend_recent_cm_yr"]), 2),
        "reciente_clara": clear(row["trend_recent_cm_yr"], row["trend_recent_se"]),
        "reciente_desde": int(RECENT_FROM),
        "cambio_cm": round(float(row["change_cm"]), 1),
        "fuga_tendencia_cm_año": round(float(row["leakage_trend_cm_yr"]), 2),
        "posicion_nacional": round(float(row["rank_national"]), 2),
        "periodo": [int(row["first_year"]), int(row["last_year"])],
        "serie": [{"año": int(r.year), "cm": round(float(r.cm), 1)} for r in series.itertuples()],
    }


def lines(summary, water):
    """Spanish sentences for the place description. Says what GRACE can and cannot tell."""
    if not summary:
        return []
    a, b = summary["periodo"]
    slope, total = summary["tendencia_cm_año"], summary["cambio_cm"]
    scope = ("GRACE ve regiones de unos 300 km: suma agua subterránea, humedad del suelo y agua superficial. "
             "No ve tu pozo ni tu acuífero.")
    if not summary["clara"]:
        return [f"Agua almacenada en tu región (satélites GRACE/GRACE-FO, NASA, {a}-{b}): sin tendencia clara "
                f"({slope:+.1f} cm por año, dentro del margen de error). {scope}"]
    word = "bajó" if slope < 0 else "subió"
    out = [f"Agua almacenada en tu región (satélites GRACE/GRACE-FO, NASA): {word} unos {abs(slope):.1f} cm por año "
           f"entre {a} y {b} (≈{abs(total):.0f} cm de lámina de agua {'menos' if total < 0 else 'más'} que al inicio). {scope}"]
    if slope < 0:
        out.append("Parte de esa baja puede venir de los años secos recientes (menos humedad en el suelo y presas "
                   "más bajas), no solo de los acuíferos: GRACE no los distingue.")
        share = summary["posicion_nacional"]
        if share <= 0.25:
            out.append("Es de las regiones de México donde más ha bajado (cuarta parte con mayor descenso).")
        if water == "riego":
            out.append("Si riegas con pozo, pregunta en tu módulo o en CONAGUA cómo está tu acuífero y cuánto ha bajado "
                       "el nivel: eso pesa al elegir cultivos que piden mucha agua.")
    return out
