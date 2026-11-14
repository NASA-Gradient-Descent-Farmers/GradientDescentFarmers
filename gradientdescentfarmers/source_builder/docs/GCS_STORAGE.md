# FarmAdapt V2 — Google Cloud Storage (Phase 1 extension)

This integration is **opt-in**. FarmProfileBuilder still executes locally, in
Colab, or in a cloud worker. `GCSStorage` uploads only profile exports, **not**
download caches, HDF5 granules, `.env`, or local files outside the export
manifest. It does not create buckets, enable billing, or deploy an API.

## Architecture

```text
FarmerInput + BuilderSettings
           |
           v
FarmProfileBuilder.build(export=True)
           |
           v
<output_root>/<farm_id>/runs/<run_id>/
  farm_profile.json, availability.json, validation.json, ...
  standardized/*.csv or *.parquet
           |
           v
GCSStorage.upload_profile(local_dir) [opt-in]
           |
           v
gs://<bucket>/profiles/<farm_id>/<run_id>/
  files + farm_profile.json (uploaded last)
```

Each run has a unique GCS prefix so one experiment cannot silently overwrite
another. Table SHA-256 hashes are checked before uploading and after downloading.
The profile JSON is uploaded last as a completion marker; if upload fails before
then, the prefix is incomplete. The current implementation does not automatically
remove partially uploaded objects; these should be inspected before cleanup.

## Getting started when you have network access

1. In a dedicated GCP project with billing and Cloud Storage API configured,
   create a **private** bucket in an appropriate region. Set a low budget and
   alerts first. Do not allow unauthenticated access.
2. Install the optional dependency and configure ADC locally:

```bash
cd farmadapt_v2
python -m pip install -e '.[gcs,test]'
gcloud auth application-default login
python -m pytest tests/test_storage.py -vv
```

`gcloud auth login` and `gcloud auth application-default login` serve
different purposes. Google client libraries use Application Default
Credentials (ADC). In Colab, authenticate explicitly with the Colab runtime
or another supported ADC mechanism; do not commit credential JSON.

3. Run an existing local profile build and publish the exported bundle:

```bash
python -m farmadapt \
  --input examples/texcoco_basic.json \
  --settings configs/quick_baseline.json \
  --output ./data \
  --run \
  --gcs-bucket YOUR_PRIVATE_BUCKET \
  --gcs-prefix profiles
```

This performs the full acquisition again. To publish a **previously exported**
profile without refetching data, use Python instead:

```python
from farmadapt.storage import GCSStorage

storage = GCSStorage("YOUR_PRIVATE_BUCKET")
result = storage.upload_profile("data/texcoco_demo/runs/RUN_ID")
print(result["manifest_uri"])
```

Retrieve a particular version:

```python
downloaded = storage.download_profile(
    farm_id="texcoco_demo",
    run_id="RUN_ID_FROM_OUTPUT",
    destination="./retrieved/texcoco_demo",
)
print(downloaded)
```

## Operational boundaries

- `cache_root` and `output_root` stay **local filesystem paths**.
  Do not set either to `gs://...`. In Colab use local scratch storage;
  publish validated exports to GCS at the end.
- The manifest contains farmer-provided input and may include personal or
  commercially sensitive farm details. Keep the bucket private; grant only
  minimal object permissions to trusted principals.
- For initial development, keep Earthdata/GPM/SMAP raw HDF5 files in a local
  temporary cache, not GCS. Preserve source identifiers and scientific
  provenance where needed for reproducibility.
- `GCSStorage` uses Google Cloud Storage, **not Google Drive**.
  Google One AI Pro and Google Cloud billing are separate services.
- This is not a production job queue, distributed lock manager, or
  multi-tenant security boundary. Cloud Run Jobs, idempotency, retention,
  IAM, privacy controls and infrastructure deployments come later.
- If a run already exists at the same prefix, uploads fail rather than
  overwriting it. Rebuilding creates a new run ID.
