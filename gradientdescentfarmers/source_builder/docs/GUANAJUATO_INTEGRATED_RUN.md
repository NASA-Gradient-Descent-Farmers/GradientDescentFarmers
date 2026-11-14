# Guanajuato — integrated scientific acquisition run

This describes the integrated **source** package for the team. The verified run below is an environmental inventory, not a field-surveyed farm, calibrated crop model, or production certification.

- **Farm:** `guanajuato_valle_demo` at 20.4243195, -101.1466639
- **POWER:** daily weather 2024-01-01 through 2025-12-31 (731 days expected)
- **SRTM:** five point samples; not a parcel survey
- **SoilGrids:** pilot 24 property×depth WCS observations (not a laboratory profile)
- **MODIS:** C6.1 three products, **2024–2025 acquisition dates**, `earthaccess` + native HDF4; 16-day MOD13Q1 (up to ~46 expected) and 8-day MOD11A2/MOD16A2GF (~92 each), with source-specific QA
- **World Bank:** country-level indicators; not crop prices or farm profitability
- **GPM IMERG:** one full UTC day (2024-07-01), **48/48 exact half-hour slots**, non-null rates required for daily rainfall
- **SMAP L4:** small two-granule snapshot (2024-07-01 to 2024-07-02), **not** a continuous two-year soil moisture series

SMAP, GPM, MODIS, POWER, SoilGrids differ in spatial/temporal resolution. They are not point measurements of a verified field. The required `area_ha=1` is a synthetic input-schema placeholder, **not** the area of a real Guanajuato farm.

## Verified run — 2026-11-14

- **Run ID:** `67b66942681a4214`.
- **Acquisition commit:** `396f2968e81678a099e13d104e2ac3fd077db06d`.
- **Interrupted-run reference:** `e07e32b`; acquisition code and integrated configuration are unchanged since that commit. This is a new run that reused valid cached granules.
- **State:** `partial`, with no enabled source in error. MODIS QA retains missing observations instead of filling them; its requested acquisition calendars are complete.
- **Audit:** `integrity_ok=true`, `qa_ok=true`; all 16 exported tables passed their checks.

| Source / table | Observations | QA / coverage |
| --- | ---: | --- |
| POWER weather | 731 daily rows | Complete 2024–2025 daily calendar, including leap day |
| SRTM | 5 samples | All named elevations present |
| SoilGrids | 24 rows | Eight properties × three depths, finite values and units |
| MOD13Q1 | 46 composites | 41 usable NDVI/EVI pairs; 89.13% QA coverage |
| MOD11A2 | 92 composites | 67 usable day/night pairs; 72.83% QA coverage |
| MOD16A2GF | 92 composites | 79 usable ET/PET pairs; 85.87% QA coverage |
| GPM IMERG | 48 half-hours + 1 daily row | Exact UTC slots for 2024-07-01; no missing precipitation values |
| SMAP L4 | 2 granules | Usable snapshot, not a continuous two-year series |
| World Bank | 192 rows | Country-level statistical context |

Local run and designated GCS delivery prefix:

```text
data/integrated_guanajuato/guanajuato_valle_demo/runs/67b66942681a4214/
gs://data_dump_samples/farm_profiles/guanajuato_valle_demo/runs/67b66942681a4214/
```

The delivery adds `audit_report.json`, `handoff_report.json`,
`wofost_source_report.json`, `execution_provenance.json`, `delivery_status.json`,
`delivery_manifest.json`, `SHA256SUMS` and a consumption guide to the original
export. `delivery_status.json` records checks before transfer;
`gcs_upload_receipt.json` is created only after every uploaded file has been
read back and its SHA-256 verified. Download caches and historical runs are
excluded. Consumers should use this specific run, without relaunching acquisition.

`wofost_pp_input_ready=false` and `wofost_wlp_input_ready=false`: the PCSE weather
adapter, crop/site parameters and prospective agromanagement remain separate
team inputs. WLP also requires verified soil hydraulics and initial water.

## Run sequence (from repository root, in the working Python 3.11 environment)

```bash
git switch daniel-sourcebuilder
git pull --ff-only origin daniel-sourcebuilder
python -m pip install -e '.[source,source-test,source-modis]'
python -m pytest tests/source_builder tests/test_scaffold.py -q

# Optional diagnostic only: this small smoke cannot prove a full GPM day.
python -m gradientdescentfarmers.source_builder \
  --config resources/guanajuato_smoke.json --run

# Start a new integrated run only when a fresh acquisition is needed.
python -m gradientdescentfarmers.source_builder \
  --config resources/guanajuato_integrated.json --run
```

Output is always versioned in `data/integrated_guanajuato/guanajuato_valle_demo/runs/<run_id>/`. Older baseline, WorldBank, MODIS-pilot and smoke runs are untouched. Original Earthdata HDF/HDF4 cache is reused where valid; large downloads may require substantial free local disk space. Do not delete HDF files if a run is interrupted: the recovery workflow preserves valid granules.

Run one acquisition at a time when sharing this cache. Existing valid granules
are reused, but the builder does not implement a process lock. A canceled run
can leave valid cache downloads without a final `farm_profile.json`; rerunning
the same configuration creates a new run ID and reuses those downloads.

## Mandatory checks for handoff

Run `python -m gradientdescentfarmers.source_builder.core.handoff --run-dir <output_dir> --output <output_dir>/handoff_report.json`.

This checks expected source enablement and QA, 731 weather days, MODIS date coverage and valid QA observations, a complete 48/48 UTC GPM day, and an honest SMAP snapshot flag. The file integrity audit checks declared SHA256s and file presence separately. Both reports must accompany an exported FarmProfile.

Any unavailable/partial source, unvalidated agronomic calibration, missing farm management, crop price or observed yield must be clearly labeled. **Do not report WOFOST, profitability or rotation readiness based solely on source data.**
