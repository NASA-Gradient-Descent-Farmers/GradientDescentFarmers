"""The monthly district panel refresh (Cloud Run job `district-panel-monthly`, deploy/district-panel-job/).

    python -m gradientdescentfarmers.model_builder.rotations.monthly --bucket gdfarming-farm-data

1. Restore the download cache from gs://<bucket>/district_panel/cache/ (so only new months are fetched).
2. Build the national panel (source_builder.district with resources/district_national.json).
3. Publish it only when every source built ("complete"): panel_store.push, which makes it the latest run. The live API
   (serve.py) switches to it within its refresh interval. A partial or failed build publishes nothing: the previous
   panel stays live, and the job exits non-zero so the failure shows on Cloud Run.
4. Save the cache back (new and changed files only).

The job's account can read and write only under district_panel/ and cannot list the bucket, so the cache keeps its own
index (cache/index.json: relative path -> size and mtime) instead of listing objects.
Earthdata (NDVI, SMAP, IGBP) reads EARTHDATA_TOKEN, or EARTHDATA_USERNAME / EARTHDATA_PASSWORD, from the environment.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

from .panel_store import PREFIX

REPO = Path(__file__).resolve().parents[3]
CONFIG = REPO / "resources" / "district_national.json"


def _bucket(name):
    from google.cloud import storage

    return storage.Client().bucket(name)


def cache_pull(bucket, cache: Path) -> int:
    blob = bucket.blob(f"{PREFIX}/cache/index.json")
    if not blob.exists():
        return 0
    index = json.loads(blob.download_as_text())
    for rel in index:
        target = cache / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        bucket.blob(f"{PREFIX}/cache/files/{rel}").download_to_filename(str(target))
    return len(index)


def cache_push(bucket, cache: Path) -> int:
    blob = bucket.blob(f"{PREFIX}/cache/index.json")
    old = json.loads(blob.download_as_text()) if blob.exists() else {}
    new, sent = {}, 0
    for path in sorted(p for p in cache.rglob("*") if p.is_file()):
        rel = path.relative_to(cache).as_posix()
        stat = path.stat()
        new[rel] = [stat.st_size, int(stat.st_mtime)]
        if old.get(rel) != new[rel]:
            bucket.blob(f"{PREFIX}/cache/files/{rel}").upload_from_filename(str(path))
            sent += 1
    blob.upload_from_string(json.dumps(new), content_type="application/json")
    return sent


def push_run(bucket, run: Path) -> str:
    """Upload a complete run and point latest.json at it (no listing: files come from the manifest)."""
    manifest = json.loads((run / "manifest.json").read_text(encoding="utf-8"))
    run_id = manifest["run_id"]
    base = f"{PREFIX}/runs/{run_id}"
    if bucket.blob(f"{base}/manifest.json").exists():
        raise FileExistsError(f"{base} already exists")
    files = [t["path"] for t in manifest.get("tables", {}).values() if isinstance(t, dict) and t.get("path")]
    files += [p.name for p in run.iterdir() if p.is_file() and p.name != "manifest.json"]
    for rel in files:
        bucket.blob(f"{base}/{rel}").upload_from_filename(str(run / rel))
    bucket.blob(f"{base}/manifest.json").upload_from_filename(str(run / "manifest.json"))   # last: marks the run complete
    bucket.blob(f"{PREFIX}/latest.json").upload_from_string(json.dumps({"run_id": run_id, "path": base}), content_type="application/json")
    return f"gs://{bucket.name}/{base}"


def main(argv=None):
    parser = argparse.ArgumentParser(description="Monthly district panel refresh")
    parser.add_argument("--bucket", default=os.environ.get("YOLIA_DISTRICT_BUCKET", "gdfarming-farm-data"))
    parser.add_argument("--work", default=os.environ.get("YOLIA_WORK", "/tmp/yolia-panel"))
    parser.add_argument("--config", default=str(CONFIG))
    parser.add_argument("--dry-run", action="store_true", help="build, but publish nothing and do not save the cache")
    args = parser.parse_args(argv)

    from gradientdescentfarmers.source_builder.district import DistrictPanelSourceBuilder, load_config

    work = Path(args.work)
    cache, output = work / "cache", work / "processed"
    cache.mkdir(parents=True, exist_ok=True)
    bucket = _bucket(args.bucket)
    started = time.time()
    print(f"cache: restored {cache_pull(bucket, cache)} files", flush=True)

    config = load_config(args.config)
    config.update({"run": True, "cache_root": str(cache), "output_root": str(output)})
    result = DistrictPanelSourceBuilder().build(config)
    state = result.get("build_state")
    print(json.dumps({k: result.get(k) for k in ("run_id", "build_state", "fatal", "output_dir")}, default=str), flush=True)

    published = None
    if state == "complete" and not args.dry_run:
        published = push_run(bucket, Path(result["output_dir"]))
        print(f"published {published} (now the latest run)", flush=True)
    elif state != "complete":
        print(f"not published: build_state={state}; the previous panel stays live", flush=True)
    if not args.dry_run:
        print(f"cache: saved {cache_push(bucket, cache)} new or changed files", flush=True)
    print(f"done in {(time.time() - started) / 60:.0f} min", flush=True)
    return 0 if published or args.dry_run and state == "complete" else 1


if __name__ == "__main__":
    sys.exit(main())
