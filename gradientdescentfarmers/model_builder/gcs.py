"""Read immutable source bundles and observation files from Google Cloud Storage."""

from __future__ import annotations

import hashlib
import io
import json
from dataclasses import dataclass
from pathlib import PurePosixPath
from typing import Any

import pandas as pd


def split_gs_uri(uri: str) -> tuple[str, str]:
    if not uri.startswith("gs://"):
        raise ValueError("Expected a gs:// URI")
    bucket, _, name = uri[5:].partition("/")
    if not bucket or not name or ".." in PurePosixPath(name).parts:
        raise ValueError("Expected a bucket and a safe object path")
    return bucket, name.rstrip("/")


@dataclass
class GCSDataClient:
    """Read-only GCS client; uses ADC unless a client is injected for testing."""

    client: Any = None
    project: str | None = None

    def __post_init__(self) -> None:
        if self.client is None:
            from google.cloud import storage
            from google.auth.exceptions import DefaultCredentialsError

            try:
                self.client = storage.Client(project=self.project)
            except DefaultCredentialsError as error:
                raise RuntimeError(
                    "Google ADC is missing. Run 'gcloud auth application-default login' "
                    "or set GOOGLE_APPLICATION_CREDENTIALS to a credential file path."
                ) from error
            except OSError as error:
                if "Project was not passed" not in str(error):
                    raise
                raise RuntimeError(
                    "Google Cloud project is missing. Pass project='your-project-id' "
                    "to GCSDataClient or set GOOGLE_CLOUD_PROJECT."
                ) from error

    def read_bytes(self, uri: str) -> bytes:
        bucket, name = split_gs_uri(uri)
        return self.client.bucket(bucket).blob(name).download_as_bytes()

    def read_json(self, uri: str) -> dict[str, Any]:
        value = json.loads(self.read_bytes(uri))
        if not isinstance(value, dict):
            raise ValueError(f"Expected a JSON object at {uri}")
        return value

    def read_frame(self, uri: str, sha256: str | None = None) -> pd.DataFrame:
        raw = self.read_bytes(uri)
        if sha256 and hashlib.sha256(raw).hexdigest() != sha256:
            raise ValueError(f"SHA-256 mismatch: {uri}")
        suffix = PurePosixPath(split_gs_uri(uri)[1]).suffix.lower()
        if suffix in (".csv", ".tab", ".tsv"):
            for encoding in ("utf-8-sig", "cp1252"):
                try:
                    text = raw.decode(encoding)
                    break
                except UnicodeDecodeError:
                    continue
            return pd.read_csv(
                io.StringIO(text), sep="\t" if suffix in (".tab", ".tsv") else ",",
                low_memory=False,
            )
        if suffix == ".parquet":
            return pd.read_parquet(io.BytesIO(raw))
        if suffix in (".xlsx", ".xls"):
            return pd.read_excel(io.BytesIO(raw))
        raise ValueError(f"Unsupported table format: {uri}")

    def list_tables(self, prefix_uri: str) -> list[str]:
        bucket, prefix = split_gs_uri(prefix_uri)
        names = [
            blob.name for blob in self.client.list_blobs(bucket, prefix=prefix.rstrip("/") + "/")
            if blob.name.lower().endswith((".csv", ".parquet", ".tab", ".tsv", ".xlsx", ".xls"))
        ]
        return [f"gs://{bucket}/{name}" for name in sorted(names)]

    def load_profile(self, run_uri: str, farm_id: str = "guanajuato_valle_demo") -> "FarmProfileRun":
        """Pin one run; never follow a mutable latest.json pointer."""
        bucket, path = split_gs_uri(run_uri)
        if "/runs/" not in path or path.endswith("/runs"):
            raise ValueError("Pass an explicit .../runs/<run_id> URI")
        manifest = self.read_json(f"gs://{bucket}/{path}/farm_profile.json")
        if manifest.get("run_id") != path.rsplit("/", 1)[-1]:
            raise ValueError("Manifest run_id does not match the GCS path")
        if manifest.get("farmer_inputs", {}).get("farm_id") != farm_id:
            raise ValueError("Manifest farm_id does not match the requested farm")
        return FarmProfileRun(self, f"gs://{bucket}/{path}", manifest)


@dataclass(frozen=True)
class FarmProfileRun:
    client: GCSDataClient
    uri: str
    manifest: dict[str, Any]

    def table(self, name: str) -> pd.DataFrame:
        item = self.manifest["tables"][name]
        relative = item["relative_path"]
        path = PurePosixPath(relative)
        if path.is_absolute() or ".." in path.parts or str(path) != relative:
            raise ValueError(f"Unsafe table path: {relative}")
        if item.get("format") not in ("csv", "parquet") or path.suffix != f".{item['format']}":
            raise ValueError(f"Unsupported table format for {name}")
        return self.client.read_frame(f"{self.uri}/{relative}", sha256=item["sha256"])
