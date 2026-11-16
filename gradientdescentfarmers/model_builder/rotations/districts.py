"""A municipality's district and the district's main current rotations, for the live API (serve.py).

The current rotations offered to a farmer ("what did you grow last year?") are the district's largest crops by SIAP area
since SINCE, each in its own season, plus the main spring-summer crop followed by the main autumn-winter crop when both
are large. Each comes with its structure ([{"pv": crop key}] ...), which the engine takes directly, so crops whose
Spanish name cannot be parsed back from text (calabaza (semilla), avena (grano)) still work.
"""
from __future__ import annotations

from . import catalog, panel, places

MIN_HA = 300
TOP_CROPS = 3
PAIR_MIN_HA = 1000
SINCE = 2016


def district_of(municipio: str, estado: str | None = None) -> dict:
    """{state_id, ddr, estado, distrito, municipio} for a municipality (or district) name. LookupError when unknown."""
    hits = places.find(municipio, estado)
    if hits.empty:
        raise LookupError(f"No encontré '{municipio}'" + (f" en {estado}" if estado else ""))
    districts = hits[["state_id", "ddr"]].drop_duplicates()
    if len(districts) > 1:
        raise LookupError(f"'{municipio}' está en varios distritos; indica el estado")
    row = hits.iloc[0]
    exact = hits[hits["mun_plain"] == catalog.plain(municipio)] if "mun_plain" in hits.columns else hits
    name = (exact.iloc[0] if len(exact) else row)["municipality"]
    return {"state_id": int(row["state_id"]), "ddr": int(row["ddr"]), "estado": row["state"], "distrito": row["ddr_name"],
            "municipio": name}


def current_rotations(state_id: int, ddr: int) -> dict:
    """{water: [{id, rotacion, etiqueta, estructura, ha}]} for the district's main crops (empty when SIAP has none)."""
    siap = panel.read("siap_crop_years")
    recent = siap[(siap["year"] >= SINCE) & (siap["state_id"] == state_id) & (siap["ddr"] == ddr)]
    if recent.empty:
        return {}
    years = siap.loc[siap["year"] >= SINCE, "year"].nunique()
    area = (recent.groupby(["water", "cycle", "crop"])["sown_ha"].sum() / years).rename("ha").reset_index()
    area = area[(area["ha"] >= MIN_HA) & area["crop"].map(catalog.is_known)]
    out = {}
    for water, g in area.groupby("water"):
        g = g.sort_values("ha", ascending=False)
        options, seen = [], set()
        for r in g.itertuples():
            if r.crop in seen:
                continue
            seen.add(r.crop)
            options.append({"id": r.crop, "rotacion": catalog.name(r.crop), "etiqueta": catalog.name(r.crop),
                            "estructura": [{r.cycle: r.crop}], "ha": round(float(r.ha))})
            if len(options) >= TOP_CROPS:
                break
        pv, oi = g[g["cycle"] == "pv"].head(1), g[g["cycle"] == "oi"].head(1)
        if len(pv) and len(oi) and pv.iloc[0]["ha"] >= PAIR_MIN_HA and oi.iloc[0]["ha"] >= PAIR_MIN_HA and pv.iloc[0]["crop"] != oi.iloc[0]["crop"]:
            a, b = pv.iloc[0]["crop"], oi.iloc[0]["crop"]
            options.append({"id": f"{a}__{b}", "rotacion": f"{catalog.name(a)}/{catalog.name(b)}",
                            "etiqueta": f"{catalog.name(a)} y luego {catalog.name(b)}", "estructura": [{"pv": a, "oi": b}],
                            "ha": round(float(min(pv.iloc[0]["ha"], oi.iloc[0]["ha"])))})
        if options:
            out[water] = options
    return out


def district(municipio: str, estado: str | None = None) -> dict:
    """The answer of GET /district: where the place is and what can be compared there."""
    d = district_of(municipio, estado)
    return {**d, "lugar": d["municipio"], "regimenes": current_rotations(d["state_id"], d["ddr"])}
