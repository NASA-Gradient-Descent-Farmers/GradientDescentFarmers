# Model data sources, SIAP calibration, and output dictionary

This document describes the current `GuanajuatoModelBuilder` flow, the
published Guanajuato profile, and the separate observed-SIAP export. The
model output contains simulations and forecasts; the observed export contains
reported municipal SIAP aggregates.

## GCS data read by the model

| GCS object | Use |
|---|---|
| `gs://data_dump_samples/farm_profiles/guanajuato_valle_demo/runs/67b66942681a4214/farm_profile.json` | Immutable run identity, point coordinates, site elevation, and checksummed table paths. |
| `.../standardized/weather_daily.csv` | Historical daily weather when `historical_weather` is not supplied. Published coverage: 2024-01-01 through 2025-12-31. |
| `soil_properties_raw` at the checksummed path declared by the profile manifest | Point SoilGrids total nitrogen, organic carbon, bulk density, and pH. The upper-30-cm N and carbon values are soil-mass-weighted across the 0–5, 5–15, and 15–30 cm layers. These values are **context observations**, not calibrated fertilizer availability or dynamic WOFOST soil nutrient states. If the profile has no table, the fields remain null. |
| `gs://data_dump_samples/SIAP_Agricultural_Production_2000_2025/Municipal (2003_2025)/Cierre_agricola_mun_<YEAR>.csv` | Configured historical years for yield calibration, and configured price years (2003–2025 by default) for price history and model selection. Municipal data are preferred; state aggregates are a per-crop fallback. |
| Configured `gs://` weather object, if supplied | Explicit historical or future weather. The profile does not contain a future-weather forecast. |

The model does not read profile vegetation, sparse SMAP soil moisture, GPM
rain, topography samples, or Dataverse harvest files. The Dataverse 2012–2022
harvest observations do not overlap the published 2024–2025 weather run.
Hydraulic WOFOST soil parameters and initial available water remain explicit
configuration inputs; SoilGrids total N is not a substitute for those inputs.
See [the source run](../../source_builder/docs/GUANAJUATO_INTEGRATED_RUN.md),
[`base.py`](../base.py), and [`gcs.py`](../gcs.py).

## SIAP yield calibration

1. Run WOFOST for each configured historical crop and harvest year. Raw yield
   is storage-organ dry matter: `yield_t_ha = TWSO / 1000`.
2. Match terminal simulation yield to SIAP by crop label and **harvest year**.
   Aggregate SIAP records first; reported yield is `Volumenproduccion /
   Sembrada` in tonnes per sown hectare. At least two matched years are
   required for each crop.
3. Try the municipality, then the state if the municipality cannot support
   calibration. `calibration_scope` records the selected scope.
4. Fit a crop-specific, zero-intercept multiplier:
   `calibration_factor = sum(simulated_t_ha * observed_t_ha) /
   sum(simulated_t_ha ** 2)`; then `calibrated_t_ha = yield_t_ha *
   calibration_factor` for a planned phase.
5. Refit while leaving each year out in turn. `yield_loyo_mae_t_ha` is the
   mean absolute error against those held-out SIAP yields. A two-year series
   gives one training year per fold. SIAP yield and WOFOST dry matter may have
   different moisture bases and spatial scales.

Soil nutrient observations are included in the output for context; this
calibration fits **yield only** and does not fit nitrogen or soil water.
See [`calibration.py`](../calibration.py).

## SIAP harvest-price estimate

Annual nominal producer price is `Valorproduccion / Volumenproduccion` in
MXN/t when production is positive. The price pipeline chooses a municipal
annual series if it has enough years for the requested horizon and backtest;
otherwise it tries the state series. Last value, damped Holt, ARIMA(1,1,0),
lagged Ridge, and lagged random forest share the same time-ordered,
harvest-horizon MAE in MXN/t. The lowest-MAE model forecasts the **harvest
year** price. Annual SIAP records do not support separate monthly forecasts.
`estimated_tonnes = calibrated_t_ha * area_ha` and
`estimated_gross_value_mxn = estimated_tonnes * estimated_price_mxn_t`.
Gross value is before costs and losses. See
[`price_forecasting.py`](../price_forecasting.py).

## Outputs and rotation semantics

`run_model_app(...)` returns a `ModelBuildResult`. Its single consolidated
model output is `final_df`, with **one row per phase of each supplied rotation
option**. `rotation_id` identifies the alternative, `rotation_step` gives the
phase order, and `rotation_phase_count` gives its size. A three-phase option
and a two-phase option therefore produce five rows. `save_final_csv(path)`
writes this one compact DataFrame. The notebook `notebooks/app.ipynb` shows
these two options and saves the five-row CSV.

The full PCSE daily state, crop summary (`summary_*`), and terminal water
balance (`terminal_*`) remain in `future_daily_df` and
`historical_daily_df` on the result object. `save_csv_bundle(...)` can export
all diagnostic DataFrames. They are not embedded as JSON or expanded into
columns in `final_df`. Water-balance totals in the compact output convert
PCSE cm to mm. Null fields mean the simulation or profile did not supply a
value; they are not zeros. Each phase runs independently, so
`soil_state_carried_forward` is false. The supplied schedules are alternatives,
not a crop sequence selected by WOFOST.

`selected_products=None` in the WOFOST builder only considers configured
historical seasons, its crop crosswalk, WOFOST support, and at least two
municipal SIAP calibration years. It does not simulate all 47 municipal SIAP
crop labels. The separately versioned
[`siap_valle_de_santiago_observed_2003_2025.csv`](../../../resources/examples/siap_valle_de_santiago_observed_2003_2025.csv)
contains 891 real SIAP records for those 47 labels. It is not a field rotation
or `final_df`; 19 prices are missing where reported production was zero.

## Model `final_df` column dictionary

The following is the exact compact schema. Units for simulated water and
plant nitrogen follow [PCSE's model documentation](https://pcse.readthedocs.io/en/stable/code.html).

| Column | Unit | Meaning |
|---|---|---|
| `rotation_id` | text | Name of the supplied rotation alternative. |
| `rotation_step` | integer | One-based phase number within this alternative. |
| `rotation_phase_count` | count | Number of phases in this alternative. |
| `rotation_option_count` | count | Number of alternatives in the model run. |
| `rotation_sequence` | text | Ordered crop sequence for the alternative. |
| `season_id` | text | Identifier for this planned phase. |
| `crop` | WOFOST name | Simulated crop. |
| `variety` | WOFOST name | Crop parameter variety. |
| `sowing_date` | date | Configured sowing date. |
| `harvest_date` | date | Configured harvest/end date used for pricing. |
| `wofost_terminal_date` | date | Actual last date of the WOFOST phase. |
| `area_ha` | ha | User-supplied cultivated area. |
| `water_mode` | text | `potential`, `rainfed`, or `irrigated`. |
| `irrigation_system` | text | User-supplied system label, if applicable. |
| `run_id` | text | Immutable farm-profile run identifier. |
| `future_weather_source` | text | User-supplied future-weather provenance label. |
| `soil_state_carried_forward` | Boolean | False: each phase is an independent PCSE run. |
| `yield_t_ha` | t dry matter/ha | Raw WOFOST storage-organ yield. |
| `calibration_factor` | dimensionless | Crop-specific SIAP yield multiplier. |
| `calibration_scope` | text | `municipal` or `state` SIAP yield fit. |
| `calibrated_t_ha` | t dry matter/ha | `yield_t_ha * calibration_factor`. |
| `estimated_tonnes` | t dry matter | `calibrated_t_ha * area_ha`. |
| `yield_loyo_mae_t_ha` | t/ha | Leave-one-year-out SIAP yield MAE. |
| `soil_moisture_end_m3_m3` | m³/m³ | Simulated root-zone soil moisture on the last day; null if unavailable. |
| `rainfall_total_mm` | mm | PCSE terminal cumulative rainfall during the phase. |
| `effective_irrigation_mm` | mm | PCSE terminal cumulative effective irrigation, after event efficiency. |
| `transpiration_total_mm` | mm | PCSE terminal cumulative crop transpiration. |
| `soil_evaporation_total_mm` | mm | PCSE terminal cumulative soil-surface evaporation. |
| `soil_total_n_0_30cm_g_kg` | g/kg dry soil | Point SoilGrids total N, soil-mass-weighted over 0–30 cm; **not plant-available N**. |
| `soil_organic_carbon_0_30cm_g_kg` | g/kg dry soil | Point SoilGrids organic carbon, soil-mass-weighted over 0–30 cm. |
| `soil_ph_0_5cm` | pH | Point SoilGrids surface-layer pH in water. |
| `soil_context_source` | text | `SoilGrids_profile` or `unavailable`. |
| `plant_n_uptake_kg_ha` | kg N/ha | PCSE crop-summary cumulative plant N uptake if emitted; not a measured soil nutrient. |
| `estimated_price_mxn_t` | nominal MXN/t | Selected model's SIAP-based harvest-year producer-price forecast. |
| `price_scope` | text | `municipal` or `state` price history. |
| `price_model` | text | Minimum-backtest-MAE model for this crop. |
| `price_backtest_mae_mxn_t` | MXN/t | Historical backtest MAE of the selected price model. |
| `estimated_gross_value_mxn` | nominal MXN | Phase tonnes multiplied by estimated price. |
| `rotation_total_estimated_gross_value_mxn` | nominal MXN | Sum of phase gross values in this alternative, repeated on its rows. |

## Observed-SIAP CSV column dictionary

The following 19 fields describe **SIAP observations only**. Each row is one
published municipal record, not a field or a rotation phase. Units are tonnes
in all 891 records of this export. `selected_products=None` in
[`siap_observations.py`](../siap_observations.py) applies no crop filter.

| Column | Unit | Meaning |
|---|---|---|
| `year` | year | SIAP closing-file year. |
| `state` | text | State name reported by SIAP. |
| `municipality` | text | Municipality name reported by SIAP. |
| `crop_label` | SIAP text | Crop or product label exactly as reported, including seed or forage distinctions. |
| `siap_crop_id` | SIAP code | SIAP crop identifier, when present. |
| `production_cycle` | SIAP text | Reported agricultural production cycle; not a field rotation stage. |
| `water_modality` | SIAP text | Reported irrigation/rainfed modality. |
| `unit` | SIAP text | Production unit; `Tonelada` in this export. |
| `sown_ha` | ha | Reported sown area. |
| `harvested_ha` | ha | Reported harvested area. |
| `lost_ha` | ha | Reported lost area, when available. |
| `production_t` | t | Reported production volume for tonne-unit records. |
| `production_value_mxn` | nominal MXN | Reported total production value. |
| `observed_yield_t_ha` | t/ha | `production_t / sown_ha` when sown area is positive. |
| `observed_price_mxn_t` | nominal MXN/t | `production_value_mxn / production_t` when production is positive; otherwise blank. |
| `reported_rural_price_mxn_t` | nominal MXN/t | SIAP `Preciomediorural` field, when present. |
| `data_origin` | text | Constant `SIAP_OBSERVED`. |
| `is_wofost_simulation` | Boolean | Constant false: these rows are not WOFOST outputs. |
| `source_uri` | GCS URI | Exact SIAP annual object from which the row came. |
