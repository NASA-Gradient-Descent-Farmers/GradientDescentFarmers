"""Static catalog of the SIAP (DGSIAP, SADER) agricultural open-data downloads.

Source page: https://nube.agricultura.gob.mx/datosAbiertos/Agricola.php

The download links on that page are root-relative (``/index.php?view=<id>&ANIO=<year>``).
The page-relative variant ``/datosAbiertos/index.php?...`` answers HTTP 200 with an
HTML page, so it must never be used. View ids are hard-coded here as a fallback and
can be re-discovered from the page with :func:`parse_listing`.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

BASE_URL = "https://nube.agricultura.gob.mx"
LISTING_URL = f"{BASE_URL}/datosAbiertos/Agricola.php"
DOWNLOAD_PATH = "/index.php"

DICTIONARY_VIEW_ID = "5D24F995-E734D711-1EA6F8D2-9D1387D7"  # Diccionario_agricola_2003_a_2025.xlsx


@dataclass(frozen=True)
class SiapDataset:
    key: str
    view_id: str
    first_year: int
    last_year: int  # last year known when this catalog was written; discovery may extend it
    level: str
    description: str
    required_columns: frozenset[str]  # raw header names, lower-cased

    def years(self) -> range:
        return range(self.first_year, self.last_year + 1)

    def url(self, year: int) -> str:
        return f"{BASE_URL}{DOWNLOAD_PATH}?view={self.view_id}&ANIO={int(year)}"


_COMMON = {"anio", "idestado", "nomestado", "idcultivo", "nomcultivo", "sembrada", "cosechada",
           "volumenproduccion", "valorproduccion"}

DATASETS: dict[str, SiapDataset] = {
    "municipal": SiapDataset(
        "municipal", "10AE434F-A2158368-A120BC5A-EDF4AFAA", 2003, 2025, "municipio",
        "Cierre de la producción agrícola, nivel municipal (CSV por año)",
        frozenset(_COMMON | {"idmunicipio", "nommunicipio"})),
    "national": SiapDataset(
        "national", "5F687BE6-1513BEE9-53E63085-9D3C988B", 1980, 2002, "estado",
        "Cierre de la producción agrícola 1980-2002, nivel estatal/nacional (CSV por año)",
        frozenset(_COMMON)),
    "no_seguimiento": SiapDataset(
        "no_seguimiento", "4877B98E-DC2C7731-96F54D97-B642E9D1", 2020, 2021, "estado",
        "Cultivos sin seguimiento, cierre 2020-2021 (CSV por año)",
        frozenset(_COMMON)),
}


def get_dataset(key: str) -> SiapDataset:
    try:
        return DATASETS[key]
    except KeyError:
        raise ValueError(f"unknown SIAP dataset {key!r}; choose from {sorted(DATASETS)}") from None


_LINK = re.compile(r'href="(?P<path>/index\.php\?view=(?P<view>[0-9A-Fa-f-]+)&(?:amp;)?ANIO=(?P<year>\d{4}))"')


def parse_listing(html: str) -> dict[str, list[int]]:
    """Return ``{view_id: sorted years}`` for every per-year CSV link on the listing page."""
    found: dict[str, set[int]] = {}
    for m in _LINK.finditer(html):
        found.setdefault(m["view"].upper(), set()).add(int(m["year"]))
    return {view: sorted(years) for view, years in found.items()}
