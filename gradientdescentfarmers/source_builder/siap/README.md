# SIAP — Mexican agricultural production (open data)

Downloads, normalizes and stores the DGSIAP/SADER "Estadística de Producción Agrícola" CSVs from
<https://nube.agricultura.gob.mx/datosAbiertos/Agricola.php>. Only needs the repo's existing `source` extra
(`requests`, `pandas`, `pyarrow`, `pydantic`); no credentials.

| dataset | years | grain |
|---|---|---|
| `municipal` (default) | 2003–2025 | municipality × crop × cycle × water modality |
| `national` | 1980–2002 | state × crop × cycle × modality |
| `no_seguimiento` | 2020–2021 | state-level crops without follow-up |

```bash
python -m pip install -e '.[source,source-test]'
python -m gradientdescentfarmers.source_builder.siap sync --years 2015-2025 --dictionary
python -m gradientdescentfarmers.source_builder.siap rebuild    # re-clean stored raw CSVs, no network
python -m gradientdescentfarmers.source_builder.siap status
python -m gradientdescentfarmers.source_builder.siap discover   # exit 1 if the site's links/years changed
```

```python
from gradientdescentfarmers.source_builder.siap import SiapStore
df = SiapStore().load("municipal", years=[2023, 2024, 2025], state="Guanajuato", crop="Maíz grano")
```

Data goes to `$SIAP_DATA_DIR` (default `<repo>/data/siap`, git-ignored; see `data/README.md`): `raw/` (original
CSV bytes), `parquet/` (**cleaned** tables), `manifest.json` (sha256, bytes, URL, fetch time and the cleaning report per file).

## Data cleaning (`clean.py`, `CLEANING_VERSION = 1`)
Applied automatically by `sync`; re-applied from the stored raw CSVs by `rebuild`. Rules come from profiling the
2025 municipal file (35,902 rows) and follow one policy: **never impute, never convert units, never edit a reported
quantity**. Defects are removed only when they carry no information; otherwise they are flagged.

| step | rule | 2025 result |
|---|---|---|
| text | NFC-normalize, collapse whitespace, strip (ids ↔ names were already 1:1; no mojibake) | no change |
| negatives | negative quantities → NaN | 0 |
| zero price/yield | `0` → NaN ("undefined", matching how 2025 already publishes it) | 0 (already NaN) |
| duplicates | exact duplicate rows dropped | 0 |
| no activity | rows with sown = harvested = volume = 0 dropped | 60 dropped → 35,842 rows |

Columns added (all boolean, values untouched):

| column | meaning | 2025 rows |
|---|---|---|
| `is_tonne_unit` | `unit` is Tonelada. Otherwise volume/yield/price are per Gruesa, Planta, Manojo, Miles de lts., m² — do not mix | 590 non-tonne |
| `has_harvest` | `harvested_ha > 0`. Planted-but-not-harvested rows (mostly perennials) have NaN yield/price | 355 without |
| `flag_harvested_gt_sown` | harvested area exceeds sown area | 2 (Oaxaca, <2 ha over) |
| `flag_yield_mismatch` | published yield ≠ volume / harvested (tolerance: 2 % or 0.011) | 0 |
| `flag_value_mismatch` | value ≠ volume × price (tolerance: 2 % or 1 MXN) | 0 |
| `flag_yield_outlier` | yield >5× (log-robust) from the median of its crop+unit (needs ≥10 rows) | 78 — review, may be real |

Things that look like defects but are **not** cleaned:
- **Grain.** Rows are unique per `(year, state, ddr, cader, municipality, cycle, modality, unit, crop)`. A municipality that
  spans several CADERs appears several times for the same crop (1,632 rows in 2025). Summing or counting by municipality
  without `aggregate_municipality(df)` double-counts. That function sums areas, volume and value and recomputes
  `yield = volume / harvested` and `price = value / volume`.
- `sown ≠ harvested + lost` (3,147 rows): normal for perennials (not yet productive area), so not flagged.
- Large yields for `Planta`/`Manojo` units are real (counts, not tonnes); the outlier flag compares within unit.

```python
from gradientdescentfarmers.source_builder.siap import SiapStore, aggregate_municipality
df = SiapStore().load("municipal", years=[2025])
ok = df[df.is_tonne_unit & df.has_harvest & ~df.flag_yield_outlier]
by_muni = aggregate_municipality(ok)
```

## Deployment (VM / web app)
- `SiapStore.load` reads local Parquet only and never touches the network. Run `sync` from cron/systemd, not in request handlers.
- Put `SIAP_DATA_DIR` on a persistent disk. Writes are atomic and guarded by a lock file (`fcntl`, Linux/macOS).
- Re-run with `sync --refresh` occasionally: it replaces a year only if its content hash changed.
- Verify once from the VM that `nube.agricultura.gob.mx` is reachable (some gov sites block datacenter IPs).

## Source quirks handled
- Use root-relative `/index.php?view=…&ANIO=…`. The `/datosAbiertos/index.php?...` form returns an HTML page with HTTP 200 (rejected by validation).
- Files are Latin-1/cp1252, not UTF-8. A missing year returns an empty 404.
- Municipal files call the price column `Preciomediorural`, the national one `Precio`; both map to `price_mxn_per_unit`.
- Units per SIAP dictionary: areas in hectares, `yield` t/ha and price MXN/tonne except for crops whose `unit` differs; values are not converted.
- `Last-Modified`/`Cache-Control` are useless for caching (always "now"), hence hash-based change detection.
