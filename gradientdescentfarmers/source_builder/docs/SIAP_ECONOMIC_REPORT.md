# SIAP district economic source: what was done and what comes next

**Branch:** `rodrigo-dev` · **Commit:** `2a9e989` · **Date:** 14 November 2026

## Summary

We now have an economic data source that is ready to use: yield, price and gross revenue per hectare, by crop and by year (2003–2025), for the three pilot sites. It comes from SIAP's municipal agricultural closing files ("Cierre agrícola"), aggregated to the Rural Development District (`Idddr`).

- The data is already materialized in the repo (two parquet files), so **it can be queried without downloading anything and without GCP access**.
- The results were checked against an independent recomputation made straight from the original CSVs: all 4,197 records match exactly.
- **There is no net margin yet**, because we have no cost tables. That is the main next step.

## Pilot sites and districts

| Site | Coordinates | State | District (`Idddr`) | Records | Crops |
|---|---|---|---|---|---|
| Adolfo Ruiz Cortines, Guasave | 25.763611, -108.861389 | Sinaloa (25) | 133 Los Mochis | 1,021 | 69 |
| Southeast of Ciudad Obregón, Cajeme | 27.332202, -110.162783 | Sonora (26) | 148 Cajeme | 1,138 | 71 |
| Valle de Santiago | 20.4243195, -101.1466639 | Guanajuato (11) | 52 Cortazar | 2,038 | 90 |

All three districts have data for all 23 years. District 134 Guasave is not in the parquet; it is computed only when requested explicitly with `district_id=134`, and that does need the original CSVs.

## How to use it

Install (once):

```bash
pip install -e ".[economic]"
```

Query by coordinates or by district:

```python
from gradientdescentfarmers.source_builder import EconomicQuery, EconomicSourceBuilder
from gradientdescentfarmers.source_builder.economic import load_economic_config

source = EconomicSourceBuilder().build(load_economic_config())

# Irrigated grain maize near Valle de Santiago, 2021-2025
maize = source.query(EconomicQuery(
    lat=20.4243195, lon=-101.1466639,
    crop="Maíz grano", modality="Riego",
    year_start=2021, year_end=2025,
))
```

`build()` loads the parquet in under a second. The result is a pandas `DataFrame` with one row per year × district × cycle × modality × crop.

Notes on querying:

- Coordinates more than 50 km from the nearest pilot site raise `ValueError`.
- With neither coordinates nor `district_id`, the query returns all three districts.
- Crop names, cycles and modalities keep SIAP's Spanish labels (`"Maíz grano"`, `"Riego"`, `"Temporal"`). The crop name is matched without case or accents, but it must be SIAP's full name (`"maiz grano"` works; `"maiz"` does not).

### Main columns

Identifier columns keep SIAP's own field names; derived metrics have English names.

| Column | Meaning |
|---|---|
| `Anio`, `Idestado`, `Idddr`, `Nomddr` | Year and district |
| `Nomcicloproductivo` | Productive cycle: Otoño-Invierno (autumn-winter), Primavera-Verano (spring-summer) or Perennes (perennials) |
| `Nommodalidad` | Riego (irrigated) or Temporal (rainfed) |
| `Idcultivo`, `crop` | Crop |
| `harvested_ha`, `volume_t`, `production_value_mxn` | District totals |
| `weighted_yield_t_ha` | Yield = total volume / total harvested area |
| `weighted_price_mxn_t` | Average rural price = total value / total volume |
| `gross_revenue_mxn_ha` | Gross revenue per hectare = yield × price |
| `stress_minus20_revenue_mxn_ha` | Revenue if yield and price both fall 20% at once (× 0.64) |
| `explicit_cost_mxn_ha`, `net_margin_mxn_ha` | Empty until costs are supplied |
| `reference_level`, `cost_reference_level` | Where the record comes from and where the cost comes from |

### Net margin

It is computed only when someone supplies an explicit cost. There are two ways:

```python
# 1. A cost supplied by the user for one crop (the value is illustrative)
wheat = source.query(EconomicQuery(
    district_id=148, crop="Trigo grano", modality="Riego",
    year_start=2024, year_end=2024, explicit_cost_mxn_ha=30000,
))

# 2. An external cost table
import pandas as pd
costs = pd.DataFrame({
    "Idestado": [11], "crop": ["Maíz grano"], "Nommodalidad": ["Riego"],
    "explicit_cost_mxn_ha": [35000.0],   # illustrative value
})
with_margin = source.with_costs(maize, source.costs_from_state_table(costs))
```

For municipality-level tables there is `costs_from_municipal_table`, which aggregates them to the district weighted by harvested area. The `cost_reference_level` column says how local the cost is:

- `user_explicit`: supplied by the user in the query.
- `district_ddr_aggregated`: from a municipal table aggregated to the district.
- `state_fallback`: a state-level figure copied to the district; use with caution.

## Rules the data follows

1. **Weighted averages, never simple ones.** District totals are summed first and divided afterwards. In 884 of the 3,088 groups with more than one municipality, a simple mean of yield would have been off by more than 5%.
2. **Irrigated and rainfed are never mixed**, and neither are productive cycles.
3. **Nothing is invented or interpolated.** Rows with no harvest, no price or a unit other than tonnes are discarded and counted.
4. **2003–2025 only.** The state-level 2000–2002 files are not used, because they carry no district.

### Rows discarded in the real data

Of 22,696 municipal rows in the three districts, 21,542 were kept (95%).

| Reason | Rows |
|---|---|
| Zero harvest, volume, value or price | 1,056 |
| Empty price (all with zero harvest, years 2024–2025) | 80 |
| Unit other than tonnes (12 "Manojo", 6 "Planta") | 18 |

## What is in the repo

| File | Contents |
|---|---|
| `gradientdescentfarmers/source_builder/economic.py` | The module |
| `configs/siap_mapping_local.json` | SIAP column names by year and the pilot-site catalog |
| `resources/application.conf` | New `"economic"` block |
| `data/economics/siap_3districts_normalized.parquet` | 4,197 district records (256 KB) |
| `data/economics/siap_3districts_normalized_municipal.parquet` | 21,542 municipal rows, used to weight costs (513 KB) |
| `tests/source_builder/test_economic.py` | 30 offline tests |
| `pyproject.toml`, `requirements.txt`, `.gitignore` | `economic` extra; raw CSVs are never committed |

Tests: the 30 new ones and the 4 in `tests/test_scaffold.py` pass on pandas 2.3 and 3.1.

## Limitations to be aware of

- **Prices are nominal** (current pesos of each year). They cannot be compared across years without deflating.
- **`planted_ha` and `damaged_ha` only sum rows with a harvest.** A municipality with total crop loss is left out, so `damaged_ha` is not the district's total damaged area.
- **The figure is for the district, not the field.** Cortazar groups 18 municipalities; it is a regional reference.
- **2025 shows sharp drops in area**: irrigated maize in Los Mochis falls to 23 thousand ha (against 113–134 thousand in 2021–2023), and irrigated wheat in Cajeme to 19 thousand ha (against 142–187 thousand in 2021–2024). We do not know whether this is real drought or an incomplete closing file.
- **The `data_dump_samples` bucket does not allow downloads.** It lists the files but answers `403` because its project has no billing account. The CSVs were copied in by hand; they are only needed to rebuild the parquet or to query district 134.

## What comes next

1. **Get production cost tables** (for example, FIRA) by crop and modality. This is what is missing for net margin; the code to plug them in already exists.
2. **Decide how this source enters the `Pipeline`.** Today `Pipeline` takes a single `source_builder` and passes it the `source` section. The economic source lives apart, in the `economic` block, and `model_builder` / `optimizer_builder` do not consume it yet. The contract between modules needs to be agreed.
3. **Deflate prices and revenue** to constant pesos (INPC) before comparing years or training models on time series.
4. **Confirm the 2025 data** against SIAP before using it as a reference year.
5. **Re-enable billing on the bucket**, or agree on another way to share the raw CSVs, so that anyone can rebuild the data.
6. **Open the pull request from `rodrigo-dev` to `main`.**
7. **Minor maintenance items:**
   - Add `configs/**` to the path filters of the CI workflow.
   - Seven tests in other modules have been failing on Windows since before this change (six on path separators, one on the optional `pyhdf` extra).
   - The `economic` extra does not cap pandas at `<3`, unlike the `source` extra; they should be aligned.
