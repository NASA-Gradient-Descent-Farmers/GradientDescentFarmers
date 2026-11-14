"""Offline tests for the four-location Phase 1 exported-profile audit."""
import json

from gradientdescentfarmers.source_builder.core.audit import audit_profile, audit_sites
from gradientdescentfarmers.source_builder.core.builder import FarmProfileBuilder


def test_audit_valid_exported_profile(farmer, offline_settings):
    builder = FarmProfileBuilder(farmer, offline_settings)
    builder.build(export=True)
    result = audit_profile(builder.run_dir, expected_farm_id=farmer.farm_id)
    assert result["integrity_ok"]
    # Offline sources are not usable. This is not a baseline integration success.
    assert not result["qa_ok"]
    assert result["build_state"] == "failed"
    assert "fields" in result["tables"]


def test_audit_detects_corrupt_table(farmer, offline_settings):
    builder = FarmProfileBuilder(farmer, offline_settings)
    builder.build(export=True)
    manifest = json.loads((builder.run_dir / "farm_profile.json").read_text())
    relative = manifest["tables"]["fields"]["relative_path"]
    (builder.run_dir / relative).write_text("corrupted")
    result = audit_profile(builder.run_dir, expected_farm_id=farmer.farm_id)
    assert not result["integrity_ok"]
    assert any("SHA256 mismatch: fields" in err for err in result["errors"])


def test_audit_missing_site(tmp_path):
    result = audit_sites(tmp_path)
    assert not result["all_integrity_ok"]
    assert not result["all_baseline_qa_ok"]
    assert len(result["sites"]) == 4
    assert all("farm_profile.json missing" in r["errors"] for r in result["sites"].values())


def test_audit_detects_manifest_identity_mismatch(farmer, offline_settings):
    builder = FarmProfileBuilder(farmer, offline_settings)
    builder.build(export=True)
    result = audit_profile(builder.run_dir, expected_farm_id="another_farm")
    assert not result["integrity_ok"]
    assert any("farm_id does not match" in e for e in result["errors"])


def test_audit_flags_untracked_table_without_claiming_it_is_current(farmer, offline_settings):
    builder = FarmProfileBuilder(farmer, offline_settings)
    builder.build(export=True)
    orphan = builder.run_dir / "standardized" / "soil_properties_raw.csv"
    orphan.write_text("farm_id,property,value\\ntexcoco_demo,phh2o,7.2\\n")
    report = audit_profile(builder.run_dir, expected_farm_id=farmer.farm_id)
    assert report["integrity_ok"]  # declared files are still intact
    assert not report["qa_ok"]  # offline sources are unavailable
    assert report["untracked_files"] == ["standardized/soil_properties_raw.csv"]
    assert any("Untracked standardized files: 1" in x for x in report["checks"])


def test_versioned_runs_keep_old_files_separate(farmer, offline_settings):
    first = FarmProfileBuilder(farmer, offline_settings)
    first.build(export=True)
    old_csv = first.run_dir / "standardized" / "soil_properties_raw.csv"
    old_csv.write_text("legacy but not declared")
    second = FarmProfileBuilder(farmer, offline_settings)
    second.build(export=True)
    assert first.run_dir != second.run_dir
    assert old_csv.is_file()
    assert not (second.run_dir / "standardized" / "soil_properties_raw.csv").exists()
    pointer = json.loads(
        (offline_settings.output_root / farmer.farm_id / "latest.json").read_text()
    )
    assert pointer["run_id"] == second.run_id
    report = audit_sites(offline_settings.output_root, sites=(farmer.farm_id,))
    assert report["sites"][farmer.farm_id]["integrity_ok"]
    assert report["sites"][farmer.farm_id]["untracked_files"] == []
