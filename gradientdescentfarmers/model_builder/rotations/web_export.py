"""Export the district rotation engine's answers for the YolIA web app's three demo places.

The web app is static (no Python on the host), so the engine is run ahead of time over a grid of the farmer inputs
the app asks for, and the answers are written as small JSON files under frontend/public/data/district/:

    python -m gradientdescentfarmers.model_builder.rotations.web_export            # all three places
    python -m gradientdescentfarmers.model_builder.rotations.web_export --place sonora --jobs 1

Grid (per place): water regime (temporal / riego) x the current rotations listed in PLACES x the farmer's
priorities (none, any one, or any two of scoring.PRIORITIES). Every other input keeps the engine's default
(stover left on the field, no animals, gentle slope, loam soil, district or default sowing calendar, no farmer
costs or yields). The live API in `serve.py` takes all of them; the web app says which inputs a precomputed
answer did not use.

Priorities only change the scores and which alternatives are chosen, not the evaluation of a rotation, so each
(place, water, current rotation) file stores every rotation once and, per priority set, the order and scores.
Nothing is computed here beyond what `comparar_rotaciones` returns; floats are rounded for size.
"""
from __future__ import annotations

import argparse
import hashlib
import itertools
import json
import time
from concurrent.futures import ProcessPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

from . import scoring

REPO = Path(__file__).resolve().parents[3]
OUT = REPO / "frontend" / "public" / "data" / "district"
FORMAT_VERSION = 1

# The three demo points of the web app (frontend/src/lib/demoLocations.ts). Municipality and state are where the
# district panel's own point-in-polygon step put each point (resources/district_three_sites.json,
# tests/model_builder/fixtures/three_districts/tables/sites.parquet). Current rotations: the district's main
# crops by SIAP area for each water regime; '/' joins the spring-summer and autumn-winter crops of one year,
# '-' separates years.
PLACES = {
    "guanajuato": {
        "municipio": "Valle de Santiago", "estado": "Guanajuato",
        "rotaciones": {
            "riego": [("maiz", "maíz", "Maíz cada año (primavera-verano)"),
                      ("maiz_trigo", "maíz/trigo", "Maíz en verano y trigo en invierno"),
                      ("maiz_cebada", "maíz/cebada", "Maíz en verano y cebada en invierno"),
                      ("sorgo_cebada", "sorgo/cebada", "Sorgo en verano y cebada en invierno"),
                      ("sorgo", "sorgo", "Sorgo cada año (primavera-verano)")],
            "temporal": [("maiz", "maíz", "Maíz de temporal cada año"),
                         ("sorgo", "sorgo", "Sorgo de temporal cada año"),
                         ("maiz_frijol", "maíz - frijol", "Maíz un año y frijol el siguiente")],
        },
    },
    "sinaloa": {
        "municipio": "Ahome", "estado": "Sinaloa",
        "rotaciones": {
            "riego": [("maiz", "maíz", "Maíz cada año (otoño-invierno)"),
                      ("sorgo_maiz", "sorgo/maíz", "Sorgo en verano y maíz en invierno"),
                      ("frijol", "frijol", "Frijol cada año (otoño-invierno)"),
                      ("trigo", "trigo", "Trigo cada año (otoño-invierno)")],
            "temporal": [("ajonjoli", "ajonjolí", "Ajonjolí de temporal cada año"),
                         ("sorgo", "sorgo", "Sorgo de temporal cada año"),
                         ("cacahuate", "cacahuate", "Cacahuate de temporal cada año")],
        },
    },
    "sonora": {
        "municipio": "Bácum", "estado": "Sonora",
        "rotaciones": {
            "riego": [("trigo", "trigo", "Trigo cada año (otoño-invierno)"),
                      ("soya_trigo", "soya/trigo", "Soya en verano y trigo en invierno"),
                      ("maiz", "maíz", "Maíz cada año"),
                      ("trigo_maiz", "trigo - maíz", "Trigo un año y maíz el siguiente")],
            "temporal": [("sorgo", "sorgo", "Sorgo de temporal cada año")],
        },
    },
}

# What the static files assume for the inputs they do not vary (the engine's own defaults).
DEFAULTS = {"residuo": "dejar", "tiene_animales": False, "pendiente": "ligera", "suelo": None, "mes_siembra": None,
            "mes_cosecha": None, "costos": None, "rendimiento_propio": None}


def priority_sets():
    keys = sorted(scoring.PRIORITIES)
    return [()] + [(k,) for k in keys] + list(itertools.combinations(keys, 2))


def priority_key(priorities) -> str:
    return "+".join(sorted(priorities)) or "none"


def _round(x):
    if isinstance(x, float):
        return round(x, 2) if abs(x) >= 100 else round(x, 4)
    if isinstance(x, list):
        return [_round(v) for v in x]
    if isinstance(x, dict):
        return {k: _round(v) for k, v in x.items()}
    return x


def _sig(obj) -> str:
    return hashlib.sha1(json.dumps(obj, ensure_ascii=False, sort_keys=True).encode()).hexdigest()[:12]


def pack(results: dict[str, dict]) -> dict:
    """{priority key: result} -> one file: what all results share once, rotations once, the rest per priority key."""
    keys = list(results)
    first = results[keys[0]]
    common, rotations, variants = {}, {}, {k: {} for k in keys}
    for field in first:
        if field == "rotaciones":
            continue
        values = [results[k].get(field) for k in keys]
        if all(_sig(v) == _sig(values[0]) for v in values):
            common[field] = values[0]
        else:
            for k, v in zip(keys, values):
                variants[k][field] = v
    for k in keys:
        order, scores = [], []
        for rotation in results[k]["rotaciones"]:
            body = {f: v for f, v in rotation.items() if f != "puntaje_prioridades"}
            s = _sig(body)
            rotations.setdefault(s, body)
            order.append(s)
            scores.append(rotation.get("puntaje_prioridades"))
        variants[k]["rotaciones"] = order
        variants[k]["puntajes"] = scores
    return {"common": common, "rotations": rotations, "variants": variants}


def unpack(packed: dict, key: str) -> dict:
    """The inverse of pack for one priority key (what the web app does in src/lib/district.ts)."""
    v = packed["variants"][key]
    out = {**packed["common"], **{f: x for f, x in v.items() if f not in ("rotaciones", "puntajes")}}
    out["rotaciones"] = [{**packed["rotations"][s], "puntaje_prioridades": p} for s, p in zip(v["rotaciones"], v["puntajes"])]
    return out


def export_place(place_id: str, panel_path: str | None = None, out_dir: str | None = None) -> dict:
    from . import RotationModelBuilder

    spec = PLACES[place_id]
    engine = RotationModelBuilder().build(panel_path, {})
    target = Path(out_dir or OUT) / place_id
    target.mkdir(parents=True, exist_ok=True)
    listing = {"municipio": spec["municipio"], "estado": spec["estado"], "regimenes": {}, "errores": []}
    for agua, options in spec["rotaciones"].items():
        listing["regimenes"][agua] = []
        for rot_id, text, label in options:
            results, started = {}, time.time()
            try:
                for priorities in priority_sets():
                    r = engine.compare(spec["municipio"], text, estado=spec["estado"], agua=agua,
                                       prioridades=list(priorities), escenarios=True)
                    results[priority_key(priorities)] = _round(json.loads(json.dumps(r, ensure_ascii=False, default=float)))
            except Exception as error:  # noqa: BLE001 - recorded and skipped, never filled in
                listing["errores"].append({"agua": agua, "rotacion": text, "error": f"{type(error).__name__}: {error}"})
                print(f"[{place_id}] {agua} {text}: {error}", flush=True)
                continue
            packed = pack(results)
            assert unpack(packed, "none") == results["none"]
            name = f"{agua}__{rot_id}.json"
            (target / name).write_text(json.dumps(packed, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
            first = results["none"]
            listing["regimenes"][agua].append({
                "id": rot_id, "rotacion": text, "etiqueta": label, "archivo": f"{place_id}/{name}",
                "secuencia": first["rotaciones"][0]["secuencia"] if first["rotaciones"] else text,
                "distrito": first["lugar"]["distrito"], "alternativas": len(first["rotaciones"]) - 1,
            })
            print(f"[{place_id}] {agua} {text}: {len(results)} priority sets in {time.time() - started:.0f}s", flush=True)
    return listing


def manifest_summary(panel_path: str | None) -> dict:
    from . import DEFAULT_PANEL

    path = Path(panel_path) if panel_path else DEFAULT_PANEL
    try:
        manifest = json.loads((path / "manifest.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {"panel": str(path.name)}
    keep = ("run_id", "created_at", "built_at", "contract_version", "sources")
    return {"panel": path.name, **{k: manifest[k] for k in keep if k in manifest}}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--place", choices=sorted(PLACES), action="append", help="only these places (repeatable)")
    parser.add_argument("--panel", help="district panel run (default: the committed national panel)")
    parser.add_argument("--out", default=str(OUT))
    parser.add_argument("--jobs", type=int, default=3)
    args = parser.parse_args(argv)
    ids = args.place or list(PLACES)
    out = Path(args.out)
    index_path = out / "index.json"
    index = json.loads(index_path.read_text(encoding="utf-8")) if index_path.is_file() else {"lugares": {}}
    with ProcessPoolExecutor(max_workers=max(1, min(args.jobs, len(ids)))) as pool:
        listings = dict(zip(ids, pool.map(export_place, ids, [args.panel] * len(ids), [str(out)] * len(ids))))
    index.update({
        "version": FORMAT_VERSION,
        "generado": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "motor": "gradientdescentfarmers.model_builder.rotations (comparar_rotaciones)",
        "panel": manifest_summary(args.panel),
        "prioridades": [{"id": k, "etiqueta": scoring.PRIORITY_LABELS[k]} for k in sorted(scoring.PRIORITIES)],
        "max_prioridades": 2,
        "supuestos": DEFAULTS,
    })
    index["lugares"].update(listings)
    out.mkdir(parents=True, exist_ok=True)
    index_path.write_text(json.dumps(index, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"wrote {index_path}")


if __name__ == "__main__":
    main()
