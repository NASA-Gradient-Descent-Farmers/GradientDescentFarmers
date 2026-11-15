"""Site -> municipality (point in polygon) -> SIAP district.

Boundaries: INEGI Marco Geoestadístico 2022, municipal areas (áreas geoestadísticas municipales), as
redistributed by CONABIO's geoportal (mun22gw, WGS84). Nearest-centre matching is not used: it fails near
borders, which is exactly where the Sinaloa demo site sits.
"""
from __future__ import annotations

import zipfile
from pathlib import Path

import pandas as pd
import requests

BOUNDARIES_URL = "http://www.conabio.gob.mx/informacion/gis/maps/geo/mun22gw.zip"
BOUNDARIES_NAME = "mun22gw"
PRODUCT = "INEGI Marco Geoestadístico 2022, áreas geoestadísticas municipales (CONABIO mun22gw)"


def boundaries_path(cache_root: Path, timeout: int = 300) -> Path:
    """Path of the municipal shapefile, downloading and unzipping it into its own cache folder once."""
    folder = Path(cache_root) / "inegi_boundaries"
    shp = folder / f"{BOUNDARIES_NAME}.shp"
    if shp.is_file():
        return shp
    folder.mkdir(parents=True, exist_ok=True)
    archive = folder / f"{BOUNDARIES_NAME}.zip"
    if not archive.is_file():
        tmp = archive.with_suffix(".part")
        with requests.get(BOUNDARIES_URL, stream=True, timeout=timeout) as r:
            r.raise_for_status()
            with open(tmp, "wb") as f:
                for chunk in r.iter_content(1 << 20):
                    f.write(chunk)
        tmp.replace(archive)
    with zipfile.ZipFile(archive) as z:
        for member in z.namelist():
            name = Path(member).name
            if name.startswith(BOUNDARIES_NAME + ".") and Path(name).suffix in {".shp", ".shx", ".dbf", ".prj"}:
                (folder / name).write_bytes(z.read(member))
    if not shp.is_file():
        raise FileNotFoundError(f"{BOUNDARIES_URL} did not contain {BOUNDARIES_NAME}.shp")
    return shp


def locate_points(points: list[tuple[str, float, float]], shapefile_path: Path) -> pd.DataFrame:
    """(name, lat, lon) -> one row per point with the INEGI municipality that contains it.

    Columns: site, latitude, longitude, state_id, mun_id, municipality_inegi, state_inegi. A point on no
    polygon (sea, outside Mexico) gets missing codes.
    """
    import shapefile
    from shapely.geometry import Point, shape

    reader = shapefile.Reader(str(shapefile_path), encoding="utf-8")
    found = {name: None for name, _, _ in points}
    for sr in reader.iterShapeRecords():
        x0, y0, x1, y1 = sr.shape.bbox
        hits = [(n, la, lo) for n, la, lo in points if found[n] is None and x0 <= lo <= x1 and y0 <= la <= y1]
        if not hits:
            continue
        geom = shape(sr.shape.__geo_interface__)
        rec = sr.record.as_dict()
        for n, la, lo in hits:
            if geom.covers(Point(lo, la)):
                found[n] = rec
    rows = []
    for name, lat, lon in points:
        rec = found[name]
        rows.append({"site": name, "latitude": lat, "longitude": lon,
                     "state_id": int(rec["CVE_ENT"]) if rec else None,
                     "mun_id": int(rec["CVE_MUN"]) if rec else None,
                     "municipality_inegi": rec["NOMGEO"] if rec else None,
                     "state_inegi": rec["NOM_ENT"] if rec else None})
    return pd.DataFrame(rows).astype({"state_id": "Int64", "mun_id": "Int64"})


def assign_districts(located: pd.DataFrame, weights: pd.DataFrame, primary: pd.DataFrame) -> pd.DataFrame:
    """Add each site's SIAP district.

    A site's district is its municipality's primary district (largest SIAP sown area). When SIAP records
    the municipality under more than one district, the others are listed in `other_districts` with their
    share of the municipality's sown area, because the site could belong to any of them.
    """
    out = located.merge(primary[["state_id", "mun_id", "ddr", "ddr_name", "state", "municipality"]],
                        on=["state_id", "mun_id"], how="left")
    notes, others = [], []
    for r in out.itertuples(index=False):
        if pd.isna(r.state_id):
            notes.append("outside every INEGI municipality")
            others.append("")
            continue
        if pd.isna(r.ddr):
            notes.append("municipality has no SIAP record in the weight years")
            others.append("")
            continue
        w = weights[(weights.state_id == r.state_id) & (weights.mun_id == r.mun_id)]
        total = w["sown_ha"].sum()
        rest = w[w.ddr != r.ddr]
        others.append("; ".join(f"{x.ddr_name} ({x.ddr}): {x.sown_ha / total:.0%}" for x in rest.itertuples())
                      if total > 0 else "")
        notes.append("municipality split across SIAP districts" if len(rest) else "")
    out["other_districts"] = others
    out["note"] = notes
    return out.astype({"ddr": "Int64"})
