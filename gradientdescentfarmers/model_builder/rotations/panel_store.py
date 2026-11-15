"""The district panel in Google Cloud Storage: publish a run, and read it back anywhere.

    python -m gradientdescentfarmers.model_builder.rotations.panel_store push resources/district_panel_national
    python -m gradientdescentfarmers.model_builder.rotations.panel_store pull                 # latest run -> local cache
    python -m gradientdescentfarmers.model_builder.rotations.panel_store list

Layout (a new prefix; nothing else in the bucket is read or written):

    gs://<bucket>/district_panel/runs/<run_id>/{manifest.json, ..., tables/*.parquet}
    gs://<bucket>/district_panel/latest.json          {"run_id": ..., "path": "district_panel/runs/<run_id>"}

Every engine entry point takes `--panel gs://<bucket>/district_panel` (latest) or `gs://.../runs/<run_id>`: `local()`
downloads it once into ~/.cache/yolia/district_panel/<run_id> and returns that folder. Runs are immutable: `push` refuses a
run id that is already there. Uses the gcloud CLI and its active account (YOLIA_DISTRICT_BUCKET sets the default bucket).
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

BUCKET = os.environ.get("YOLIA_DISTRICT_BUCKET", "gdfarming-farm-data")
PREFIX = "district_panel"
CACHE = Path(os.environ.get("YOLIA_CACHE", Path.home() / ".cache" / "yolia")) / "district_panel"


def _gcloud(*args: str, capture: bool = True) -> str:
    result = subprocess.run(["gcloud", "storage", *args], check=False, capture_output=capture, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"gcloud storage {' '.join(args)} failed: {(result.stderr or '').strip()[:500]}")
    return result.stdout if capture else ""


def _root(bucket: str | None) -> str:
    return f"gs://{bucket or BUCKET}/{PREFIX}"


def _exists(url: str) -> bool:
    try:
        return bool(_gcloud("ls", url).strip())
    except RuntimeError:
        return False


def push(run_dir: str | Path, bucket: str | None = None, make_latest: bool = True) -> str:
    """Upload a complete panel run (it must have tables/ and a manifest with run_id); returns its gs:// URL."""
    from .panel import resolve

    run = resolve(run_dir)
    manifest = json.loads((run / "manifest.json").read_text(encoding="utf-8"))
    if manifest.get("build_state") not in (None, "complete"):
        raise ValueError(f"Run {manifest.get('run_id')} is not complete ({manifest.get('build_state')})")
    run_id = manifest["run_id"]
    target = f"{_root(bucket)}/runs/{run_id}"
    if _exists(f"{target}/manifest.json"):
        raise FileExistsError(f"{target} already exists; runs are immutable (give the new build its own run id)")
    _gcloud("cp", "-r", f"{run}/*", f"{target}/", capture=False)
    if make_latest:
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
            json.dump({"run_id": run_id, "path": f"{PREFIX}/runs/{run_id}"}, f)
        _gcloud("cp", f.name, f"{_root(bucket)}/latest.json")
        os.unlink(f.name)
    return target


def runs(bucket: str | None = None) -> list[str]:
    try:
        out = _gcloud("ls", f"{_root(bucket)}/runs/")
    except RuntimeError:
        return []
    return sorted(line.rstrip("/").rsplit("/", 1)[-1] for line in out.split() if line.strip())


def latest(bucket: str | None = None) -> str:
    return json.loads(_gcloud("cat", f"{_root(bucket)}/latest.json"))["run_id"]


def local(url: str) -> Path:
    """A gs:// panel URL (the prefix = latest, or runs/<run_id>) -> a local run folder, downloaded once."""
    if not url.startswith("gs://"):
        return Path(url)
    path = url[5:].rstrip("/")
    bucket, _, rest = path.partition("/")
    run_id = rest.rsplit("/", 1)[-1] if "/runs/" in f"/{rest}" else latest(bucket)
    target = CACHE / run_id
    if (target / "tables").is_dir() and (target / "manifest.json").is_file():
        return target
    partial = CACHE / f".{run_id}.partial"
    shutil.rmtree(partial, ignore_errors=True)
    partial.mkdir(parents=True)
    _gcloud("cp", "-r", f"gs://{bucket}/{PREFIX}/runs/{run_id}/*", f"{partial}/", capture=False)
    if not (partial / "tables").is_dir():
        raise FileNotFoundError(f"gs://{bucket}/{PREFIX}/runs/{run_id} has no tables/")
    partial.rename(target)
    return target


def main(argv=None):
    parser = argparse.ArgumentParser(description="District panel runs in Google Cloud Storage")
    parser.add_argument("--bucket", default=BUCKET)
    sub = parser.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("push", help="upload a run and make it the latest")
    p.add_argument("run")
    p.add_argument("--no-latest", action="store_true")
    q = sub.add_parser("pull", help="download a run into the local cache (default: latest)")
    q.add_argument("run_id", nargs="?")
    sub.add_parser("list", help="runs in the bucket, and which is latest")
    args = parser.parse_args(argv)
    if args.cmd == "push":
        print(push(args.run, args.bucket, make_latest=not args.no_latest))
    elif args.cmd == "pull":
        url = f"gs://{args.bucket}/{PREFIX}" + (f"/runs/{args.run_id}" if args.run_id else "")
        print(local(url))
    else:
        current = None
        try:
            current = latest(args.bucket)
        except RuntimeError:
            pass
        for run_id in runs(args.bucket):
            print(run_id + ("  (latest)" if run_id == current else ""))


if __name__ == "__main__":
    main()
