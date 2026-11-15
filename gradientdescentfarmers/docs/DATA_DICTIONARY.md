# Data Dictionary — Texcoco

## Spatial and temporal identifiers

| Field | Unit | Meaning |
|---|---:|---|
| `lat`, `lon` | degrees | Query point, 19.53 N, -98.85 W |
| `date` | ISO 8601 | Calendar date from the source; daily POWER was requested without `time-standard`, so the API uses LST by default; other sources may use UTC |
| `year` | year | SIAP agricultural/statistical year |

## Meteorological and hydrological indicators

| Field | Unit | Source | Interpretation |
|---|---:|---|---|
| `power_t2m` | °C | NASA POWER | Daily mean air temperature |
| `power_t2m_max`, `power_t2m_min` | °C | NASA POWER | Daily extremes |
| `power_prectotcorr` | mm/day | NASA POWER | Corrected precipitation |
| `power_rh2m` | % | NASA POWER | Relative humidity at 2 m |
| `power_ws2m` | m/s | NASA POWER | Wind speed at 2 m |
| `power_allsky_sfc_sw_dwn` | MJ/m²/day | NASA POWER, `AG` community | Daily solar radiation; the PCSE provider multiplies by 10⁶ to obtain J/m²/day |
| `smap_sm_surface` | m³/m³ | SMAP L4 | Soil moisture at 0–5 cm |
| `smap_sm_rootzone` | m³/m³ | SMAP L4 | Modeled root-zone soil moisture at 0–100 cm |
| `smap_sm_profile` | m³/m³ | SMAP L4 | Modeled profile soil moisture |
| `smap_surface_temp` | K | SMAP L4 | Surface temperature |
| `smap_n_obs` | count/day | SMAP L4 | Three-hourly samples used in the daily average |
| `gpm_precipitation_mm` | mm/day | GPM IMERG Final | Daily precipitation in a 0.1° pixel |
| `ecostress_etdaily_mm` | mm/day | ECOSTRESS | Estimated ET on the acquisition date |
| `grace_tws_anomaly_cm` | cm EWT | GRACE/GRACE-FO | Monthly regional terrestrial water-storage anomaly |
| `srtm_elevation_m` | m | SRTM | Elevation at the point |
| `srtm_slope_deg` | degrees | SRTM | Approximate slope from five points |

## Vegetation and soils

| Field | Unit | Source | Interpretation |
|---|---:|---|---|
| `modis_ndvi` | dimensionless | MODIS | 16-day NDVI composite at 250 m |
| `landsat_hls_ndvi` | dimensionless | HLS Landsat | 30 m NDVI with an Fmask mask |
| `texture`, `texture_class` | text/code | GLDAS | Soil texture class |
| `sand`, `silt`, `clay` | fraction 0–1 | GLDAS | Texture fractions |
| `porosity` | fraction 0–1 | GLDAS | Noah model porosity |
| `field_capacity` | mm/0–100 cm | IGBP-DIS | Water at −10 kPa |
| `wilting_point` | mm/0–100 cm | IGBP-DIS | Water at −1500 kPa |
| `profile_available_water_capacity` | mm/0–100 cm | IGBP-DIS | Available water capacity |
| `bulk_density` | g/cm³ | IGBP-DIS | Bulk density |
| `soil_carbon_density` | kg/m² | IGBP-DIS | Soil carbon |
| `total_nitrogen_density` | g/m² | IGBP-DIS | Total soil nitrogen |
| `thermal_capacity` | MJ/m³/K | IGBP-DIS | Heat capacity |

## SIAP

The table retains the main quantities reported by SIAP and calculates transparent yield measures:

- `yield_harvested_t_ha = production_t / harvested_ha`;
- `yield_sown_t_ha = production_t / sown_ha`, which treats lost area as zero yield;
- `lost_share = lost_ha / sown_ha`;
- `price_mxn_t = value_mxn / production_t` when SIAP publishes production value.

No grain-moisture conversion is applied. Municipal statistics are not treated as measurements of an individual field or as a crop-rotation history.
