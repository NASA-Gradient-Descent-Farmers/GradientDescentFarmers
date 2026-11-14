# Guanajuato — integrated scientific acquisition run

This is the planned first integrated **source** package for the team. Not a field-surveyed farm, calibrated crop model, or production certification.

- **Farm:** `guanajuato_valle_demo` at 20.4243195, -101.1466639
- **POWER:** daily weather 2024-01-01 through 2025-12-31 (731 days expected)
- **SRTM:** five point samples; not a parcel survey
- **SoilGrids:** pilot 24 property×depth WCS observations (not a laboratory profile)
- **MODIS:** C6.1 three products, **2024–2025 acquisition dates**, `earthaccess` + native HDF4; 16-day MOD13Q1 (up to ~46 expected) and 8-day MOD11A2/MOD16A2GF (~92 each), with source-specific QA
- **World Bank:** country-level indicators; not crop prices or farm profitability
- **GPM IMERG:** one full UTC day (2024-07-01), **48/48 exact half-hour slots**, non-null rates required for daily rainfall
- **SMAP L4:** small two-granule snapshot (2024-07-01 to 2024-07-02), **not** a continuous two-year soil moisture series

SMAP, GPM, MODIS, POWER, SoilGrids differ in spatial/temporal resolution. They are not point measurements of a verified field. The required `area_ha=1` is a synthetic input-schema placeholder, **not** the area of a real Guanajuato farm.

## Run sequence (from repository root, in the working Python 3.11 environment)

```bash
git switch daniel-sourcebuilder
git pull --ff-only origin daniel-sourcebuilder
python -m pip install -e '.[source,source-test,source-modis]'
python -m pytest tests/source_builder tests/test_scaffold.py -q

# First re-run the small GPM + SMAP smoke; it previously failed for
# missing earthaccess, prior to fixing .env and installing dependencies.
python -m gradientdescentfarmers.source_builder \
  --config resources/guanajuato_smoke.json --run

# Once smoke succeeds and its availability / scientific QA are reviewed:
python -m gradientdescentfarmers.source_builder \
  --config resources/guanajuato_integrated.json --run
```

Output is always versioned in `data/integrated_guanajuato/guanajuato_valle_demo/runs/<run_id>/`. Older baseline, WorldBank, MODIS-pilot and smoke runs are untouched. Original Earthdata HDF/HDF4 cache is reused where valid; large downloads may require substantial free local disk space. Do not delete HDF files if a run is interrupted: the recovery workflow preserves valid granules.

## Mandatory checks for handoff

Run `python -m gradientdescentfarmers.source_builder.core.handoff --run-dir <output_dir> --output <output_dir>/handoff_report.json`.

This checks expected source enablement and QA, 731 weather days, MODIS date coverage and valid QA observations, a complete 48/48 UTC GPM day, and an honest SMAP snapshot flag. The file integrity audit checks declared SHA256s and file presence separately. Both reports must accompany an exported FarmProfile.

Any unavailable/partial source, unvalidated agronomic calibration, missing farm management, crop price or observed yield must be clearly labeled. **Do not report WOFOST, profitability or rotation readiness based solely on source data.**
