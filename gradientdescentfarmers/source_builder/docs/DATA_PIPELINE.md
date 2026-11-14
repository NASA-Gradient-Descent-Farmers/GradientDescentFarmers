# FarmProfile data contract, step by step

Source basis: the **user-built master exploratory notebook** `00_build_farm_profile_earthdata(1).ipynb`, especially sections 1–6, 8, 10, 13–20, and subsequently developed MODIS 6.1–6.8 and GPM/SMAP extraction routines. This package independently reimplements the notebook scientific logic, not the older `src/advisor/` pipeline. The notebook itself is not shipped as a runtime dependency.

## A. Validated inputs

`FarmerInput` strictly validates farm/field IDs, coordinates, areas, crops, dates, history, mode, budget/currency, irrigation, soil tests, constraints, cropping mode, weights and language. `extra='forbid'` prevents accidental silent mistyping. Advanced values remain optional in basic mode. The builder does NOT auto-guess the crop variety or assign yields.

Normalized input tables: `fields` (one per field), `crop_seasons` (one per season per field), `crop_plantings` (one per planting; the same season can have multiple simultaneous species), `farmer_soil_tests` (if supplied). A species' cultivated area is not summed across an intercropped field to get total field area.

## B. Retrieval and default provider registry

| Identifier | Primary | Output(s) | Temporal / spatial support | Enabled by default |
|---|---|---|---|---|
| `nasa_power` | NASA POWER daily HTTP | `weather_daily` | daily, meteorological grid | basic, advanced |
| `srtm` | OpenTopoData/SRTM30m HTTP | `topography_samples` | static, 30 m DEM | basic, advanced |
| `soilgrids_wcs` | ISRIC WCS 1.0 | `soil_properties_raw` | static, ~250 m global modeled soil | basic, advanced |
| `modis_mod13q1` | ORNL MODIS REST | `vegetation_timeseries` | 16 day, 250 m | basic, advanced |
| `modis_mod11a2` | ORNL MODIS REST | `land_surface_temperature` | 8 day, 1 km | basic, advanced |
| `modis_mod16a2gf` | ORNL MODIS REST | `evapotranspiration` | 8 day, 500 m | basic, advanced |
| `gpm_imerg_v07` | Earthdata GES DISC | `gpm_half_hourly`, `gpm_daily` | 30 min, 0.1° | advanced |
| `smap_l4` | Earthdata NSIDC | `soil_moisture_timeseries` | 3 h, EASE2 9 km | advanced |
| `worldbank_agriculture` | World Bank HTTP | `country_agriculture_context` | national, annual | basic, advanced |
| `usda_quickstats` | USDA QuickStats | `usda_iowa_yield` | Iowa, annual example | explicit only |
| `faostat_production`/`faostat_prices` | FAOSTAT JWT | corresponding context tables | national | explicit only |
| `grace_fo_mascon` | Earth Engine mascons | `regional_water_storage` | regional, monthly | explicit only |
| `nex_gddp_cmip6` | Earth Engine | `climate_projections` | daily, 0.25° | explicit only |
| `modis_landcover` | Earth Engine MCD12Q1 | `landcover` | annual, 500 m | explicit only |

**Alternatives**, stored as explicit metadata: MODIS via Earth Engine; IMERG via Earth Engine; SMAP via NASA Harmony. Alternative Earth Engine routines are documented in `farmadapt/earth_engine.py`, but **do not run automatically** or impersonate identical QA. Harmony is a planned integration, not a completed client.

## C. Main transformations and units

- **POWER**: `T2M`, `T2M_MIN`, `T2M_MAX` in Celsius; `PRECTOTCORR` mm/day; `RH2M` percent; `WS2M` m/s. Verify the solar unit in `parameters.ALLSKY_SFC_SW_DWN.units`. Convert kWh/m²/day to MJ/m²/day by ×3.6, or preserve MJ/m²/day as is. Unknown units are an error, not an invisible conversion.
- **SRTM**: five nearby samples, finite differences `dz/dx`, `dz/dy`, `slope=atan(sqrt(dx²+dy²))`. This is an *approximate* point slope, not a field survey.
- **SoilGrids**: query **advertised** WCS coverages only. Use the notebook's measured divisors: e.g., `phh2o/10`, `clay/10`, `soc/10`, `nitrogen/100`, `wv0033/10`. Preserve depth, statistic, unit, coverage ID and raw pixel. WCS outages and country/region-specific limitations are explicit.
- **MOD13Q1**: `NDVI_raw×0.0001`, `EVI_raw×0.0001`; valid raw range −2000..10000. Bits `VI_Quality & 3` = MODLAND QA; `(q>>2)&15` usefulness, `(q>>10)&1` mixed clouds, `(q>>15)&1` possible shadow. Combine with `pixel_reliability==0` conservatively. Raw and filtered series both retained. Low NDVI is not proof of bare soil.
- **MOD11A2**: day/night LST Celsius = raw×0.02−273.15; valid nonfill raw range 7500..65535. Day and night have *separate* QC, with mandatory QA and estimated LST error class. LST ≠ air temperature.
- **MOD16A2GF**: `ET`, `PET` raw ×0.1 = mm/**composite**, divide by 8 or shorter final-year composite to get mm/day. Keep QA and raw, reject fill codes. MOD16 is a model-derived/gap-filled estimate; ET/PET ≠ a field-specific crop irrigation requirement.
- **GPM IMERG Final V07**: native `mm/h` rate ×0.5 = estimated mm per 30-min interval. Group into UTC days; daily totals ONLY if exactly 48 distinct and 48 valid slots. No zero-filling. A geographic CMR search still typically downloads global HDF5 granules. `h5py` selects one cell and verifies unit and axis order.
- **SMAP L4 SPL4SMGP v008**: select 9 km EASE-Grid 2.0 (EPSG:6933) row and column; extract `sm_surface` 0–5 cm, `sm_rootzone` 0–100 cm and optional percentile. Exclude `-9999` / HDF5 missing codes. **Keep `*.h5` only**; Earthdata also delivers `.qa`/`.h5.xml` auxiliaries. The percentile is sometimes absent; do not infer it. This represents model assimilation at regional pixel scale.
- **CMIP6**: `pr` kg/m²/s×86400=mm/day, Kelvin−273.15=Celsius. Preserve model, scenario, time period. Projections ≠ weather forecasts. Multi-model ensembles are needed for risk evaluation.
- **World Bank/FAOSTAT/USDA**: *statistical context*; do NOT treat national cereal yield or price as farm-level expected outcome. Local costs, validated physiological parameters and farmer yield are absent unless explicitly supplied.

## D. Processing -> validation -> features

`data_retrieval()` returns `ProviderPayload` per enabled source. It logs stage elapsed time and whether a source failed. `data_preprocessing()` applies *pure* product-specific transformations. `data_validation()` detects missing timestamps, duplicates, nonphysical values, QC coverage and required columns. Some sources may yield `partial`; scientifically invalid tables are errors, not unqualified successes. `feature_engineering()` creates climate annual and monthly summaries, including complete-year coverage, longest consecutive dry spell (gaps **break** streaks), GDD approximation, heat/frost days, thresholds and provenance.

`SOURCE_TABLES` and `SourceRecord` provide one **canonical** identifier per source. Re-running `build()` resets in-memory registrations; it does not append duplicate `CATALOG` rows. The persisted `FarmProfile` uses a proper typed contract (`schema_version='2.0.0'`). Exported table filenames reflect actual CSV or Parquet, with SHA-256 and row/column metadata.

## E. Readiness and output for models

`FarmProfile` stores `farmer_inputs`, `source_status`, `tables`, `topography`, `features`, `provenance`, `model_readiness`, `limitations`, `build_state` and a reproducible job trace (`run_id`, timestamps). Raw tables are NOT embedded in JSON; model code should load only the manifest-named tables needed for a given run.

Readiness is *specific*; e.g., `extreme_rain_analysis` requires a valid **complete UTC day**, not merely 2 downloaded granules. WOFOST and economic/rotation optimization deliberately remain `ready=False` until their own tests, calibration and parameter catalogs exist.

The `model_readiness` block is **not** an agronomic endorsement.
