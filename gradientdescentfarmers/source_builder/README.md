# Guanajuato SourceBuilder — reproducible scientific data pipeline

**Branch:** `daniel-sourcebuilder`. **Coordinates:** (20.4243195, -101.1466639), regional reference in Guanajuato, Mexico. **Not an observed farm.** The 1-ha field in `resources/guanajuato_reference.json` is a synthetic placeholder required by the input schema; no actual yields, management history or irrigation are asserted.

This package migrates the scientific pipeline from `NASA-warm-up/farmadapt_v2/farmadapt/` into `gradientdescentfarmers/source_builder/core/`, keeping the original tests and domain schemas. It provides `NASAProfileSourceBuilder(SourceBuilder)` for the team's `Pipeline` contract.

## Outputs / data catalog

All outputs live in **repository-root `data/`**, ignored by Git. The default baseline is `data/processed/guanajuato_valle_demo/runs/<run_id>/`, alongside `data/processed/guanajuato_valle_demo/latest.json`. GPM/SMAP HDF5 cache is `data/cache/earthdata/`.

Each run includes:
- `farm_profile.json`: versioned metadata/manifest, declared table hashes and paths
- `availability.json`: source-level status, coverage, warnings and errors
- `validation.json`: per-table QA checks and coverage
- `model_readiness.json`: prerequisites, **not** a validated crop-yield model
- `provenance.json`: source-specific provenance
- `feature_catalog.csv`: sources and declared outputs
- `standardized/*.csv`: time-series and geospatial sample tables at native grains

Core sources: NASA POWER daily weather, SRTM elevation, SoilGrids soil properties, ORNL MODIS NDVI/EVI/LST/ET/PET, GPM IMERG 30-min rain, SMAP L4 soil moisture. Optional World Bank/USDA/FAOSTAT and GEE providers exist but are not mandatory.

See [DATA_PIPELINE](docs/DATA_PIPELINE.md), [FARM_PROFILE_CONTRACT](docs/FARM_PROFILE_CONTRACT.md), [QUALITY_AND_LIMITATIONS](docs/QUALITY_AND_LIMITATIONS.md). Some inherited docs contain historical `farmadapt/` paths; use the new `gradientdescentfarmers/source_builder/core/` paths instead.

## Install, test, run

Requires Python 3.11 for the scientific components.

```bash
python -m pip install -e '.[source,source-test,source-modis]'
python -m pytest tests/source_builder tests/test_scaffold.py -q

# Preview (no remote data acquisition)
python -m gradientdescentfarmers.source_builder --config resources/guanajuato_baseline.json

# Baseline (real data, may take time)
python -m gradientdescentfarmers.source_builder --config resources/guanajuato_baseline.json --run

# GPM+SMAP small smoke (only after baseline)
python -m gradientdescentfarmers.source_builder --config resources/guanajuato_smoke.json --run

# Full day: ONLY after robust Earthdata recovery is integrated and smoke passes
python -m gradientdescentfarmers.source_builder --config resources/guanajuato_full_day.json --run
```

Never commit `.env`, `data/` or credential-bearing notebooks. Use `EARTHDATA_USERNAME` / `EARTHDATA_PASSWORD` or `EARTHDATA_TOKEN` in local `.env`. The old HDF5 `GranuleRecovery` helper is included but **not yet connected to `core/earthdata.py::_download`**; do not restart a large 48-granule download before fixing that.

Use `python -m gradientdescentfarmers.source_builder.core.audit --root data/processed --sites guanajuato_valle_demo --output data/phase1_guanajuato_audit.json` after baseline. Audit output must be reviewed: a `partial` state can be legitimate, and no synthetic value is scientific evidence.

**Status:** migration code committed; Guanajuato remote runs, GPM 48/48, and independent scientific field validation are **pending**. Offline regression tests validate code behavior only.

## MODIS native HDF4 without GDAL HDF4

`gradientdescentfarmers/source_builder/discovery.ipynb` is an opt-in
`earthaccess` + `pyhdf` + `pyproj` inspection notebook. Rasterio
remains a SoilGrids dependency, but its HDF4 driver is **not** required for
MODIS. See `docs/MODIS_EARTHACCESS.md`. Do not interpret pilot (1–2 granule)
coverage as a complete MODIS time series.
