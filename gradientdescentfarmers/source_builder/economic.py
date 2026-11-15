"""DGSIAP/SIAP economic reference source, 2003-2025, at Rural Development District level.

The source reads the SIAP "Cierre agricola" municipal files, whose rows already
carry the official territorial hierarchy ``Idestado -> Idddr -> Idcader ->
Idmunicipio``, and aggregates them to the district (``Idddr``) for the pilot
sites declared in ``configs/siap_mapping_local.json``.

Rules enforced here:

* Only the municipal files (2003-2025) are read. The state-level 2000-2002 files
  are never ingested and state values are never disaggregated to a district.
* Nothing is interpolated or imputed. Rows with a non-tonne unit, a null, or a
  non-positive harvest, volume, value or price are discarded and counted.
* District yield and price are always ratios of district totals
  (``volume / harvested`` and ``value / volume``), never a mean of municipal ratios.
* ``Riego`` and ``Temporal``, and the productive cycles, are never merged.
* ``net_margin_mxn_ha`` stays missing unless an explicit cost is supplied.
"""
from __future__ import annotations

import json
import math
import os
import re
import unicodedata
import warnings
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Mapping, Sequence

import numpy as np
import pandas as pd

from .base import SourceBuilder

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_CONFIG_FILE = "resources/application.conf"
DEFAULT_MAPPING_FILE = "configs/siap_mapping_local.json"
CONFIG_SECTION = "economic"

AGGREGATION_LEVEL = "district_ddr"
CURRENCY = "MXN"
REFERENCE_LEVEL_SIAP = "district_ddr_siap_reference"
REFERENCE_LEVEL_MUNICIPAL_COST = "district_ddr_aggregated"
REFERENCE_LEVEL_STATE_COST = "state_fallback"
REFERENCE_LEVEL_USER_COST = "user_explicit"
# MVP stress test: yield and price both fall 20% at once, so revenue keeps 0.8 * 0.8.
STRESS_MINUS20_FACTOR = 0.64
COST_COLUMN = "explicit_cost_mxn_ha"
EARTH_RADIUS_KM = 6371.0088
MODALITIES = {"riego": "Riego", "temporal": "Temporal"}

DistrictKey = tuple[int, int]  # (Idestado, Idddr)

DISTRICT_KEYS = [
    "Anio", "Idestado", "Nomestado", "Idddr", "Nomddr", "Idciclo",
    "Nomcicloproductivo", "Idmodalidad", "Nommodalidad", "Idcultivo", "crop",
]
MUNICIPAL_COLUMNS = [
    "Anio", "Idestado", "Nomestado", "Idddr", "Nomddr", "Idcader", "Nomcader",
    "Idmunicipio", "Nommunicipio", "Idciclo", "Nomcicloproductivo", "Idmodalidad",
    "Nommodalidad", "Idcultivo", "crop", "planted_ha", "harvested_ha", "damaged_ha",
    "volume_t", "rural_price_mxn_t", "production_value_mxn",
]
DISTRICT_COLUMNS = DISTRICT_KEYS + [
    "planted_ha", "harvested_ha", "damaged_ha", "volume_t", "production_value_mxn",
    "source_rows", "weighted_yield_t_ha", "weighted_price_mxn_t",
    "gross_revenue_mxn_ha", "stress_minus20_revenue_mxn_ha", COST_COLUMN,
    "net_margin_mxn_ha", "cost_reference_level", "reference_level", "currency",
    "source_id",
]
# Optional keys an external cost table may carry to narrow which records it prices.
COST_JOIN_KEYS = [
    "Anio", "Idciclo", "Nomcicloproductivo", "Idmodalidad", "Nommodalidad",
    "Idcultivo", "crop",
]

_INT_COLUMNS = {
    "Anio", "Idestado", "Idddr", "Idcader", "Idmunicipio", "Idciclo",
    "Idmodalidad", "Idunidadmedida", "Idcultivo",
}
_MEASURES = [
    "planted_ha", "harvested_ha", "damaged_ha", "volume_t", "rural_price_mxn_t",
    "production_value_mxn",
]
_STRICTLY_POSITIVE = ["harvested_ha", "volume_t", "rural_price_mxn_t", "production_value_mxn"]
_FLOAT_COLUMNS = set(_MEASURES) | {"reported_yield_t_ha"}
_OPTIONAL_COLUMNS = {"Idcader", "Nomcader", "Idunidadmedida", "reported_yield_t_ha"}
_REQUIRED_NON_NULL = DISTRICT_KEYS + ["Idmunicipio"]
_LABEL_KEYS = ["Nomestado", "Nomddr", "Nomcicloproductivo", "Nommodalidad", "crop"]
_TEXT_JOIN_KEYS = {"Nomcicloproductivo", "Nommodalidad", "crop"}
_SORT_ORDER = ["Idestado", "Idddr", "Anio", "Idciclo", "Idmodalidad", "crop", "Idcultivo"]
_PARQUET_METADATA_KEY = b"gradientdescentfarmers.economic"


# --------------------------------------------------------------------------- mapping

@dataclass(frozen=True)
class PilotSite:
    """A validated pilot location and the SIAP district that represents it."""

    site_id: str
    name: str
    lat: float
    lon: float
    state_id: int
    state_name: str
    district_id: int
    district_name: str
    explicit_only_district_ids: tuple[int, ...] = ()

    @property
    def key(self) -> DistrictKey:
        return (self.state_id, self.district_id)

    @property
    def explicit_only_keys(self) -> tuple[DistrictKey, ...]:
        return tuple((self.state_id, d) for d in self.explicit_only_district_ids)


@dataclass(frozen=True)
class SiapMapping:
    """Parsed ``configs/siap_mapping_local.json``."""

    source_id: str
    encoding: str
    name_pattern: re.Pattern[str]
    first_year: int
    last_year: int
    excluded_folders: tuple[str, ...]
    columns: Mapping[str, tuple[str, ...]]
    unit_name: str
    unit_id: int
    max_distance_km: float
    pilot_sites: tuple[PilotSite, ...]

    @property
    def pilot_keys(self) -> tuple[DistrictKey, ...]:
        return tuple(site.key for site in self.pilot_sites)

    @property
    def explicit_only_keys(self) -> tuple[DistrictKey, ...]:
        return tuple(key for site in self.pilot_sites for key in site.explicit_only_keys)

    def file_year(self, file_name: str) -> int | None:
        """Year of a municipal file name, or None when the file must be ignored."""
        match = self.name_pattern.fullmatch(file_name)
        if match is None:
            return None
        year = int(match.group(1))
        return year if self.first_year <= year <= self.last_year else None


def load_siap_mapping(path: str | Path | None = None) -> SiapMapping:
    """Load the canonical SIAP column mapping and pilot-site catalog."""
    path = Path(path) if path is not None else REPO_ROOT / DEFAULT_MAPPING_FILE
    data = json.loads(path.read_text(encoding="utf-8"))
    columns = {name: tuple(aliases) for name, aliases in data["columns"].items()}
    needed = set(MUNICIPAL_COLUMNS) | {"Nomunidad"} | _OPTIONAL_COLUMNS
    absent = sorted(needed - set(columns))
    if absent:
        raise ValueError(f"SIAP mapping {path} lacks canonical columns: {absent}")
    sites = tuple(
        PilotSite(
            site_id=site["site_id"], name=site["name"],
            lat=float(site["lat"]), lon=float(site["lon"]),
            state_id=int(site["Idestado"]), state_name=site["Nomestado"],
            district_id=int(site["Idddr"]), district_name=site["Nomddr"],
            explicit_only_district_ids=tuple(
                int(d["Idddr"]) for d in site.get("explicit_only_districts", [])),
        )
        for site in data["pilot_sites"]
    )
    if not sites:
        raise ValueError(f"SIAP mapping {path} declares no pilot sites")
    files = data["files"]
    return SiapMapping(
        source_id=data["source_id"],
        encoding=files["encoding"],
        name_pattern=re.compile(files["name_pattern"]),
        first_year=int(files["first_year"]),
        last_year=int(files["last_year"]),
        excluded_folders=tuple(files.get("excluded_folders", [])),
        columns=columns,
        unit_name=data["units"]["accepted_unit_name"],
        unit_id=int(data["units"]["accepted_unit_id"]),
        max_distance_km=float(data["site_resolution"]["max_distance_km"]),
        pilot_sites=sites,
    )


def load_economic_config(path: str | Path | None = None) -> dict[str, Any]:
    """Read the ``economic`` block of the shared application configuration."""
    path = Path(path) if path is not None else REPO_ROOT / DEFAULT_CONFIG_FILE
    data = json.loads(path.read_text(encoding="utf-8"))
    section = data.get(CONFIG_SECTION) if isinstance(data, dict) else None
    if not isinstance(section, dict):
        raise ValueError(f"Expected a JSON object under '{CONFIG_SECTION}' in {path}")
    return section


# ------------------------------------------------------------------ site resolution

def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in kilometres between two WGS84 points."""
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = phi2 - phi1
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * EARTH_RADIUS_KM * math.asin(min(1.0, math.sqrt(a)))


def _check_coordinates(lat: Any, lon: Any) -> tuple[float, float]:
    try:
        lat, lon = float(lat), float(lon)
    except (TypeError, ValueError) as exc:
        raise ValueError("lat and lon must be numbers") from exc
    if not (math.isfinite(lat) and math.isfinite(lon) and -90 <= lat <= 90 and -180 <= lon <= 180):
        raise ValueError(f"Invalid coordinates: lat={lat}, lon={lon}")
    return lat, lon


def resolve_district(lat: float, lon: float, mapping: SiapMapping | None = None) -> PilotSite:
    """Return the pilot site nearest to ``(lat, lon)``.

    Raises ``ValueError`` when the nearest pilot site is farther than the mapping's
    maximum distance (50 km), because no validated district covers the point.
    """
    mapping = mapping or load_siap_mapping()
    lat, lon = _check_coordinates(lat, lon)
    distance, site = min(
        ((haversine_km(lat, lon, s.lat, s.lon), s) for s in mapping.pilot_sites),
        key=lambda pair: pair[0],
    )
    if distance > mapping.max_distance_km:
        raise ValueError(
            f"({lat}, {lon}) is {distance:.1f} km from the nearest pilot site "
            f"'{site.name}'; the limit is {mapping.max_distance_km:g} km")
    return site


# ---------------------------------------------------------------------------- query

@dataclass(frozen=True)
class EconomicQuery:
    """Filter for district records.

    Select the district with ``(lat, lon)`` or an explicit ``district_id``
    (``Idddr``); with neither, all pilot districts are returned.
    ``explicit_cost_mxn_ha`` is a user-supplied production cost for one crop and is
    the only way a query yields a net margin.
    """

    lat: float | None = None
    lon: float | None = None
    district_id: int | None = None
    state_id: int | None = None
    year_start: int | None = None
    year_end: int | None = None
    crop: str | None = None
    modality: str | None = None
    explicit_cost_mxn_ha: float | None = None

    def __post_init__(self) -> None:
        if (self.lat is None) != (self.lon is None):
            raise ValueError("lat and lon must be given together")
        if self.lat is not None:
            lat, lon = _check_coordinates(self.lat, self.lon)
            object.__setattr__(self, "lat", lat)
            object.__setattr__(self, "lon", lon)
        for name in ("district_id", "state_id", "year_start", "year_end"):
            value = getattr(self, name)
            if value is not None:
                if isinstance(value, bool) or int(value) != value:
                    raise ValueError(f"{name} must be an integer")
                object.__setattr__(self, name, int(value))
        if None not in (self.year_start, self.year_end) and self.year_start > self.year_end:
            raise ValueError("year_start must not be after year_end")
        if self.crop is not None and not str(self.crop).strip():
            raise ValueError("crop must not be blank")
        if self.modality is not None:
            canonical = MODALITIES.get(_norm_text(self.modality))
            if canonical is None:
                raise ValueError(f"modality must be one of {sorted(MODALITIES.values())}")
            object.__setattr__(self, "modality", canonical)
        if self.explicit_cost_mxn_ha is not None:
            cost = float(self.explicit_cost_mxn_ha)
            if not math.isfinite(cost) or cost < 0:
                raise ValueError("explicit_cost_mxn_ha must be a finite non-negative number")
            if self.crop is None:
                raise ValueError("explicit_cost_mxn_ha applies to one crop; set crop as well")
            object.__setattr__(self, "explicit_cost_mxn_ha", cost)


# ------------------------------------------------------------- cleaning and metrics

def _norm_text(value: Any) -> str:
    """Accent-insensitive, case-insensitive comparison key."""
    text = unicodedata.normalize("NFKD", str(value))
    return "".join(ch for ch in text if not unicodedata.combining(ch)).strip().casefold()


def _norm_series(series: pd.Series) -> pd.Series:
    return series.astype(object).map(lambda v: _norm_text(v) if isinstance(v, str) else "")


def _clean_text(series: pd.Series) -> pd.Series:
    text = series.astype("string").str.strip()
    return text.mask(text.fillna("") == "")


def _to_float(text: pd.Series) -> pd.Series:
    """Strict numeric parse: anything unparseable or non-finite becomes NaN."""
    values = pd.to_numeric(text, errors="coerce").astype("float64")
    return values.where(np.isfinite(values))


def _to_int(text: pd.Series) -> pd.Series:
    values = _to_float(text)
    return values.where(values == values.round()).astype("Int64")


def harmonize_siap_frame(raw: pd.DataFrame, mapping: SiapMapping) -> pd.DataFrame:
    """Rename one SIAP municipal file to canonical columns and parse its values.

    Aliases such as ``Nomcultivo`` / ``Nomcultivo Sin Um`` and ``Precio`` /
    ``Preciomediorural`` collapse into ``crop`` and ``rural_price_mxn_t``.
    """
    by_header = {_norm_text(column): column for column in raw.columns}
    data: dict[str, pd.Series] = {}
    missing = []
    for canonical, aliases in mapping.columns.items():
        found = [by_header[_norm_text(a)] for a in aliases if _norm_text(a) in by_header]
        if found:
            text = _clean_text(raw[found[0]])
            for other in found[1:]:
                text = text.fillna(_clean_text(raw[other]))
        else:
            if canonical not in _OPTIONAL_COLUMNS:
                missing.append(f"{canonical} ({' | '.join(aliases)})")
            text = pd.Series(pd.NA, index=raw.index, dtype="string")
        if canonical in _INT_COLUMNS:
            data[canonical] = _to_int(text)
        elif canonical in _FLOAT_COLUMNS:
            data[canonical] = _to_float(text)
        else:
            data[canonical] = text
    if missing:
        raise ValueError(
            f"SIAP file lacks required columns {missing}; found {list(raw.columns)}")
    return pd.DataFrame(data, index=raw.index)


def _district_mask(frame: pd.DataFrame, keys: Sequence[DistrictKey]) -> np.ndarray:
    state = frame["Idestado"].astype("float64").to_numpy()
    district = frame["Idddr"].astype("float64").to_numpy()
    mask = np.zeros(len(frame), dtype=bool)
    for state_id, district_id in keys:
        mask |= (state == state_id) & (district == district_id)
    return mask


def apply_quality_control(
    frame: pd.DataFrame, mapping: SiapMapping
) -> tuple[pd.DataFrame, dict[str, int]]:
    """Drop rows that cannot be compared or trusted; return the rest and drop counts.

    Each discarded row is counted once, under the first rule it breaks.
    """
    keep = np.ones(len(frame), dtype=bool)
    counts = {"rows_in_scope": len(frame)}

    def discard(reason: str, bad: np.ndarray) -> None:
        nonlocal keep
        bad = bad & keep
        counts[reason] = int(bad.sum())
        keep &= ~bad

    discard("missing_keys", frame[_REQUIRED_NON_NULL].isna().any(axis=1).to_numpy())
    year = frame["Anio"].astype("float64").to_numpy()
    with np.errstate(invalid="ignore"):
        discard("year_out_of_range", ~((year >= mapping.first_year) & (year <= mapping.last_year)))
        unit_id = frame["Idunidadmedida"].astype("float64").to_numpy()
        name_ok = (_norm_series(frame["Nomunidad"]) == _norm_text(mapping.unit_name)).to_numpy()
        id_ok = np.isnan(unit_id) | (unit_id == mapping.unit_id)
        discard("non_tonne_unit", ~(name_ok & id_ok))
        measures = frame[_MEASURES].astype("float64")
        discard("null_measure", measures.isna().any(axis=1).to_numpy())
        non_positive = (measures[_STRICTLY_POSITIVE] <= 0).any(axis=1)
        negative_area = (measures[["planted_ha", "damaged_ha"]] < 0).any(axis=1)
        discard("non_positive_measure", (non_positive | negative_area).to_numpy())

    clean = frame.loc[keep, MUNICIPAL_COLUMNS].reset_index(drop=True)
    for column in _INT_COLUMNS & set(_REQUIRED_NON_NULL):
        clean[column] = clean[column].astype("int64")
    counts["rows_kept"] = len(clean)
    return clean, counts


def aggregate_to_district(municipal: pd.DataFrame) -> pd.DataFrame:
    """Sum municipal rows to district totals, then derive weighted yield and price."""
    if municipal.empty:
        return pd.DataFrame(columns=DISTRICT_KEYS + [
            "planted_ha", "harvested_ha", "damaged_ha", "volume_t",
            "production_value_mxn", "source_rows", "weighted_yield_t_ha",
            "weighted_price_mxn_t"])
    # Labels are compared without case or accents, so two spellings of one district
    # or crop cannot split a district total; the first spelling seen is kept.
    folded = {f"_n_{label}": _norm_series(municipal[label]) for label in _LABEL_KEYS}
    ids = [key for key in DISTRICT_KEYS if key not in _LABEL_KEYS]
    district = municipal.assign(**folded).groupby(
        ids + list(folded), as_index=False, sort=True).agg(
        **{label: (label, "first") for label in _LABEL_KEYS},
        planted_ha=("planted_ha", "sum"),
        harvested_ha=("harvested_ha", "sum"),
        damaged_ha=("damaged_ha", "sum"),
        volume_t=("volume_t", "sum"),
        production_value_mxn=("production_value_mxn", "sum"),
        source_rows=("harvested_ha", "size"),
    )
    district = district.drop(columns=list(folded))
    district["weighted_yield_t_ha"] = district["volume_t"] / district["harvested_ha"]
    district["weighted_price_mxn_t"] = district["production_value_mxn"] / district["volume_t"]
    return district


def add_financial_metrics(
    district: pd.DataFrame, source_id: str, currency: str = CURRENCY
) -> pd.DataFrame:
    """Add revenue, the -20%/-20% stress case, empty cost columns and provenance tags."""
    out = district.copy()
    out["gross_revenue_mxn_ha"] = out["weighted_yield_t_ha"] * out["weighted_price_mxn_t"]
    out["stress_minus20_revenue_mxn_ha"] = out["gross_revenue_mxn_ha"] * STRESS_MINUS20_FACTOR
    out[COST_COLUMN] = np.nan
    out["net_margin_mxn_ha"] = np.nan
    out["cost_reference_level"] = pd.Series(pd.NA, index=out.index, dtype="string")
    out["reference_level"] = REFERENCE_LEVEL_SIAP
    out["currency"] = currency
    out["source_id"] = source_id
    for column in ("gross_revenue_mxn_ha", "stress_minus20_revenue_mxn_ha", COST_COLUMN,
                   "net_margin_mxn_ha", "weighted_yield_t_ha", "weighted_price_mxn_t"):
        out[column] = out[column].astype("float64")
    return out[DISTRICT_COLUMNS]


def build_district_records(
    municipal: pd.DataFrame, source_id: str, currency: str = CURRENCY
) -> pd.DataFrame:
    return add_financial_metrics(aggregate_to_district(municipal), source_id, currency)


def load_municipal_rows(
    files: Sequence[Path], mapping: SiapMapping, districts: Sequence[DistrictKey]
) -> tuple[pd.DataFrame, dict[str, int]]:
    """Read cached SIAP CSVs and return clean municipal rows for ``districts``."""
    parts: list[pd.DataFrame] = []
    totals: dict[str, int] = {}
    for path in files:
        try:  # a copy re-saved as UTF-8 must not be read as latin-1 mojibake
            raw = pd.read_csv(path, dtype=str, encoding="utf-8-sig")
        except UnicodeDecodeError:
            raw = pd.read_csv(path, dtype=str, encoding=mapping.encoding)
        try:
            frame = harmonize_siap_frame(raw, mapping)
        except ValueError as exc:
            raise ValueError(f"{path.name}: {exc}") from exc
        in_scope = frame.loc[_district_mask(frame, districts)]
        clean, counts = apply_quality_control(in_scope, mapping)
        for reason, count in counts.items():
            totals[reason] = totals.get(reason, 0) + count
        if not clean.empty:
            parts.append(clean)
    if parts:
        return pd.concat(parts, ignore_index=True), totals
    return pd.DataFrame(columns=MUNICIPAL_COLUMNS), totals


# ----------------------------------------------------------------- external costs

def _join_keys(frame: pd.DataFrame, columns: Sequence[str]) -> pd.DataFrame:
    """Comparable merge keys: ids as floats, labels accent- and case-folded."""
    keys = pd.DataFrame(index=frame.index)
    for column in columns:
        if column in _TEXT_JOIN_KEYS:
            keys[f"_k_{column}"] = _norm_series(frame[column])
        else:
            keys[f"_k_{column}"] = pd.to_numeric(frame[column], errors="coerce").astype("float64")
    return keys


def _cost_keys(table: pd.DataFrame, id_columns: list[str]) -> tuple[pd.DataFrame, list[str]]:
    """Validate an external cost table; return its merge keys plus the cost column."""
    if not isinstance(table, pd.DataFrame):
        raise TypeError("cost table must be a pandas DataFrame")
    absent = [c for c in id_columns + [COST_COLUMN] if c not in table.columns]
    if absent:
        raise ValueError(f"cost table lacks columns {absent}")
    optional = [c for c in COST_JOIN_KEYS if c in table.columns]
    keys = _join_keys(table, id_columns + optional).reset_index(drop=True)
    if keys.isna().any().any() or (keys == "").any().any():
        raise ValueError("cost table has null identifiers; rows are never imputed")
    if keys.duplicated().any():
        raise ValueError(f"cost table has duplicate rows for {id_columns + optional}")
    cost = pd.to_numeric(table[COST_COLUMN], errors="coerce").astype("float64").to_numpy()
    if not (np.isfinite(cost) & (cost >= 0)).all():
        raise ValueError(f"{COST_COLUMN} must be finite and non-negative; costs are never imputed")
    keys[COST_COLUMN] = cost
    return keys, optional


def _finish_costs(frame: pd.DataFrame, optional: list[str], level: str) -> pd.DataFrame:
    out = frame.rename(columns={f"_k_{c}": c for c in ["Idestado"] + optional})
    for column in ["Idestado", "Idddr"] + [c for c in optional if c not in _TEXT_JOIN_KEYS]:
        out[column] = out[column].astype("int64")
    out["reference_level"] = level
    extra = [c for c in ("cost_weight_harvested_ha", "cost_municipalities") if c in out.columns]
    columns = ["Idestado", "Idddr"] + optional + [COST_COLUMN, "reference_level"] + extra
    return out[columns].sort_values(["Idestado", "Idddr"] + optional).reset_index(drop=True)


# --------------------------------------------------------------------------- source

class EconomicSource:
    """District-level SIAP economic records for the pilot sites.

    ``records`` holds the pilot districts only. ``municipal`` holds the clean
    municipal rows behind them and doubles as the official
    ``(Idestado, Idmunicipio) -> Idddr`` catalog and harvested-area weights.
    """

    def __init__(
        self,
        records: pd.DataFrame,
        municipal: pd.DataFrame | None,
        mapping: SiapMapping,
        metadata: Mapping[str, Any] | None = None,
        extra_loader: Callable[[DistrictKey], tuple[pd.DataFrame, pd.DataFrame]] | None = None,
    ):
        self.records = records
        self.municipal = municipal
        self.mapping = mapping
        self.metadata = dict(metadata or {})
        self._extra_loader = extra_loader
        self._extra: dict[DistrictKey, tuple[pd.DataFrame, pd.DataFrame]] = {}

    def resolve_district(self, lat: float, lon: float) -> PilotSite:
        return resolve_district(lat, lon, self.mapping)

    # -- querying

    def _target_keys(self, query: EconomicQuery) -> list[DistrictKey]:
        site = self.resolve_district(query.lat, query.lon) if query.lat is not None else None
        if query.district_id is None:
            keys = [site.key] if site else list(self.mapping.pilot_keys)
            if query.state_id is not None:
                keys = [k for k in keys if k[0] == query.state_id]
                if not keys:
                    raise ValueError(f"No pilot district in Idestado={query.state_id}")
            return keys
        allowed = ([site.key, *site.explicit_only_keys] if site
                   else [*self.mapping.pilot_keys, *self.mapping.explicit_only_keys])
        matches = [k for k in allowed if k[1] == query.district_id
                   and (query.state_id is None or k[0] == query.state_id)]
        if not matches:
            where = f" for the site at ({query.lat}, {query.lon})" if site else ""
            raise ValueError(
                f"Idddr={query.district_id} is not a validated district{where}; "
                f"validated (Idestado, Idddr): {sorted(allowed)}")
        if len(matches) > 1:
            raise ValueError(f"Idddr={query.district_id} is ambiguous; pass state_id")
        return matches

    def _load_extra(self, key: DistrictKey) -> tuple[pd.DataFrame, pd.DataFrame]:
        if key not in self._extra:
            if self._extra_loader is None:
                raise ValueError(f"District {key} is not materialized and no raw cache is attached")
            self._extra[key] = self._extra_loader(key)
        return self._extra[key]

    def _district_records(self, key: DistrictKey) -> pd.DataFrame:
        if key in self.mapping.pilot_keys:
            return self.records.loc[_district_mask(self.records, [key])]
        return self._load_extra(key)[0]

    def query(self, query: EconomicQuery | None = None) -> pd.DataFrame:
        """Return district records matching ``query``, one row per
        year x district x cycle x modality x crop."""
        query = query or EconomicQuery()
        out = pd.concat(
            [self._district_records(key) for key in self._target_keys(query)],
            ignore_index=True)
        if query.year_start is not None:
            out = out.loc[out["Anio"] >= query.year_start]
        if query.year_end is not None:
            out = out.loc[out["Anio"] <= query.year_end]
        if query.crop is not None:
            out = out.loc[(_norm_series(out["crop"]) == _norm_text(query.crop)).to_numpy()]
        if query.modality is not None:
            out = out.loc[
                (_norm_series(out["Nommodalidad"]) == _norm_text(query.modality)).to_numpy()]
        out = out.sort_values(_SORT_ORDER).reset_index(drop=True)
        if query.explicit_cost_mxn_ha is not None:
            out[COST_COLUMN] = query.explicit_cost_mxn_ha
            out["net_margin_mxn_ha"] = out["gross_revenue_mxn_ha"] - out[COST_COLUMN]
            out["cost_reference_level"] = REFERENCE_LEVEL_USER_COST
        return out

    # -- catalog and external cost tables

    def _municipal_rows(self) -> pd.DataFrame:
        frames = [m for _, m in self._extra.values()]
        if self.municipal is not None:
            frames.insert(0, self.municipal)
        if not frames:
            raise ValueError(
                "Municipal rows are not materialized; rebuild with refresh=true to "
                "aggregate municipality-level cost tables")
        return pd.concat(frames, ignore_index=True)

    def municipality_catalog(self) -> pd.DataFrame:
        """Official ``(Idestado, Idmunicipio) -> Idddr`` catalog seen in the SIAP rows.

        A municipality can appear under more than one district when its CADERs
        report to different districts.
        """
        columns = ["Idestado", "Nomestado", "Idddr", "Nomddr", "Idmunicipio", "Nommunicipio"]
        rows = self._municipal_rows()[columns].drop_duplicates(
            ["Idestado", "Idddr", "Idmunicipio"])
        return rows.sort_values(["Idestado", "Idddr", "Idmunicipio"]).reset_index(drop=True)

    def costs_from_municipal_table(self, table: pd.DataFrame) -> pd.DataFrame:
        """Aggregate a municipality-level cost table to the district.

        ``table`` needs ``Idestado``, ``Idmunicipio`` and ``explicit_cost_mxn_ha``,
        plus any of ``COST_JOIN_KEYS``. Each municipality is joined to its district
        through the SIAP rows and weighted by its SIAP harvested area for the same
        keys. Municipalities without harvested area carry no weight and are left
        out; the result is tagged ``district_ddr_aggregated``.
        """
        costs, optional = _cost_keys(table, ["Idestado", "Idmunicipio"])
        municipal = self._municipal_rows()
        weights = _join_keys(municipal, ["Idestado", "Idmunicipio"] + optional)
        on = list(weights.columns)
        weights["Idddr"] = municipal["Idddr"].to_numpy()
        weights["harvested_ha"] = municipal["harvested_ha"].to_numpy()
        weights = weights.groupby(["Idddr"] + on, as_index=False)["harvested_ha"].sum()
        merged = weights.merge(costs, on=on, how="inner")
        merged["_weighted_cost"] = merged[COST_COLUMN] * merged["harvested_ha"]
        group = ["_k_Idestado", "Idddr"] + [f"_k_{c}" for c in optional]
        out = merged.groupby(group, as_index=False).agg(
            _weighted_cost=("_weighted_cost", "sum"),
            cost_weight_harvested_ha=("harvested_ha", "sum"),
            cost_municipalities=("_k_Idmunicipio", "nunique"),
        )
        out[COST_COLUMN] = out.pop("_weighted_cost") / out["cost_weight_harvested_ha"]
        return _finish_costs(out, optional, REFERENCE_LEVEL_MUNICIPAL_COST)

    def costs_from_state_table(self, table: pd.DataFrame) -> pd.DataFrame:
        """Carry a state-level cost table to the districts of that state.

        The state figure is copied unchanged and tagged ``state_fallback`` so it is
        never mistaken for district evidence.
        """
        costs, optional = _cost_keys(table, ["Idestado"])
        known = [*self.mapping.pilot_keys, *self._extra]
        districts = pd.DataFrame(known, columns=["_k_Idestado", "Idddr"]).astype(
            {"_k_Idestado": "float64"})
        return _finish_costs(
            districts.merge(costs, on="_k_Idestado", how="inner"),
            optional, REFERENCE_LEVEL_STATE_COST)

    def with_costs(self, records: pd.DataFrame, district_costs: pd.DataFrame) -> pd.DataFrame:
        """Attach district costs to ``records`` and compute ``net_margin_mxn_ha``.

        ``district_costs`` comes from ``costs_from_municipal_table`` or
        ``costs_from_state_table``. Costs already present in ``records`` are kept,
        so apply the district-level table first and the state fallback second.
        Records without a matching cost keep a missing net margin.
        """
        absent = [c for c in ("Idddr", "reference_level") if c not in district_costs.columns]
        if absent:
            raise ValueError(f"district cost table lacks columns {absent}")
        costs, optional = _cost_keys(district_costs, ["Idestado", "Idddr"])
        costs["_level"] = district_costs["reference_level"].to_numpy()
        keys = _join_keys(records, ["Idestado", "Idddr"] + optional).reset_index(drop=True)
        matched = keys.merge(costs, on=list(keys.columns), how="left")
        out = records.copy()
        fill = out[COST_COLUMN].isna().to_numpy() & matched[COST_COLUMN].notna().to_numpy()
        levels = out["cost_reference_level"].astype(object).to_numpy(copy=True)
        levels[fill] = matched["_level"].to_numpy()[fill]
        out["cost_reference_level"] = levels
        out[COST_COLUMN] = np.where(fill, matched[COST_COLUMN].to_numpy(), out[COST_COLUMN])
        out["net_margin_mxn_ha"] = out["gross_revenue_mxn_ha"] - out[COST_COLUMN]
        return out


# -------------------------------------------------------------------------- builder

@dataclass(frozen=True)
class _Settings:
    source_id: str
    currency: str
    bucket: str
    prefix: str
    cache_dir: Path
    output_parquet: Path
    municipal_parquet: Path
    sync_from_gcs: bool
    refresh: bool
    mapping_file: Path


def _write_parquet(frame: pd.DataFrame, path: Path, metadata: Mapping[str, Any]) -> None:
    pa, pq = _pyarrow()
    table = pa.Table.from_pandas(frame, preserve_index=False)
    table = table.replace_schema_metadata({
        **(table.schema.metadata or {}),
        _PARQUET_METADATA_KEY: json.dumps(metadata).encode("utf-8"),
    })
    path.parent.mkdir(parents=True, exist_ok=True)
    partial = path.with_name(path.name + ".part")
    pq.write_table(table, partial)
    os.replace(partial, path)


def _read_parquet(path: Path) -> tuple[pd.DataFrame, dict[str, Any]]:
    _, pq = _pyarrow()
    table = pq.read_table(path)
    raw = (table.schema.metadata or {}).get(_PARQUET_METADATA_KEY)
    return table.to_pandas(), (json.loads(raw) if raw else {})


def _pyarrow():
    try:
        import pyarrow as pa
        import pyarrow.parquet as pq
    except ImportError as exc:
        raise ImportError("Install the economic extra: pip install -e '.[economic]'") from exc
    return pa, pq


class EconomicSourceBuilder(SourceBuilder):
    """Build the SIAP district economic source from the ``economic`` config block.

    ``build`` loads ``output_parquet`` when it exists. Otherwise it reads the raw
    CSV cache, first syncing any missing municipal file from GCS, and materializes
    the parquet. All files stay under the repository's ``data/`` directory.
    ``storage_client`` lets tests inject a fake GCS client; by default Application
    Default Credentials are used, and only when a download is actually needed.
    """

    def __init__(self, repository_root: Path | None = None, storage_client: Any = None):
        self.repository_root = Path(repository_root or REPO_ROOT).resolve()
        self._storage_client = storage_client

    def _resolve(self, path: str | Path) -> Path:
        p = Path(path)
        return p.resolve() if p.is_absolute() else (self.repository_root / p).resolve()

    def _settings(self, config: Mapping[str, Any]) -> _Settings:
        if not isinstance(config, Mapping):
            raise TypeError("economic config must be a mapping")
        if config.get("enabled", True) is not True:
            raise ValueError("The economic source is disabled (enabled != true)")
        absent = [k for k in ("source_id", "gcs_bucket", "gcs_municipal_prefix",
                              "local_cache_dir", "output_parquet") if not config.get(k)]
        if absent:
            raise ValueError(f"economic config lacks {absent}")
        if config.get("aggregation_level", AGGREGATION_LEVEL) != AGGREGATION_LEVEL:
            raise ValueError(f"aggregation_level must be '{AGGREGATION_LEVEL}'")
        if config.get("currency", CURRENCY) != CURRENCY:
            raise ValueError(f"currency must be '{CURRENCY}'; SIAP values are not converted")
        bucket = config["gcs_bucket"]
        if "/" in bucket or bucket.startswith("gs://"):
            raise ValueError("gcs_bucket must be a bucket name, not a URI")
        data_root = self.repository_root / "data"
        cache_dir = self._resolve(config["local_cache_dir"])
        output = self._resolve(config["output_parquet"])
        municipal = self._resolve(config.get(
            "municipal_parquet", output.with_name(f"{output.stem}_municipal.parquet")))
        for path in (cache_dir, output, municipal):
            if not path.is_relative_to(data_root):
                raise ValueError("Economic cache and outputs must reside under repository-root data/")
        mapping_file = (self._resolve(config["mapping_file"]) if config.get("mapping_file")
                        else REPO_ROOT / DEFAULT_MAPPING_FILE)
        return _Settings(
            source_id=config["source_id"], currency=CURRENCY, bucket=bucket,
            prefix=config["gcs_municipal_prefix"].strip("/") + "/",
            cache_dir=cache_dir, output_parquet=output, municipal_parquet=municipal,
            sync_from_gcs=config.get("sync_from_gcs", True) is True,
            refresh=config.get("refresh", False) is True, mapping_file=mapping_file,
        )

    def build(self, config: Mapping[str, Any]) -> EconomicSource:
        settings = self._settings(config)
        mapping = load_siap_mapping(settings.mapping_file)
        if mapping.source_id != settings.source_id:
            raise ValueError(
                f"source_id '{settings.source_id}' does not match the mapping's "
                f"'{mapping.source_id}'")
        if any(folder in settings.prefix for folder in mapping.excluded_folders):
            raise ValueError("gcs_municipal_prefix points at an excluded state-level folder")

        if settings.output_parquet.is_file() and not settings.refresh:
            records, metadata = _read_parquet(settings.output_parquet)
            absent = [c for c in DISTRICT_COLUMNS if c not in records.columns]
            if absent or metadata.get("source_id") != settings.source_id:
                raise ValueError(
                    f"{settings.output_parquet} was not written by source "
                    f"'{settings.source_id}' with the current schema; rebuild with refresh=true")
            records = records.loc[_district_mask(records, mapping.pilot_keys)].reset_index(drop=True)
            municipal = (_read_parquet(settings.municipal_parquet)[0]
                         if settings.municipal_parquet.is_file() else None)
        else:
            files = self._ensure_raw_cache(settings, mapping)
            municipal, quality = load_municipal_rows(files, mapping, mapping.pilot_keys)
            records = build_district_records(municipal, settings.source_id, settings.currency)
            metadata = self._metadata(settings, mapping, files, records, quality)
            _write_parquet(records, settings.output_parquet, metadata)
            _write_parquet(municipal, settings.municipal_parquet, metadata)

        found = set(zip(records["Idestado"].tolist(), records["Idddr"].tolist()))
        for site in mapping.pilot_sites:
            if site.key not in found:
                warnings.warn(
                    f"No SIAP rows for pilot district Idestado={site.state_id}, "
                    f"Idddr={site.district_id} ({site.district_name})", stacklevel=2)

        def load_extra(key: DistrictKey) -> tuple[pd.DataFrame, pd.DataFrame]:
            rows, _ = load_municipal_rows(self._ensure_raw_cache(settings, mapping), mapping, [key])
            return build_district_records(rows, settings.source_id, settings.currency), rows

        return EconomicSource(records, municipal, mapping, metadata, load_extra)

    @staticmethod
    def _metadata(settings: _Settings, mapping: SiapMapping, files: Sequence[Path],
                  records: pd.DataFrame, quality: Mapping[str, int]) -> dict[str, Any]:
        years = sorted(year for year in (mapping.file_year(f.name) for f in files) if year)
        return {
            "source_id": settings.source_id,
            "currency": settings.currency,
            "aggregation_level": AGGREGATION_LEVEL,
            "reference_level": REFERENCE_LEVEL_SIAP,
            "gcs_uri": f"gs://{settings.bucket}/{settings.prefix}",
            "files": [f.name for f in files],
            "file_years": years,
            "districts": [list(key) for key in mapping.pilot_keys],
            "stress_minus20_factor": STRESS_MINUS20_FACTOR,
            "quality_control": dict(quality),
            "district_rows": len(records),
            "built_at_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        }

    # -- raw cache

    @staticmethod
    def _cached_files(cache_dir: Path, mapping: SiapMapping) -> dict[int, Path]:
        """Usable municipal CSVs in the cache, by year. Other files are ignored."""
        if not cache_dir.is_dir():
            return {}
        cached = {}
        for path in cache_dir.iterdir():
            year = mapping.file_year(path.name)
            if year is not None and path.is_file() and path.stat().st_size > 0:
                cached[year] = path
        return cached

    def _ensure_raw_cache(self, settings: _Settings, mapping: SiapMapping) -> list[Path]:
        cached = self._cached_files(settings.cache_dir, mapping)
        expected = set(range(mapping.first_year, mapping.last_year + 1))
        if settings.sync_from_gcs and not expected <= set(cached):
            self._sync_from_gcs(settings, mapping)
            cached = self._cached_files(settings.cache_dir, mapping)
        if not cached:
            raise FileNotFoundError(f"No SIAP municipal CSVs in {settings.cache_dir}")
        return [cached[year] for year in sorted(cached)]

    def _client(self) -> Any:
        if self._storage_client is None:
            try:
                from google.cloud import storage
            except ImportError as exc:
                raise ImportError(
                    "Install the economic extra: pip install -e '.[economic]'") from exc
            self._storage_client = storage.Client()
        return self._storage_client

    def _sync_from_gcs(self, settings: _Settings, mapping: SiapMapping) -> list[Path]:
        """Download municipal CSVs that are not cached yet; return the new files."""
        uri = f"gs://{settings.bucket}/{settings.prefix}"
        client = self._client()
        try:
            blobs = list(client.list_blobs(settings.bucket, prefix=settings.prefix))
        except Exception as exc:
            raise RuntimeError(f"Could not list {uri}: {exc}") from exc
        settings.cache_dir.mkdir(parents=True, exist_ok=True)
        downloaded = []
        for blob in blobs:
            if not blob.name.startswith(settings.prefix):
                continue
            name = blob.name[len(settings.prefix):]
            if mapping.file_year(name) is None:
                continue  # not a 2003-2025 municipal file, e.g. state-level 2000-2002
            if any(folder in blob.name for folder in mapping.excluded_folders):
                continue
            target = settings.cache_dir / name
            if target.is_file() and target.stat().st_size > 0:
                continue
            partial = target.with_name(name + ".part")
            try:
                blob.download_to_filename(str(partial))
                os.replace(partial, target)
            except Exception as exc:
                partial.unlink(missing_ok=True)
                raise RuntimeError(
                    f"Could not download gs://{settings.bucket}/{blob.name}: {exc}") from exc
            downloaded.append(target)
        return downloaded
