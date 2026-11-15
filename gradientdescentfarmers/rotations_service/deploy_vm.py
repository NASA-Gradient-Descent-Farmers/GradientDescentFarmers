"""Provision the independent phase-2 VM without changing the source VM."""
from __future__ import annotations

import argparse
import gzip
import hashlib
import io
import json
from pathlib import Path
import subprocess
import tarfile

from ..source_builder.cloud.deploy_vm import gcloud, ensure

ROOT = Path(__file__).resolve().parents[2]


def archive_files(files, destination):
    buffer = io.BytesIO()
    with gzip.GzipFile(fileobj=buffer, mode="wb", mtime=0) as compressed:
        with tarfile.open(fileobj=compressed, mode="w") as archive:
            for name, value in sorted(files.items()):
                item = tarfile.TarInfo(name)
                item.size, item.mode = len(value), 0o644
                archive.addfile(item, io.BytesIO(value))
    content = buffer.getvalue()
    sha = hashlib.sha256(content).hexdigest()
    destination = Path(destination) / f"{sha}.tar.gz"
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(content)
    return destination, sha


def prepare(reference_root, output):
    revision = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
    paths = [ROOT / "README.md", ROOT / "pyproject.toml"]
    for pattern in ("*.py", "*.md", "*.sh"):
        paths.extend((ROOT / "gradientdescentfarmers").rglob(pattern))
    paths.extend((ROOT / "resources").glob("*.json"))
    files = {path.relative_to(ROOT).as_posix(): path.read_bytes() for path in sorted(set(paths))}
    files["source_manifest.json"] = (json.dumps({"git_revision": revision,
        "note": "Exact deployed working-tree files; SHA256 identifies uncommitted implementation bytes",
        "files": {name: hashlib.sha256(value).hexdigest() for name, value in files.items()}}, indent=2) + "\n").encode()
    source, source_sha = archive_files(files, output)
    reference_root = Path(reference_root)
    reference_files = list(reference_root.glob("inegi_*.geojson"))
    reference_files.extend((reference_root / "siap_state").glob("*.json"))
    reference_files.extend((reference_root / "crops").rglob("*.yaml"))
    reference_files.extend((reference_root / "crops").rglob("manifest.json"))
    if not (reference_root / "siap_state/snapshot.json").is_file():
        raise ValueError("Prepare the verified SIAP snapshot before deployment")
    payloads = {path.relative_to(reference_root).as_posix(): path.read_bytes() for path in reference_files}
    reference, reference_sha = archive_files(payloads, output)
    return {"git_revision": revision, "source_archive": str(source), "source_sha256": source_sha,
            "reference_archive": str(reference), "reference_sha256": reference_sha}


def upload(path, uri, project):
    existing = gcloud("storage", "objects", "describe", uri, f"--project={project}", check=False)
    if existing.returncode == 0:
        stored = gcloud("storage", "cat", uri, f"--project={project}").stdout
        if hashlib.sha256(stored).digest() != hashlib.sha256(Path(path).read_bytes()).digest():
            raise ValueError("Existing deployment artifact SHA256 differs")
    else:
        message = existing.stderr.decode(errors="replace").lower()
        if not any(part in message for part in ("404", "not found", "not_found")):
            raise RuntimeError(existing.stderr.decode(errors="replace"))
        gcloud("storage", "cp", path, uri, "--if-generation-match=0", f"--project={project}")


def apply(args, release):
    project, zone = args.project, args.zone
    common = [f"--project={project}"]
    current = gcloud("compute", "instances", "describe", args.instance, f"--zone={zone}", *common, check=False)
    if current.returncode == 0:
        raise ValueError("VM already exists; do not replace or restart an active rotation worker")
    ensure(["storage", "buckets", "describe", f"gs://{args.bucket}", *common],
           ["storage", "buckets", "create", f"gs://{args.bucket}", "--location=us-central1",
            "--uniform-bucket-level-access", "--public-access-prevention", *common])
    details = json.loads(gcloud("storage", "buckets", "describe", f"gs://{args.bucket}", "--raw", "--format=json", *common).stdout)
    number = gcloud("projects", "describe", project, "--format=value(projectNumber)").stdout.decode().strip()
    if str(details["projectNumber"]) != number:
        raise ValueError("Rotation bucket belongs to another project")
    service = f"farm-rotations@{project}.iam.gserviceaccount.com"
    ensure(["iam", "service-accounts", "describe", service, *common],
           ["iam", "service-accounts", "create", "farm-rotations", "--display-name=Farm rotations worker", *common])
    gcloud("storage", "buckets", "add-iam-policy-binding", f"gs://{args.bucket}",
           f"--member=serviceAccount:{service}", "--role=roles/storage.objectUser", *common)
    gcloud("storage", "buckets", "add-iam-policy-binding", f"gs://{args.source_bucket}",
           f"--member=serviceAccount:{service}", "--role=roles/storage.objectViewer", *common)
    ensure(["compute", "firewall-rules", "describe", "farm-rotations-allow-iap", *common],
           ["compute", "firewall-rules", "create", "farm-rotations-allow-iap", "--network=farm-builder-vpc",
            "--direction=INGRESS", "--action=ALLOW", "--rules=tcp:22,tcp:8081",
            "--source-ranges=35.235.240.0/20", "--target-tags=farm-rotations", *common])
    source_uri = f"gs://{args.bucket}/deployment/releases/{release['source_sha256']}/source.tar.gz"
    reference_uri = f"gs://{args.bucket}/reference/releases/{release['reference_sha256']}/reference.tar.gz"
    upload(release["source_archive"], source_uri, project)
    upload(release["reference_archive"], reference_uri, project)
    ensure(["compute", "disks", "describe", "farm-rotations-data", f"--zone={zone}", *common],
           ["compute", "disks", "create", "farm-rotations-data", "--size=30GB", "--type=pd-balanced", f"--zone={zone}", *common])
    metadata = {"rotations-source-uri": source_uri, "rotations-source-sha": release["source_sha256"],
                "rotations-reference-uri": reference_uri, "rotations-reference-sha": release["reference_sha256"],
                "rotations-source-revision": release["git_revision"], "rotations-bucket": args.bucket,
                "farm-source-bucket": args.source_bucket, "enable-oslogin": "TRUE"}
    gcloud("compute", "instances", "create", args.instance, f"--zone={zone}", "--machine-type=e2-standard-2",
           "--image-family=debian-12", "--image-project=debian-cloud", "--boot-disk-size=20GB",
           "--boot-disk-type=pd-balanced", "--subnet=farm-builder-subnet", "--tags=farm-rotations",
           f"--service-account={service}", "--scopes=cloud-platform",
           "--disk=name=farm-rotations-data,device-name=farm-rotations-data,mode=rw,boot=no,auto-delete=no",
           "--metadata=" + ",".join(f"{key}={value}" for key, value in metadata.items()),
           f"--metadata-from-file=startup-script={Path(__file__).with_name('bootstrap_vm.sh')}",
           "--labels=app=farm-rotations,environment=mvp", *common)
    return {**release, "project": project, "instance": args.instance, "zone": zone,
            "bucket": args.bucket, "source_bucket": args.source_bucket,
            "source_uri": source_uri, "reference_uri": reference_uri, "service_account": service}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", default="gdfarming")
    parser.add_argument("--zone", default="us-central1-a")
    parser.add_argument("--bucket", default="gdfarming-farm-rotations")
    parser.add_argument("--source-bucket", default="gdfarming-farm-data")
    parser.add_argument("--instance", default="farm-rotations")
    parser.add_argument("--reference-root", type=Path, default=ROOT / "data/phase2/reference")
    parser.add_argument("--output", type=Path, default=ROOT / "data/rotations_deploy")
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args(argv)
    release = prepare(args.reference_root, args.output)
    result = apply(args, release) if args.apply else release
    target = args.output / release["source_sha256"]
    target.mkdir(parents=True, exist_ok=True)
    (target / "deployment.json").write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
