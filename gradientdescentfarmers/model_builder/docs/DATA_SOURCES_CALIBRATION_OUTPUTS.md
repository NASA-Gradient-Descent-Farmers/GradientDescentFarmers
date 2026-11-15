# Model data sources, SIAP calibration, and output dictionary

This document describes the current `GuanajuatoModelBuilder` implementation,
the published Guanajuato farm-profile run, and the separate observed-SIAP CSV.
The model result and the observed CSV are different products. The former
contains simulations and forecasts; the latter contains only reported SIAP
municipal aggregates.

## GCS data actually read by the model

| GCS object | Use in the current model |
|---|---|
| `gs://data_dump_samples/farm_profiles/guanajuato_valle_demo/runs/67b66942681a4214/farm_profile.json` | Reads `run_id`, point latitude/longitude from `farmer_inputs`, and `topography.elevation_m` (1717 m unless overridden). The manifest also identifies and checksums the daily-weather table. |
| `gs://data_dump_samples/farm_profiles/guanajuato_valle_demo/runs/67b66942681a4214/standardized/weather_daily.csv` | Historical daily weather when `historical_weather` is omitted. The published table covers 2024-01-01 through 2025-12-31 (731 days). It originates from NASA POWER in the source-builder run. |
| `gs://data_dump_samples/SIAP_Agricultural_Production_2000_2025/Municipal (2003_2025)/Cierre_agricola_mun_<YEAR>.csv` | Reads the years named in `historical_seasons` for yield calibration. Independently reads `siap_price_years` (2003–2025 by default) for price history and model selection. Municipal records are preferred; state aggregates are used when the configured crop lacks sufficient municipal yield or price history. |
| A user-supplied `gs://` weather URI, if configured | `historical_weather` and `future_weather` can read an explicit GCS table. The published profile does **not** include future weather. The example notebook supplies synthetic weather DataFrames instead. |

The profile contains other tables, including `soil_properties_raw`,
`topography_samples`, vegetation, SMAP soil moisture, GPM rain, and economic
input requirements. `GuanajuatoModelBuilder` does **not** read those tables.
Hydraulic soil parameters and initial water are supplied in the model
configuration; the example values are invented. The current flow does not read
`gs://data_dump_samples/dataverse_files/` for calibration because its field
harvest years do not overlap the published 2024–2025 weather run. WOFOST crop
parameters come from PCSE's WOFOST crop catalog, not from this GCS bucket.
See [the source run](../../source_builder/docs/GUANAJUATO_INTEGRATED_RUN.md),
[`base.py`](../base.py), and [`gcs.py`](../gcs.py).

## SIAP yield calibration

1. Run one WOFOST historical season per configured crop and harvest year. The
   model output is dry storage-organ matter: `yield_t_ha = TWSO / 1000`.
2. Match each terminal simulation row to SIAP by crop label and **harvest
   year**. Calculate reported yield as `Volumenproduccion / Sembrada`, in
   tonnes per **sown** hectare. Multiple SIAP records for the same crop/year
   are aggregated before division. Reject a crop with missing matched years or
   fewer than two distinct observation years.
3. Try the configured municipality first. If it cannot support calibration,
   try the state aggregate for that crop. `calibration_scope` records the scope.
4. Fit one crop-specific, zero-intercept multiplier:
   `calibration_factor = sum(simulated_t_ha * observed_t_ha) / sum(simulated_t_ha ** 2)`.
   For a planned phase, `calibrated_t_ha = yield_t_ha * calibration_factor`.
5. Refit the multiplier with each year left out in turn. The mean absolute
   difference between these held-out predictions and SIAP is
   `yield_loyo_mae_t_ha`. The full-data fitted error is in-sample; with only
   two years, each leave-one-year-out fold trains on one year. SIAP municipal
   yields may differ from WOFOST dry matter in moisture basis and spatial
   scale. This is a diagnostic calibration, not field validation.

The equations and checks are implemented in [`calibration.py`](../calibration.py).
The historical WOFOST seasons and SIAP crop-label crosswalk are explicit
configuration inputs; SIAP does not provide the field sowing dates or cultivar.

## SIAP price estimation and gross value

For each crop/year, nominal SIAP price is `Valorproduccion /
Volumenproduccion` (MXN/t) when production is positive. The price pipeline
uses a municipal annual series if it has enough recent, mostly complete years
and at least three time-ordered backtest origins at the requested forecast
horizon; otherwise it tries the state series. It compares last value, damped
Holt, ARIMA(1,1,0), lagged Ridge, and lagged random forest using the **same**
held-out harvest-horizon MAE in MXN/t. The lowest-MAE model forecasts the price
for each crop's harvest **year**. Annual SIAP data cannot estimate a separate
within-year price for the harvest month. `estimated_tonnes = calibrated_t_ha *
area_ha`, and `estimated_gross_value_mxn = estimated_tonnes *
estimated_price_mxn_t`. Gross value excludes costs and is not profit. See
[`price_forecasting.py`](../price_forecasting.py).

## Outputs and selection semantics

`run_model_app(...)` returns `ModelBuildResult`. Its **single final model
output** is `final_df`: one row for every phase of every supplied rotation
option. `result.save_final_csv(path)` writes that DataFrame as one CSV. Each
row contains the terminal WOFOST values, all PCSE crop-summary and terminal
water-balance variables, calibrated yield, price, value, and a JSON array of
the complete phase trajectory in `wofost_daily_json`. Each phase is simulated
independently; `soil_state_carried_forward` is false. The result object also
holds optional diagnostic DataFrames (`historical_daily_df`,
`future_daily_df`, calibration, price history, backtests, and forecasts).

`selected_products=None` in the **WOFOST builder** does not mean all SIAP
products: it considers only crops present in its configured historical
seasons, crop crosswalk, WOFOST catalog, and at least two municipal calibration
years. The published farm profile has no verified `crop_history`, and the SIAP
municipal series contains 47 distinct crop labels during 2003–2025, many
without a WOFOST cultivar or known sowing/harvest calendar. No fully real
future WOFOST final CSV for all 47 crops can be inferred from these sources.

For **observations**, `load_municipal_siap_observations(...,
selected_products=None)` includes all 47 SIAP labels without WOFOST
simulation. The versioned
[`siap_valle_de_santiago_observed_2003_2025.csv`](../../../resources/examples/siap_valle_de_santiago_observed_2003_2025.csv)
has 891 original municipal rows, including separate SIAP production cycles
and irrigation modalities. Its 19 missing `observed_price_mxn_t` values
correspond to zero reported production. It is a real observed-data export,
**not** the model's `final_df` or a field-level crop rotation.
The bucket has state-only closing files for 2000–2002; its municipal files
begin in 2003, so no earlier municipal years are silently omitted.

## Model `final_df` column dictionary

This is the 107-column schema produced by the current rainfed app integration
test. PCSE PP and WLP configurations expose somewhat different daily variables;
an unavailable variable may be absent or null. `summary_*` and `terminal_*`
retain the native PCSE variable name after the prefix. Units below follow
[PCSE's model documentation](https://pcse.readthedocs.io/en/stable/code.html)
and the configured [engine output](https://pcse.readthedocs.io/en/stable/reference_guide.html#engine-configuration-files).

### Daily WOFOST state on the phase's final day

| Column | Unit | Meaning |
|---|---|---|
| `date` | date | Last simulated daily date in this phase. |
| `DVS` | dimensionless | Crop development stage. |
| `LAI` | m² leaf/m² ground | Leaf area index. |
| `TAGP` | kg dry matter/ha | Total above-ground crop biomass. |
| `WSO` | kg dry matter/ha | Storage-organ biomass. |
| `WLV` | kg dry matter/ha | Living leaf biomass. |
| `WST` | kg dry matter/ha | Living stem biomass. |
| `TSUM` | °C·day | Accumulated development temperature sum. |
| `TSUME` | °C·day | Accumulated temperature sum for emergence. |
| `WRT` | kg dry matter/ha | Living root biomass. |
| `RD` | cm | Rooting depth. |
| `SM` | m³ water/m³ soil | Simulated volumetric root-zone soil moisture. |
| `RFTRA` | fraction | Reduction factor for transpiration due to water or oxygen stress. |
| `EVS` | cm/day | Daily soil evaporation. |
| `TRA` | cm/day | Daily actual crop transpiration. |
| `CEVST` | cm | Cumulative soil evaporation over the crop cycle. |
| `CTRAT` | cm | Cumulative crop transpiration over the crop cycle. |
| `NamountSO` | kg N/ha | Simulated nitrogen held in storage organs. |
| `NamountLV` | kg N/ha | Simulated nitrogen held in living leaves. |
| `NamountST` | kg N/ha | Simulated nitrogen held in living stems. |
| `NamountRT` | kg N/ha | Simulated nitrogen held in living roots. |
| `NuptakeTotal` | kg N/ha | Cumulative plant nitrogen uptake; not measured soil N. |
| `WC` | cm | Soil-layer water content where exposed by PCSE; often null in the current classic water balance. |

### Identifiers, scenario, and supplied site inputs

| Column | Unit | Meaning |
|---|---|---|
| `crop` | WOFOST name | Simulated crop, such as `maize` or `fababean`. |
| `variety` | WOFOST name | Crop-parameter variety used by PCSE. |
| `year` | year | Planned harvest year; SIAP calibration also pairs by harvest year. |
| `run_id` | text | Immutable farm-profile run identifier. |
| `latitude` | decimal degrees | Model point latitude from the profile. |
| `longitude` | decimal degrees | Model point longitude from the profile. |
| `scenario` | text | `experimental_PP` or `experimental_WLP` PCSE production mode. |
| `water_mode` | text | `potential`, `rainfed`, or `irrigated`. |
| `irrigation_system` | text | User-provided system label; the label itself does not change PCSE physics. |
| `irrigation_applied_mm` | mm | Sum of requested irrigation event depths, before the separate event-efficiency treatment. |
| `input_elevation_m` | m | Site elevation supplied to the model. |
| `input_co2_ppm` | ppm | Atmospheric CO₂ assumption. |
| `input_initial_available_water_cm` | cm | Initial soil-profile available water (`WAV`); null in potential mode. |
| `input_site_NAVAILI_kg_ha` | kg N/ha | Fixed PCSE site placeholder (10); not a measured soil-N observation. |
| `input_soil_SMW` | m³/m³ | Soil moisture at wilting point. |
| `input_soil_SMFCF` | m³/m³ | Soil moisture at field capacity. |
| `input_soil_SM0` | m³/m³ | Soil moisture at saturation. |
| `input_soil_RDMSOL` | cm | Maximum rootable soil depth. |
| `input_soil_CRAIRC` | fraction | Critical soil air content. |
| `input_soil_SOPE` | cm/day | Maximum percolation rate from the rooted zone. |
| `input_soil_KSUB` | cm/day | Maximum percolation rate through the subsoil. |
| `input_soil_K0` | cm/day | Saturated hydraulic conductivity. |
| `is_final_day` | Boolean | True for the WOFOST terminal row used in `final_df`. |

### Native PCSE crop-summary variables

| Column | Unit | Meaning |
|---|---|---|
| `summary_DVS` | dimensionless | Development stage at crop finish. |
| `summary_LAIMAX` | m² leaf/m² ground | Maximum leaf area index reached. |
| `summary_TAGP` | kg dry matter/ha | Final total above-ground biomass. |
| `summary_TWSO` | kg dry matter/ha | Total storage-organ biomass at crop finish. |
| `summary_TWLV` | kg dry matter/ha | Total leaf biomass, including senesced material. |
| `summary_TWST` | kg dry matter/ha | Total stem biomass. |
| `summary_TWRT` | kg dry matter/ha | Total root biomass. |
| `summary_CTRAT` | cm | Cumulative crop transpiration through crop finish. |
| `summary_RD` | cm | Root depth at crop finish. |
| `summary_DOS` | date | Sowing date recorded by PCSE, if applicable. |
| `summary_DOE` | date | Emergence date, if simulated. |
| `summary_DOA` | date | Anthesis date, if simulated. |
| `summary_DOM` | date | Maturity date, if reached. |
| `summary_DOH` | date | Harvest date recorded by PCSE, if applicable. |
| `summary_DOV` | date | Date vernalization requirement was fulfilled, if applicable. |
| `summary_CEVST` | cm | Cumulative soil evaporation through crop finish. |
| `summary_NuptakeTotal` | kg N/ha | Total plant nitrogen uptake at crop finish. |
| `summary_NamountSO` | kg N/ha | Nitrogen held in storage organs at crop finish. |

### Native PCSE terminal water-balance variables

| Column | Unit | Meaning |
|---|---|---|
| `terminal_WTRAT` | cm | Total transpiration accounted for by the soil water balance. |
| `terminal_EVST` | cm | Total evaporation from the soil surface. |
| `terminal_EVWT` | cm | Total evaporation from standing surface water. |
| `terminal_TSR` | cm | Total surface runoff. |
| `terminal_RAINT` | cm | Total rainfall entering the water-balance accounting. |
| `terminal_TOTINF` | cm | Total water infiltration. |
| `terminal_TOTIRR` | cm | Total **effective** irrigation used to close the water balance. |
| `terminal_PERCT` | cm | Water percolating from the rooted zone to the subsoil. |
| `terminal_LOSST` | cm | Water lost to deeper soil. |

### Phase, calibration, price, and rotation fields

| Column | Unit | Meaning |
|---|---|---|
| `TWSO` | kg dry matter/ha | Convenience copy of `summary_TWSO` on the final row. |
| `yield_t_ha` | t dry matter/ha | Raw WOFOST yield, `TWSO / 1000`. |
| `season_id` | text | Unique configured season identifier within the model run. |
| `rotation_id` | text | User-supplied alternative rotation identifier; `default` for the legacy schedule. |
| `season_step` | 1-based integer | Position of this planned season inside its option. |
| `rotation_step` | 1-based integer | Phase number inside `rotation_id`. |
| `soil_state_carried_forward` | Boolean | Always false in the current implementation; seasons are independent PCSE runs. |
| `sowing_date` | date | Configured sowing date for the phase. |
| `sowing_year` | year | Year of `sowing_date`. |
| `planned_harvest_date` | date | Configured end/harvest date passed to PCSE. |
| `wofost_terminal_date` | date | Date on which the PCSE run actually ended. |
| `harvest_date` | date | Configured harvest date used to attach the annual price forecast. |
| `area_ha` | ha | Configured cultivated area for this phase. |
| `calibration_factor` | dimensionless | Per-crop SIAP yield scale fitted without an intercept. |
| `calibration_scope` | text | `municipal` or `state` SIAP yield observations used in the fit. |
| `calibrated_t_ha` | t dry matter/ha | Raw `yield_t_ha * calibration_factor`. |
| `future_weather_source` | text | User-provided provenance label for future weather; not independent validation. |
| `wofost_daily_json` | JSON string | Every daily PCSE result row for this phase, including summary/terminal values on its final day. |
| `estimated_price_mxn_t` | nominal MXN/t | Selected price model's forecast for the harvest year. |
| `price_scope` | text | `municipal` or `state` SIAP series selected for price forecasting. |
| `price_model` | text | Lowest-backtest-MAE model name for this crop. |
| `months_ahead` | calendar months | Months from December of `last_siap_year` to the harvest month. |
| `last_siap_year` | year | Latest SIAP file year specified in the price configuration. |
| `last_observed_year` | year | Latest positive-price SIAP observation for this crop and selected scope. |
| `last_production_t` | t | SIAP production volume in `last_observed_year` for the price scope. |
| `forecast_step_years` | years | Harvest year minus the crop's `last_observed_year`. |
| `estimated_tonnes` | t | `calibrated_t_ha * area_ha`. |
| `estimated_gross_value_mxn` | nominal MXN | `estimated_tonnes * estimated_price_mxn_t`; before costs and losses. |
| `price_backtest_mae_mxn_t` | MXN/t | Shared-horizon historical MAE of the selected price model. |
| `yield_loyo_mae_t_ha` | t/ha | Leave-one-year-out SIAP yield-calibration MAE. |
| `rotation_phase_count` | count | Number of planned phases in this rotation option. |
| `rotation_option_count` | count | Number of alternative rotation options in the model run. |
| `rotation_sequence` | text | Ordered crop-name sequence for this option, such as `maize -> fababean`. |
| `rotation_total_estimated_gross_value_mxn` | nominal MXN | Sum of estimated gross values over all phases in this option; repeated on its rows. |

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
