# Validation matrix and known risks

**Current scope:** automated code tests, synthetic-source smoke tests and file-format checks; external API/live scientific source tests still to run. "Productive architecture" ≠ "production-qualified farming model".

| Layer | Implemented now | Not yet certified |
|---|---|---|
| Farmer input | Strong Pydantic bounds, IDs, dates, fields, intercropping semantics, objectives | Geometry/topology verification of uploaded GeoJSON; farmer identity/access control |
| HTTP/API | Caching, timeout/retries, source status, secret sanitization | Continuous production monitoring, distributed locks/circuit-breakers, quotas |
| POWER | Scientific unit verification for solar radiation, physical ranges, daily dates | Independent station comparison, crop-specific weather driver quality |
| SRTM | Five samples and approximate slope | Parcel-scale survey, slope uncertainty |
| SoilGrids | Advertised coverages only, proper scale/depth/WCS CRS | Soil laboratory ground-truth, WCS uptime, heavy query runtime |
| MODIS | 3 products, strict QA masks, native composites, retain raw | Spatial aggregation over true field boundaries, cloud-related sampling bias |
| GPM | 0.5 h rate->accumulation, time/lat-lon checks, no incomplete-day totals | Extreme-event definition over years and hydrological validation |
| SMAP | EPSG:6933 point cell, HDF5 auxiliary filtering, fill values | HDF5 open cost (up to several minutes observed), remote Harmony subsets, multi-year reference percentiles |
| Economics | World Bank contextual, optional USDA/FAOSTAT, schema-only price/cost | Farmgate prices, input costs, calibration and exchange-rate consistency |
| Model readiness | Explicit reasons; WOFOST/NSGA flagged NOT validated | Actual simulator runs, Pareto benchmark, economic uncertainty coverage |
| Export | Atomic JSON and table writes; SHA-256 path/hash metadata | Central object storage, per-user encryption, multi-node concurrency |

## Critical provenance principles

- Sources at different grids (250 m MODIS, 9 km SMAP, 0.1° GPM) are **not per-field measurements**. Include cell center and resolution, do not assume all fields share sub-grid truth.
- A CMR bounding box selects files; it does **not** imply Earthdata transferred only a 0.05° subset.
- `partial` and `error` must survive through `FarmProfile`; no fallback silently changes product or band QA.
- Historic intercropping records are **not** proof that every combination is safe to recommend, or a ready parameter set for multi-species simulation.
- All inputs and model assumptions should be versioned; persist time window and raw source metadata, including solar units and GPM UTC day conventions.
- Avoid numbers presented as net profit until matched input prices, costs, yield units, currency and season are available.

## Official entry points cited by the underlying notebook

- NASA POWER API: https://power.larc.nasa.gov/docs/services/api/
- NASA GPM: https://gpm.nasa.gov/data/imerg
- NASA NSIDC SMAP SPL4SMGP: https://nsidc.org/data/spl4smgp/versions/8
- NASA ORNL MODIS REST: https://modis.ornl.gov/rst/api/v1/
- ISRIC SoilGrids: https://docs.isric.org/globaldata/soilgrids/
- SRTM via OpenTopoData: https://www.opentopodata.org/
- NASA Earth Engine GDDP: https://developers.google.com/earth-engine/datasets/catalog/NASA_GDDP-CMIP6
- FAO crop calendar: https://cropcalendar.apps.fao.org/
- PCSE/WOFOST: https://pcse.readthedocs.io/
