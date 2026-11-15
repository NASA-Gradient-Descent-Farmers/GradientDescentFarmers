# District panel contract

**Status:** draft for team review, 14 November 2026. Nothing in this folder is implemented yet.
**Owner:** Santiago (`santiago-rotation-engine`). Questions and changes go through him so the engine and the data work stay on one schema.

## 1. Purpose

The rotation engine compares a farmer's rotation with alternatives using what has actually happened in the farmer's SIAP district (DDR). This document fixes the tables the district panel must deliver so that:

- the data work in `source_builder` and the engine can be built in parallel, against the same columns;
- the engine ported from `NASA-warm-up` (branch `claude/field-shift`, `src/rotations/`) can read the panel **without changes**: table and column names below are the ones it already reads (`rotations_*` files in `NASA-warm-up/data/shared/`);
- everyone fetches data through `source_builder` providers, with its rules on provenance, availability and missing values.

The panel is data only. It does not choose crops, compute scores, or compute trends (see section 6).

## 2. Scope for the hackathon

Three sites, each resolved to its district:

| Site | Coordinates | District (DDR) | Status |
|---|---|---|---|
| Guanajuato | 20.4243195, -101.1466639 | Cortazar (18 municipalities) | Unambiguous |
| Northern Sinaloa | 25.763611, -108.861389 (25°45'49"N 108°51'41"W) | Los Mochis **or** Guamúchil | **To confirm** with municipal boundaries (section 4) |
| Valle del Yaqui, Sonora | 27.332202, -110.162783 | Cajeme (7 municipalities) | Unambiguous |

The builder takes a list of sites or districts, so adding districts later is a configuration change, not a code change.

## 3. Keys and codes

| Key | Meaning |
|---|---|
| `state_id` | INEGI state code (int, 1–32) |
| `mun_id` | INEGI municipality code within the state (int) |
| `ddr` | SIAP rural development district code (int); unique together with `state_id` |
| `year` | Calendar year (int) |
| `month` | Calendar month (int, 1–12) |
| `crop` | Engine crop key, e.g. `maize`, `bean`, `wheat` (`src/rotations/tables/crops.csv`) |
| `cycle` | `pv` (spring–summer) or `oi` (autumn–winter), SIAP's agricultural cycles |
| `water` | `temporal` (rainfed) or `riego` (irrigated) |

## 4. Spatial method

1. **Site → municipality → district.** Point-in-polygon against INEGI municipal boundaries (Marco Geoestadístico), then the SIAP municipality → district table. Municipalities created after SIAP's catalogue (e.g. Sinaloa's Eldorado and Juan José Ríos) are assigned to the district of the municipality they were split from, and the result says so. Nearest-centre matching is **not** acceptable: it fails near borders.
2. **Municipality → sample point.** One point per municipality, from `municipalities.csv` (`lat`, `lon`; NASA-warm-up `src/yield_panel/`). Gridded data are sampled there (POWER, SMAP pixel, GRACE mascon) or averaged over cropland around it (MODIS NDVI: MCD12C1 cropland share within 15 km).
3. **Municipality → district.** Weighted mean over the district's municipalities. Weight = mean annual sown area of the municipality over 2016–2025 (both cycles, SIAP) **+ 1 ha**, so every municipality counts a little. GRACE is the exception: unweighted mean, because one mascon covers many municipalities.

Municipal tables are delivered too: the engine uses a municipality's own climate when the farmer names a municipality.

## 5. Tables

All tables are Parquet. Units are fixed as below. Missing values stay missing (`NaN`), never filled with invented values.

### 5.1 `municipality_districts`

`state_id`, `mun_id`, `ddr`, `state`, `municipality`, `ddr_name`. Plus, new: `lat`, `lon` (sample point), `weight_ha` (section 4.3), `assignment` (`siap` or `split_from:<mun_id>`).

### 5.2 `siap_crop_years`: district × crop × cycle × water × year, 2003–2025

| Column | Unit |
|---|---|
| `year`, `state_id`, `ddr`, `crop`, `cycle`, `water`, `state`, `ddr_name` | keys |
| `sown_ha`, `harvested_ha`, `lost_ha` | ha |
| `production_t` | t |
| `value_mxn` | MXN, nominal, as SIAP reports |

Source: SIAP open data (production by municipality, aggregated to district for the catalogue crops). Prices are not stored separately; the engine derives them as `value_mxn / production_t`.

### 5.3 `climate_municipal` and `climate_district`: monthly normals, 2001–2025

Keys: (`state_id`, `mun_id` | `ddr`), `month`.

| Column | Definition | Unit |
|---|---|---|
| `rain` | Mean monthly rain (POWER `PRECTOTCORR`, CHIRPS-corrected where available) | mm |
| `et0` | Mean monthly reference ET, FAO-56 Penman–Monteith from POWER daily | mm |
| `tmin`, `tmax` | Mean daily min / max 2 m air temperature | °C |
| `frost_prob` | Share of years with at least one night with Tmin ≤ 2 °C in that month | 0–1 |
| `frost_nights` | Mean nights with Tmin ≤ 2 °C | days |
| `heat_days` | Mean days with Tmax ≥ 35 °C | days |
| `rain_p20` | 20th percentile of monthly rain across years | mm |
| `rain_corrected` | Municipal only: CHIRPS correction applied | bool |

**Change from field-shift:** ET0 uses POWER wind (`WS2M`) instead of the FAO-56 default of 2 m/s. Expect ET0 to differ from field-shift's values; the regression check in section 8 reports by how much.

### 5.4 `climate_municipal_years` and `climate_district_years`: monthly values by year, **1982–2025**

Keys: (`state_id`, `mun_id` | `ddr`), `year`, `month`.

Columns: `rain`, `et0` (as field-shift), plus, new: `tmin`, `tmax`, `frost_nights`, `heat_days` (definitions as 5.3, for that month of that year). Municipal table also has `rain_corrected` (CHIRPS exists only from 1999; earlier years are uncorrected and flagged).

**Change from field-shift:** field-shift's yearly table covers 2001–2025 with rain and ET0 only, and its trends come from a separate May–October season table. This table replaces both: the engine can compute water balances for 2001–2025 as before and trends for **any crop window** (section 6). The normals in 5.3 keep the 2001–2025 window.

### 5.5 `observed_municipal` and `observed_district`: satellite observations by calendar month

| Column | Definition | Unit |
|---|---|---|
| `ndvi` | Median monthly NDVI, MODIS MOD13C2 v061 (0.05°), 2003–2025, cropland-weighted | — |
| `ndvi_p20`, `ndvi_p80` | 20th / 80th percentile across years | — |
| `ndvi_cropland_weighted` | Municipal only: cropland weighting was possible | bool |
| `smap_rootzone` | Median root-zone soil moisture, SMAP L4 SPL4SMGP v008 (9 km, model with satellite assimilation), 2015–2025 | m³/m³ |
| `smap_dry`, `smap_wet` | Municipal only: 5th / 95th percentile of daily values | m³/m³ |
| `smap_relative` | `(smap_rootzone − smap_dry) / (smap_wet − smap_dry)`, clipped to 0–1; missing if the span is under 0.01 | 0–1 |

SMAP is "satellite-informed soil moisture", not a field measurement. The engine uses `smap_relative` only for rainfed autumn–winter crops sown on residual moisture.

### 5.6 `grace_municipal`, `grace_district`, `grace_years`: water storage

Source: NASA GSFC mascons RL06v2.0 (April 2002 onward), the product field-shift used. The Earth Engine JPL collection in `core/earth_engine.py` is not a substitute: it has no leakage estimate, and its current window (2019–2024) is too short for a trend.

- `grace_municipal`: `state_id`, `mun_id`, `mascon`, `trend_cm_yr`, `trend_se`, `trend_recent_cm_yr`, `trend_recent_se`, `change_cm`, `leakage_trend_cm_yr`, `noise_2sigma_cm`, `rank_national`, `first_year`, `last_year`.
- `grace_district`: same with `ddr` in place of `mun_id`, plus `n_mascons`.
- `grace_years`: `year`, `mascon`, `cm` (mean anomaly), `months` (months with data).

Trend method unchanged from field-shift: least squares with annual and semi-annual cycles, standard error widened for lag-1 autocorrelation, leakage added in quadrature; "clear" only above 1.64 × combined error. `rank_national` is relative to the districts in the panel; with three districts it is not a national rank and the engine must not present it as one.

GRACE weighs all stored water. In dam-fed irrigated districts (Cajeme, Los Mochis) a decline can be reservoir storage, not the aquifer.

### 5.7 `soil_municipal`: map soil, context only

`state_id`, `mun_id`, `texture_class`, `sand`, `silt`, `clay`, `profile_available_water_capacity`, `soil_carbon_density` (GLDAS texture, IGBP-DIS available water and carbon, as field-shift). Never enters a calculation; the farmer's own soil answer does. SoilGrids (already a `source_builder` provider) may be added as extra columns.

## 6. What the panel does not do

- **Trends.** The engine computes trends (Theil–Sen slope, Mann–Kendall test) from 5.4, over **each crop's own season**, which it derives from the sowing date. A fixed May–October window is wrong for irrigated autumn–winter districts such as Cajeme and Los Mochis.
- **Crop choice, scores, income, scenarios.** Engine only.
- **Irrigation water allocation.** Not in the panel. In irrigated districts, the water a farmer can use depends on CONAGUA's yearly allocation, which no table here covers. The engine must state that gap.

## 7. Run outputs

Following `source_builder` conventions, each run writes to `data/processed/districts/runs/<run_id>/`:

- `tables/*.parquet` (section 5)
- `availability.json`: per source and district, `available` / `partial` / `missing` / `error`, coverage and warnings
- `provenance.json`: source URL, product and version, spatial and temporal resolution, download time
- `validation.json`: per-table checks (keys unique, units in range, coverage)
- `manifest.json`: table names, rows, columns and SHA-256

`data/processed/districts/latest.json` points to the last run exported, not the last one approved.

## 8. Acceptance check

For the municipalities in the three districts, the new tables are compared with field-shift's `rotations_*` files:

- SIAP: identical.
- Rain, Tmin, Tmax, frost, heat, NDVI, SMAP, GRACE: equal within rounding where inputs are the same.
- ET0: difference reported per district (wind change, section 5.3).

Differences outside these are bugs until explained.

## 9. Sources and access

| Source | Product | Login | Provider |
|---|---|---|---|
| SIAP | Agricultural production open data | none | new (`district/siap.py`) |
| NASA POWER | Daily point, AG community, 1982–2025 | none | existing `core/providers.py:get_power` |
| CHIRPS | v2.0 daily, 0.05° | none | new |
| MODIS | MOD13C2 v061 NDVI; MCD12C1 v061 land cover | Earthdata (LP DAAC) | new, via `core/opendap.py` |
| SMAP | SPL4SMGP v008 | Earthdata (NSIDC) | new, via `core/opendap.py` |
| GRACE / GRACE-FO | GSFC mascons RL06v2.0 | none | new (`district/grace.py`) |
| GLDAS, IGBP-DIS | Soil texture; available water and carbon | partly | new |
| INEGI | Marco Geoestadístico, municipal boundaries | none | new (`district/locate.py`) |

## 10. Code layout and rules

```text
gradientdescentfarmers/source_builder/
  core/opendap.py          # new, shared: box subsets from Earthdata OPeNDAP
  district/
    DISTRICT_PANEL_CONTRACT.md
    locate.py              # site -> municipality -> district
    siap.py  climate.py  observed.py  grace.py  soil.py
    builder.py             # DistrictPanelBuilder(SourceBuilder)
tests/source_builder/district/   # offline only, small fixtures
resources/district_*.json        # configs
```

- Additive only: no edits to existing `core/` files, `base.py`, `app.py`, `application.conf`, or the `source_builder` README. Existing providers are imported, not changed.
- The only shared-file edit: a `source-district` dependency group in `pyproject.toml`.
- Tests run offline, so the team's CI never depends on the network or a login.

## 11. Open decisions

1. District of the Sinaloa site (section 2).
2. Where the engine lives in this repo: `model_builder`, `optimizer_builder`, or a new `rotations/` package.
3. Whether data engineering's market tables join on `state_id` + `ddr` (recommended) and what they contain.
