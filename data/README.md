# data/

Local data root for the project. Only this README is tracked by Git; everything else here is downloaded or
generated and ignored.

| folder | written by | contents |
|---|---|---|
| `siap/` | `python -m gradientdescentfarmers.source_builder.siap sync` | Mexican agricultural production (SIAP): `raw/` original CSVs, `parquet/` cleaned tables, `dictionary/`, `manifest.json` |
| `processed/`, `cache/` | NASA source builder (`gradientdescentfarmers.source_builder`) | Guanajuato baseline runs and Earthdata caches |

On a VM / web-app deployment, point `SIAP_DATA_DIR` at a persistent disk; the default is `<repo>/data/siap`.
See `gradientdescentfarmers/source_builder/siap/README.md`.
