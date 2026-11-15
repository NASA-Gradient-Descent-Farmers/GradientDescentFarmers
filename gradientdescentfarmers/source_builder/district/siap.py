"""SIAP agricultural statistics: district x crop x cycle x water regime, and which municipalities make up
each district.

Source: SIAP open data, one national CSV per year since 2003 (https://nube.agricultura.gob.mx/datosAbiertos/
Agricola.php). Each row is a municipality, a SIAP district (DDR) and CADER, a cycle, a water regime and a crop.
SIAP's municipal numbers are largely district estimates, so outcomes are used at district level.

The crop table is always national: the engine falls back from the district to the state and the nation
when a district has no record of a crop, so cutting it to the target districts would change its answers.
"""
from __future__ import annotations

from io import BytesIO
from pathlib import Path

import numpy as np
import pandas as pd
import requests

from .common import siap_crop_names, plain

URL = "https://nube.agricultura.gob.mx/index.php?view=10AE434F-A2158368-A120BC5A-EDF4AFAA&ANIO={year}"
PRODUCT = "SIAP, Estadística de la producción agrícola (datos abiertos), national CSV per year"
CYCLES = {1: "oi", 2: "pv"}
WATER = {1: "riego", 2: "temporal"}
NUMERIC = ["sembrada", "cosechada", "siniestrada", "volumenproduccion", "valorproduccion"]
REQUIRED = {"anio", "idestado", "nomestado", "idddr", "nomddr", "idmunicipio", "nommunicipio", "idciclo",
            "idmodalidad", "nomcultivo", "nomunidad", *NUMERIC}
COLUMN_ALIASES = {"nomcultivo sin um": "nomcultivo", "preciomediorural": "precio"}


def normalize(frame: pd.DataFrame) -> pd.DataFrame:
    frame = frame.rename(columns=lambda c: str(c).strip().lower())
    return frame.rename(columns=COLUMN_ALIASES)


def _parse(content: bytes) -> pd.DataFrame:
    return normalize(pd.read_csv(BytesIO(content), encoding="cp1252", low_memory=False))


def year_path(year: int, cache_root: Path, timeout: int = 120) -> Path:
    """Cached national SIAP file for `year`; downloaded and validated the first time."""
    folder = Path(cache_root) / "siap"
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / f"{year}.csv"
    if path.is_file():
        return path
    r = requests.get(URL.format(year=year), timeout=timeout)
    r.raise_for_status()
    frame = _parse(r.content)
    missing = REQUIRED - set(frame)
    # Validate before caching, so an error page never becomes a permanent input.
    if missing or len(frame) == 0 or not (pd.to_numeric(frame["anio"], errors="coerce") == year).all():
        raise ValueError(f"Unexpected SIAP file for {year}: missing columns {sorted(missing)}")
    tmp = path.with_suffix(".part")
    tmp.write_bytes(r.content)
    tmp.replace(path)
    return path


def read_year(year: int, cache_root: Path, timeout: int = 120) -> pd.DataFrame:
    return _parse(year_path(year, cache_root, timeout).read_bytes())


def extract_year(frame: pd.DataFrame) -> pd.DataFrame:
    """One SIAP year -> district x crop x cycle x water rows for the catalogue crops (tonnes only)."""
    names = siap_crop_names()
    crop = frame["nomcultivo"].map(plain).map(names)
    keep = crop.notna() & frame["idciclo"].isin(CYCLES) & frame["idmodalidad"].isin(WATER)
    keep &= frame["nomunidad"].astype(str).map(plain).str.startswith("tonelada")
    f = frame.loc[keep, ["anio", "idestado", "nomestado", "idddr", "nomddr", "idciclo", "idmodalidad", *NUMERIC]].copy()
    f["crop"] = crop[keep]
    f[NUMERIC] = f[NUMERIC].apply(pd.to_numeric, errors="coerce")
    f["cycle"] = f.pop("idciclo").map(CYCLES)
    f["water"] = f.pop("idmodalidad").map(WATER)
    out = (f.groupby(["anio", "idestado", "idddr", "crop", "cycle", "water"], as_index=False)
           .agg(state=("nomestado", "first"), ddr_name=("nomddr", "first"),
                **{c: (c, lambda s: s.sum(min_count=1)) for c in NUMERIC}))
    out = out.rename(columns={"anio": "year", "idestado": "state_id", "idddr": "ddr", "sembrada": "sown_ha",
                              "cosechada": "harvested_ha", "siniestrada": "lost_ha",
                              "volumenproduccion": "production_t", "valorproduccion": "value_mxn"})
    return out[["year", "state_id", "ddr", "crop", "cycle", "water", "state", "ddr_name",
                "sown_ha", "harvested_ha", "lost_ha", "production_t", "value_mxn"]]


def membership_year(frame: pd.DataFrame) -> pd.DataFrame:
    """One year's (municipality, district) pairs with their sown area of annual crops (both cycles)."""
    f = frame[frame["idciclo"].isin([1, 2])].copy()
    f["sembrada"] = pd.to_numeric(f["sembrada"], errors="coerce")
    year = int(pd.to_numeric(f["anio"], errors="coerce").dropna().iloc[0]) if len(f) else None
    g = (f.groupby(["idestado", "idmunicipio", "idddr"], as_index=False)
         .agg(sown_ha=("sembrada", "sum"), rows=("sembrada", "size"),
              state=("nomestado", "last"), municipality=("nommunicipio", "last"), ddr_name=("nomddr", "last")))
    g["year"] = year
    return g.rename(columns={"idestado": "state_id", "idmunicipio": "mun_id", "idddr": "ddr"})


def memberships(yearly: list[pd.DataFrame], mode: str = "shared") -> tuple[pd.DataFrame, pd.DataFrame]:
    """(weights, primary) from the per-year pairs.

    weights: one row per (state_id, mun_id, ddr) with `sown_ha` (mean over the years, absent years as 0)
    and `weight_ha` = sown_ha + 1, so every municipality counts a little.
      mode "shared": a municipality belongs to every district SIAP records it in, weighted by its sown
        area there. SIAP splits some municipalities across districts (Guasave, Sinaloa, is recorded under
        Los Mochis, Guasave and Guamúchil).
      mode "primary": each municipality belongs only to its primary district, with its whole sown area,
        as in field-shift's panel. Kept to reproduce field-shift exactly.
    primary: one row per municipality, the district SIAP lists it under in the most years (ties: larger
        sown area), with names: the `municipality_districts` table.
    """
    pairs = pd.concat(yearly, ignore_index=True)
    n_years = pairs["year"].nunique()
    stats = (pairs.groupby(["state_id", "mun_id", "ddr"], as_index=False)
             .agg(years=("year", "nunique"), sown_total=("sown_ha", "sum")))
    stats["sown_ha"] = stats["sown_total"] / n_years
    primary = (stats.sort_values(["years", "sown_ha"]).drop_duplicates(["state_id", "mun_id"], keep="last")
               [["state_id", "mun_id", "ddr"]])
    last = pairs.sort_values("year")
    mun_names = last.drop_duplicates(["state_id", "mun_id"], keep="last")[["state_id", "mun_id", "state", "municipality"]]
    ddr_names = last.drop_duplicates(["state_id", "ddr"], keep="last")[["state_id", "ddr", "ddr_name"]]
    primary = primary.merge(mun_names, on=["state_id", "mun_id"]).merge(ddr_names, on=["state_id", "ddr"])
    primary = primary[["state_id", "mun_id", "ddr", "state", "municipality", "ddr_name"]].sort_values(["state_id", "mun_id"])
    if mode == "primary":
        total = stats.groupby(["state_id", "mun_id"], as_index=False)["sown_ha"].sum()
        weights = primary[["state_id", "mun_id", "ddr"]].merge(total, on=["state_id", "mun_id"])
    else:
        weights = stats[["state_id", "mun_id", "ddr", "sown_ha"]].copy()
    weights = weights.merge(ddr_names, on=["state_id", "ddr"])
    weights["weight_ha"] = weights["sown_ha"] + 1.0
    flag = weights.merge(primary[["state_id", "mun_id", "ddr"]].assign(p=1), on=["state_id", "mun_id", "ddr"], how="left")
    weights["is_primary"] = flag["p"].notna().to_numpy()
    return (weights.sort_values(["state_id", "ddr", "mun_id"]).reset_index(drop=True),
            primary.reset_index(drop=True))


def build(cache_root: Path, siap_years: tuple[int, int], weight_years: tuple[int, int], mode: str,
          timeout: int = 120, log=print) -> dict[str, pd.DataFrame]:
    """National crop table, municipality weights and primary districts."""
    crops, pairs = [], []
    years = range(min(siap_years[0], weight_years[0]), max(siap_years[1], weight_years[1]) + 1)
    for year in years:
        frame = read_year(year, cache_root, timeout)
        if siap_years[0] <= year <= siap_years[1]:
            crops.append(extract_year(frame))
        if weight_years[0] <= year <= weight_years[1]:
            pairs.append(membership_year(frame))
        log(f"SIAP {year}: {len(frame):,} rows")
    weights, primary = memberships(pairs, mode)
    table = pd.concat(crops, ignore_index=True)
    for c in ("year", "state_id", "ddr"):
        table[c] = table[c].astype("int64")
    return {"siap_crop_years": table, "municipality_district_weights": weights, "municipality_districts": primary}
