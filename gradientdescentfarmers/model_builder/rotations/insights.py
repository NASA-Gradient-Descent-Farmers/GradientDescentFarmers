"""Checks and views added on top of the nine indicators, each one tied to a limit of the data.

| function | answers | kind |
|---|---|---|
| `adoption` | do many local farmers already grow this crop, or only a few plots? | observed (SIAP) |
| `bad_years` | how did this rotation do in the current rotation's worst years? | observed (SIAP + rain) |
| `scenario_grid` | how would the water indicator move with less rain or more heat? | scenario (model) |
| `precrop` | how large would the previous-crop effect have to be to matter? | literature assumption |
| `calendar` | which months is the field covered, and by what? | model (crop calendar) |

Observed data, model output and literature assumptions are kept in separate fields so the screen can label them.
"""

from dataclasses import replace

import numpy as np

from . import catalog
from .indicators import DAYS, MONTH_OF_DAY, income_series, plan_seasons, water_by_year

# --- 1. Adoption: is the crop's local record broad, or does it come from a few plots? ----------------

ADOPTION_MIN = 0.02       # a new crop sown on <2% of the reference crop's area: its numbers come from few plots


def adoption(place, evaluation, baseline):
    """How much of each crop is sown locally next to the farmer's main crop.

    SIAP yields for a crop come only from the fields where it is grown. When those are a small share of the
    district's farmland (e.g. 207 ha of rainfed winter chickpea against 150,000 ha of maize), they are likely
    the fields that suit it (residual moisture, a well, better soil), so their yield does not transfer to an
    average field. The year-bootstrap interval cannot show this: it measures year-to-year noise only.
    """
    base_items = [i for i in baseline["seasons"] if i["prod"]]
    base_crops = {part for i in base_items for part in i["prod"]}
    reference = max(((part, p["sown_ha"]) for i in base_items for part, p in i["prod"].items()
                     if p["level"] == "distrito"), key=lambda x: x[1], default=None)
    rows = []
    for item in evaluation["seasons"]:
        if not item["prod"]:
            continue
        for part, p in item["prod"].items():
            if part in base_crops:
                continue
            if p["level"] != "distrito" and item["season"].crop in catalog.COMPOSITES:
                continue            # milpa: its yields are already labelled as assumed, with the lowest evidence level
            if p["level"] != "distrito":
                # No usable record in the district: the numbers are the state's (or the nation's) average.
                rows.append({"cultivo": catalog.name(part), "clave": part, "nivel": p["level"], "pocas_parcelas": False,
                             "fuera_del_distrito": True})
                continue
            if reference is None:
                continue
            share = p["sown_ha"] / reference[1] if reference[1] > 0 else np.nan
            rows.append({"cultivo": catalog.name(part), "clave": part, "ha": round(p["sown_ha"]),
                         "referencia": catalog.name(reference[0]), "ha_referencia": round(reference[1]),
                         "proporcion": round(float(share), 4), "pocas_parcelas": bool(share < ADOPTION_MIN),
                         "fuera_del_distrito": False})
    seen, unique = set(), []
    for r in rows:
        if r["clave"] not in seen:
            seen.add(r["clave"])
            unique.append(r)
    return {"cultivos_nuevos": unique, "condicional": any(r["pocas_parcelas"] or r["fuera_del_distrito"] for r in unique)}


def adoption_lines(info, place=None):
    lines = []
    for r in info["cultivos_nuevos"]:
        if r["fuera_del_distrito"]:
            where = (f"el promedio de {place.state}" if place is not None and r["nivel"] == "estado"
                     else "el promedio del estado" if r["nivel"] == "estado" else "el promedio nacional")
            lines.append(
                f"{r['cultivo'].capitalize()} casi no tiene registro en tu distrito: su rendimiento e ingreso son {where}, "
                "donde el clima, el suelo y los compradores pueden ser otros. Tómalo como una idea para preguntar, no como "
                "lo que rendiría tu parcela.")
            continue
        if not r["pocas_parcelas"]:
            continue
        share = "menos de 0.1" if 100 * r["proporcion"] < 0.1 else f"{100 * r['proporcion']:.1f}"
        lines.append(
            f"{r['cultivo'].capitalize()} se siembra en unas {r['ha']:,} ha del distrito: {share}% de lo que se siembra de "
            f"{r['referencia']} (unas {r['ha_referencia']:,} ha). Su rendimiento e ingreso vienen de esas pocas parcelas, que "
            "pueden tener más humedad, riego de auxilio o mejor suelo que la tuya. Léelo como lo que logran quienes ya "
            "lo siembran, no como lo que rendiría tu parcela.")
    return lines


def adoption_rank(info):
    """0 = every new crop is grown at scale in the district, 1 = on few plots, 2 = not in the district."""
    return max([2 if r["fuera_del_distrito"] else int(r["pocas_parcelas"]) for r in info["cultivos_nuevos"]] or [0])


# --- 2. Bad years: how each option did in the current rotation's worst years -------------------------

N_BAD = 5
RAINY_MONTHS = range(5, 11)


def season_rain(place):
    """May-October rain by year (POWER corrected with CHIRPS), or None."""
    y = place.climate_years
    if y is None or y.empty:
        return None
    return y[y["month"].isin(RAINY_MONTHS)].groupby("year")["rain"].sum()


def relative_to_trend(series):
    """Each year's value divided by a straight-line fit through the series (1.0 = as expected that year).

    Yields drift over 23 years, so comparing a year with the plain average would mostly pick early or late
    years. When the fitted line is not positive everywhere, the plain mean is used.
    """
    s = series.dropna()
    x = s.index.to_numpy(float)
    fit = np.polyval(np.polyfit(x, s.to_numpy(float), 1), x) if len(s) >= 8 else np.full(len(s), s.mean())
    if (fit <= 0).any():
        fit = np.full(len(s), s.mean())
    return s / fit


def bad_years(place, evaluation, baseline):
    """The current rotation's worst years on record, and how this rotation did in those same years.

    Observed (SIAP), not modelled. "Worst" means lowest value of the harvest per sown hectare relative to
    the trend. Each of those years comes with its May-October rain as a share of the median, so the reader
    sees whether the bad years were dry years: often they were not, because failure depends on when it rains,
    on frost and on pests more than on the season's total. Five years is a small sample: it shows what
    happened, not a probability.
    """
    base, own = baseline["income_by_year"], evaluation["income_by_year"]
    if base is None or own is None or len(base) < 3 * N_BAD:
        return None
    base_rel = relative_to_trend(base)
    worst = sorted(base_rel.nsmallest(N_BAD).index)
    own_rel = relative_to_trend(own)
    shared = [y for y in worst if y in own_rel.index]
    if len(shared) < 3:
        return None
    rain = season_rain(place)
    wet = {}
    if rain is not None and rain.median() > 0:
        wet = {int(y): round(float(rain[y] / rain.median()), 2) for y in worst if y in rain.index}
    return {"años": [int(y) for y in worst], "lluvia_relativa": wet,
            "relativo": round(float(own_rel[shared].mean()), 2), "relativo_actual": round(float(base_rel[worst].mean()), 2),
            "años_con_dato": len(shared)}


def bad_line(info, is_current=False):
    if not info:
        return None
    years = ", ".join(str(y) for y in info["años"])
    wet = info["lluvia_relativa"]
    rain = ""
    if wet:
        lo, hi = min(wet.values()), max(wet.values())
        rain = f"; en ellos llovió entre {100 * lo:.0f}% y {100 * hi:.0f}% de lo normal de mayo a octubre"
    tail = " Son datos de SIAP de esos años, no un cálculo; con cinco años es una referencia, no una probabilidad."
    if is_current:
        return (f"Tus {N_BAD} peores años desde 2003 ({years}{rain}): la cosecha valió {100 * info['relativo_actual']:.0f}% de "
                "lo esperado para esos años." + tail)
    return (f"En los {N_BAD} peores años de tu rotación actual ({years}{rain}) esta rotación dio "
            f"{100 * info['relativo']:.0f}% de lo esperado; tu rotación actual, {100 * info['relativo_actual']:.0f}%." + tail)


# --- 3. Scenarios: the water indicator under less rain and more heat ---------------------------------

RAIN_STEPS = (-30, -20, -10, 0, 10)       # % change in every month's rain
TEMP_STEPS = (0.0, 1.0, 2.0, 3.0)         # °C added to every month


def et0_factor(tmean, delta_c):
    """ET0 multiplier for a warming of delta_c, from the Hargreaves-Samani (1985) temperature term (T + 17.8).

    About +2.5% per °C at 20 °C, close to FAO-56 Penman-Monteith at constant relative humidity. It ignores
    changes in humidity, wind and radiation, which the scenario does not specify.
    """
    return (np.asarray(tmean, float) + delta_c + 17.8) / (np.asarray(tmean, float) + 17.8)


def shifted(place, rain_pct=0.0, temp_c=0.0):
    """A copy of the place whose yearly rain is scaled and whose yearly ET0 follows a warming of temp_c.

    The monthly normals are left as they are, so the crop calendar (sowing date, cycle length) stays the one
    of today: the scenario asks "same crop, same dates, drier and hotter air". Letting the cycle shorten with
    heat would make a warmer scenario look better for water while hiding the yield lost to a shorter cycle.
    """
    years = place.climate_years
    if years is None or years.empty:
        return place
    c = place.climate.sort_values("month")
    k = et0_factor(((c["tmin"] + c["tmax"]) / 2).to_numpy(), temp_c)
    years = years.copy()
    years["rain"] *= 1 + rain_pct / 100
    years["et0"] *= k[years["month"].to_numpy() - 1]
    return replace(place, climate_years=years)


def water_value(place, rotation, seasons=None):
    """The water indicator as shown: share of need met by rain in a dry year (temporal), or mm of irrigation."""
    if seasons is None:
        seasons = [s for y in plan_seasons(place, rotation) for s in y]
    w = water_by_year(place, seasons)
    if place.water == "temporal":
        return float((1 - w["deficit"] / w["demand"].where(w["demand"] > 0)).quantile(0.2))
    return float((w["deficit"] / len(rotation)).median())


def scenario_grid(place, rotation):
    """Water indicator for every combination of RAIN_STEPS and TEMP_STEPS: rows = temperature, columns = rain.

    Labelled a scenario, not a forecast. Only water moves: income and risk stay at their SIAP history because
    our tests found no weather model that predicts yield better than each district's own record
    (src/yield_panel/README.md). Frost and heat-day counts also stay: they need daily data. The crop calendar
    is held at today's (see `shifted`).
    """
    seasons = [s for y in plan_seasons(place, rotation) for s in y]
    return {"lluvia_pct": list(RAIN_STEPS), "temp_c": list(TEMP_STEPS),
            "unidad": "proporcion_cubierta" if place.water == "temporal" else "mm_riego",
            "valores": [[round(water_value(shifted(place, r, t), rotation, seasons), 3) for r in RAIN_STEPS]
                        for t in TEMP_STEPS]}


# --- 4. Previous-crop effect: a labelled what-if with published ranges -------------------------------

# Yield gain of a crop grown after a legume, relative to the same crop after a non-legume. Looked up, not fitted:
PRECROP = {
    "bajo": {"pct": 4, "fuente": "Seifert, Roberts y Lobell 2017 (Agronomy Journal 109:541-548): maíz de temporal tras soya frente "
                                 "a maíz tras maíz, 748,374 observaciones en parcelas comerciales de seis estados de EE. UU."},
    "medio": {"pct": 20, "fuente": "Zhao et al. 2022 (Nature Communications 13:4926): promedio mundial de 462 experimentos de campo"},
    "alto": {"pct": 32, "fuente": "Zhao et al. 2022: experimentos en ambientes de bajo rendimiento (en los de alto rendimiento, 7%)"},
}
# The only plot-level evidence from Mexico we found: CIMMYT's farmer logbooks, 2012-2022. Sole maize after a legume
# against sole maize after maize in the same municipality, year, water regime and management. Computed by
# src/rotations/plot_evidence.py; the numbers are in docs/field_shift/results/cimmyt_precrop.csv and a test
# checks that they still match.
PRECROP_MEXICO = {"pct": 6, "rango_90": [-7, 20], "parcelas": 81, "parcelas_comparadas": 58, "periodo": "2012-2022",
                  "fuente": ("Bitácoras de parcelas de productores, CIMMYT (Gardeazábal-Monsalve et al. 2024, "
                             "hdl:11529/10548986); comparación propia, no experimental")}
PRECROP_NOTE = ("Esos estudios no se hicieron en México. Lo más cercano que hay aquí son bitácoras de parcelas de "
                f"productores (CIMMYT, {PRECROP_MEXICO['periodo']}): el maíz sembrado después de una leguminosa rindió alrededor de "
                f"{PRECROP_MEXICO['pct']}% más que el maíz después de maíz en el mismo municipio y año, pero son solo "
                f"{PRECROP_MEXICO['parcelas']} parcelas y el rango va de {PRECROP_MEXICO['rango_90'][0]}% a "
                f"+{PRECROP_MEXICO['rango_90'][1]}%: no se distingue de cero. El efecto baja cuando se fertiliza con nitrógeno "
                "(Zhao et al. 2022). No está sumado al ingreso de arriba.").replace("-7%", "−7%")
# For screens that show PRECROP_MEXICO on its own line:
PRECROP_NOTE_SHORT = ("Los tres estudios de arriba no se hicieron en México. El efecto baja cuando se fertiliza con "
                      "nitrógeno (Zhao et al. 2022). No está sumado al ingreso de arriba.")


def _sequence(evaluation):
    """Seasons in the order they are grown, with the mean income of each."""
    return [(i["season"].crop, i.get("income_mean", np.nan)) for i in evaluation["seasons"] if i["prod"]]


def _after_legume_income(evaluation):
    """MXN per rotation of income earned by a non-legume crop grown right after a legume (cyclic)."""
    traits, seq = catalog.crops(), _sequence(evaluation)
    is_legume = lambda c: c in traits.index and bool(traits.loc[c, "leguminosa"])
    total, pairs = 0.0, []
    for k, (crop, income) in enumerate(seq):
        before = seq[k - 1][0]
        if len(seq) > 1 and is_legume(before) and crop in traits.index and not is_legume(crop) and np.isfinite(income):
            total += income
            pairs.append(f"{catalog.name(crop)} después de {catalog.name(before)}")
    return total, pairs


def precrop(evaluation, baseline):
    """What the rotation's income would be if the crop after a legume yielded more, and the break-even gain.

    Returns None when no non-legume crop follows a legume. Nothing here enters the indicators or the scores.
    """
    affected, pairs = _after_legume_income(evaluation)
    if not pairs:
        return None
    n = len(evaluation["years"])
    income = evaluation["values"]["ingreso"]
    out = {"secuencias": sorted(set(pairs)), "ingreso_sin_efecto": round(income),
           "supuestos": [{"nivel": k, "aumento_pct": v["pct"], "ingreso": round(income + v["pct"] / 100 * affected / n),
                          "fuente": v["fuente"]} for k, v in PRECROP.items()],
           "observado_en_mexico": PRECROP_MEXICO, "nota": PRECROP_NOTE, "nota_corta": PRECROP_NOTE_SHORT, "tipo": "supuesto de literatura"}
    if baseline is not None and baseline is not evaluation:
        base_income = baseline["values"]["ingreso"]
        base_affected, _ = _after_legume_income(baseline)
        gain_per_point = affected / n - base_affected / len(baseline["years"])
        gap = base_income - income
        if gap <= 0:
            out["equilibrio_pct"] = 0.0          # already matches the current rotation without the effect
        elif gain_per_point > 0:
            out["equilibrio_pct"] = round(100 * gap / gain_per_point, 1)
        else:
            out["equilibrio_pct"] = None
    return out


def precrop_line(info):
    if not info:
        return None
    low, mid, high = (s for s in info["supuestos"])
    text = (f"Efecto del cultivo anterior (supuesto, no medido aquí): si {info['secuencias'][0]} rindiera {low['aumento_pct']}% "
            f"más, el ingreso sería ${low['ingreso']:,}; con {mid['aumento_pct']}%, ${mid['ingreso']:,}; con "
            f"{high['aumento_pct']}%, ${high['ingreso']:,} por ha al año.")
    be = info.get("equilibrio_pct")
    if be:
        text += f" Para igualar el ingreso de tu rotación actual haría falta un aumento de {be:.0f}%"
        text += " (más de lo que reportan esos estudios)." if be > high["aumento_pct"] else "."
    return text


# --- 5. Calendar: what covers the field each month ---------------------------------------------------

def calendar(evaluation):
    """Per rotation year: each crop's sowing day and length, and the canopy cover by month (0-1)."""
    out = []
    for k, seasons in enumerate(evaluation["years"], 1):
        canopy = np.zeros(365)
        for s in seasons:
            canopy = np.maximum(canopy, s.occupancy)
        out.append({
            "año": k,
            "cultivos": [{"cultivo": catalog.name(s.crop), "ciclo": s.cycle, "siembra_dia": int(s.sow_day),
                          "dias": int(s.length), "siembra_mes": int(MONTH_OF_DAY[s.sow_day]) + 1,
                          "cosecha_mes": int(MONTH_OF_DAY[s.harvest_day]) + 1} for s in seasons],
            "cobertura": [round(float(v), 2) for v in np.bincount(MONTH_OF_DAY, weights=canopy, minlength=12) / DAYS],
        })
    return out


def place_calendar(place):
    """Monthly climate and satellite series for the place: the backdrop of the calendar."""
    c = place.climate.sort_values("month")
    out = {"lluvia_mm": c["rain"].round(0).tolist(), "et0_mm": c["et0"].round(0).tolist(),
           "tmin_c": c["tmin"].round(1).tolist(), "tmax_c": c["tmax"].round(1).tolist(),
           "prob_helada": c["frost_prob"].round(2).tolist(), "dias_calor": c["heat_days"].round(1).tolist()}
    obs = place.observed
    if obs is not None:
        o = obs.sort_values("month")
        clean = lambda s: [None if not np.isfinite(v) else round(float(v), 3) for v in s]
        out["ndvi"] = clean(o["ndvi"])
        if "ndvi_p20" in o:
            out["ndvi_p20"], out["ndvi_p80"] = clean(o["ndvi_p20"]), clean(o["ndvi_p80"])
        if "smap_relative" in o:
            out["humedad_relativa_smap"] = clean(o["smap_relative"])
    return out
