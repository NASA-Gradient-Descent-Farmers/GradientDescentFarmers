"""Precompute the district engine for every district of Mexico, for the web app's simple farmer view (`/campo`).

    python -m gradientdescentfarmers.model_builder.rotations.web_export_national            # ~1 h on 2 cores
    python -m gradientdescentfarmers.model_builder.rotations.web_export_national --limit 5  # a quick sample

Until the engine runs as an API (serve.py), this is how any point in Mexico gets an answer from a static site.
Per district and water regime (where SIAP records a crop on >= MIN_HA ha a year since 2016):
- current rotations: the district's TOP_CROPS largest crops, each alone, and the largest spring-summer crop followed by the
  largest autumn-winter crop in the same year when both are sizeable;
- priorities: none, and each of PRIORITIES alone (the four the farmer view asks about);
- every other input at the engine's defaults; no water scenarios (the simple view does not show them).
Written as web_export.pack files under frontend/public/data/district/national/, with an index that also maps every
municipality of public/data/municipios.json (same order) to its district.
"""
from __future__ import annotations

import argparse
import json
import time
from concurrent.futures import ProcessPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

from . import catalog, panel
from .web_export import _round, pack, priority_key, unpack

REPO = Path(__file__).resolve().parents[3]
OUT = REPO / "frontend" / "public" / "data" / "district" / "national"
MUNICIPIOS = REPO / "frontend" / "public" / "data" / "municipios.json"
PRIORITIES = ["ingreso", "riesgo", "agua", "suelo"]
PRIORITY_SETS = [()] + [(p,) for p in PRIORITIES]
MIN_HA = 300
TOP_CROPS = 3
SINCE = 2016


def district_cases():
    """[(key, district info, water, [(rot_id, text, crops)])] for every district and regime with sizeable crops."""
    siap = panel.read("siap_crop_years")
    recent = siap[siap["year"] >= SINCE]
    years = recent["year"].nunique()
    area = (recent.groupby(["state_id", "ddr", "state", "ddr_name", "water", "cycle", "crop"])["sown_ha"].sum() / years).rename("ha").reset_index()
    area = area[area["ha"] >= MIN_HA]
    out = []
    for (state_id, ddr, state, ddr_name, water), g in area.groupby(["state_id", "ddr", "state", "ddr_name", "water"]):
        g = g.sort_values("ha", ascending=False)
        options, seen = [], set()
        for r in g.itertuples():
            if r.crop in seen or not catalog.is_known(r.crop):
                continue
            seen.add(r.crop)
            options.append((r.crop, catalog.name(r.crop), [r.crop]))
            if len(options) >= TOP_CROPS:
                break
        pv = g[g["cycle"] == "pv"].head(1)
        oi = g[g["cycle"] == "oi"].head(1)
        if len(pv) and len(oi) and pv.iloc[0]["ha"] >= 1000 and oi.iloc[0]["ha"] >= 1000 and pv.iloc[0]["crop"] != oi.iloc[0]["crop"]:
            a, b = pv.iloc[0]["crop"], oi.iloc[0]["crop"]
            if catalog.is_known(a) and catalog.is_known(b):
                options.append((f"{a}__{b}", f"{catalog.name(a)}/{catalog.name(b)}", [a, b]))
        if options:
            key = f"{int(state_id)}-{int(ddr)}"
            out.append((key, {"state_id": int(state_id), "ddr": int(ddr), "estado": state, "distrito": ddr_name}, water, options))
    return out


def _lugar(info):
    """A name the engine resolves to this district: the district's own name, else one of its municipalities."""
    from . import places

    try:
        hits = places.find(info["distrito"], info["estado"])
        if not hits.empty and len(hits[["state_id", "ddr"]].drop_duplicates()) == 1 and int(hits.iloc[0]["ddr"]) == info["ddr"]:
            return info["distrito"]
    except LookupError:
        pass
    muns = panel.read("municipality_districts")
    row = muns[(muns["state_id"] == info["state_id"]) & (muns["ddr"] == info["ddr"])].iloc[0]
    return row["municipality"]


def _init(panel_path):
    panel.use(panel_path)


def run_case(args):
    key, info, water, options, out_dir = args
    from .compare import comparar_rotaciones

    target = Path(out_dir) / key
    target.mkdir(parents=True, exist_ok=True)
    lugar = _lugar(info)
    listing, errors = [], []
    for rot_id, text, crops in options:
        name = f"{water}__{rot_id}.json"
        results = {}
        try:
            for prios in PRIORITY_SETS:
                r = comparar_rotaciones(lugar, text, estado=info["estado"], agua=water, prioridades=list(prios), escenarios=False)
                r["tendencias"].pop("detalle", None)
                r.pop("calendario_lugar", None)
                for x in r["rotaciones"]:
                    x.pop("efecto_cultivo_anterior", None)
                results[priority_key(prios)] = _round(json.loads(json.dumps(r, ensure_ascii=False, default=float)))
        except Exception as error:  # noqa: BLE001 - recorded and skipped, never filled in
            errors.append({"agua": water, "rotacion": text, "error": f"{type(error).__name__}: {error}"})
            continue
        packed = pack(results)
        assert unpack(packed, "none") == results["none"]
        (target / name).write_text(json.dumps(packed, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        first = results["none"]
        listing.append({"id": rot_id, "rotacion": text, "etiqueta": text, "archivo": f"national/{key}/{name}",
                        "secuencia": first["rotaciones"][0]["secuencia"] if first["rotaciones"] else text,
                        "distrito": first["lugar"]["distrito"], "alternativas": len(first["rotaciones"]) - 1})
    return key, info, water, lugar, listing, errors


def municipality_map(districts: dict) -> list:
    """For each place of municipios.json (same order), its district key or None."""
    places_json = json.loads(MUNICIPIOS.read_text(encoding="utf-8"))
    muns = panel.read("municipality_districts").copy()
    muns["k"] = muns["state"].map(catalog.plain) + "|" + muns["municipality"].map(catalog.plain)
    lookup = {r.k: f"{int(r.state_id)}-{int(r.ddr)}" for r in muns.itertuples()}
    rows = places_json["places"]
    keys = [lookup.get(f"{catalog.plain(s)}|{catalog.plain(m)}") for s, m, *_ in rows]
    # unmatched names (spelling differences between catalogues): the nearest matched municipality of the same state
    for i, (s, _m, lat, lon) in enumerate(rows):
        if keys[i] is not None:
            continue
        best = min(((lat - r[2]) ** 2 + (lon - r[3]) ** 2, keys[j]) for j, r in enumerate(rows) if r[0] == s and keys[j] is not None) if any(
            r[0] == s and keys[j] is not None for j, r in enumerate(rows)) else (None, None)
        keys[i] = best[1]
    return [k if k in districts else None for k in keys]


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--panel", default=str(REPO / "resources" / "district_panel_national"))
    parser.add_argument("--out", default=str(OUT))
    parser.add_argument("--jobs", type=int, default=2)
    parser.add_argument("--limit", type=int, help="only the first N district-regime cases (a quick sample)")
    args = parser.parse_args(argv)
    from .panel_store import local
    args.panel = str(local(args.panel))     # a gs:// run is downloaded once
    panel.use(args.panel)
    cases = district_cases()[: args.limit] if args.limit else district_cases()
    print(f"{len(cases)} district-regime cases, {sum(len(c[3]) for c in cases)} current rotations", flush=True)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    districts, errors, started = {}, [], time.time()
    with ProcessPoolExecutor(max_workers=args.jobs, initializer=_init, initargs=(args.panel,)) as pool:
        for i, (key, info, water, lugar, listing, errs) in enumerate(pool.map(run_case, [(*c, str(out)) for c in cases]), 1):
            d = districts.setdefault(key, {**info, "lugar": lugar, "regimenes": {}})
            if listing:
                d["regimenes"][water] = listing
            errors += [{"distrito": key, **e} for e in errs]
            if i % 10 == 0:
                print(f"  {i}/{len(cases)} in {time.time() - started:.0f}s", flush=True)
    districts = {k: v for k, v in districts.items() if v["regimenes"]}
    index = {
        "version": 1,
        "generado": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "panel": Path(args.panel).name,
        "prioridades": PRIORITIES,
        "max_prioridades": 1,
        "supuestos": "Valores por omisión del motor para todo lo que no se pregunta; sin escenarios de agua.",
        "distritos": districts,
        "municipios": municipality_map(districts),
        "errores": errors,
    }
    (out / "index.json").write_text(json.dumps(index, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {len(districts)} districts, {len(errors)} errors, in {time.time() - started:.0f}s")


if __name__ == "__main__":
    main()
