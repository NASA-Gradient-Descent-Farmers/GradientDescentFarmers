"""Pinned crop parameters and official regional data, cached for offline reuse."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import shutil
import time

import requests
import yaml
from shapely.geometry import Point, shape

from .settings import CROPS, ModelSettings


def prepare_crop_parameters(root: Path, settings: ModelSettings) -> dict:
    directory = Path(root) / "crops" / settings.crop_parameter_commit
    directory.mkdir(parents=True, exist_ok=True)
    files = {}
    for crop in settings.crops:
        path = directory / f"{crop}.yaml"
        url = f"https://raw.githubusercontent.com/ajwdewit/WOFOST_crop_parameters/{settings.crop_parameter_commit}/{crop}.yaml"
        if not path.is_file():
            response = requests.get(url, timeout=45)
            response.raise_for_status()
            yaml.safe_load(response.content)
            path.write_bytes(response.content)
        files[crop] = {"url": url, "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                       "variety": CROPS[crop]["variety"]}
    (directory / "crops.yaml").write_text(yaml.safe_dump({"available_crops": settings.crops}))
    manifest = {"commit": settings.crop_parameter_commit, "files": files,
                "local_path": str(directory), "cultivars_field_validated": False}
    (directory / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    return manifest


def _official_municipality(document, point):
    matches = [feature["properties"] for feature in document["features"]
               if shape(feature["geometry"]).covers(point)]
    if len(matches) > 1:
        raise ValueError("Coordinate is on an ambiguous municipality boundary")
    return matches[0] if matches else None


def resolve_region(root: Path, farmer: dict, state_hint: str | None = None) -> dict:
    if farmer.get("country_iso3") != "MEX":
        return {"country": farmer.get("country_iso3"), "economics_applicable": False}
    root = Path(root)
    root.mkdir(parents=True, exist_ok=True)
    point = Point(farmer["longitude"], farmer["latitude"])
    paths = list(root.glob("inegi_*.geojson"))
    errors = []
    for path in paths:
        found = _official_municipality(json.loads(path.read_text()), point)
        if found:
            return {"country": "MEX", "economics_applicable": True, **found,
                    "method": "INEGI official municipality polygon contains point",
                    "geography_sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                    "geography_file": str(path), "geography_errors": errors}
    # Optional state hint is checked against the polygon, never blindly trusted.
    if state_hint:
        try:
            response = requests.get(f"https://gaia.inegi.org.mx/wscatgeo/v2/geo/mgem/{state_hint}", timeout=30)
            response.raise_for_status()
            document = response.json()
            found = _official_municipality(document, point)
            if not found:
                raise ValueError("state_id_hint does not contain the requested coordinate")
            path = root / f"inegi_{state_hint}.geojson"
            path.write_bytes(response.content)
            return resolve_region(root, farmer)
        except requests.RequestException as exc:
            errors.append(type(exc).__name__)
    # If a geospatial service cannot resolve a point, retain a clearly labeled
    # national price fallback. Never assign a municipality by nearest centroid.
    return {"country": "MEX", "economics_applicable": True,
            "method": "national fallback; municipality unresolved", "geography_errors": errors}
