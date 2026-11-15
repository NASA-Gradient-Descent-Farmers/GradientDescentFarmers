"""Complete immutable run publication, with read-back SHA256 verification."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

from ..core.storage import GCSStorage
from .contracts import json_bytes
from .queue import utc


class CloudStorage(GCSStorage):
    def __init__(self, bucket_name: str, client=None):
        super().__init__(bucket_name, "farm_profiles", client=client)

    def immutable_bytes(self, key: str, payload: bytes):
        blob = self.bucket.blob(key)
        try:
            blob.upload_from_string(payload, if_generation_match=0)
        except Exception as exc:
            from google.api_core.exceptions import PreconditionFailed
            if not isinstance(exc, PreconditionFailed):
                raise
            if blob.download_as_bytes() != payload:
                raise ValueError(f"Existing GCS object differs: {key}") from exc
        if hashlib.sha256(blob.download_as_bytes()).digest() != hashlib.sha256(payload).digest():
            raise ValueError(f"GCS read-back checksum mismatch: {key}")

    def publish_inputs(self, job_id: str, documents: dict):
        for key, name in (("config", "config.json"), ("farmer_input", "farmer_input.json"),
                          ("settings", "settings.json")):
            self.immutable_bytes(f"inputs/{job_id}/{name}", json_bytes(documents[key]))

    def publish_status(self, job_id: str, status: dict):
        # The status pointer is explicitly mutable; scientific run files are not.
        self.bucket.blob(f"inputs/{job_id}/status.json").upload_from_string(
            json_bytes(status), content_type="application/json")

    def publish_run(self, directory: Path) -> dict:
        directory = Path(directory)
        manifest, files = self._bundle_files(directory)
        files.extend(Path(x) for x in ("audit_report.json", "handoff_report.json", "cloud_execution.json"))
        payloads = {rel.as_posix(): (directory / rel).read_bytes() for rel in files}
        records = {name: {"sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data)}
                   for name, data in sorted(payloads.items())}
        delivery = {"farm_id": manifest["farmer_inputs"]["farm_id"],
                    "run_id": manifest["run_id"], "files": records}
        payloads["delivery_manifest.json"] = json_bytes(delivery)
        payloads["SHA256SUMS"] = "".join(
            f"{hashlib.sha256(data).hexdigest()}  {name}\n"
            for name, data in sorted(payloads.items())).encode()
        root = f"farm_profiles/{delivery['farm_id']}/runs/{delivery['run_id']}"
        # Commit the scientific manifest after every other payload has arrived.
        order = sorted(set(payloads) - {"farm_profile.json"}) + ["farm_profile.json"]
        for name in order:
            self.immutable_bytes(f"{root}/{name}", payloads[name])
            local = directory / name
            if not local.exists():
                local.write_bytes(payloads[name])
        receipt = {
            "farm_id": delivery["farm_id"], "run_id": delivery["run_id"],
            "dataset_uri": f"gs://{self.bucket_name}/{root}",
            "manifest_uri": f"gs://{self.bucket_name}/{root}/farm_profile.json",
            "files_verified": len(payloads), "sha256_readback_verified": True,
            "delivery_manifest_sha256": hashlib.sha256(payloads["delivery_manifest.json"]).hexdigest(),
        }
        # A deterministic receipt makes publication safe to retry after a reboot.
        self.immutable_bytes(f"{root}/upload_receipt.json", json_bytes(receipt))
        (directory / "upload_receipt.json").write_bytes(json_bytes(receipt))
        return receipt
