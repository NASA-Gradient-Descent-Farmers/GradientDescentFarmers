"""The web app's district export (web_export) and the live API (serve): packing is lossless, the grid is the one the web
app expects, every committed file unpacks, and the API passes only known arguments to the engine."""

import json
import threading
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

from gradientdescentfarmers.model_builder.rotations import scoring, serve, web_export

REPO = Path(__file__).resolve().parents[2]


def _result(order, scores, extra=None):
    rotations = {"a": {"id": "actual", "nombre": "Tu rotación actual: maíz"}, "b": {"id": "leguminosa", "nombre": "Con leguminosa: maíz – frijol"},
                 "c": {"id": "invierno", "nombre": "Con cultivo de invierno: maíz – garbanzo"}}
    return {"lugar": {"distrito": "X"}, "aviso": "...", **(extra or {}),
            "rotaciones": [{**rotations[k], "puntaje_prioridades": s} for k, s in zip(order, scores)]}


def test_pack_is_lossless_and_stores_shared_parts_once():
    results = {"none": _result("ab", [50, 60], {"prioridades": []}), "agua": _result("ac", [40, 70], {"prioridades": ["agua"]})}
    packed = web_export.pack(results)
    assert set(packed["common"]) == {"lugar", "aviso"}
    assert len(packed["rotations"]) == 3
    for key, result in results.items():
        assert web_export.unpack(packed, key) == result


def test_priority_grid_is_none_singles_and_pairs():
    sets = web_export.priority_sets()
    n = len(scoring.PRIORITIES)
    assert len(sets) == 1 + n + n * (n - 1) // 2
    assert web_export.priority_key(("suelo", "agua")) == "agua+suelo" and web_export.priority_key(()) == "none"


def test_committed_web_files_unpack_for_every_priority_set():
    root = REPO / "frontend" / "public" / "data" / "district"
    index = json.loads((root / "index.json").read_text(encoding="utf-8"))
    assert set(index["lugares"]) == set(web_export.PLACES)
    keys = {web_export.priority_key(p) for p in web_export.priority_sets()}
    for place in index["lugares"].values():
        assert place["errores"] == []
        for options in place["regimenes"].values():
            for option in options:
                packed = json.loads((root / option["archivo"]).read_text(encoding="utf-8"))
                assert set(packed["variants"]) == keys
                result = web_export.unpack(packed, "none")
                assert result["rotaciones"][0]["id"] == "actual" and len(result["rotaciones"]) >= 3


class _Engine:
    def __init__(self):
        self.calls = []

    def compare(self, lugar, rotacion, **kwargs):
        self.calls.append((lugar, rotacion, kwargs))
        if lugar == "nowhere":
            raise LookupError("No encontré 'nowhere'")
        return {"lugar": {"municipio": lugar}, "rotaciones": []}


def _post(port, body):
    request = urllib.request.Request(f"http://127.0.0.1:{port}/compare", data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(request) as response:
            return response.status, json.loads(response.read())
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read())


def test_serve_passes_known_arguments_and_reports_errors():
    engine = _Engine()
    server = ThreadingHTTPServer(("127.0.0.1", 0), serve.make_handler(engine))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    port = server.server_address[1]
    try:
        status, body = _post(port, {"lugar": "Bácum", "rotacion_actual": "trigo", "agua": "riego", "pendiente": "fuerte", "hack": 1, "suelo": None})
        assert status == 200 and body["lugar"]["municipio"] == "Bácum"
        assert engine.calls[-1] == ("Bácum", "trigo", {"agua": "riego", "pendiente": "fuerte"})
        status, body = _post(port, {"lugar": "nowhere", "rotacion_actual": "trigo"})
        assert status == 400 and "nowhere" in body["error"]
        status, body = _post(port, {"rotacion_actual": "trigo"})
        assert status == 400
    finally:
        server.shutdown()
