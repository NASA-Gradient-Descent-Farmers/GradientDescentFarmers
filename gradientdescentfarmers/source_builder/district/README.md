# District panel

Builds the district-level tables the rotation engine reads: SIAP outcomes by district, plus NASA climate, water storage, vegetation, soil moisture and map soil for the municipalities of each target district. Tables, units and methods: [DISTRICT_PANEL_CONTRACT.md](DISTRICT_PANEL_CONTRACT.md).

## Install

```bash
python -m pip install -e '.[source,source-district]'          # add source-modis for cropland-weighted NDVI
```

## Run

```bash
# Preview: validates the config, downloads nothing
python -m gradientdescentfarmers.source_builder.district --config resources/district_three_sites.json

# Build (about 5 minutes without Earthdata; SMAP adds a few hours the first time, then it is cached)
python -m gradientdescentfarmers.source_builder.district --config resources/district_three_sites.json --run

# Only some sources (SIAP and POWER always run)
python -m gradientdescentfarmers.source_builder.district --config resources/district_three_sites.json --run --only chirps grace
```

Output: `data/processed/districts/runs/<run_id>/` (`tables/`, `availability.json`, `provenance.json`, `validation.json`, `manifest.json`) and `data/processed/districts/latest.json`. Downloads are cached in `data/cache/districts/`, so a second run only fetches what is missing. Both folders are ignored by Git.

From Python, through the team's `SourceBuilder` contract:

```python
from gradientdescentfarmers.source_builder.district import DistrictPanelSourceBuilder, load_config

config = load_config("resources/district_three_sites.json")
config["run"] = True
result = DistrictPanelSourceBuilder().build(config)
print(result["build_state"], result["output_dir"])
```

## Earthdata (NDVI, SMAP, IGBP soil)

These need a NASA Earthdata login. Put `EARTHDATA_TOKEN`, or `EARTHDATA_USERNAME` and `EARTHDATA_PASSWORD`, in `gradientdescentfarmers/source_builder/.env` (ignored by Git), the same file the rest of `source_builder` uses. In your Earthdata profile, approve the **LP DAAC**, **NSIDC** and **ORNL DAAC** applications, or the first download fails. Without a login those sources are marked `missing` and the rest of the panel is still built.

SMAP is the slow one: one request per day per box, about 4,000 per box for 2015–2025. Start it early; it resumes from the cache if interrupted.

## Using the tables with the field-shift engine

The table names are field-shift's without the `rotations_` prefix. Point the engine's `data/rotations/` folder at `<run>/tables/`. Until the engine is ported: if IGBP soil is missing (no Earthdata login), leave `soil_municipal.parquet` out, because the current engine assumes every soil value is present.

## Check against field-shift

```bash
python -m gradientdescentfarmers.source_builder.district.regression \
  --run data/processed/districts_regression/runs/<run_id> --fieldshift ../NASA-warm-up/data/shared
```

Build that run with `"settings": {"district_membership": "primary", "et0_wind": "fao_default"}` to reproduce field-shift's choices. Results of the last check are in section 8 of the contract.

## Tests

```bash
python -m pytest tests/source_builder/district -q      # offline, no credentials
```
