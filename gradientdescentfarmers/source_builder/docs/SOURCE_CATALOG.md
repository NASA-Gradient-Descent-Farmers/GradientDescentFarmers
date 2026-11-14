# Scientific source and table catalog — Guanajuato

Reference location: **20.4243195, -101.1466639**. All source statuses depend on a real local run, and **none of the following is assumed to have succeeded on Guanajuato**.

| Provider | Native observation | Output table | Primary variables | Resolution / QA |
|---|---|---|---|---|
| NASA POWER | Daily point | `weather_daily` | temperature, rain, radiation, humidity, wind | Daily physical QA, units, continuity |
| SRTM via OpenTopoData | Point samples | `topography_samples` | elevation, approximate slope | 5 sampled points; not surveyed parcel |
| SoilGrids WCS | Depth/property samples | `soil_properties_raw` | pH, texture, SOC, bulk density | Layer units, WCS coverage IDs; no lab calibration |
| MODIS MOD13Q1 (ORNL) | Composite | `vegetation_timeseries` | NDVI, EVI | Masked QA observations, no crop ID |
| MODIS MOD11A2 (ORNL) | Composite | `land_surface_temperature` | LST day/night | QA and scale factors |
| MODIS MOD16A2GF (ORNL) | Composite | `evapotranspiration` | ET, PET | QA and scale factors |
| NASA GPM IMERG V07 | Half hour | `gpm_half_hourly`, `gpm_daily` | mm/h and 30-min precipitation | 48/48 unique valid UTC slots for daily totals |
| NASA SMAP L4 | 3-hour assimilation | `soil_moisture_timeseries` | surface/root-zone water | EASE-grid ~9km; not parcel moisture |
| World Bank | Country-level | `country_agriculture_context` | agriculture macro indicators | National context only |

## Core contracts

- `FarmerInput` contains location, fields, optional crop history and management; not imputed.
- `FarmProfile` records provider statuses `not_requested`, `missing`, `error`, `partial`, `available`; `available` means *preliminary input QA*, not field validation.
- Each output table has its own grain, units, source, checks, path and SHA256 in the manifest.
- Missing crop calibration, field yield, financial price and nutrient parameters remain missing. No model readiness flag is a prediction.

## Export and reproducibility

Under `data/processed/guanajuato_valle_demo/runs/<run_id>`, inspect:
`farm_profile.json`, `availability.json`, `validation.json`, `provenance.json`, `model_readiness.json`, `feature_catalog.csv`, `standardized/*.csv`.

`data/` is gitignored, so anyone who needs the same run must execute the pipeline or obtain an explicitly shared versioned artifact. Do not commit raw HDF5 or observed farmer data to a public GitHub repository.
