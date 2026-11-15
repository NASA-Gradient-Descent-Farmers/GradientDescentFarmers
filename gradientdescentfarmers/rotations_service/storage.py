"""Verified read-only source ingestion and immutable rotation publication."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import re
from urllib.parse import urlsplit

from google.api_core.exceptions import PreconditionFailed

from ..source_builder.core.storage import _relative_file
from ..model_builder.wofost_mvp.utils import json_bytes, write_json

SAFE = r"[A-Za-z0-9][A-Za-z0-9_-]{0,79}"


def source_identity(uri: str, expected_bucket="gdfarming-farm-data"):
    parsed = urlsplit(uri)
    path = parsed.path.strip("/")
    if path.endswith("/farm_profile.json"):
        path = path.removesuffix("/farm_profile.json")
    match = re.fullmatch(rf"farm_profiles/({SAFE})/runs/({SAFE})", path)
    if parsed.scheme != "gs" or parsed.netloc != expected_bucket or parsed.query or parsed.fragment or not match:
        raise ValueError("source_profile_uri must identify a versioned profile in the configured source bucket")
    return parsed.netloc, path, match.group(1), match.group(2)


class RotationStorage:
    def __init__(self, output_bucket="gdfarming-farm-rotations", source_bucket="gdfarming-farm-data", client=None):
        if client is None:
            from google.cloud import storage
            client = storage.Client()
        self.client, self.output_bucket, self.source_bucket = client, output_bucket, source_bucket
        self.output = client.bucket(output_bucket)
        self.source = client.bucket(source_bucket)

    def download_source(self, uri: str, cache_root: Path):
        _, prefix, farm_id, run_id = source_identity(uri, self.source_bucket)
        directory = Path(cache_root) / farm_id / run_id
        directory.mkdir(parents=True, exist_ok=True)
        receipt = json.loads(self.source.blob(f"{prefix}/upload_receipt.json").download_as_bytes())
        delivery_bytes = self.source.blob(f"{prefix}/delivery_manifest.json").download_as_bytes()
        if hashlib.sha256(delivery_bytes).hexdigest() != receipt["delivery_manifest_sha256"]:
            raise ValueError("Source delivery manifest checksum mismatch")
        delivery = json.loads(delivery_bytes)
        order = sorted(set(delivery["files"]) - {"farm_profile.json"}) + ["farm_profile.json"]
        for name in order:
            metadata = delivery["files"][name]
            path = directory / _relative_file(name)
            if path.is_file() and hashlib.sha256(path.read_bytes()).hexdigest() == metadata["sha256"]:
                continue
            content = self.source.blob(f"{prefix}/{name}").download_as_bytes()
            if len(content) != metadata["bytes"] or hashlib.sha256(content).hexdigest() != metadata["sha256"]:
                raise ValueError(f"Source SHA256 mismatch: {name}")
            path.parent.mkdir(parents=True, exist_ok=True)
            temporary = path.with_suffix(path.suffix + ".tmp")
            temporary.write_bytes(content)
            temporary.replace(path)
        profile = json.loads((directory / "farm_profile.json").read_text())
        if profile["farmer_inputs"]["farm_id"] != farm_id or profile["run_id"] != run_id:
            raise ValueError("Source URI and FarmProfile identity differ")
        return directory

    def immutable(self, name: str, payload: bytes):
        blob = self.output.blob(name)
        try:
            blob.upload_from_string(payload, if_generation_match=0)
        except PreconditionFailed:
            if blob.download_as_bytes() != payload:
                raise ValueError(f"Immutable rotation object differs: {name}")
        if hashlib.sha256(blob.download_as_bytes()).digest() != hashlib.sha256(payload).digest():
            raise ValueError(f"Rotation read-back SHA256 mismatch: {name}")

    def publish(self, directory: Path):
        directory = Path(directory)
        manifest_bytes = (directory / "manifest.json").read_bytes()
        manifest = json.loads(manifest_bytes)
        farm, source_run, run = (manifest[key] for key in ("farm_id", "source_run_id", "rotation_run_id"))
        if any(not re.fullmatch(SAFE, value) for value in (farm, source_run, run)):
            raise ValueError("Invalid rotation bundle identity")
        prefix = f"farm_rotations/{farm}/source_runs/{source_run}/runs/{run}"
        payloads = {}
        for name, metadata in manifest["files"].items():
            path = directory / _relative_file(name)
            if not path.resolve().is_relative_to(directory.resolve()):
                raise ValueError("Rotation bundle path escapes its directory")
            content = path.read_bytes()
            if len(content) != metadata["bytes"] or hashlib.sha256(content).hexdigest() != metadata["sha256"]:
                raise ValueError(f"Rotation bundle checksum mismatch: {name}")
            payloads[name] = content
        payloads["manifest.json"] = manifest_bytes
        payloads["SHA256SUMS"] = "".join(f"{hashlib.sha256(value).hexdigest()}  {name}\n"
                                            for name, value in sorted(payloads.items())).encode()
        for name in sorted(set(payloads) - {"manifest.json"}) + ["manifest.json"]:
            self.immutable(f"{prefix}/{name}", payloads[name])
        receipt = {"farm_id": farm, "source_run_id": source_run, "rotation_run_id": run,
                   "dataset_uri": f"gs://{self.output_bucket}/{prefix}",
                   "rotations_uri": f"gs://{self.output_bucket}/{prefix}/rotations.json",
                   "files_verified": len(payloads), "sha256_readback_verified": True,
                   "manifest_sha256": hashlib.sha256(manifest_bytes).hexdigest()}
        self.immutable(f"{prefix}/upload_receipt.json", json_bytes(receipt))
        write_json(directory / "upload_receipt.json", receipt)
        self.output.blob(f"latest/{farm}.json").upload_from_string(json_bytes(receipt), content_type="application/json")
        return receipt

    def mirror_status(self, source_run: str, status: dict):
        self.output.blob(f"status/source_runs/{source_run}.json").upload_from_string(json_bytes(status), content_type="application/json")

    def completed_sources(self):
        blobs = [blob for blob in self.client.list_blobs(self.source_bucket, prefix="farm_profiles/")
                 if blob.name.endswith("/upload_receipt.json")]
        blobs.sort(key=lambda blob: (str(blob.time_created), blob.name))
        return [f"gs://{self.source_bucket}/{blob.name.removesuffix('/upload_receipt.json')}" for blob in blobs]

    def source_preferences(self, directory: Path):
        """Read optional phase-2 config archived with the original three JSONs."""
        execution_path = Path(directory) / "cloud_execution.json"
        if not execution_path.is_file():
            return {}, {}
        execution = json.loads(execution_path.read_text())
        parsed = urlsplit(execution.get("input_uri", ""))
        if parsed.scheme != "gs" or parsed.netloc != self.source_bucket or not re.fullmatch(r"/inputs/[a-f0-9]{32}/?", parsed.path):
            raise ValueError("Invalid source input URI in execution provenance")
        config = json.loads(self.source.blob(parsed.path.strip("/") + "/config.json").download_as_bytes())
        return config.get("model", {}).get("rotation_mvp", {}), config.get("optimizer", {}).get("rotation_mvp", {})
