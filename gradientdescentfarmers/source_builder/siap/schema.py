"""Decoding and normalization of SIAP CSV files into one canonical schema.

Per the SIAP data dictionary: areas are hectares, ``yield`` is t/ha except for crops whose
``unit`` is not tonnes, ``price`` is MXN per ``unit`` and ``production_value_mxn`` is in
current Mexican pesos. Values are NOT converted or imputed here.
"""
from __future__ import annotations

import io

import pandas as pd

RENAME = {
    "anio": "year", "idestado": "state_id", "nomestado": "state",
    "idddr": "ddr_id", "nomddr": "ddr", "idcader": "cader_id", "nomcader": "cader",
    "idmunicipio": "municipality_id", "nommunicipio": "municipality",
    "idciclo": "cycle_id", "nomcicloproductivo": "cycle",
    "idmodalidad": "modality_id", "nommodalidad": "modality",
    "idunidadmedida": "unit_id", "nomunidad": "unit",
    "idcultivo": "crop_id", "nomcultivo": "crop",
    "sembrada": "sown_ha", "cosechada": "harvested_ha", "siniestrada": "lost_ha",
    "volumenproduccion": "production_volume", "rendimiento": "yield",
    "preciomediorural": "price_mxn_per_unit", "precio": "price_mxn_per_unit",
    "valorproduccion": "production_value_mxn",
}
INT_COLUMNS = ("year", "state_id", "ddr_id", "cader_id", "municipality_id", "cycle_id",
               "modality_id", "unit_id", "crop_id")
FLOAT_COLUMNS = ("sown_ha", "harvested_ha", "lost_ha", "production_volume", "yield",
                 "price_mxn_per_unit", "production_value_mxn")
TEXT_COLUMNS = ("state", "ddr", "cader", "municipality", "cycle", "modality", "unit", "crop")


class SiapFormatError(ValueError):
    """The downloaded payload is not a valid SIAP CSV."""


def decode_bytes(raw: bytes) -> tuple[str, str]:
    """Decode to text. SIAP serves Latin-1/cp1252 today; UTF-8 is tried first in case that changes."""
    for enc in ("utf-8-sig", "cp1252", "latin-1"):
        try:
            return raw.decode(enc), enc
        except UnicodeDecodeError:
            continue
    raise SiapFormatError("cannot decode payload")  # pragma: no cover - latin-1 never fails


def check_csv_payload(raw: bytes, required_columns: frozenset[str]) -> None:
    """Reject empty payloads, HTML pages served with HTTP 200, and CSVs missing key columns."""
    if not raw.strip():
        raise SiapFormatError("empty payload")
    head = raw[:512].lstrip(b"\xef\xbb\xbf").lstrip().lower()
    if head.startswith((b"<!doctype", b"<html", b"<?xml", b"<head")):
        raise SiapFormatError("received an HTML page instead of a CSV (wrong or expired URL?)")
    text, _ = decode_bytes(raw[:4096] if len(raw) > 4096 else raw)
    header = text.splitlines()[0].lower().split(",") if text else []
    missing = required_columns - {h.strip() for h in header}
    if missing:
        raise SiapFormatError(f"CSV header is missing columns: {sorted(missing)}")


def parse_csv(raw: bytes, required_columns: frozenset[str] = frozenset()) -> pd.DataFrame:
    """Parse and normalize one SIAP CSV (raw bytes) into the canonical schema."""
    check_csv_payload(raw, required_columns)
    text, _ = decode_bytes(raw)
    df = pd.read_csv(io.StringIO(text), dtype=str, keep_default_na=False)
    df.columns = [c.strip().lower() for c in df.columns]
    unknown = [c for c in df.columns if c not in RENAME]
    if unknown:
        raise SiapFormatError(f"unrecognized SIAP columns: {unknown}")
    df = df.rename(columns=RENAME)
    for col in TEXT_COLUMNS:
        if col in df:
            df[col] = df[col].str.strip()
    for col in INT_COLUMNS:
        if col in df:
            df[col] = pd.to_numeric(df[col], errors="coerce").astype("Int64")
    for col in FLOAT_COLUMNS:
        if col in df:
            df[col] = pd.to_numeric(df[col], errors="coerce").astype("float64")
    if df.empty:
        raise SiapFormatError("CSV has a header but no rows")
    return df.reset_index(drop=True)
