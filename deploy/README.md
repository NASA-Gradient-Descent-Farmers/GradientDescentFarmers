# YoliA on Google Cloud (project `gdfarming`, region `us-central1`)

Nothing here touches the WOFOST side (its VMs, buckets and service accounts). Everything district-related lives under
`gs://gdfarming-farm-data/district_panel/` and uses two accounts that can only read or write that prefix.

```
gs://gdfarming-farm-data/district_panel/
  runs/<run_id>/            immutable panel runs (manifest.json, tables/*.parquet, ...)
  latest.json               {"run_id": ..., "path": ...}: the run the API serves
  cache/index.json, files/  the monthly build's download cache (its own index: the job cannot list the bucket)
```

## District engine API (`district-api/`): Cloud Run service

`https://district-api-842797144624.us-central1.run.app` (public, CORS open, 0-3 instances, 2 GiB).
`GET /health`, `GET /district?municipio=&estado=`, `POST /compare` (see `serve.py`). At start-up it downloads the latest
run; every 10 minutes it checks `latest.json` and switches when a new run is published. Runtime account:
`district-api@` (Storage Object Viewer on `district_panel/` only).

```bash
deploy/district-api/deploy.sh          # build (Cloud Build, Artifact Registry repo "yolia") and deploy
```

The simple farmer view (`/campo`) calls it by default; `VITE_DISTRICT_API` overrides the address (`off` disables it).

## Monthly panel refresh (`district-panel-job/`): Cloud Run job + Cloud Scheduler

`district-panel-monthly` runs on day 5 of each month at 03:00 America/Mexico_City (`monthly.py`): restore the cache,
build the national panel (`resources/district_national.json`), publish it only if every source built (`complete`),
save the cache. A partial or failed build publishes nothing and the job ends in error, so the last good panel stays
live. Runtime account: `district-panel-builder@` (Storage Object Admin on `district_panel/` only, reader of the
`farm-builder-earthdata` secret, mounted as `EARTHDATA_TOKEN`). 4 CPU, 16 GiB, 24 h timeout, no retries.

```bash
deploy/district-panel-job/deploy.sh                                                   # build, deploy, schedule
gcloud run jobs execute district-panel-monthly --region us-central1 --project gdfarming   # run now
```

The first run starts with an empty cache: a full national build, several hours (SMAP is the slow source). Later runs
only fetch what is new.
