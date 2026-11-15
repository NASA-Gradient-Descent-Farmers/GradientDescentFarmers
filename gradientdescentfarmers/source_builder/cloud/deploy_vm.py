"""Reviewable, repeatable gcloud deployment; never changes the active project.

Preparation is local by default. --apply provisions the explicitly named project.
NASA credentials are transferred from the configured environment to Secret
Manager over stdin, and are never included in source archives or command args.
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import io
import json
from pathlib import Path
import subprocess
import tarfile

ROOT = Path(__file__).resolve().parents[3]


def gcloud(*args, input_bytes=None, check=True):
    result = subprocess.run(["gcloud", *args, "--quiet"], input=input_bytes, capture_output=True)
    if check and result.returncode:
        raise RuntimeError(result.stderr.decode(errors="replace")[-2500:])
    return result


def ensure(describe, create):
    result = gcloud(*describe, check=False)
    if result.returncode == 0:
        return
    message = result.stderr.decode(errors="replace").lower()
    if not any(text in message for text in ("not found", "not_found", "does not exist", "404")):
        raise RuntimeError(result.stderr.decode(errors="replace")[-2500:])
    print("Creating", " ".join(create[:4]), flush=True)
    gcloud(*create)


def prepare(bucket: str, destination: Path):
    revision = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
    paths = [ROOT / "pyproject.toml", ROOT / "README.md"]
    paths.extend((ROOT / "gradientdescentfarmers").rglob("*.py"))
    paths.extend((ROOT / "resources").glob("*.json"))
    paths.append(Path(__file__).with_name("bootstrap_vm.sh"))
    paths.extend((ROOT / "gradientdescentfarmers/source_builder/docs").glob("*.md"))
    payloads = {path.relative_to(ROOT).as_posix(): path.read_bytes() for path in sorted(set(paths))}
    source_manifest = {"git_revision": revision,
                       "note": "Exact deployed bytes are identified by source archive SHA256; may include uncommitted changes",
                       "files": {name: hashlib.sha256(data).hexdigest() for name, data in payloads.items()}}
    payloads["source_manifest.json"] = (json.dumps(source_manifest, indent=2) + "\n").encode()
    buffer = io.BytesIO()
    with gzip.GzipFile(fileobj=buffer, mode="wb", mtime=0) as gz:
        with tarfile.open(fileobj=gz, mode="w") as archive:
            for name, data in sorted(payloads.items()):
                item = tarfile.TarInfo(name)
                item.size, item.mode = len(data), 0o644
                archive.addfile(item, io.BytesIO(data))
    data = buffer.getvalue()
    sha = hashlib.sha256(data).hexdigest()
    release = f"{revision[:12]}-{sha[:12]}"
    folder = destination / release
    folder.mkdir(parents=True, exist_ok=True)
    bundle = folder / "source.tar.gz"
    bundle.write_bytes(data)
    startup = folder / "startup.sh"
    startup.write_bytes(Path(__file__).with_name("bootstrap_vm.sh").read_bytes())
    return {"source_revision": revision, "source_bundle_sha256": sha,
            "source_release_uri": f"gs://{bucket}/deployment/releases/{release}/source.tar.gz",
            "archive": str(bundle), "startup_script": str(startup), "folder": str(folder),
            "source_files": len(payloads)}


def deploy(args, release):
    project, bucket, zone = args.project, args.bucket, args.zone
    region = zone.rsplit("-", 1)[0]
    common = [f"--project={project}"]
    service = f"farm-profile-builder@{project}.iam.gserviceaccount.com"
    secret = "farm-builder-earthdata"
    gcloud("services", "enable", "compute.googleapis.com", "secretmanager.googleapis.com", "iap.googleapis.com", *common)
    ensure(["storage", "buckets", "describe", f"gs://{bucket}", *common],
           ["storage", "buckets", "create", f"gs://{bucket}", f"--location={region}",
            "--uniform-bucket-level-access", "--public-access-prevention", *common])
    # Refuse to deploy into an unrelated project's existing bucket.
    details = json.loads(gcloud("storage", "buckets", "describe", f"gs://{bucket}", "--raw", "--format=json", *common).stdout)
    number = gcloud("projects", "describe", project, "--format=value(projectNumber)").stdout.decode().strip()
    if str(details.get("project_number", details.get("projectNumber"))) != number:
        raise ValueError("Bucket is not owned by the requested project")
    ensure(["iam", "service-accounts", "describe", service, *common],
           ["iam", "service-accounts", "create", "farm-profile-builder", "--display-name=FarmProfileBuilder VM", *common])
    gcloud("storage", "buckets", "add-iam-policy-binding", f"gs://{bucket}",
           f"--member=serviceAccount:{service}", "--role=roles/storage.objectUser", *common)
    ensure(["secrets", "describe", secret, *common],
           ["secrets", "create", secret, "--replication-policy=automatic", *common])
    from ..core.auth import load_project_env
    import os
    load_project_env()
    credentials = {name: os.environ[name] for name in
                   ("EARTHDATA_USERNAME", "EARTHDATA_PASSWORD", "EARTHDATA_TOKEN") if os.environ.get(name)}
    if not (credentials.get("EARTHDATA_TOKEN") or
            (credentials.get("EARTHDATA_USERNAME") and credentials.get("EARTHDATA_PASSWORD"))):
        raise ValueError("NASA credentials are required in the local environment or ignored project .env")
    version = gcloud("secrets", "versions", "add", secret, "--data-file=-", "--format=value(name)",
                     *common, input_bytes=json.dumps(credentials).encode()).stdout.decode().strip()
    gcloud("secrets", "add-iam-policy-binding", secret, f"--member=serviceAccount:{service}",
           "--role=roles/secretmanager.secretAccessor", *common)
    ensure(["compute", "networks", "describe", "farm-builder-vpc", *common],
           ["compute", "networks", "create", "farm-builder-vpc", "--subnet-mode=custom", *common])
    ensure(["compute", "networks", "subnets", "describe", "farm-builder-subnet", f"--region={region}", *common],
           ["compute", "networks", "subnets", "create", "farm-builder-subnet", "--network=farm-builder-vpc",
            "--range=10.42.0.0/24", f"--region={region}", "--enable-private-ip-google-access", *common])
    ensure(["compute", "firewall-rules", "describe", "farm-builder-allow-iap", *common],
           ["compute", "firewall-rules", "create", "farm-builder-allow-iap", "--network=farm-builder-vpc",
            "--direction=INGRESS", "--action=ALLOW", "--rules=tcp:22,tcp:8080",
            "--source-ranges=35.235.240.0/20", "--target-tags=farm-builder", *common])
    gcloud("storage", "cp", release["archive"], release["source_release_uri"], "--if-generation-match=0", *common)
    metadata = {
        "source-release-uri": release["source_release_uri"],
        "source-bundle-sha256": release["source_bundle_sha256"],
        "source-revision": release["source_revision"], "farm-builder-bucket": bucket,
        "earthdata-secret-version": version, "enable-oslogin": "TRUE",
    }
    exists = gcloud("compute", "instances", "describe", args.instance, f"--zone={zone}", *common, check=False)
    if exists.returncode == 0:
        raise ValueError("VM already exists; finish active jobs before updating it (see deployment README)")
    ensure(["compute", "disks", "describe", "farm-builder-data", f"--zone={zone}", *common],
           ["compute", "disks", "create", "farm-builder-data", "--size=100GB", "--type=pd-balanced", f"--zone={zone}", *common])
    gcloud("compute", "instances", "create", args.instance, f"--zone={zone}", "--machine-type=e2-standard-4",
           "--image-family=debian-12", "--image-project=debian-cloud", "--boot-disk-size=20GB",
           "--boot-disk-type=pd-balanced", "--subnet=farm-builder-subnet", "--tags=farm-builder",
           f"--service-account={service}", "--scopes=cloud-platform",
           "--disk=name=farm-builder-data,device-name=farm-builder-data,mode=rw,boot=no,auto-delete=no",
           "--metadata=" + ",".join(f"{key}={value}" for key, value in metadata.items()),
           f"--metadata-from-file=startup-script={release['startup_script']}",
           "--labels=app=farm-profile-builder,environment=mvp", *common)
    return {"project": project, "bucket": bucket, "instance": args.instance, "zone": zone,
            "service_account": service, "earthdata_secret_version": version, **release}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", default="gdfarming")
    parser.add_argument("--bucket", default="gdfarming-farm-data")
    parser.add_argument("--zone", default="us-central1-a")
    parser.add_argument("--instance", default="farm-profile-builder")
    parser.add_argument("--output", type=Path, default=ROOT / "data/gcp_deploy")
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args(argv)
    release = prepare(args.bucket, args.output)
    result = deploy(args, release) if args.apply else release
    (Path(release["folder"]) / "deployment.json").write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
