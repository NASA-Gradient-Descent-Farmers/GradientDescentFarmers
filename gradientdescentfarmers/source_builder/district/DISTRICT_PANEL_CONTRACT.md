# District panel contract

**Status:** implemented on `santiago-rotation-engine`, 15 November 2026 (see `README.md` in this folder for how to run it).
**Owner:** Santiago. Questions and changes go through him so the engine and the data work stay on one schema.

## 1. Purpose

The rotation engine compares a farmer's rotation with alternatives using what has actually happened in the farmer's SIAP district (DDR). This document fixes the tables the district panel delivers so that:

- the data work in `source_builder` and the engine can be built in parallel, against the same columns;
- the engine ported from `NASA-warm-up` (branch `claude/field-shift`, `src/rotations/`) reads the panel **without changes**: table and column names are the ones it already reads (`rotations_*` files in `NASA-warm-up/data/shared/`, without the prefix);
- everyone fetches data through `source_builder`, with its rules on provenance, availability and missing values.

The panel is data only. It does not choose crops, compute scores, or compute trends (section 6).

## 2. Scope for the hackathon

Three sites, located by point in polygon (INEGI 2022 municipal boundaries):

| Site | Coordinates | Municipality | District (DDR) |
|---|---|---|---|
| `guanajuato_valle_de_santiago` | 20.4243195, -101.1466639 | Valle de Santiago (11-042) | Cortazar (52) |
| `sinaloa_ahome` | 25.763611, -108.861389 | Ahome (25-001) | Los Mochis (133) |
| `sonora_valle_del_yaqui` | 27.332202, -110.162783 | Bácum (26-012) | Cajeme (148) |

The builder takes any list of sites (`resources/district_*.json`), so adding districts is a configuration change.

## 3. Keys and codes

| Key | Meaning |
|---|---|
| `state_id` | INEGI state code (int, 1–32) |
| `mun_id` | INEGI municipality code within the state (int) |
| `ddr` | SIAP rural development district code (int); unique together with `state_id` |
| `year`, `month` | Calendar year and month (int) |
| `crop` | Engine crop key, e.g. `maize`, `bean`, `wheat` (`reference/siap_crops.csv`) |
| `cycle` | `pv` (spring–summer) or `oi` (autumn–winter) |
| `water` | `temporal` (rainfed) or `riego` (irrigated) |

## 4. Spatial method

1. **Site → municipality → district.** Point in polygon against INEGI's Marco Geoestadístico 2022 municipal areas (CONABIO's `mun22gw` copy). The district is the municipality's **primary** district: the one SIAP lists it under in the most years of 2016–2025 (ties: larger sown area). If SIAP also records the municipality under other districts, the `sites` table lists them with their share of sown area. A municipality SIAP does not list is reported, not guessed.
2. **Municipality → sample point.** One point per municipality (`reference/municipalities.csv`: median of rural localities, with altitude). Gridded data are sampled there (POWER at the containing MERRA-2 cell centre, SMAP pixel, GRACE mascon) or averaged around it (CHIRPS 10 km, SMAP 10 km, MODIS NDVI 15 km cropland-weighted).
3. **Municipality → district.** Weighted mean over the district's municipalities; a missing value never counts. Weight = mean annual sown area 2016–2025 (both cycles, SIAP) **+ 1 ha**.
   - `district_membership: "shared"` (default): SIAP records some municipalities under more than one district (Guasave, Sinaloa, appears under Los Mochis, Guasave and Guamúchil). Each municipality counts in every district it appears in, weighted by its sown area **in that district**.
   - `"primary"`: each municipality counts only in its primary district, with its whole sown area. This is field-shift's rule, kept to reproduce field-shift exactly.
   - GRACE is unweighted (one mascon covers many municipalities).

## 5. Tables

Parquet, in `<run>/tables/`. Missing values stay missing (`NaN`).

### 5.1 Reference

- `sites`: `site`, `latitude`, `longitude`, `state_id`, `mun_id`, `municipality_inegi`, `state_inegi`, `ddr`, `ddr_name`, `state`, `municipality`, `other_districts`, `note`.
- `municipality_districts` (national, one row per municipality, primary district): `state_id`, `mun_id`, `ddr`, `state`, `municipality`, `ddr_name`. The engine uses it to find places by name.
- `municipality_district_weights` (national): `state_id`, `mun_id`, `ddr`, `sown_ha`, `ddr_name`, `weight_ha`, `is_primary`.
- `power_cells`: `state_id`, `mun_id`, `lat`, `lon` (sample point), `cell_lat`, `cell_lon` (POWER cell used).

### 5.2 `siap_crop_years`: district × crop × cycle × water × year, 2003–2025, **national**

`year`, `state_id`, `ddr`, `crop`, `cycle`, `water`, `state`, `ddr_name`, `sown_ha`, `harvested_ha`, `lost_ha` (ha), `production_t` (t), `value_mxn` (nominal MXN). Catalogue crops reported in tonnes. National because the engine falls back from district to state to nation when a district has no record of a crop; cutting the table to the target districts would change its answers. The engine derives prices as `value_mxn / production_t`.

### 5.3 `climate_municipal`, `climate_district`: monthly normals, 2001–2025

Keys: (`state_id`, `mun_id` | `ddr`), `month`.

| Column | Definition | Unit |
|---|---|---|
| `rain` | Mean monthly rain (POWER `PRECTOTCORR`, CHIRPS-corrected, 5.5) | mm |
| `et0` | Mean monthly FAO-56 Penman–Monteith ET0 from POWER daily | mm |
| `tmin`, `tmax` | Mean daily min / max 2 m air temperature | °C |
| `frost_prob` | Share of years with at least one night ≤ 2 °C in that month | 0–1 |
| `frost_nights` | Mean nights with Tmin ≤ 2 °C | days |
| `heat_days` | Mean days with Tmax ≥ 35 °C | days |
| `rain_p20` | 20th percentile of monthly rain across years | mm |
| `rain_corrected` | Municipal only: CHIRPS correction applied | bool |

ET0 uses POWER's daily 2 m wind (`et0_wind: "power"`, default) or the FAO-56 default of 2 m/s (`"fao_default"`, field-shift's choice).

### 5.4 `climate_municipal_years`, `climate_district_years`: monthly values by year, 1982–2025

Keys: (`state_id`, `mun_id` | `ddr`), `year`, `month`. Columns: `rain`, `et0`, `tmin`, `tmax`, `frost_nights`, `heat_days` (definitions as 5.3); municipal table also `rain_corrected`. Field-shift's yearly table covered 2001–2025 with rain and ET0 only, and its trends came from a separate May–October table that omits irrigated municipalities. This table replaces both.

**Rain quality control.** Monthly rain more than 20 interquartile ranges above the municipality's upper quartile for that calendar month (IQR at least 10 mm) and above 200 mm is set to missing, with `rain_flagged` true. Nationally this removes 184 municipality-months, all in January–February 1991 and January 1992, where POWER has spurious dry-season rain: CHIRPS medians for the same municipality-months are 40, 5 and 70 mm against POWER's 1,651, 662 and 369. Field-shift's 1982–2025 trend table contained these months.

### 5.5 Rain correction (CHIRPS)

Per municipality, the ratio of CHIRPS v2.0 to POWER mean rain over 2001–2025, for May–October and for November–April (clipped to 0.3–3; the November–April ratio only where POWER's mean exceeds 20 mm), applied to that municipality's rain **in every year**. One fixed ratio per season keeps the 1982–2025 series free of a step at 1999, when CHIRPS starts.

`chirps_municipal_years`, `chirps_district_years`: monthly CHIRPS rain (`chirps_rain`, mm) by year, November 2000 – December 2025, the values behind the ratios. The engine uses them only to check that a POWER rain trend has the same sign in CHIRPS.

### 5.6 `observed_municipal`, `observed_district`: satellites by calendar month (Earthdata login)

| Column | Definition | Unit |
|---|---|---|
| `ndvi`, `ndvi_p20`, `ndvi_p80` | Median and 20th/80th percentile of monthly NDVI across 2003–2025, MODIS MOD13C2 v061 (0.05°), cropland-weighted (MCD12C1 v061 2015) | — |
| `ndvi_cropland_weighted` | Municipal only: cropland weighting used | bool |
| `smap_rootzone` | Median of monthly mean root-zone moisture, SMAP L4 SPL4SMGP v008 (9 km; model with satellite assimilation), 2015–2025 | m³/m³ |
| `smap_dry`, `smap_wet` | Municipal only: 5th / 95th percentile of daily values | m³/m³ |
| `smap_relative` | `(smap_rootzone − smap_dry) / (smap_wet − smap_dry)`, clipped to 0–1; missing if the span is under 0.01 | 0–1 |

Written only when NDVI or SMAP succeeded. The engine uses `smap_relative` only for rainfed autumn–winter crops sown on residual moisture.

### 5.7 `grace_municipal`, `grace_district`, `grace_years`: water storage

NASA GSFC mascons RL06v2.0 (April 2002 – June 2026), field-shift's product and method: least squares with annual and semi-annual cycles, standard error widened for lag-1 autocorrelation, the product's leakage trend kept for the engine to combine. `rank_national` ranks the mascon among all Mexican land mascons, whatever districts the panel covers. Columns as field-shift (`trend_cm_yr`, `trend_se`, `trend_recent_cm_yr`, `trend_recent_se`, `change_cm`, `leakage_trend_cm_yr`, `noise_2sigma_cm`, `rank_national`, `mascon`, `first_year`, `last_year`; district also `n_mascons`; years: `year`, `mascon`, `cm`, `months`).

GRACE weighs all stored water. In dam-fed irrigated districts (Cajeme, Los Mochis) a decline can be reservoir storage, not the aquifer.

### 5.8 `soil_municipal`: map soil, context only

`texture_class`, `sand`, `silt`, `clay` (GLDAS/Noah, 0.25°, public) and `profile_available_water_capacity`, `soil_carbon_density` (IGBP-DIS, 5 arc-min, Earthdata login). Never enters a calculation.

## 6. What the panel does not do

- **Trends.** The engine computes them from 5.4 over **each crop's own season**. A fixed May–October window is wrong for irrigated autumn–winter districts such as Cajeme and Los Mochis.
- **Crop choice, scores, income, scenarios.** Engine only.
- **Irrigation water allocation.** In irrigated districts the water a farmer can use depends on CONAGUA's yearly allocation, which no table covers. The engine must state that gap.

## 7. Run outputs

`<output_root>/runs/<run_id>/`: `tables/*.parquet`, `availability.json` (per source: `available`, `partial`, `missing` [no credentials], `error`, `not_requested`; warnings, errors, timing), `provenance.json`, `validation.json` (keys unique, value ranges, missing shares, coverage of the target municipalities and districts), `manifest.json` (rows, columns, SHA-256, settings). `<output_root>/latest.json` points to the last run exported, not the last one approved. Build state: `complete`, `partial` (a non-core source missing) or `failed` (sites, SIAP or POWER failed).

## 8. Acceptance check (`regression.py`), 15 November 2026

Run with `district_membership: "primary"` and `et0_wind: "fao_default"` against field-shift's `data/shared`, 28 municipalities, 3 districts:

| Table | Result |
|---|---|
| `siap_crop_years` (52,420 rows, national) | identical |
| ET0, Tmin, Tmax, frost, heat (municipal and district) | identical |
| GRACE (municipal, district, years) | identical |
| GLDAS soil | identical |
| `municipality_districts` (national) | 2,438 of 2,446 equal; 8 ties broken by sown area instead of arbitrarily; none in the target districts |
| Rain | within 1% where field-shift corrected it (monthly vs daily CHIRPS files). **Different in 6 irrigated municipalities** (Ahome, Bácum, Cajeme, San Ignacio Río Muerto and 2 more) that field-shift never corrected because its CHIRPS table came from the rainfed yield panel: CHIRPS puts their rain 16–38% below POWER |
| NDVI, SMAP, IGBP soil (municipal) | identical (checked with an Earthdata token, full 2003–2025 NDVI and 2015–2025 SMAP) |
| NDVI, SMAP (district, default `shared` run) | differ by up to 0.05 NDVI and 0.03 relative moisture: the shared-membership rule, not the data |

The field-shift engine (`comparar_rotaciones`) runs on the panel for all three districts and gives the same alternatives and income differences as on field-shift's data; priority scores differ by at most 1 point (the rain correction).

## 9. Sources and access

| Source | Product | Login |
|---|---|---|
| INEGI (via CONABIO) | Marco Geoestadístico 2022, municipal areas (`mun22gw`) | none |
| SIAP | Agricultural production open data, national CSV per year | none |
| NASA POWER | Daily point, AG community, via `core/providers.py:get_power` | none |
| CHIRPS | v2.0 monthly, 0.05°, Cloud-Optimized GeoTIFF | none |
| GRACE / GRACE-FO | GSFC mascons RL06v2.0 | none |
| GLDAS | Soil texture and fractions | none |
| MODIS | MOD13C2 v061 (OPeNDAP), MCD12C1 v061 (download; needs `pyhdf`) | Earthdata |
| SMAP | SPL4SMGP v008 (OPeNDAP) | Earthdata |
| IGBP-DIS | ORNL DAAC 569 | Earthdata |

## 10. Code layout and rules

```text
gradientdescentfarmers/source_builder/
  core/opendap.py            # new, shared: Earthdata OPeNDAP box subsets
  district/
    __init__.py __main__.py  # DistrictPanelSourceBuilder (team SourceBuilder contract), CLI
    builder.py               # DistrictPanelBuilder: steps, statuses, export, validation
    locate.py siap.py climate.py grace.py observed.py soil.py
    regression.py            # comparison with field-shift
    reference/               # municipality points, SIAP crop names
tests/source_builder/district/   # offline
resources/district_three_sites.json
```

Additive only: no existing `source_builder` file changed. One shared-file edit: the `source-district` dependency group in `pyproject.toml`.

## 11. Open decisions

1. Where the engine lives in this repo (`model_builder`, `optimizer_builder`, or a new `rotations/` package).
2. How data engineering's market tables join (recommended: `state_id` + `ddr`, or `state_id` for state prices) and what they contain.
3. Whether to keep `shared` membership as the default (more faithful to SIAP; changes Los Mochis' climate slightly versus field-shift).
