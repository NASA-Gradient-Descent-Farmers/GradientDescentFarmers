"""comparar_rotaciones: compare a farmer's rotation with alternatives built from local data.

    from gradientdescentfarmers.model_builder.rotations.compare import comparar_rotaciones
    out = comparar_rotaciones("Celaya", "maíz", estado="Guanajuato", prioridades=["agua", "suelo"])

The result is a JSON-serializable dict; every number is computed by code (SIAP, NASA POWER, FAO-56, IPCC
coefficients), so a language model only has to phrase it.
"""

import json

import numpy as np

from . import candidates, cards, catalog, grace, insights, places, scoring, soil, trends
from .indicators import EVIDENCE_RANK, RESIDUE, evaluate

MIN_ALTERNATIVES = 2      # the comparison always shows the current rotation and at least two others, where data exist
WIDER_NOTE = ("En tu distrito casi toda la superficie de {agua} es de un solo cultivo, así que para darte al menos dos "
              "alternativas se buscaron también cultivos que aquí se siembran muy poco, forrajes, o cultivos que se "
              "siembran en otras partes de tu estado. Esas opciones dicen de dónde salen sus números y llevan la "
              "marca \"depende de tu parcela\" cuando no vienen de siembras amplias en tu distrito.")
FEW_NOTE = ("SIAP no registra en tu distrito ni en tu estado suficientes cultivos de {agua} para armar dos alternativas "
            "a tu rotación con datos. Revisa si elegiste bien temporal o riego; si es correcto, aquí la herramienta "
            "no alcanza y la comparación hay que hacerla con un técnico de la zona.")
DISCLAIMER = ("Esta comparación usa datos públicos (SIAP, NASA) y supuestos de literatura. Sirve para explorar "
              "opciones, no reemplaza tu experiencia ni la de un técnico o extensionista de tu zona.")


def comparar_rotaciones(lugar, rotacion_actual, estado=None, agua="temporal", prioridades=(), residuo="dejar",
                        tiene_animales=False, mes_siembra=None, pendiente="ligera", propuestas=(), n_alternativas=3,
                        costos=None, rendimiento_propio=None, escenarios=True, suelo=None):
    """Compare `rotacion_actual` with up to `n_alternativas` alternatives (plus any `propuestas`).

    lugar: municipality or SIAP district name; estado: state name to disambiguate.
    mes_siembra: the farmer's sowing month (1-12) for the crop of its cycle: March-August sets the
        spring-summer sowing, September-February the autumn-winter sowing. Without it each cycle uses a
        default, which is weakest for autumn-winter crops; `preguntar` then asks for it.
    rotacion_actual / propuestas: text like "maíz - frijol" or "maíz/garbanzo", or lists of {"pv":..., "oi":...}.
    agua: "temporal" or "riego". prioridades: subset of scoring.PRIORITIES.
    residuo: what happens to stover, one of indicators.RESIDUE. pendiente: "plana", "ligera" or "fuerte".
    costos: {"maíz": 9000, ...} the farmer's cost per hectare per season (MXN). Only these enter the calculations;
        without them the tool reports break-even costs, and quotes the reference costs in tables/costs.csv
        (where one exists) when it asks the farmer for theirs.
    rendimiento_propio: {"maíz": 2.5, ...} the farmer's yield in a normal year (t/ha); it sets the level of
        that crop's SIAP history for this farm.
    suelo: the farmer's soil, "arenoso", "franco" or "arcilloso" (soil.AVAILABLE_WATER). It sets the water a metre
        of soil holds for crops sown on residual moisture; without it a loam is assumed. Map soil (GLDAS, IGBP-DIS)
        is reported as context under `suelo` and never enters a calculation.
    escenarios: also compute the water indicator under less rain and more heat (insights.scenario_grid).
        Set False to save ~1 s when the caller will not show them (e.g. the WhatsApp assistant).

    At least MIN_ALTERNATIVES alternatives are returned wherever SIAP has data to build them: when the
    district's common crops give fewer, the search widens to niche crops, forages and state-level crops
    (`busqueda_ampliada` on those rotations, `nota_opciones` on the result).

    Besides the nine indicators and the cards, each rotation carries (see src/rotations/insights.py):
    `adopcion` (how much of each new crop is sown locally), `años_malos` (how it did in the current
    rotation's worst years, observed), `escenarios` (scenario, not forecast), `efecto_cultivo_anterior` (literature what-if, never added
    to income) and `calendario`. The result also has `tendencias` (1982-2025 weather trends, NASA POWER) and
    `agua_region` (GRACE / GRACE-FO water storage).
    """
    if agua not in ("temporal", "riego"):
        raise ValueError("agua debe ser 'temporal' o 'riego'")
    if residuo not in RESIDUE:
        raise ValueError(f"residuo debe ser uno de {sorted(RESIDUE)}")
    prioridades = [p for p in prioridades if p in scoring.PRIORITIES]
    place = places.place(lugar, estado, water=agua, sowing_month=mes_siembra)
    soil_info = soil.summary(place, suelo)
    place.soil_water_mm_m = soil_info["agua_aprovechable_mm_m"]
    place.costs = {candidates.crop_key(k): float(v) for k, v in (costos or {}).items() if v is not None}
    place.own_yield = {candidates.crop_key(k): float(v) for k, v in (rendimiento_propio or {}).items() if v}
    current = candidates.assign_cycles(place, candidates.parse_rotation(rotacion_actual))

    options = [("actual", current)]
    options += [("propuesta", candidates.assign_cycles(place, candidates.parse_rotation(p))) for p in propuestas]
    generated = candidates.generate(place, current, has_animals=tiene_animales)

    def prepare(template, rotation, base=None):
        """Evaluate one rotation and say how broad the local record of its new crops is."""
        x = {"template": template, "rotation": rotation, "evaluation": evaluate(place, rotation, residuo), "wide": False}
        # A new crop sown on a small share of the district's land (or not in the district at all): its SIAP
        # record comes from other fields, so the evidence for this field is weaker than "observed" suggests.
        x["adoption"] = insights.adoption(place, x["evaluation"], (base or x)["evaluation"])
        if x["adoption"]["condicional"] and EVIDENCE_RANK[x["evaluation"]["siap_evidence"]] > EVIDENCE_RANK["media"]:
            x["evaluation"]["siap_evidence"] = "media"
        return x

    evaluated = [prepare(*options[0])]
    evaluated += [prepare(t, r, evaluated[0]) for t, r in options[1:] + generated]
    # Profit replaces gross income in the scores when the current rotation's costs are known and enough
    # alternatives have known costs too; alternatives without costs are then left out (and listed).
    has_net = lambda x: np.isfinite(x["evaluation"]["values"]["ganancia"])
    with_net = [x for x in evaluated if x["template"] not in ("actual", "propuesta") and has_net(x)
                and not x["evaluation"]["gaps"]]
    net = has_net(evaluated[0]) and len(with_net) >= n_alternativas
    without_cost = [x for x in evaluated if net and x["template"] not in ("actual", "propuesta") and not has_net(x)
                    and not x["evaluation"]["gaps"]]
    for x in evaluated:
        x["score"] = scoring.scores(x["evaluation"]["values"], agua, pendiente, net=net)
        x["weighted"] = scoring.weighted(x["score"], prioridades)

    baseline = evaluated[0]
    fixed = [x for x in evaluated if x["template"] in ("actual", "propuesta")]
    pool = sorted((x for x in evaluated if x["template"] not in ("actual", "propuesta")
                   and x["weighted"] is not None and not x["evaluation"]["gaps"] and x not in without_cost),
                  key=lambda x: -x["weighted"])
    chosen, used, shown = [], set(), {c for y in current for c in y.values()}
    for strict in (True, False):                    # best per template first, so the options differ in kind,
        for x in pool:                              # and first those that bring a crop not shown yet
            new = {c for y in x["rotation"] for c in y.values()} - shown
            if x in chosen or x["template"] in used or len(chosen) >= n_alternativas or (strict and not new):
                continue
            chosen.append(x)
            used.add(x["template"])
            shown |= new
    for x in pool:
        if len(chosen) >= n_alternativas:
            break
        if x not in chosen:
            chosen.append(x)

    # Fewer than two alternatives (typical where one crop covers nearly all the district's land): widen the
    # search to niche crops, forages and crops grown elsewhere in the state. Preferred in that order.
    widened = False
    if len(chosen) < MIN_ALTERNATIVES:
        have = {candidates.signature(x["rotation"]) for x in evaluated}
        wider = []
        for t, r in candidates.generate(place, current, has_animals=tiene_animales, widen=True):
            if candidates.signature(r) in have:
                continue
            x = prepare(t, r, baseline)
            x["wide"] = True
            x["score"] = scoring.scores(x["evaluation"]["values"], agua, pendiente, net=net)
            x["weighted"] = scoring.weighted(x["score"], prioridades)
            if x["weighted"] is not None and not x["evaluation"]["gaps"] and (not net or has_net(x)):
                wider.append(x)
        wider.sort(key=lambda x: (insights.adoption_rank(x["adoption"]), -x["weighted"]))
        for distinct in (True, False):
            for x in wider:
                if len(chosen) >= MIN_ALTERNATIVES:
                    break
                if x not in chosen and not (distinct and x["template"] in used):
                    chosen.append(x)
                    used.add(x["template"])
        widened = any(x["wide"] for x in chosen)

    # Options backed by broad local practice go before those whose numbers come from few plots.
    chosen.sort(key=lambda x: insights.adoption_rank(x["adoption"]))

    rotations = []
    for x in fixed + chosen:
        e = x["evaluation"]
        key = "net_by_year" if net else "income_by_year"
        diff = None if x is baseline else scoring.paired_difference(e[key], baseline["evaluation"][key])
        if diff and x["adoption"]["condicional"]:
            diff = {**diff, "clara": False, "condicional": True}
        extras = {"adopcion": x["adoption"], "años_malos": insights.bad_years(place, e, baseline["evaluation"]),
                  "efecto_cultivo_anterior": insights.precrop(e, None if x is baseline else baseline["evaluation"]),
                  "ampliada": x["wide"], "tiene_animales": bool(tiene_animales)}
        rotations.append({
            "id": x["template"] if x["template"] != "propuesta" else f"propuesta_{len(rotations)}",
            "nombre": f"{cards.TEMPLATE_NAMES[x['template']]}: {' – '.join(catalog.name(c) for c in cards.crop_names(x['rotation']))}",
            "secuencia": candidates.describe(x["rotation"]),
            "rotacion": x["rotation"],
            "puntaje_prioridades": None if x["weighted"] is None else round(x["weighted"]),
            "indicadores": cards.indicator_rows(e, x["score"], agua, net),
            "vs_actual_ingreso": diff,
            "tarjeta": cards.card(place, x["template"], x["rotation"], e, baseline, diff, residuo, net=net, extras=extras),
            "adopcion": x["adoption"],
            "busqueda_ampliada": x["wide"],
            "años_malos": extras["años_malos"],
            "efecto_cultivo_anterior": extras["efecto_cultivo_anterior"],
            "escenarios": insights.scenario_grid(place, x["rotation"]) if escenarios else None,
            "calendario": insights.calendar(e),
        })

    place_trends = trends.place_trends(place, [x["season"] for x in baseline["evaluation"]["seasons"]])
    storage = grace.storage(place.state_id, place.ddr, place.mun_id)

    return {
        "lugar": {"municipio": place.municipality, "distrito": place.ddr_name, "estado": place.state, "agua": agua,
                  "notas": place.notes},
        "tu_lugar": cards.place_summary(place, baseline["evaluation"]) + soil_info["lineas"],
        "suelo": soil_info,
        "tendencias": {"lineas": trends.lines(place_trends, agua), "detalle": place_trends,
                       "tipo": "observado (reanálisis), sobre los meses en campo de tu rotación actual"},
        "agua_region": None if storage is None else {**storage, "lineas": grace.lines(storage, agua), "tipo": "observado"},
        "calendario_lugar": insights.place_calendar(place),
        "prioridades": [scoring.PRIORITY_LABELS[p] for p in prioridades],
        "fechas_siembra": cards.sowing_dates(place, baseline["evaluation"]),
        "preguntar": ask_for(place, baseline["evaluation"]),
        "rotaciones": rotations,
        "nota_opciones": (WIDER_NOTE.format(agua=agua) if widened and len(chosen) >= MIN_ALTERNATIVES
                          else FEW_NOTE.format(agua=agua) if len(chosen) < MIN_ALTERNATIVES else None),
        "costos": {**cards.cost_summary(place, [x["evaluation"] for x in fixed + chosen + without_cost], net),
                   "sin_costo_no_mostradas": [candidates.describe(x["rotation"]) for x in without_cost]},
        "cultivos_de_nicho": {
            "nota": ("Se siembran poco en tu distrito, así que no se proponen solos; puedes pedir compararlos. Su "
                     "rendimiento viene de las pocas parcelas donde se dan y su mercado es chico."),
            "cultivos": candidates.niche_crops(place, current)},
        "no_evaluadas": [{"secuencia": candidates.describe(x["rotation"]), "motivo": "; ".join(x["evaluation"]["gaps"])}
                         for x in evaluated if x["evaluation"]["gaps"] and x["template"] not in ("actual", "propuesta")],
        "como_leer": ("Cada indicador tiene un puntaje de 0 a 100 en una escala fija (100 = mejor) y un nivel de "
                      "evidencia: alta = datos observados en tu distrito; media = modelo, datos del estado, o "
                      "datos de pocas parcelas del distrito; baja = supuestos de literatura; regla = criterio "
                      "agronómico general. Un escenario no es un pronóstico."),
        "vacios_generales": cards.GENERAL_GAPS,
        "aviso": DISCLAIMER,
    }


def ask_for(place, evaluation):
    """Data worth asking the farmer for, because a default stands in for it where it matters most.

    The autumn-winter sowing date is a fixed default (about 21 November under irrigation, the end of the rains
    under rainfed), while spring-summer follows the rains, so a winter crop's calendar rests most on the
    assumption: its water need, frost and heat, and the months its climate trends cover.
    """
    out = []
    dates = cards.sowing_dates(place, evaluation)
    winter = [d for d in dates if d["ciclo"] == "oi" and d["fuente"] == "supuesto"]
    if winter:
        crop = catalog.name(winter[0]["cultivo"])
        out.append({"dato": "mes_siembra",
                    "pregunta": f"¿En qué mes siembras el {crop}?",
                    "por_que": ("La fecha de siembra de otoño-invierno se supuso; cambia el agua que pide el cultivo, "
                                "el riesgo de helada y calor, y los meses en que se miden las tendencias del clima.")})
    return out


def to_json(result):
    return json.dumps(result, ensure_ascii=False, indent=1, default=float)
