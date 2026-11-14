"""Upload and retrieve immutable FarmAdapt profile bundles in Google Cloud Storage.

The builder continues to export locally; this adapter publishes complete bundles
under <prefix>/<farm_id>/<run_id>/, avoiding accidental overwrites across runs.
It never uploads raw download caches, .env files or arbitrary directory trees.
"""
from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path, PurePosixPath
from typing import Any

_SAFE_SEGMENT = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$")
_REPORT_FILES = ("farm_profile.json", "availability.json", "validation.json",
                 "model_readiness.json", "provenance.json", "feature_catalog.csv")


def _clean_prefix(prefix: str) -> str:
    parts = prefix.strip("/").split("/")
    if not parts or any(not _SAFE_SEGMENT.fullmatch(part) for part in parts):
        raise ValueError("GCS prefix must contain safe nonempty slash-separated segments")
    return "/".join(parts)


def _relative_file(name: str) -> Path:
    posix = PurePosixPath(name)
    if (not name or posix.is_absolute() or ".." in posix.parts
            or "\\" in name or str(posix) != name or name.startswith(".")):
        raise ValueError(f"Invalid relative path in profile manifest: {name!r}")
    return Path(*posix.parts)


class GCSStorage:
    """GCS adapter, authenticated through Application Default Credentials.

    The optional client argument supports isolated offline tests; credentials
    are never written to disk or passed via JSON settings.
    """

    def __init__(self, bucket_name: str, prefix: str = "profiles", client: Any = None):
        if not bucket_name or "/" in bucket_name or bucket_name.startswith("gs://"):
            raise ValueError("bucket_name must be a GCS bucket name, not a URI")
        self.bucket_name = bucket_name
        self.prefix = _clean_prefix(prefix)
        if client is None:
            try:
                from google.cloud import storage
            except ImportError as exc:
                raise ImportError("Install the GCS extra: pip install -e '.[gcs]'") from exc
            client = storage.Client()
        self.bucket = client.bucket(bucket_name)

    def _bundle_files(self, local_dir: Path) -> tuple[dict, list[Path]]:
        local_dir = Path(local_dir).resolve(strict=True)
        manifest_path = local_dir / "farm_profile.json"
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        if not isinstance(manifest, dict):
            raise ValueError("farm_profile.json must contain a JSON object")
        farm_id = manifest.get("farmer_inputs", {}).get("farm_id")
        run_id = manifest.get("run_id")
        if not isinstance(farm_id, str) or not _SAFE_SEGMENT.fullmatch(farm_id):
            raise ValueError("Invalid farm_id in profile")
        if not isinstance(run_id, str) or not _SAFE_SEGMENT.fullmatch(run_id):
            raise ValueError("Valid run_id required for immutable cloud publication")

        required = [Path(x) for x in _REPORT_FILES]
        for table in manifest.get("tables", {}).values():
            relative = table.get("relative_path")
            digest = table.get("sha256")
            if not isinstance(relative, str) or not isinstance(digest, str):
                raise ValueError("Exported tables require relative_path and sha256")
            path = _relative_file(relative)
            resolved = (local_dir / path).resolve()
            if not resolved.is_relative_to(local_dir) or not resolved.is_file():
                raise ValueError(f"Missing or escaping table: {relative}")
            actual = hashlib.sha256(resolved.read_bytes()).hexdigest()
            if actual != digest:
                raise ValueError(f"Table checksum mismatch: {relative}")
            required.append(path)
        distinct = list(dict.fromkeys(required))
        for rel in distinct:
            path = (local_dir / rel).resolve()
            if not path.is_relative_to(local_dir) or not path.is_file():
                raise FileNotFoundError(f"Missing bundle file: {rel}")
        return manifest, distinct

    def upload_profile(self, local_dir: str | Path) -> dict[str, Any]:
        """Verify locally and upload; publish farm_profile.json last as commit marker.

        GCS objects are created with an if_generation_match=0 precondition.
        Existing objects are never overwritten. Retry after a partial upload
        with a new build/run_id; a partial prefix is not a published profile.
        """
        local_dir = Path(local_dir).resolve(strict=True)
        manifest, files = self._bundle_files(local_dir)
        farm_id = manifest["farmer_inputs"]["farm_id"]
        run_id = manifest["run_id"]
        root = f"{self.prefix}/{farm_id}/{run_id}"
        files = [p for p in files if p.as_posix() != "farm_profile.json"] + [Path("farm_profile.json")]
        uploaded = []
        for rel in files:
            blob = self.bucket.blob(f"{root}/{rel.as_posix()}")
            # Atomic create precondition prevents accidental cross-run overwrite.
            blob.upload_from_filename(str(local_dir / rel), if_generation_match=0)
            uploaded.append(rel.as_posix())
        return {
            "bucket": self.bucket_name,
            "prefix": root,
            "manifest_uri": f"gs://{self.bucket_name}/{root}/farm_profile.json",
            "files_uploaded": len(uploaded),
            "run_id": run_id,
            "farm_id": farm_id,
        }

    def download_profile(self, farm_id: str, run_id: str, destination: str | Path) -> Path:
        """Fetch manifest and its declared files; verify table SHA256 after download."""
        if not _SAFE_SEGMENT.fullmatch(farm_id) or not _SAFE_SEGMENT.fullmatch(run_id):
            raise ValueError("Invalid farm_id or run_id")
        root = f"{self.prefix}/{farm_id}/{run_id}"
        destination = Path(destination).resolve()
        destination.mkdir(parents=True, exist_ok=True)
        manifest_path = destination / "farm_profile.json"
        self.bucket.blob(f"{root}/farm_profile.json").download_to_filename(str(manifest_path))
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        if (manifest.get("farmer_inputs", {}).get("farm_id") != farm_id
                or manifest.get("run_id") != run_id):
            raise ValueError("Downloaded manifest identity mismatch")
        for rel in _REPORT_FILES[1:]:
            self.bucket.blob(f"{root}/{rel}").download_to_filename(str(destination / rel))
        for table in manifest.get("tables", {}).values():
            rel = _relative_file(table["relative_path"])
            target = (destination / rel).resolve()
            if not target.is_relative_to(destination):
                raise ValueError("Unsafe table path")
            target.parent.mkdir(parents=True, exist_ok=True)
            self.bucket.blob(f"{root}/{rel.as_posix()}").download_to_filename(str(target))
            checksum = hashlib.sha256(target.read_bytes()).hexdigest()
            if checksum != table["sha256"]:
                raise ValueError(f"Downloaded table checksum mismatch: {rel}")
        return destination
