"""panel_store (Cloud Storage runs) without the network, and the national web export's choice of cases."""

from pathlib import Path

import pytest

from gradientdescentfarmers.model_builder.rotations import panel, panel_store, web_export_national

FIXTURE = Path(__file__).parent / "fixtures" / "three_districts"


def test_local_paths_pass_through_and_gs_urls_pick_the_run(monkeypatch, tmp_path):
    assert panel_store.local(str(FIXTURE)) == FIXTURE
    calls = []
    monkeypatch.setattr(panel_store, "CACHE", tmp_path)
    monkeypatch.setattr(panel_store, "latest", lambda bucket: "RUN1")

    def fake(*args, capture=True):
        calls.append(args)
        dest = Path(args[-1].rstrip("/"))
        (dest / "tables").mkdir(parents=True, exist_ok=True)
        (dest / "manifest.json").write_text("{}")
        return ""

    monkeypatch.setattr(panel_store, "_gcloud", fake)
    assert panel_store.local("gs://b/district_panel") == tmp_path / "RUN1"
    assert calls[0][2] == "gs://b/district_panel/runs/RUN1/*"
    assert panel_store.local("gs://b/district_panel/runs/RUN2") == tmp_path / "RUN2"
    calls.clear()
    panel_store.local("gs://b/district_panel/runs/RUN2")      # cached: no download
    assert calls == []


def test_push_refuses_an_existing_run(monkeypatch):
    monkeypatch.setattr(panel_store, "_exists", lambda url: True)
    with pytest.raises(FileExistsError):
        panel_store.push(FIXTURE, "b")


def test_national_cases_are_districts_with_their_main_crops():
    panel.use(FIXTURE)
    cases = web_export_national.district_cases()
    assert cases
    for key, info, water, options in cases:
        assert key == f"{info['state_id']}-{info['ddr']}" and water in ("riego", "temporal")
        assert 1 <= len(options) <= web_export_national.TOP_CROPS + 1
        assert all(text for _, text, _ in options)
