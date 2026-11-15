"""Held-out backtest of the district rotation engine: do its recommendations hold up in years it never saw?

    python -m gradientdescentfarmers.model_builder.rotations.backtest                    # cutoff 2017, demo + national sample
    python -m gradientdescentfarmers.model_builder.rotations.backtest --cutoff 2019 --national 30

How it works
1. A copy of the panel is cut at the cutoff year: every table with a `year` column keeps only years <= cutoff (SIAP,
   NASA POWER, CHIRPS, GRACE). The engine is run on it exactly as the app runs it (`comparar_rotaciones`), so its
   prices, yields, bad years and recommendations use only what was known then.
2. On the full panel, the current rotation and every recommended alternative are evaluated again (`indicators.evaluate`)
   and their income in the held-out years (cutoff+1 .. 2025) is read: district SIAP production per sown hectare in each
   of those years, valued at the same fixed recent prices for every rotation, so a difference is a difference in what the
   district's fields produced, not in price luck.
3. The engine's claims are compared with what happened.

What can be checked with observed data, and is: the income difference against the current rotation (direction, size,
and whether the "clear difference" label held), and the share of bad years. What cannot (no observed outcome exists):
water, nitrogen, carbon, erosion, pest breaks and forage; the report says so.

Cases: the web app's 23 demo cases (web_export.PLACES) and a seeded random sample of districts across Mexico, each with
its largest crop of the main cycle as the "current rotation". Priority settings: none, and each of the seven alone.
District SIAP is an aggregate of many fields, not a farm: this tests the engine's statements about the district.
"""
from __future__ import annotations

import argparse
import json
import shutil
import tempfile
from concurrent.futures import ProcessPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

from . import panel, scoring

REPO = Path(__file__).resolve().parents[3]
OUT = REPO / "resources" / "district_backtest"
LAST_YEAR = 2025
PRIORITY_SETS = [()] + [(p,) for p in sorted(scoring.PRIORITIES)]
TESTABLE = {"ingreso": "income", "riesgo": "bad years"}
BIG = 5000   # MXN/ha/yr: a claimed difference this large or larger is a "large" claim


# ---- 1. the panel as it was at the cutoff ----

def truncated_panel(source: Path, cutoff: int, target: Path) -> Path:
    """A copy of the panel run with every yearly table cut at `cutoff`."""
    (target / "tables").mkdir(parents=True, exist_ok=True)
    for f in source.iterdir():
        if f.is_file():
            shutil.copy2(f, target / f.name)
    for f in (source / "tables").iterdir():
        if f.suffix != ".parquet":
            shutil.copy2(f, target / "tables" / f.name)
            continue
        t = pd.read_parquet(f)
        if "year" in t.columns:
            t = t[t["year"] <= cutoff]
        t.to_parquet(target / "tables" / f.name, index=False)
    return target


# ---- cases ----

def demo_cases():
    from .web_export import PLACES
    return [{"grupo": "demo", "lugar": spec["municipio"], "estado": spec["estado"], "agua": agua, "rotacion": text, "etiqueta": f"{pid}/{agua}/{rid}"}
            for pid, spec in PLACES.items() for agua, options in spec["rotaciones"].items() for rid, text, _ in options]


def national_cases(n: int, cutoff: int, seed: int = 7, exclude=()):
    """Districts with a sizeable main crop in the training years and SIAP data in most held-out years."""
    from . import catalog

    siap = panel.read("siap_crop_years")
    train = siap[siap["year"] <= cutoff]
    big = (train.groupby(["state_id", "ddr", "state", "ddr_name", "water", "cycle", "crop"])["sown_ha"].sum()
           / train["year"].nunique()).rename("ha").reset_index()
    big = big[big["ha"] >= 2000].sort_values("ha", ascending=False).drop_duplicates(["state_id", "ddr", "water"])
    test = siap[(siap["year"] > cutoff) & (siap["sown_ha"] > 0)]
    years = test.groupby(["state_id", "ddr", "water", "crop", "cycle"])["year"].nunique().rename("test_years").reset_index()
    big = big.merge(years, on=["state_id", "ddr", "water", "crop", "cycle"], how="left")
    big = big[big["test_years"].fillna(0) >= max(3, (LAST_YEAR - cutoff) - 2)]
    big = big[~big["ddr_name"].isin(exclude)]
    sample = big.sample(n=min(n, len(big)), random_state=seed)
    return [{"grupo": "nacional", "lugar": r.ddr_name, "estado": r.state, "agua": r.water, "rotacion": catalog.name(r.crop),
             "etiqueta": f"{r.state}/{r.ddr_name}/{r.water}/{r.crop}"} for r in sample.itertuples()]


# ---- 2. what the engine recommended with the data up to the cutoff ----

def _init(panel_path):
    panel.use(panel_path)


def predict(case):
    from .compare import comparar_rotaciones

    out = []
    for prios in PRIORITY_SETS:
        try:
            r = comparar_rotaciones(case["lugar"], case["rotacion"], estado=case["estado"], agua=case["agua"],
                                    prioridades=list(prios), escenarios=False)
        except Exception as error:  # noqa: BLE001 - recorded, never filled in
            return {**case, "error": f"{type(error).__name__}: {error}"}
        out.append({"prioridades": list(prios), "rotaciones": [
            {"id": x["id"], "nombre": x["nombre"], "rotacion": x["rotacion"], "puntaje": x["puntaje_prioridades"],
             "pred": x["vs_actual_ingreso"], "condicional": x["adopcion"]["condicional"],
             "riesgo_pred": x["indicadores"].get("riesgo", {}).get("valor")}
            for x in r["rotaciones"]]})
    return {**case, "predicciones": out}


# ---- 3. what happened afterwards ----

def _key(rotation):
    return json.dumps(rotation, sort_keys=True)


def realize(args):
    """Income by year for each distinct rotation of a case, on the full panel."""
    case, cutoff = args
    from . import places, soil
    from .indicators import evaluate

    place = places.place(case["lugar"], case["estado"], water=case["agua"])
    place.soil_water_mm_m = soil.summary(place, None)["agua_aprovechable_mm_m"]
    place.costs, place.own_yield = {}, {}
    series = {}
    for pred in case["predicciones"]:
        for x in pred["rotaciones"]:
            k = _key(x["rotacion"])
            if k in series:
                continue
            income = evaluate(place, x["rotacion"])["income_by_year"]
            series[k] = {} if income is None else {int(y): float(v) for y, v in income.items()}
    return {**case, "series": series}


def _bad_share(series: dict, cutoff: int):
    """Share of held-out years with income below half its training-years median (the engine's bad-year rule)."""
    train = [v for y, v in series.items() if y <= cutoff]
    test = [v for y, v in series.items() if y > cutoff]
    if len(train) < 5 or len(test) < 3:
        return None
    return float(np.mean([v < 0.5 * np.median(train) for v in test]))


def score(cases, cutoff):
    """Pairwise claims (alternative vs current) and the priority hits, from predictions and held-out incomes."""
    pairs, top = [], []
    for case in cases:
        s = case["series"]
        for pred in case["predicciones"]:
            current = next(x for x in pred["rotaciones"] if x["id"] == "actual")
            cur = s.get(_key(current["rotacion"]), {})
            alts = [x for x in pred["rotaciones"] if x["id"] != "actual"]
            for rank, x in enumerate(alts):
                alt = s.get(_key(x["rotacion"]), {})
                years = sorted(y for y in alt if y > cutoff and y in cur)
                if not x["pred"] or len(years) < 3:
                    continue
                real = float(np.mean([alt[y] - cur[y] for y in years]))
                pairs.append({"grupo": case["grupo"], "caso": case["etiqueta"], "prioridades": pred["prioridades"], "alternativa": x["nombre"],
                              "pred": x["pred"]["media"], "clara": bool(x["pred"]["clara"]), "condicional": bool(x["condicional"]),
                              "real": real, "años_prueba": len(years), "acierta": bool(np.sign(real) == np.sign(x["pred"]["media"]))})
            # the farmer's priority: the alternative the engine scored highest for it
            prio = pred["prioridades"][0] if pred["prioridades"] else None
            if prio in TESTABLE and alts:
                best = max(alts, key=lambda x: x["puntaje"] if x["puntaje"] is not None else -1)
                alt = s.get(_key(best["rotacion"]), {})
                years = sorted(y for y in alt if y > cutoff and y in cur)
                if len(years) < 3:
                    continue
                if prio == "ingreso":
                    claim = best["pred"]["media"] > 0 if best["pred"] else None
                    held = float(np.mean([alt[y] for y in years])) >= float(np.mean([cur[y] for y in years]))
                    top.append({"grupo": case["grupo"], "caso": case["etiqueta"], "prioridad": prio, "alternativa": best["nombre"],
                                "dijo_mejor": claim, "fue_mejor_o_igual": held, "empate": False, "estrictamente_mejor": held})
                else:
                    a, c = _bad_share(alt, cutoff), _bad_share(cur, cutoff)
                    if a is None or c is None:
                        continue
                    claim = (best["riesgo_pred"] is not None and current["riesgo_pred"] is not None and best["riesgo_pred"] <= current["riesgo_pred"])
                    top.append({"grupo": case["grupo"], "caso": case["etiqueta"], "prioridad": prio, "alternativa": best["nombre"],
                                "dijo_mejor": claim, "fue_mejor_o_igual": a <= c, "empate": a == c, "estrictamente_mejor": a < c,
                                "malos_alt": a, "malos_actual": c})
    return pairs, top


def summarize(pairs, top, cases, cutoff):
    p = pd.DataFrame(pairs)
    t = pd.DataFrame(top)

    def block(df):
        if df.empty:
            return {"n": 0}
        clear = df[df["clara"]]
        unique = df.drop_duplicates(["caso", "alternativa"])
        rho = unique[["pred", "real"]].corr(method="spearman").iloc[0, 1] if len(unique) >= 5 else None
        return {
            "n_afirmaciones": int(len(df)), "n_pares_distintos": int(len(unique)),
            "direccion_acierta": float(unique["acierta"].mean()),
            "direccion_acierta_claras": float(unique[unique["clara"]]["acierta"].mean()) if unique["clara"].any() else None,
            "n_claras": int(unique["clara"].sum()),
            "direccion_acierta_no_claras": float(unique[~unique["clara"]]["acierta"].mean()) if (~unique["clara"]).any() else None,
            "spearman_pred_real": None if rho is None or pd.isna(rho) else float(rho),
            "error_absoluto_mediano_mxn": float((unique["pred"] - unique["real"]).abs().median()),
            "diferencia_real_mediana_abs_mxn": float(unique["real"].abs().median()),
            "claras_n": int(len(clear)),
            "linea_base_mayoria": float(max((unique["real"] > 0).mean(), (unique["real"] < 0).mean())),
            "direccion_acierta_pred_grande": float(unique[unique["pred"].abs() >= BIG]["acierta"].mean()) if (unique["pred"].abs() >= BIG).any() else None,
            "n_pred_grande": int((unique["pred"].abs() >= BIG).sum()),
            "direccion_acierta_pred_chica": float(unique[unique["pred"].abs() < BIG]["acierta"].mean()) if (unique["pred"].abs() < BIG).any() else None,
            "n_pred_chica": int((unique["pred"].abs() < BIG).sum()),
        }

    def hits(df):
        if df.empty:
            return {"n": 0}
        out = {"n": int(len(df)), "alternativa_top_fue_mejor_o_igual": float(df["fue_mejor_o_igual"].mean()),
               "empates": int(df["empate"].sum()), "estrictamente_mejor": float(df["estrictamente_mejor"].mean())}
        said = df[df["dijo_mejor"] == True]  # noqa: E712
        if len(said):
            out["cuando_dijo_mejor_n"] = int(len(said))
            out["cuando_dijo_mejor_acierta"] = float(said["fue_mejor_o_igual"].mean())
        return out

    return {
        "corte": cutoff, "entrenamiento": f"2003-{cutoff}", "prueba": f"{cutoff + 1}-{LAST_YEAR}",
        "casos": {"total": len(cases), "con_error": sum(1 for c in cases if "error" in c)},
        "ingreso_vs_actual": {g: block(p[p["grupo"] == g]) if not p.empty else {"n": 0} for g in ("demo", "nacional")} | {"todos": block(p)},
        "prioridad": {f"{g}/{k}": hits(t[(t["grupo"] == g) & (t["prioridad"] == k)]) if not t.empty else {"n": 0}
                      for g in ("demo", "nacional") for k in TESTABLE},
        "no_comprobable_con_datos_observados": ["agua", "nitrogeno", "carbono", "erosion", "plagas", "forraje"],
        "linea_base": "coin flip 50%; majority baseline per group in linea_base_mayoria",
    }


def report_md(summary, pairs):
    s = summary
    pct = lambda x: "—" if x is None else f"{x:.0%}"
    num = lambda x: "—" if x is None else f"{x:,.0f}"
    rho = lambda x: "—" if x is None else f"{x:.2f}"
    lines = [f"# District engine (SIAP) backtest: trained {s['entrenamiento']}, tested {s['prueba']}", "",
             f"Generated {datetime.now(timezone.utc):%Y-%m-%d} with `python -m gradientdescentfarmers.model_builder.rotations.backtest --cutoff {s['corte']}`.",
             "", "The engine was run on a copy of the panel cut at the training cutoff, so it only knew what existed then. Its "
             "recommendations were then checked against what the districts produced in the following years (SIAP, valued at the same "
             "fixed recent prices for every rotation). This tests the engine's statements about the district, not about one field.", "",
             f"Cases: {s['casos']['total']} ({s['casos']['con_error']} without an engine answer): the web app's demo cases and a seeded "
             "random sample of districts across Mexico. Baselines: a coin flip (50%), and always predicting whatever happened most "
             "often (the 'Majority baseline' column).", "",
             "## Did the alternative earn more (or less) than the current rotation, as the engine said?", "",
             "| Group | Pairs | Direction right | Majority baseline | Claimed gap ≥ 5,000 | Claimed gap < 5,000 | 'Clear' only | Spearman claimed vs real | Median abs. error (MXN/ha/yr) | Median |real gap| |",
             "|---|---|---|---|---|---|---|---|---|---|"]
    names = {"demo": "demo", "nacional": "national", "todos": "all"}
    for g, b in s["ingreso_vs_actual"].items():
        if not b.get("n_pares_distintos"):
            continue
        lines.append(f"| {names[g]} | {b['n_pares_distintos']} | {pct(b['direccion_acierta'])} | {pct(b['linea_base_mayoria'])} | "
                     f"{pct(b['direccion_acierta_pred_grande'])} (n={b['n_pred_grande']}) | {pct(b['direccion_acierta_pred_chica'])} (n={b['n_pred_chica']}) | "
                     f"{pct(b['direccion_acierta_claras'])} (n={b['n_claras']}) | {rho(b['spearman_pred_real'])} | "
                     f"{num(b['error_absoluto_mediano_mxn'])} | {num(b['diferencia_real_mediana_abs_mxn'])} |")
    lines += ["", "## When the farmer's priority is income or risk: did the top-scored alternative deliver?", "",
              "| Group / priority | Cases | Top alternative equal or better | Strictly better | Ties | When the engine said it was better |", "|---|---|---|---|---|---|"]
    for k, h in s["prioridad"].items():
        if not h.get("n"):
            continue
        g, prio = k.split("/")
        lines.append(f"| {names[g]} / {'income' if prio == 'ingreso' else 'risk (bad years)'} | {h['n']} | {pct(h['alternativa_top_fue_mejor_o_igual'])} | "
                     f"{pct(h['estrictamente_mejor'])} | {h['empates']} | {pct(h.get('cuando_dijo_mejor_acierta'))} (n={h.get('cuando_dijo_mejor_n', 0)}) |")
    lines += ["", "Risk: most held-out windows had no bad year for either rotation, so the comparison is mostly ties and does not "
              "validate the risk claim either way."]
    misses = pd.DataFrame(pairs)
    if not misses.empty:
        misses = misses.drop_duplicates(["caso", "alternativa"])
        misses = misses[~misses["acierta"]].assign(gap=lambda d: (d["real"] - d["pred"]).abs()).sort_values("gap", ascending=False)
        lines += ["", f"## Where the direction was wrong ({len(misses)} pairs, largest gaps first)", "",
                  "| Case | Alternative (engine's Spanish name) | Claimed (MXN/ha/yr) | Happened | Marked 'clear' |", "|---|---|---|---|---|"]
        for r in misses.head(12).itertuples():
            lines.append(f"| {r.caso} | {r.alternativa} | {r.pred:+,.0f} | {r.real:+,.0f} | {'yes' if r.clara else 'no'} |")
    lines += ["", "## What this test cannot check", "",
              "Water, nitrogen, carbon, erosion, pest breaks and forage have no observed yearly district outcome to compare with; "
              "they remain model estimates (FAO-56) and literature rules.", "",
              "## Limits", "",
              "- District SIAP aggregates many fields; crops grown on few hectares have fewer years and more noise.",
              "- Income at fixed recent prices measures what was produced, not price luck; price risk is separate.",
              "- Priority settings tested: none and each of the seven alone (not pairs).",
              "- The WOFOST simulation is not part of this test.", ""]
    return "\n".join(lines)


def run(cutoff: int, national: int, jobs: int, out: Path):
    full = panel.resolve(REPO / "resources" / "district_panel_national")
    panel.use(full)
    demo = demo_cases()
    nat = national_cases(national, cutoff, exclude={"Cortazar", "Los Mochis", "Cajeme"}) if national else []
    cases = demo + nat
    with tempfile.TemporaryDirectory() as tmp:
        cut = truncated_panel(full, cutoff, Path(tmp) / f"cut_{cutoff}")
        with ProcessPoolExecutor(max_workers=jobs, initializer=_init, initargs=(str(cut),)) as pool:
            predicted = list(pool.map(predict, cases))
    ok = [c for c in predicted if "error" not in c]
    with ProcessPoolExecutor(max_workers=jobs, initializer=_init, initargs=(str(full),)) as pool:
        realized = list(pool.map(realize, [(c, cutoff) for c in ok]))
    pairs, top = score(realized, cutoff)
    summary = summarize(pairs, top, predicted, cutoff)
    summary["errores"] = [{"caso": c["etiqueta"], "error": c["error"]} for c in predicted if "error" in c]
    out.mkdir(parents=True, exist_ok=True)
    (out / f"summary_{cutoff}.json").write_text(json.dumps(summary, ensure_ascii=False, indent=1), encoding="utf-8")
    pd.DataFrame(pairs).to_csv(out / f"pairs_{cutoff}.csv", index=False)
    pd.DataFrame(top).to_csv(out / f"priority_{cutoff}.csv", index=False)
    (out / f"REPORT_{cutoff}.md").write_text(report_md(summary, pairs), encoding="utf-8")
    return summary


def main(argv=None):
    parser = argparse.ArgumentParser(description="Held-out backtest of the district rotation engine")
    parser.add_argument("--cutoff", type=int, default=2017, help="last training year (default 2017: test 2018-2025)")
    parser.add_argument("--national", type=int, default=30, help="random districts besides the demo cases (0: demo only)")
    parser.add_argument("--jobs", type=int, default=2)
    parser.add_argument("--out", default=str(OUT))
    args = parser.parse_args(argv)
    summary = run(args.cutoff, args.national, args.jobs, Path(args.out))
    print(json.dumps(summary, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
