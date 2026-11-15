"""Regional SIAP references, gross income and explicit optional cost scenarios.

The initial official CSV endpoint was unreachable from both laptop and GCP.
The public DataMX redistribution is preserved byte-for-byte as JSON, hashed,
and labeled as a mirror, without claiming verification against the publisher.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

import numpy as np
import pandas as pd
import requests

from ...source_builder.siap.clean import clean as clean_siap
from .settings import CROPS
from .utils import write_json

RESOURCE_ID = "8d22bea7-25d6-44d2-bea3-53fd4b947024"
DATASET = "https://datamx.io/dataset/produccion-agricola-en-mexico-1980-2024"
DATASTORE = "https://datamx.io/api/3/action/datastore_search_sql"

STATE_COLUMNS = {
    "AÑO": "year", "CVE_ENT": "state_id", "ENTIDAD": "state", "CULTIVO": "crop",
    "VARIEDAD": "variety", "UNIDAD_MEDIDA": "unit", "CICLO": "cycle", "MODALIDAD": "modality",
    "TIPO_TECNOLOGIA": "technology", "TIPO_PRODUCCION": "production_type", "TIPO_MERCADO": "market",
    "SUPERFICIE_SEMBRADA": "sown_ha", "SUPERFICIE_COSECHADA": "harvested_ha",
    "SUPERFICIE_SINIESTRADA": "lost_ha", "VOLUMEN_PRODUCCION": "production_volume",
    "RENDIMIENTO": "yield", "PRECIO_MEDIO_RURAL": "price_mxn_per_unit",
    "VALOR_PRODUCCION": "production_value_mxn",
}


def normalize_state_export(records):
    frame = pd.DataFrame(records)
    if not set(STATE_COLUMNS).issubset(frame.columns):
        raise ValueError("SIAP state snapshot has an unsupported schema")
    frame = frame[list(STATE_COLUMNS)].rename(columns=STATE_COLUMNS)
    numeric = ["year", "state_id", "sown_ha", "harvested_ha", "lost_ha", "production_volume",
               "yield", "price_mxn_per_unit", "production_value_mxn"]
    for column in numeric:
        frame[column] = pd.to_numeric(frame[column], errors="coerce")
    frame = frame.drop_duplicates()
    grain = ["year", "state_id", "crop", "variety", "unit", "cycle", "modality",
             "technology", "production_type", "market"]
    if frame.duplicated(grain, keep=False).any():
        raise ValueError("SIAP snapshot has conflicting records at its documented grain")
    # Existing source_builder cleaning is reused. These two temporary grouping
    # labels are NOT numeric SIAP IDs and are removed before publication.
    frame["crop_id"], frame["unit_id"] = frame["crop"], frame["unit"]
    frame, cleaning = clean_siap(frame)
    cleaning["export_grain"] = grain
    cleaning["grain_key_duplicates"] = 0  # complete export grain was checked above
    return frame.drop(columns=["crop_id", "unit_id"]), cleaning


def prepare_siap_reference(root: Path, years: list[int]):
    root = Path(root) / "siap_state"
    root.mkdir(parents=True, exist_ok=True)
    raw_path, manifest_path = root / "snapshot.json", root / "manifest.json"
    if not raw_path.is_file():
        crop_names = ",".join("'" + crop["siap"].replace("'", "''") + "'" for crop in CROPS.values())
        # Catalog values and year bounds are validated internally, never SQL
        # text accepted from an HTTP caller. This public API is read-only.
        sql = (f'SELECT * FROM "{RESOURCE_ID}" WHERE "AÑO" BETWEEN {min(years)} AND {max(years)} '
               f'AND "CULTIVO" IN ({crop_names}) ORDER BY "_id" LIMIT 10000')
        response = requests.get(DATASTORE, params={"sql": sql}, timeout=(15, 90))
        response.raise_for_status()
        document = response.json()
        if not document.get("success"):
            raise ValueError("SIAP public datastore query failed")
        rows = document.get("result", {}).get("records", [])
        if not rows or len(rows) >= 10000:
            raise ValueError("SIAP snapshot is empty or possibly truncated")
        raw_path.write_bytes(response.content)
        write_json(manifest_path, {
            "source_agency": "DGSIAP/SADER", "acquisition_channel": "DataMX public CKAN datastore",
            "original_source": "https://nube.agricultura.gob.mx/cierre_agricola/",
            "dataset_url": DATASET, "resource_id": RESOURCE_ID, "query_url": response.url,
            "raw_sha256": hashlib.sha256(response.content).hexdigest(), "raw_bytes": len(response.content),
            "records": len(rows), "scope": "state, crop, variety, cycle, modality, technology, production, market",
            "verified_against_official_server": False,
            "note": "Public redistribution of SIAP; direct official server unavailable in the initial acquisition",
        })
    manifest = json.loads(manifest_path.read_text())
    if hashlib.sha256(raw_path.read_bytes()).hexdigest() != manifest["raw_sha256"]:
        raise ValueError("Cached SIAP snapshot checksum mismatch")
    frame, cleaning = normalize_state_export(json.loads(raw_path.read_text())["result"]["records"])
    available = sorted(int(year) for year in frame.year.dropna().unique())
    if not set(years).issubset(available):
        raise ValueError(f"SIAP snapshot does not cover requested years; available={available}")
    frame = frame[frame.year.isin(years)].copy()
    manifest = {**manifest, "available_years": available, "selected_years": sorted(years), "cleaning": cleaning}
    frame.to_parquet(root / "normalized.parquet", index=False)
    return frame, manifest


class EconomicReference:
    def __init__(self, frame: pd.DataFrame | None, manifest: dict, region: dict, minimum_years=3):
        self.frame, self.manifest, self.region, self.minimum_years = frame, manifest, region, minimum_years
        self.quotes = {}

    def quote(self, crop: str, regime: str):
        key = (crop, regime)
        if key in self.quotes:
            return self.quotes[key]
        if self.frame is None:
            return None
        crop_data = self.frame[(self.frame.crop == CROPS[crop]["siap"]) & self.frame.is_tonne_unit
                               & self.frame.has_harvest & ~self.frame.flag_value_mismatch
                               & (self.frame.production_volume > 0) & (self.frame.production_value_mxn > 0)
                               & (self.frame.price_mxn_per_unit > 0)].copy()
        wanted_cycle = "Otoño - Invierno" if CROPS[crop]["season"] == "cool" else "Primavera - Verano"
        wanted_mode = "Riego" if regime == "irrigated" else "Temporal"
        state_id = self.region.get("cve_ent")
        if state_id is not None:
            state = crop_data[crop_data.state_id == int(state_id)]
        else:
            state = crop_data.iloc[:0]
        scopes = [(state, "state"), (crop_data, "national_fallback")]
        for regional, scope in scopes:
            for use_mode, use_cycle in ((True, True), (False, True), (True, False), (False, False)):
                selected = regional
                if use_mode:
                    selected = selected[selected.modality == wanted_mode]
                if use_cycle:
                    selected = selected[selected.cycle == wanted_cycle]
                if selected.year.nunique() < self.minimum_years:
                    continue
                summed = selected.groupby("year")[
                    ["production_volume", "production_value_mxn", "harvested_ha"]].sum()
                values = (summed.production_value_mxn / summed.production_volume).to_dict()
                if not all(np.isfinite(value) and value > 0 for value in values.values()):
                    continue
                result = {"crop": crop, "water_regime": regime, "currency": "MXN", "unit": "MXN/t",
                          "scope": scope, "state": selected.state.iloc[0] if scope == "state" else None,
                          "cycle": wanted_cycle if use_cycle else "pooled_cycles",
                          "modality": wanted_mode if use_mode else "pooled_modalities",
                          "annual_price_mxn_t": {str(int(year)): float(value) for year, value in values.items()},
                          "annual_regional_yield_t_ha": {str(int(year)): float(row.production_volume / row.harvested_ha)
                                                             for year, row in summed.iterrows() if row.harvested_ha > 0},
                          "price_median_mxn_t": float(np.median(list(values.values()))),
                          "method": "sum production value / sum grain volume; original disjoint state export strata",
                          "source": "SIAP via DataMX", "mirror_verified_against_official": False,
                          "fallback": scope != "state" or not use_mode or not use_cycle}
                self.quotes[key] = result
                return result
        self.quotes[key] = None
        return None

    def evaluate(self, simulation: dict, costs_mxn_ha: dict):
        if not self.region.get("economics_applicable"):
            return {"applicable": False, "metric": None, "currency": None,
                    "gross_median_mxn_ha": None, "margin_median_mxn_ha": None,
                    "downside_fraction": None, "annual_price_scenarios": [], "costs_complete": False}
        planted = [campaign for campaign in simulation["campaigns"] if campaign["crop"]]
        quotes = [self.quote(campaign["crop"], simulation["water_regime"]) for campaign in planted]
        if any(quote is None for quote in quotes):
            return {"applicable": True, "available": False, "metric": None,
                    "gross_median_mxn_ha": None, "margin_median_mxn_ha": None,
                    "downside_fraction": None, "annual_price_scenarios": [], "costs_complete": False}
        common = sorted(set.intersection(*(set(quote["annual_price_mxn_t"]) for quote in quotes)))
        if len(common) < self.minimum_years:
            raise ValueError("Insufficient common SIAP price years across rotation crops")
        scenarios = [{"price_year": int(year),
                      "gross_mxn_ha": sum(campaign["marketable_grain_t_ha"] * quote["annual_price_mxn_t"][year]
                                           for campaign, quote in zip(planted, quotes))} for year in common]
        gross = np.array([scenario["gross_mxn_ha"] for scenario in scenarios])
        complete = all(campaign["crop"] in costs_mxn_ha for campaign in planted)
        cost = sum(costs_mxn_ha[campaign["crop"]] for campaign in planted) if complete else None
        center = float(np.median(gross))
        low, high = (float(value) for value in np.quantile(gross, [.1, .9]))
        return {"applicable": True, "available": True, "currency": "MXN",
                "metric": "estimated_margin" if complete else "gross_income",
                "gross_median_mxn_ha": center, "gross_p10_mxn_ha": low, "gross_p90_mxn_ha": high,
                "cost_mxn_ha": cost, "costs_complete": complete,
                "margin_median_mxn_ha": center - cost if complete else None,
                "net_profit_mxn_ha": None,
                "horizon_campaigns": len(simulation["campaigns"]),
                "downside_fraction": max(0., (center - low) / center) if center > 0 else 1.,
                "annual_price_scenarios": scenarios, "price_reference_years": [int(x) for x in common],
                "price_interval_kind": "historical price sensitivity; not a confidence or forecast interval",
                "basis": "WOFOST grain dry mass converted with stated moisture assumption × regional historical price",
                "income_field_validated": False}
