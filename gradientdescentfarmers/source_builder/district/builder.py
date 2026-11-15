"""DistrictPanelBuilder: sites -> SIAP districts -> the district panel described in DISTRICT_PANEL_CONTRACT.md.

Order: locate the sites (INEGI boundaries), read SIAP (national crop table and which municipalities make up
each district), then fetch NASA and other sources for the municipalities of the target districts only.
Every source records its own status; a source that fails or lacks credentials leaves its tables out and
says why. Nothing missing is filled with invented values.
"""
from __future__ import annotations

import hashlib
import json
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd

from . import climate, grace, locate, observed, siap, soil
from .common import DISTRICT, UNIT, DistrictSettings, SourceResult, municipalities, utcnow

SCHEMA_VERSION = "district-panel/0.1"
CORE = ("siap", "power")

PROVENANCE = {
    "inegi_boundaries": {"product": locate.PRODUCT, "url": locate.BOUNDARIES_URL},
    "siap": {"product": siap.PRODUCT, "url": siap.URL.format(year="{year}"), "spatial": "SIAP district (DDR); rows by municipality"},
    "power": {"product": climate.POWER_PRODUCT, "url": "https://power.larc.nasa.gov/api/temporal/daily/point",
              "spatial": "MERRA-2 cell centre (0.5 x 0.625 deg) of each municipality point", "temporal": "daily"},
    "chirps": {"product": climate.CHIRPS_PRODUCT, "url": climate.CHIRPS_COG, "spatial": "0.05 deg, mean within 10 km",
               "temporal": "monthly"},
    "grace": {"product": grace.PRODUCT, "url": grace.URL, "spatial": "1-degree equal-area mascons (~300 km resolution)",
              "temporal": "monthly"},
    "ndvi": {"product": f"{observed.NDVI_PRODUCT}; weights: {observed.CROPLAND_PRODUCT}",
             "spatial": "0.05 deg, cropland-weighted within 15 km", "temporal": "monthly"},
    "smap": {"product": observed.SMAP_PRODUCT, "spatial": "9 km EASE-Grid 2.0, mean within 10 km", "temporal": "daily"},
    "gldas": {"product": soil.GLDAS_PRODUCT, "url": soil.GLDAS_URL, "spatial": "0.25 deg nearest cell"},
    "igbp": {"product": soil.IGBP_PRODUCT, "doi": soil.IGBP_DOI, "spatial": "5 arc-min cell"},
}

KEYS = {
    "sites": ["site"],
    "municipality_districts": UNIT,
    "municipality_district_weights": [*UNIT, "ddr"],
    "siap_crop_years": ["year", *DISTRICT, "crop", "cycle", "water"],
    "climate_municipal": [*UNIT, "month"],
    "climate_municipal_years": [*UNIT, "year", "month"],
    "climate_district": [*DISTRICT, "month"],
    "climate_district_years": [*DISTRICT, "year", "month"],
    "power_cells": UNIT,
    "chirps_municipal_years": [*UNIT, "year", "month"],
    "chirps_district_years": [*DISTRICT, "year", "month"],
    "observed_municipal": [*UNIT, "month"],
    "observed_district": [*DISTRICT, "month"],
    "grace_municipal": UNIT,
    "grace_district": DISTRICT,
    "grace_years": ["year", "mascon"],
    "soil_municipal": UNIT,
}
RANGES = {
    "rain": (0, 3000), "rain_p20": (0, 3000), "et0": (0, 400), "tmin": (-30, 45), "tmax": (-20, 55),
    "frost_prob": (0, 1), "frost_nights": (0, 31), "heat_days": (0, 31), "ndvi": (-0.3, 1), "ndvi_p20": (-0.3, 1),
    "ndvi_p80": (-0.3, 1), "smap_rootzone": (0, 0.9), "smap_relative": (0, 1), "sown_ha": (0, 5e6),
    "production_t": (0, 5e7), "sand": (0, 1), "silt": (0, 1), "clay": (0, 1), "weight_ha": (1, 5e6),
}


def _log(msg: str):
    print(f"[district] {msg}", file=sys.stderr, flush=True)


class DistrictPanelBuilder:
    def __init__(self, settings: DistrictSettings, log=_log):
        self.s = settings
        self.log = log
        self.results: dict[str, SourceResult] = {}
        self.tables: dict[str, pd.DataFrame] = {}
        self.run_id = None
        self.run_dir: Path | None = None

    # -- helpers --
    def _run(self, source: str, fn):
        """Run one source step, recording status, timing and errors instead of raising."""
        r = SourceResult(source=source, started_utc=utcnow())
        self.results[source] = r
        if source not in ("inegi_boundaries", *CORE) and not self.s.enabled(source):
            r.status = "not_requested"
            return r
        t0 = time.time()
        try:
            out = fn(r)
            if out:
                r.tables.update(out)
            if r.status == "not_requested":
                r.status = "available"
        except Exception as exc:
            msg = repr(exc)
            r.errors.append(msg[:2000])
            r.status = "missing" if _is_credentials_error(exc) else "error"
            if r.status == "missing":
                r.warnings.append("Earthdata credentials not configured: set EARTHDATA_TOKEN or "
                                  "EARTHDATA_USERNAME/EARTHDATA_PASSWORD in gradientdescentfarmers/source_builder/.env")
            self.log(f"{source}: {r.status}: {msg[:300]}")
        r.seconds = time.time() - t0
        r.provenance = {**PROVENANCE.get(source, {}), "retrieved_utc": r.started_utc}
        return r

    # -- steps --
    def build(self, export: bool = True) -> dict:
        s = self.s
        self.run_id = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime()) + "_" + hashlib.sha256(
            s.model_dump_json().encode()).hexdigest()[:8]
        self.run_dir = Path(s.output_root) / "runs" / self.run_id
        self.run_dir.mkdir(parents=True, exist_ok=True)
        points_in = [(x.name, x.latitude, x.longitude) for x in s.sites]

        loc = self._run("inegi_boundaries", lambda r: {"located": locate.locate_points(
            points_in, locate.boundaries_path(s.cache_root, s.http_timeout_s))})
        sp = self._run("siap", lambda r: siap.build(s.cache_root, s.siap_years, s.weight_years,
                                                     s.district_membership, s.http_timeout_s, self.log))
        if loc.status != "available" or sp.status != "available":
            return self._finish(export, fatal="site location or SIAP failed: districts cannot be resolved")

        weights_all = sp.tables["municipality_district_weights"]
        primary = sp.tables["municipality_districts"]
        sites = locate.assign_districts(loc.tables.pop("located"), weights_all, primary)
        self.tables.update({"sites": sites, **sp.tables})
        for row in sites.itertuples(index=False):
            if row.note:
                loc.warnings.append(f"{row.site}: {row.note}" + (f" ({row.other_districts})" if row.other_districts else ""))
        targets = sites.dropna(subset=["ddr"])[["state_id", "ddr"]].drop_duplicates().astype("int64")
        if targets.empty:
            return self._finish(export, fatal="no site falls in a SIAP district")
        weights = weights_all.merge(targets, on=DISTRICT)
        site_muns = sites.dropna(subset=["mun_id"])[UNIT].astype("int64")
        wanted = pd.concat([weights[UNIT], site_muns]).drop_duplicates()
        mun = municipalities()
        points = wanted.merge(mun[[*UNIT, "municipality", "lat", "lon", "alt_m"]], on=UNIT, how="left")
        no_point = points[points["lat"].isna()]
        if len(no_point):
            sp.warnings.append(f"{len(no_point)} municipalities in the target districts have no reference point "
                               f"and are left out: {no_point[UNIT].to_dict('records')}")
        points = points.dropna(subset=["lat"]).reset_index(drop=True)
        self.points, self.weights = points, weights
        self.log(f"{len(sites)} sites -> {len(targets)} districts, {len(points)} municipalities")

        def run_climate(r):
            tables, ok, err = climate.build(points, weights, s, self.run_dir, self.log)
            cr = SourceResult(source="chirps", started_utc=r.started_utc,
                              status="available" if ok else ("not_requested" if not s.enabled("chirps") else "error"),
                              provenance={**PROVENANCE["chirps"], "retrieved_utc": r.started_utc})
            if err:
                cr.errors.append(err[:2000])
                r.warnings.append("Rain not corrected with CHIRPS (CHIRPS failed); POWER rain used as is")
            self.results["chirps"] = cr
            return tables

        self._run("power", run_climate)
        self._run("grace", lambda r: grace.build(points, weights, s.cache_root, max(s.http_timeout_s, 300)))
        nd = self._run("ndvi", lambda r: {"_ndvi": observed.ndvi_monthly(points, s, r.warnings)})
        sm = self._run("smap", lambda r: {"_smap": observed.smap_monthly(points, s, self.log)})
        ndvi_t, smap_t = nd.tables.pop("_ndvi", None), sm.tables.pop("_smap", None)
        if ndvi_t is not None or smap_t is not None:
            self.tables.update(observed.combine(points, weights, ndvi_t, smap_t))
        gl = self._run("gldas", lambda r: {"_gldas": soil.gldas(points, s.cache_root)})
        ig = self._run("igbp", lambda r: {"_igbp": soil.igbp(points, s.cache_root)})
        g_t, i_t = gl.tables.pop("_gldas", None), ig.tables.pop("_igbp", None)
        if g_t is not None or i_t is not None:
            base = points[UNIT].astype("int64")
            for part in (g_t, i_t):
                if part is not None:
                    base = base.merge(part, on=UNIT, how="left")
            for c in soil.COLUMNS:
                if c not in base:
                    base[c] = np.nan
            self.tables["soil_municipal"] = base[[*UNIT, *soil.COLUMNS]]
        for name in ("power", "grace"):
            self.tables.update(self.results[name].tables)
        return self._finish(export)

    def _finish(self, export: bool, fatal: str | None = None) -> dict:
        requested = [k for k in self.results if k != "inegi_boundaries" and self.results[k].status != "not_requested"]
        bad = [k for k in requested if self.results[k].status in ("error", "missing")]
        if fatal or any(self.results.get(k) is None or self.results[k].status != "available" for k in CORE):
            state = "failed"
        else:
            state = "partial" if bad else "complete"
        self.build_state = state
        validation = {name: validate(name, t, self) for name, t in self.tables.items()}
        summary = {
            "schema_version": SCHEMA_VERSION, "run_id": self.run_id, "created_utc": utcnow(), "build_state": state,
            "fatal": fatal, "output_dir": str(self.run_dir), "tables": {k: len(v) for k, v in self.tables.items()},
            "sources": {k: v.status for k, v in self.results.items()},
        }
        if export and self.run_dir is not None:
            self.export(summary, validation)
        return summary

    def export(self, summary: dict, validation: dict):
        tdir = self.run_dir / "tables"
        tdir.mkdir(parents=True, exist_ok=True)
        records = {}
        for name, t in self.tables.items():
            path = tdir / f"{name}.parquet"
            t.to_parquet(path, index=False)
            records[name] = {"path": str(path.relative_to(self.run_dir)), "rows": int(len(t)),
                             "columns": list(map(str, t.columns)),
                             "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}
        write = lambda n, obj: _atomic_json(self.run_dir / n, obj)
        write("availability.json", {k: v.summary() for k, v in self.results.items()})
        write("provenance.json", {k: v.provenance for k, v in self.results.items()})
        write("validation.json", validation)
        write("manifest.json", {**summary, "tables": records, "settings": json.loads(self.s.model_dump_json())})
        _atomic_json(Path(self.s.output_root) / "latest.json",
                     {"run_id": self.run_id, "path": str(self.run_dir), "build_state": summary["build_state"],
                      "note": "last run exported, not last run approved"})


def _is_credentials_error(exc: Exception) -> bool:
    text = repr(exc).lower()
    return any(w in text for w in ("credentials not found", "earthdata credentials", "login failed",
                                   "401", "unauthorized", "netrc"))


def _atomic_json(path: Path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(obj, ensure_ascii=False, indent=2, default=_json_default), encoding="utf-8")
    tmp.replace(path)


def _json_default(o):
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, (np.floating,)):
        return None if not np.isfinite(o) else float(o)
    if isinstance(o, (np.bool_,)):
        return bool(o)
    if isinstance(o, Path):
        return str(o)
    return str(o)


def validate(name: str, t: pd.DataFrame, builder: DistrictPanelBuilder | None = None) -> dict:
    """Per-table checks: keys present and unique, values in plausible ranges, missing shares, coverage."""
    out = {"rows": int(len(t)), "checks": {}, "missing_share": {}}
    keys = KEYS.get(name, [])
    missing_keys = [k for k in keys if k not in t]
    out["checks"]["keys_present"] = not missing_keys
    if keys and not missing_keys:
        out["checks"]["keys_unique"] = not bool(t.duplicated(keys).any())
    for col, (lo, hi) in RANGES.items():
        if col in t:
            v = pd.to_numeric(t[col], errors="coerce").dropna()
            out["checks"][f"{col}_in_range"] = bool(((v >= lo) & (v <= hi)).all()) if len(v) else True
    for col in t.columns:
        if col not in keys and t[col].dtype.kind in "fi":
            out["missing_share"][str(col)] = round(float(t[col].isna().mean()), 4) if len(t) else 1.0
    if builder is not None and hasattr(builder, "points"):
        if name.endswith("_district") or name.endswith("_district_years"):
            got = t[DISTRICT].drop_duplicates() if set(DISTRICT) <= set(t) else pd.DataFrame(columns=DISTRICT)
            exp = builder.weights[DISTRICT].drop_duplicates()
            out["coverage"] = round(len(exp.merge(got, on=DISTRICT)) / max(len(exp), 1), 4)
        elif name.endswith("_municipal") or name.endswith("_municipal_years"):
            got = t[UNIT].drop_duplicates() if set(UNIT) <= set(t) else pd.DataFrame(columns=UNIT)
            exp = builder.points[UNIT].drop_duplicates()
            out["coverage"] = round(len(exp.merge(got, on=UNIT)) / max(len(exp), 1), 4)
    out["passed"] = all(out["checks"].values()) and out.get("coverage", 1.0) == 1.0
    return out
