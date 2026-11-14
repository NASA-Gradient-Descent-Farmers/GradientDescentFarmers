"""Offline Phase 1 audit: exported manifests, table integrity, and source QA.

This module does NOT fetch satellite data, authenticate to GCP or validate
agronomic recommendations. It audits reproducible artifacts already exported.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
from typing import Any

# The original Punjab run remains accessible via explicit --sites.
SITES = ("texcoco_demo", "iowa_us_demo", "punjab_ballowal_basic", "nakuru_ke_demo")
CORE_SOURCES = ("nasa_power", "srtm", "soilgrids_wcs", "modis_mod13q1",
                "modis_mod11a2", "modis_mod16a2gf", "worldbank_agriculture")
REQUIRED_REPORTS = ("availability.json", "validation.json",
                    "model_readiness.json", "provenance.json",
                    "feature_catalog.csv")


def _safe_relative(path: str) -> Path:
    posix = PurePosixPath(path)
    if (not path or posix.is_absolute() or ".." in posix.parts
            or "\\" in path or str(posix) != path or path.startswith(".")):
        raise ValueError(f"Unsafe table relative_path: {path!r}")
    return Path(*posix.parts)


def audit_profile(directory: Path, expected_farm_id: str | None = None) -> dict[str, Any]:
    directory = Path(directory)
    result: dict[str, Any] = {
        "folder": str(directory), "farm_id": expected_farm_id, "run_id": None,
        "build_state": None, "integrity_ok": False, "qa_ok": False,
        "checks": [], "errors": [], "sources": {}, "tables": {},
        "untracked_files": [],
    }
    manifest_path = directory / "farm_profile.json"
    if not manifest_path.is_file():
        result["errors"].append("farm_profile.json missing")
        return result
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        farmer_id = manifest["farmer_inputs"]["farm_id"]
        result["farm_id"] = farmer_id
        if expected_farm_id is not None and farmer_id != expected_farm_id:
            result["errors"].append("farm_id does not match expected directory")
        result["run_id"] = manifest.get("run_id")
        result["build_state"] = manifest.get("build_state")

        for report in REQUIRED_REPORTS:
            if not (directory / report).is_file():
                result["errors"].append(f"Missing report: {report}")
        if result["errors"]:
            return result

        availability = json.loads((directory / "availability.json").read_text())
        validation = json.loads((directory / "validation.json").read_text())
        source_status = manifest.get("source_status", {})
        result["sources"] = {
            name: {
                "status": rec.get("status"), "coverage": rec.get("coverage"),
                "rows": rec.get("rows", 0), "warnings": len(rec.get("warnings") or []),
                "error": rec.get("error"),
            }
            for name, rec in availability.items()
        }
        for source in CORE_SOURCES:
            if source not in availability:
                result["errors"].append(f"Missing core source entry: {source}")
            elif source_status.get(source, {}).get("status") != availability[source].get("status"):
                result["errors"].append(f"Source status mismatch: {source}")

        declared_files = {"farm_profile.json", *REQUIRED_REPORTS}
        for name, metadata in manifest.get("tables", {}).items():
            if isinstance(metadata.get("relative_path"), str):
                declared_files.add(metadata["relative_path"])
            relative = _safe_relative(metadata["relative_path"])
            target = (directory / relative).resolve()
            if not target.is_relative_to(directory.resolve()) or not target.is_file():
                result["errors"].append(f"Missing table file: {name}")
                continue
            actual_sha = hashlib.sha256(target.read_bytes()).hexdigest()
            match = actual_sha == metadata.get("sha256")
            report = validation.get(name, {})
            result["tables"][name] = {
                "sha256_ok": match,
                "qa_passed": report.get("passed"),
                "rows": metadata.get("rows"),
                "coverage": report.get("coverage"),
            }
            if not match:
                result["errors"].append(f"SHA256 mismatch: {name}")
            if report.get("passed") is not True:
                result["checks"].append(f"Table QA not passed: {name}")

        standardized_dir = directory / "standardized"
        if standardized_dir.is_dir():
            result["untracked_files"] = sorted(
                path.relative_to(directory).as_posix()
                for path in standardized_dir.rglob("*")
                if path.is_file() and path.relative_to(directory).as_posix() not in declared_files
            )
            if result["untracked_files"]:
                result["checks"].append(
                    f"Untracked standardized files: {len(result['untracked_files'])}; "
                    "may originate from older runs"
                )
        result["integrity_ok"] = not result["errors"]
        result["qa_ok"] = (
            result["integrity_ok"]
            and all(rec.get("qa_passed") is True for rec in result["tables"].values())
            and not any(result["sources"].get(s, {}).get("status") == "error" for s in CORE_SOURCES)
        )
        for source in CORE_SOURCES:
            status = result["sources"].get(source, {}).get("status")
            if status not in ("available", "partial"):
                result["checks"].append(f"Core source not usable: {source} ({status})")
        if not all(result["sources"].get(s, {}).get("status") in ("available", "partial")
                   for s in CORE_SOURCES):
            result["qa_ok"] = False
    except (OSError, ValueError, KeyError, TypeError, json.JSONDecodeError) as exc:
        result["errors"].append(f"Audit could not complete: {type(exc).__name__}: {exc}")
    return result


def _site_latest_directory(site_root: Path) -> Path:
    """Resolve a versioned export; retain read support for legacy flat exports."""
    latest = site_root / "latest.json"
    if latest.is_file():
        pointer = json.loads(latest.read_text(encoding="utf-8"))
        rel = _safe_relative(pointer["relative_path"])
        if not rel.parts or rel.parts[0] != "runs" or len(rel.parts) != 2:
            raise ValueError("latest.json must point to runs/<run_id>")
        resolved = (site_root / rel).resolve()
        if not resolved.is_relative_to(site_root.resolve()):
            raise ValueError("latest.json escapes farm directory")
        return resolved
    return site_root


def audit_sites(root: Path, sites: tuple[str, ...] = SITES) -> dict[str, Any]:
    root = Path(root)
    records = {}
    for site in sites:
        try:
            directory = _site_latest_directory(root / site)
            records[site] = audit_profile(directory, expected_farm_id=site)
        except (OSError, ValueError, KeyError, TypeError, json.JSONDecodeError) as exc:
            records[site] = audit_profile(root / site, expected_farm_id=site)
            records[site]["errors"].append(f"Invalid latest pointer: {type(exc).__name__}: {exc}")
            records[site]["integrity_ok"] = False
            records[site]["qa_ok"] = False
    return {
        "scope": "Phase 1 environmental baseline; Earthdata integration assessed separately",
        "sites": records,
        "all_integrity_ok": all(rec["integrity_ok"] for rec in records.values()),
        "all_baseline_qa_ok": all(rec["qa_ok"] for rec in records.values()),
    }


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Offline FarmAdapt Phase 1 export audit")
    parser.add_argument("--root", type=Path, default=Path("./data"))
    parser.add_argument("--output", type=Path, default=Path("./phase1_audit.json"))
    parser.add_argument("--sites", nargs="+", default=list(SITES),
                        help="Farm IDs to audit; defaults include Punjab Ballowal")
    args = parser.parse_args(argv)
    audit = audit_sites(args.root, sites=tuple(args.sites))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(audit, indent=2, ensure_ascii=False), encoding="utf-8")
    print("FarmAdapt Phase 1 audit")
    for site, record in audit["sites"].items():
        print(f"{site}: build={record['build_state']}, integrity={record['integrity_ok']}, "
              f"baseline_QA={record['qa_ok']}, errors={len(record['errors'])}, "
              f"observations={len(record['checks'])}")
    print(f"Report: {args.output}")
    return 0 if audit["all_baseline_qa_ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
