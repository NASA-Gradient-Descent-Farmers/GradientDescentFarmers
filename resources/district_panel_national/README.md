# District panel, all of Mexico (committed copy of run 20261115T071028Z_d16825a6)

Built 15 November 2026 by `source_builder.district` (branch `santiago-rotation-engine`) with
`resources/district_national.json`: 191 SIAP districts, 2,439 municipalities, every source available
(SIAP, NASA POWER, CHIRPS, GRACE/GRACE-FO, MODIS NDVI, SMAP L4, GLDAS, IGBP-DIS). Validation passed.

- `tables/*.parquet`: the panel (see `source_builder/district/DISTRICT_PANEL_CONTRACT.md`)
- `manifest.json`: rows, columns and SHA-256 of every table, plus the settings used
- `availability.json`, `provenance.json`, `validation.json`: per-source status, sources, checks

The rotation engine uses this folder by default:

    from gradientdescentfarmers.model_builder.rotations import RotationModelBuilder
    engine = RotationModelBuilder().build(None, {})
    engine.compare("Celaya", "maíz", estado="Guanajuato", agua="temporal")

Tables were recompressed with zstd for the repo (values identical; the checksums in manifest.json are for
these files). It is tracked here, outside `data/`, on purpose: `data/` stays ignored. To refresh it, rebuild
with `resources/district_national.json` and copy the new run's files over this folder.

Settings and paths inside manifest.json are from the machine that built it.
All sources are public; cite them as listed in provenance.json.
