# SIAP agricultural closing data (2003–2025): raw files and processed datasets

This README is kept, with identical content, in two places:

- `gs://data_dump_samples/SIAP_Agricultural_Production_2000_2025/README.md`, next to the raw SIAP CSVs.
- `data/economics/README.md` in the repository, next to the processed parquet files.

## Where everything lives

| What | Where |
|---|---|
| Raw SIAP closing CSVs (input) | `gs://data_dump_samples/SIAP_Agricultural_Production_2000_2025/` (this bucket) |
| Processed parquet datasets (output) | Repository [`NASA-Gradient-Descent-Farmers/GradientDescentFarmers`](https://github.com/NASA-Gradient-Descent-Farmers/GradientDescentFarmers), branch `rodrigo-dev`, folder `data/economics/` |
| Code that builds them | `gradientdescentfarmers/source_builder/economic.py` (`EconomicSourceBuilder`) |
| Column mapping and pilot-site catalog | `configs/siap_mapping_local.json` |
| Configuration | `"economic"` block in `resources/application.conf` |

The parquet files are **not** stored in this bucket. They live only in the repository, which is the single source of truth for them. They are small enough to version there and can be rebuilt from the raw CSVs at any time.

| Processed dataset | Rows | Columns | Granularity |
|---|---|---|---|
| `data/economics/siap_3districts_normalized.parquet` (primary) | 4,197 | 27 | Rural Development District (`Idddr`), with area- and volume-weighted metrics |
| `data/economics/siap_3districts_normalized_municipal.parquet` | 21,542 | 21 | Cleaned SIAP rows at municipality / CADER level (`Idmunicipio`, `Idcader`), the input to the district totals |

Both cover the three pilot districts only, for every year from 2003 to 2025. They were built on 2026-11-14 from the 23 municipal CSVs below.

## Raw source structure in GCS

```
gs://data_dump_samples/SIAP_Agricultural_Production_2000_2025/
├── README.md                          this file
├── Municipal (2003_2025)/             USED
│   ├── Cierre_agricola_mun_2003.csv
│   ├── ...
│   └── Cierre_agricola_mun_2025.csv   23 files
└── Estatal (2000_2002)/               NOT USED
    ├── Cierre_agricola_estat_2000.csv
    ├── Cierre_agricola_estat_2001.csv
    └── Cierre_agricola_estat_2002.csv
```

**`Municipal (2003_2025)/`** holds 23 CSVs, one per year, `latin-1` encoded, 24 columns. Despite the `_mun_` name, every row carries the full official SIAP territorial hierarchy: `Idestado` → `Idddr` → `Idcader` → `Idmunicipio`. That is why districts are built from these files directly, without any external municipality-to-district crosswalk.

Three header variants exist and are harmonized:

| Years | Crop name column | Rural price column |
|---|---|---|
| 2003–2014 | `Nomcultivo` | `Precio` |
| 2015–2020 | `Nomcultivo Sin Um` | `Precio` |
| 2021–2025 | `Nomcultivo` | `Preciomediorural` |

**`Estatal (2000_2002)/`** holds three state-level files. They are excluded from every district and municipal pipeline on purpose: they carry no district, and spreading state averages down to a district would fabricate local data. The code ignores them by folder, by file-name pattern and by year.

## Pilot sites and SIAP identifiers

A coordinate is resolved to the nearest pilot site by Haversine distance. Points more than 50 km from every pilot site are rejected with `ValueError`.

| Pilot site | Coordinates | State | District (`Idddr`) | Municipality | CADER |
|---|---|---|---|---|---|
| Adolfo Ruiz Cortines, Guasave, Sinaloa | 25.763611, -108.861389 | 25 Sinaloa | **133 Los Mochis** (default); 134 Guasave only on explicit request | 11 Guasave | 8 Ruíz Cortinez |
| Southeast of Ciudad Obregón, Cajeme, Sonora | 27.332202, -110.162783 | 26 Sonora | **148 Cajeme** | 18 Cajeme | — |
| Valle de Santiago, Guanajuato | 20.4243195, -101.1466639 | 11 Guanajuato | **52 Cortazar** | 42 Valle de Santiago | 7 Valle Santiago |

Guasave municipality (25/11) reports to both district 133 and district 134 in the SIAP data; CADER 8 Ruíz Cortinez belongs to 133. District 134 is not stored in the parquet files. It is computed from the raw CSVs only when a query passes `district_id=134`.

Rows per district in the processed files:

| District | District-level rows | Municipal-level rows | Crops |
|---|---|---|---|
| 11 / 52 Cortazar | 2,038 | 12,189 | 90 |
| 25 / 133 Los Mochis | 1,021 | 3,715 | 69 |
| 26 / 148 Cajeme | 1,138 | 5,638 | 71 |

## Schemas

Identifier columns keep SIAP's own field names and Spanish values (`Riego`, `Temporal`, `Otoño-Invierno`, `Maíz grano`). Derived columns have English names. All money is in **MXN, current (nominal) pesos of each year**; it is not adjusted for inflation.

### District level: `siap_3districts_normalized.parquet`

One row per year × district × productive cycle × modality × crop.

| Column | Type | Unit | Meaning |
|---|---|---|---|
| `Anio` | int64 | year | Agricultural year |
| `Idestado`, `Nomestado` | int64, string | — | State |
| `Idddr`, `Nomddr` | int64, string | — | Rural Development District |
| `Idciclo`, `Nomcicloproductivo` | int64, string | — | 1 Otoño-Invierno, 2 Primavera-Verano, 3 Perennes |
| `Idmodalidad`, `Nommodalidad` | int64, string | — | 1 Riego (irrigated), 2 Temporal (rainfed) |
| `Idcultivo`, `crop` | int64, string | — | Crop |
| `planted_ha` | double | ha | Sum of `Sembrada` |
| `harvested_ha` | double | ha | Sum of `Cosechada` |
| `damaged_ha` | double | ha | Sum of `Siniestrada` |
| `volume_t` | double | t | Sum of `Volumenproduccion` |
| `production_value_mxn` | double | MXN | Sum of `Valorproduccion` |
| `source_rows` | int64 | rows | Municipal rows aggregated into this record |
| `weighted_yield_t_ha` | double | t/ha | `volume_t / harvested_ha` |
| `weighted_price_mxn_t` | double | MXN/t | `production_value_mxn / volume_t` |
| `gross_revenue_mxn_ha` | double | MXN/ha | `weighted_yield_t_ha × weighted_price_mxn_t` |
| `stress_minus20_revenue_mxn_ha` | double | MXN/ha | `gross_revenue_mxn_ha × 0.64` |
| `explicit_cost_mxn_ha` | double | MXN/ha | Empty (NA) in the stored file |
| `net_margin_mxn_ha` | double | MXN/ha | Empty (NA) in the stored file |
| `cost_reference_level` | string | — | Empty (NA) in the stored file |
| `reference_level` | string | — | Always `district_ddr_siap_reference` |
| `currency` | string | — | Always `MXN` |
| `source_id` | string | — | Always `dgsiap_siap_district_mx` |

### Municipal level: `siap_3districts_normalized_municipal.parquet`

One row per cleaned SIAP record: year × municipality × CADER × cycle × modality × crop. It covers 32 municipality–district pairs and 22 CADERs. It doubles as the official `(Idestado, Idmunicipio) → Idddr` catalog and as the harvested-area weights used to aggregate municipal cost tables.

| Column | Type | Unit | Source column |
|---|---|---|---|
| `Anio`, `Idestado`, `Nomestado`, `Idddr`, `Nomddr` | int64 / string | — | same names |
| `Idcader`, `Nomcader` | int64, string | — | same names |
| `Idmunicipio`, `Nommunicipio` | int64, string | — | same names |
| `Idciclo`, `Nomcicloproductivo`, `Idmodalidad`, `Nommodalidad` | int64 / string | — | same names |
| `Idcultivo`, `crop` | int64, string | — | `Idcultivo`; `Nomcultivo` or `Nomcultivo Sin Um` |
| `planted_ha`, `harvested_ha`, `damaged_ha` | double | ha | `Sembrada`, `Cosechada`, `Siniestrada` |
| `volume_t` | double | t | `Volumenproduccion` |
| `rural_price_mxn_t` | double | MXN/t | `Precio` or `Preciomediorural` |
| `production_value_mxn` | double | MXN | `Valorproduccion` |

Both files carry build provenance (source files, years, quality-control counts, build time) in their parquet schema metadata under the key `gradientdescentfarmers.economic`.

## Aggregation and quality rules

1. **Units.** Only rows with `Nomunidad == "Tonelada"` and `Idunidadmedida == 200201` are kept. Non-comparable units such as `Manojo` or `Planta` are dropped.
2. **No fabrication.** Rows with a null or non-positive harvested area, volume, value or price are dropped; this removes total crop failures and unharvested records. Nothing is interpolated or imputed.
3. **Weighted, never simple, averages.** District totals are summed first; ratios are derived afterwards:
   - `weighted_yield_t_ha = sum(volume_t) / sum(harvested_ha)`
   - `weighted_price_mxn_t = sum(production_value_mxn) / sum(volume_t)`

   A plain mean of `Rendimiento` or `Precio` across municipalities is never computed. In this data it would have been off by more than 5% in 884 of the 3,088 district records built from more than one municipality.
4. **Strict separation.** `Riego` and `Temporal` are never averaged together, and neither are the productive cycles (`Nomcicloproductivo`).
5. **Stress test.** `stress_minus20_revenue_mxn_ha = gross_revenue_mxn_ha × 0.64`, a simultaneous 20% drop in yield and in price (0.8 × 0.8).
6. **Net margin.** `net_margin_mxn_ha` stays NA unless an explicit production cost is supplied, either in a query or from an external cost table. `cost_reference_level` then records where the cost came from: `user_explicit`, `district_ddr_aggregated` (municipal table weighted by harvested area) or `state_fallback` (a state figure copied to the district).

Quality-control counts for the current build, over the 22,696 raw rows of the three districts:

| Outcome | Rows |
|---|---|
| Kept | 21,542 |
| Dropped: zero harvest, volume, value or price | 1,056 |
| Dropped: empty price (all with zero harvest, 2024–2025) | 80 |
| Dropped: unit other than tonnes (12 Manojo, 6 Planta) | 18 |

## Using the datasets on GCP (Compute Engine or Cloud Shell)

### 1. Clone and install

```bash
git clone --branch rodrigo-dev https://github.com/NASA-Gradient-Descent-Farmers/GradientDescentFarmers.git
cd GradientDescentFarmers
python3 -m venv .venv && source .venv/bin/activate
pip install -e ".[economic]"
```

Python 3.10 or newer is required.

### 2a. Read the parquet files directly

No raw CSVs and no GCS access are needed.

```python
import pandas as pd

districts = pd.read_parquet("data/economics/siap_3districts_normalized.parquet")
municipal = pd.read_parquet("data/economics/siap_3districts_normalized_municipal.parquet")

print(districts.shape, municipal.shape)   # (4197, 27) (21542, 21)
```

### 2b. Query them through `EconomicSourceBuilder`

This adds coordinate resolution, filters and the cost helpers on top of the same files.

```python
from gradientdescentfarmers.source_builder import EconomicQuery, EconomicSourceBuilder
from gradientdescentfarmers.source_builder.economic import load_economic_config

source = EconomicSourceBuilder().build(load_economic_config())

maize = source.query(EconomicQuery(
    lat=20.4243195, lon=-101.1466639,      # Valle de Santiago -> Idddr 52 Cortazar
    crop="Maíz grano", modality="Riego",
    year_start=2021, year_end=2025,
))
print(maize[["Anio", "Nomcicloproductivo", "weighted_yield_t_ha",
             "weighted_price_mxn_t", "gross_revenue_mxn_ha"]])
```

When the parquet files exist, `build()` loads them in well under a second and never contacts GCS. Crop names are matched without case or accents but must be SIAP's full name (`"maiz grano"` works, `"maiz"` does not).

### 3. Regenerate both parquet files from this bucket

On a VM whose service account can read `gs://data_dump_samples`:

```bash
gcloud auth application-default login   # only if the VM has no service account with access
```

```python
from gradientdescentfarmers.source_builder import EconomicSourceBuilder
from gradientdescentfarmers.source_builder.economic import load_economic_config

config = {**load_economic_config(), "refresh": True}
source = EconomicSourceBuilder().build(config)
print(source.metadata["quality_control"])
```

With `refresh: True`, the builder:

1. Downloads any of the 23 `Municipal (2003_2025)/` CSVs missing from `data/raw/siap/municipal/`. Files already there are not downloaded again, and `Estatal (2000_2002)/` is never touched.
2. Rebuilds and overwrites both files in `data/economics/`.

A full rebuild from cached CSVs takes about 10 seconds. A rebuild from the same 23 files must reproduce the current parquet files exactly; compare `quality_control` with the table above.

If downloads fail, copy the files by hand and run the same code. With all 23 files cached, GCS is not contacted:

```bash
mkdir -p data/raw/siap/municipal
gcloud storage cp "gs://data_dump_samples/SIAP_Agricultural_Production_2000_2025/Municipal (2003_2025)/*.csv" data/raw/siap/municipal/
```

Raw CSVs under `data/raw/` are git-ignored and must not be committed.

## Known limitations

- **Bucket billing.** As of 2026-11-15, object downloads from `data_dump_samples` fail with `403: The billing account for the owning project is disabled`, although listing works. Until billing is restored, step 3 only works with CSVs obtained another way.
- **Nominal prices.** Values are current pesos of each year; deflate (for example with INPC) before comparing across years.
- **Damaged area is partial.** `planted_ha` and `damaged_ha` only sum rows that passed the quality rules, so municipalities with total crop loss are not included.
- **District, not field.** Values are regional references for the whole district (Cortazar groups 18 municipalities), not field-level observations.
- **2025 area drops.** Irrigated grain maize in Los Mochis falls to about 23 thousand ha (113–134 thousand in 2021–2023) and irrigated wheat in Cajeme to about 19 thousand ha (142–187 thousand in 2021–2024). It is not yet confirmed whether this reflects real conditions or an incomplete closing file.
