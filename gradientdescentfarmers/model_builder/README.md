# Guanajuato model builder

This package contains a read-only GCS connector, single-crop WOFOST 8.1 potential (PP) and water-limited (WLP) scenarios, and a municipal SIAP yield comparison and calibration. It is experimental and does not provide farm-specific yield or crop recommendations.

## Setup

Use a Python environment compatible with PCSE (the baseline was smoke-tested with PCSE 6.0.13). From the repository root:

```bash
python -m pip install -r requirements.txt
python -m unittest discover -s tests/model_builder -v
```

Configure Google Cloud Application Default Credentials with read access to `data_dump_samples`. No credential files are stored in this repository. Pass an immutable `gs://data_dump_samples/farm_profiles/guanajuato_valle_demo/runs/<RUN_ID>` URI, not `latest.json`. `GCSDataClient` checks the manifest identity and table SHA-256 before returning a DataFrame.

For local development, install the Google Cloud CLI and run `gcloud auth application-default login` in your terminal. This stores ADC outside the repository; no environment variable is needed. If you already have an authorized credential JSON file, set `GOOGLE_APPLICATION_CREDENTIALS` to its absolute path in the same shell that launches Python or Jupyter. This variable is a **path**, not the JSON contents. Do not commit the file or paste its contents into a notebook. A Python virtual environment installs libraries but does not create ADC credentials. See [Google's local ADC guide](https://docs.cloud.google.com/docs/authentication/set-up-adc-local-dev-environment).

If the local ADC file has no `project_id`, also set `GOOGLE_CLOUD_PROJECT` to the project ID. The verified setup for this bucket used `gdfarming` as the project. Export both variables in the shell that starts the notebook kernel. The published farm run is `gs://data_dump_samples/farm_profiles/guanajuato_valle_demo/runs/67b66942681a4214`.

## Modules and handoff

- `gcs.py`: `GCSDataClient.load_profile(run_uri).table("weather_daily")` reads a declared CSV or Parquet table. `list_tables(prefix)` and `read_frame(uri)` inspect SIAP and Dataverse files; CSV, TSV/TAB, Parquet, and Excel are supported. Excel needs `openpyxl`.
- `wofost.py`: `run_wofost(weather_df, crop=..., variety=..., water_mode=..., sowing_date=..., end_date=..., elevation_m=..., run_id=...)` returns every daily variable from PCSE. The final row also contains every variable from PCSE's crop summary (`summary_*`) and terminal water balance (`terminal_*`), with their original names retained after the prefixes. It has `is_final_day=True` and `yield_t_ha=TWSO/1000`, a dry-matter yield in t/ha. Input soil and site values are recorded as `input_*` columns. POWER radiation and rain are converted to PCSE units; vapor pressure is derived from relative humidity and mean temperature, and reference ET is calculated by PCSE. Weather dates must cover the full simulation window.
- `soil_context.py`: reads the profile's point SoilGrids table and computes soil-mass-weighted total nitrogen and organic carbon for 0–30 cm, plus surface pH. These are contextual observations, not plant-available nitrogen or fertilizer-response estimates. Missing tables yield null values.
- `profile_scenarios.py`: replays the profile's daily weather in later years as an explicitly labeled analog and constructs a water-limited soil scenario anchored to the profile's SoilGrids water-content and bulk-density layers. It calls no external data API.
- `calibration.py`: `compare_siap_yield(...)` pairs final WOFOST yields with SIAP municipal production per **sown** hectare and calculates signed, absolute, and percentage errors. `calibrate_siap_yield(...)` fits a no-intercept multiplier by crop and produces full-data and leave-one-year-out predictions and errors. `error_metrics(...)` returns MAE, RMSE, mean bias, and MAPE as a DataFrame. The full-data fit is an in-sample diagnostic; leave-one-year-out is a limited temporal check when only two years are available.
- `price_forecasting.py`: `load_siap_price_history(...)` reads annual SIAP municipal closing files, accepts the 2015–2020 alternate crop heading, and computes production-weighted nominal producer price as production value divided by tonnes. `select_price_scope(...)` uses the municipality when its annual series is sufficient and otherwise falls back to the state. `compare_price_models(...)` evaluates time-series and conventional ML models with expanding-origin forecasts and one shared harvest-horizon MAE in MXN/t. `forecast_harvest_prices(...)` returns a price for each planned crop harvest. `add_prices_to_calibrated_wofost(...)` multiplies that price by calibrated estimated tonnes to produce nominal gross crop value.
- `siap_observations.py`: `load_municipal_siap_observations(..., selected_products=None)` exports **all** SIAP crop labels for a municipality as observed records. It does not run WOFOST or infer a field rotation.

The crop-simulation notebooks live in `notebooks/`: `guanajuato_wofost_baseline.ipynb`, `guanajuato_wofost_calibration.ipynb`, and the focused `guanajuato_maize_fababean_rainfed.ipynb`. The baseline notebook passes `project="gdfarming"` to `GCSDataClient`, so VS Code does not need to inherit `GOOGLE_CLOUD_PROJECT`. It exposes crop, cultivar, water mode, dates, CO₂, elevation, soil, irrigation, and municipality as inputs. The focused rainfed notebook runs maize and faba bean in 2024–2025. Its default `DATA_MODE="synthetic"` executes with explicitly invented weather and soil; `DATA_MODE="gcs"` requires supplied soil measurements before loading the immutable weather profile. It checks SIAP availability by crop and year, then reports errors only for matched observations. The 2024–2025 Valle de Santiago SIAP files contain maize but no grain faba bean observations. The paired SIAP comparison and calibration filenames in the general notebooks include the crop and water mode, for example `data/model_builder/siap_potential_maize_comparison.csv` and `data/model_builder/siap_potential_maize_calibration.csv`. The calibration notebook builds the comparison itself if that CSV is absent. The `data/` directory is ignored by Git.

## Crop choices and scientific limits

The [current `wofost81` crop catalog](https://raw.githubusercontent.com/ajwdewit/WOFOST_crop_parameters/wofost81/crops.yaml) lists 20 active crops, including `maize`, `barley`, and `fababean`. The baseline notebook prints all supported crops and the available varieties for the selected crop using `available_crop_varieties(YAMLCropDataProvider(model=...))`. It starts with `maize` / `Grain_maize_202`. The provider may need network access on first use. These reference parameters are not calibrated for Guanajuato. For SIAP comparison, also enter the exact crop label used by SIAP in `SIAP_CROP_LABELS`.

Set `water_mode="potential"` for PP, which assumes unlimited water. Set `water_mode="rainfed"` for WLP with rainfall and no irrigation events. Set `water_mode="irrigated"` for WLP with dated irrigation. Both WLP modes require `soil_parameters` with `SMW`, `SMFCF`, `SM0`, `RDMSOL`, `CRAIRC`, `SOPE`, `KSUB`, and `K0`, plus `initial_available_water_cm` (`WAV`). Soil moisture and critical air content are fractions; `RDMSOL` and initial water are cm; `SOPE`, `KSUB`, and `K0` are cm/day. Irrigated runs also require `irrigation_system` and one or more `irrigation_events` with `date`, `amount_mm`, and `efficiency` (0–1). PCSE uses the event depth and efficiency; the system name is retained as metadata. Use measured or independently justified values. The current profile does not supply these soil or irrigation measurements.

```python
run_wofost(
    weather_df, crop="maize", variety="Grain_maize_202",
    sowing_date="2024-05-15", end_date="2024-12-15", elevation_m=1700,
    water_mode="irrigated", soil_parameters=measured_soil,
    initial_available_water_cm=measured_initial_water_cm,
    irrigation_system="drip",
    irrigation_events=[{"date": "2024-06-01", "amount_mm": 40, "efficiency": 0.8}],
)
```

The [Guanajuato source handoff](../source_builder/docs/GUANAJUATO_INTEGRATED_RUN.md) identifies a reference point at 20.4243195, -101.1466639 and a 2024–2025 POWER history. The 1-ha area is a schema placeholder, not an observed field. PP assumes no water or N limitation. WLP simulates water limitation but still does not model fertilizer management or crop-specific irrigation-system hydraulics. SIAP yields may use a different moisture basis from WOFOST dry matter; align units before interpreting residuals. Reusing years in both municipal fitting and field comparison is not an independent holdout.

The `NamountSO`, `NamountLV`, `NamountST`, `NamountRT`, and `NuptakeTotal` columns describe simulated **plant** nitrogen pools and uptake. The PP and WLP models used here do not simulate nitrogen-limited soil fertility or fertilizer response. `input_site_NAVAILI_kg_ha` records the fixed 10 kg/ha PCSE site placeholder; it is not a measured soil N value.

The live run contains 731 daily weather rows for 2024–2025. Carmelitas Chico is in the **Valle de Santiago** municipality according to [INEGI's Guanajuato locality table](https://www.inegi.org.mx/contenidos/productos/prod_serv/contenidos/espanol/bvinegi/productos/historicos/1329/702825116682/702825116682_1.pdf). The Dataverse yield workbook covers **2012–2022**, so its field observations have no year overlap with the current weather and are excluded from the current calibration notebooks. A field-level comparison requires historical weather and a corresponding simulation; it cannot be inferred from the 2024–2025 run.

## Harvest-price exploration

Run `notebooks/siap_harvest_price_model_exploration.ipynb` after installing `requirements.txt` and configuring GCS ADC. Edit `SELECTED_PRODUCTS`, their exact `SIAP_CROP_LABELS`, and the planned `CROP_ROTATION` harvest dates. The notebook computes the number of calendar months through the last harvest, fits annual price models through each crop's own harvest year, compares last-value, damped Holt, ARIMA(1,1,0), lagged Ridge, and lagged random forest with the same held-out dates and MAE in MXN/t, and saves annual, harvest, leaderboard, and backtest CSVs under ignored `data/model_builder/`.

The 2003–2025 SIAP files contain 23 usable municipal maize price years for Valle de Santiago. Grain faba bean has only one municipal year, so the notebook uses Guanajuato state prices; its latest usable priced year is 2023, with 3.72 tonnes of recorded state production. That thin and older market record makes its later forecasts especially uncertain. The SIAP files are annual, so the harvest month determines which **annual** forecast to use; the notebook does not claim to estimate within-year price changes. Prices are nominal MXN/t. The optional calibrated-WOFOST join requires a future harvest date and either estimated tonnes or calibrated t/ha plus area in ha. Its result is gross value before costs and other adjustments, not profit.

## End-to-end orchestration

`GuanajuatoModelBuilder` in `base.py` connects to GCS, reads the immutable farm profile, SoilGrids context, and SIAP, runs historical WOFOST seasons, fits per-crop SIAP yield factors, runs every phase of each supplied rotation option with **explicit future weather**, selects the minimum-MAE price model per crop, and returns one `ModelBuildResult.final_df`. Each row is one phase. It includes `rotation_id`, `rotation_step`, `rotation_phase_count`, compact water and soil nutrient measures, calibrated yield, area, estimated tonnes, forecast MXN/t, and nominal gross value. The same crop may occur in multiple phases and options. The full PCSE daily, summary, and terminal variables remain in diagnostic DataFrames on the result object.

`rotation_options` is a list of named **input schedules**. Each option has a unique `rotation_id` and a nonempty `phases` list; each phase needs `crop`, `sowing_date`, `harvest_date`, and positive `area_ha`. Phases must be chronological and nonoverlapping within an option. `selected_products` is the union of crops across options, and each selected crop needs matching historical WOFOST seasons and SIAP calibration years. `application.conf` supplies two maize rotation alternatives by default; user-provided `rotation_options` replace that list. WOFOST/PCSE simulates the supplied crops and dates; it does not select the next crop. This implementation runs each season independently, so it does not transfer soil water or nutrients from one crop to the next. `soil_state_carried_forward=False` makes that scope explicit.

```python
"rotation_options": [
    {"rotation_id": "maize_faba_maize", "phases": [
        {"crop": "maize", "sowing_date": "2027-05-15", "harvest_date": "2027-12-15", "area_ha": 1.0},
        {"crop": "fababean", "sowing_date": "2028-01-15", "harvest_date": "2028-06-15", "area_ha": 1.0},
        {"crop": "maize", "sowing_date": "2029-05-15", "harvest_date": "2029-12-15", "area_ha": 1.0},
    ]},
    {"rotation_id": "faba_maize", "phases": [
        {"crop": "fababean", "sowing_date": "2027-01-15", "harvest_date": "2027-06-15", "area_ha": 1.0},
        {"crop": "maize", "sowing_date": "2028-05-15", "harvest_date": "2028-12-15", "area_ha": 1.0},
    ]},
]
```

Call `result.save_final_csv("data/model_builder/my_run.csv")` to save the **one consolidated final DataFrame**. It has one row per phase, with no embedded daily JSON or expanded `summary_*`/`terminal_*` columns. `notebooks/app.ipynb` writes `data/model_builder/app_profile_weather_analog_2026_2027_final.csv` for two two-phase maize alternatives. It reads only the existing GCS profile and SIAP files. The profile's 2024–2025 weather is replayed in 2026–2027 as an analog; crop calendars, 1-ha areas, and hydraulic proxy assumptions are not measured farm inputs. `save_csv_bundle(...)` remains available for optional full PCSE and model diagnostic exports. The versioned CSV in `resources/examples/` is a separate **real SIAP observation export** for all 47 historical municipal crop labels. It is not a WOFOST final DataFrame. See [data sources, calibration, outputs, and both column dictionaries](docs/DATA_SOURCES_CALIBRATION_OUTPUTS.md).

The app entry point `run_model_app(user_parameters)` in `../app.py` reads `resources/application.conf`, applies the optional dictionary, checks the pinned latitude/longitude, and prepares missing analog weather and water-limited soil inputs from the GCS profile. A different point raises `NoPointDataError` until source-builder integration exists. `notebooks/app.ipynb` only exposes the override dictionary and displays the returned final and intermediate DataFrames. Change `selected_products`, `water_mode`, and `irrigation_system` there, along with dates, area, soil, irrigation events, and weather as needed. Lists and nested dictionaries in the user dictionary replace their configured defaults in full.

```python
from gradientdescentfarmers.model_builder import GuanajuatoModelBuilder

result = GuanajuatoModelBuilder().build(None, {
    "run_uri": "gs://data_dump_samples/farm_profiles/guanajuato_valle_demo/runs/67b66942681a4214",
    "gcp_project": "gdfarming",
    "state": "Guanajuato", "municipality": "Valle de Santiago",
    "selected_products": ["maize"],  # omit to infer from matching municipal SIAP history
    "historical_seasons": [
        {"crop": "maize", "sowing_date": "2024-05-15", "harvest_date": "2024-12-15"},
        {"crop": "maize", "sowing_date": "2025-05-15", "harvest_date": "2025-12-15"},
    ],
    "planned_rotation": [
        {"crop": "maize", "sowing_date": "2027-05-15",
         "harvest_date": "2027-12-15", "area_ha": measured_area_ha},
    ],
    "water_mode": "rainfed",
    "soil_parameters": measured_soil,
    "initial_available_water_cm": measured_initial_water_cm,
    "future_weather": future_weather_df,  # or a gs:// URI covering every planned season
    "future_weather_source": "documented_scenario_name",
})
valued_harvests = result.final_df
```

If `selected_products` is omitted, the builder considers crops with historical season dates and at least two matching **municipal** SIAP calibration years; the default crop-label and variety crosswalk covers maize and grain faba bean. Add `siap_crop_labels` and `varieties` for other WOFOST crops. A selected crop needs at least two matching yield observations from either the municipality or state; the builder rejects incomplete calibration instead of copying another crop's factor. The current profile has 2024–2025 weather and no matching faba-bean SIAP yield observations in those years. Calibrating faba bean requires compatible historical weather and seasons for years with SIAP observations. Future weather must be supplied; the bucket's 2024–2025 weather cannot be treated as a forecast. For irrigated seasons, set `water_mode="irrigated"`, supply hydraulic soil inputs, a system name, and dated `irrigation_events` on each historical and planned season. Production value is gross revenue, not profit.
