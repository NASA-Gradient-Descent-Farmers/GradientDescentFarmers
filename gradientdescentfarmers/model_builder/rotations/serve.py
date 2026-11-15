"""A small HTTP API over the district rotation engine, for the YolIA web app's optional "live" mode.

    python -m gradientdescentfarmers.model_builder.rotations.serve --port 8765

The web app works without it (it reads the precomputed answers written by `web_export.py`). With it running and
the app built or served with VITE_DISTRICT_API=http://localhost:8765, the inputs the precomputed grid does not
vary (slope, soil, residue, animals, sowing and harvest month, the farmer's costs and own yields) reach the engine.

    GET  /health                    -> {"ok": true}
    POST /compare  {lugar, rotacion_actual, estado?, agua?, prioridades?, residuo?, tiene_animales?, pendiente?,
                    suelo?, mes_siembra?, mes_cosecha?, costos?, rendimiento_propio?, propuestas?}
                                    -> the engine's result (compare.comparar_rotaciones), or {"error": "..."} (400)

Standard library only (no web framework), CORS open for GET/POST, one engine bound to one panel. A demo
service: it has no authentication and should not be exposed to the internet as it is.
"""
from __future__ import annotations

import argparse
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Lock

ALLOWED = {"estado", "agua", "prioridades", "residuo", "tiene_animales", "pendiente", "suelo", "mes_siembra",
           "mes_cosecha", "costos", "rendimiento_propio", "propuestas", "escenarios", "n_alternativas"}
MAX_BODY = 32_000


def make_handler(engine):
    lock = Lock()   # the engine caches tables in module globals; one comparison at a time

    class Handler(BaseHTTPRequestHandler):
        def _send(self, status, payload):
            body = json.dumps(payload, ensure_ascii=False, default=float).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.end_headers()
            self.wfile.write(body)

        def do_OPTIONS(self):  # noqa: N802
            self._send(204, {})

        def do_GET(self):  # noqa: N802
            if self.path.rstrip("/") == "/health":
                return self._send(200, {"ok": True})
            self._send(404, {"error": "not found"})

        def do_POST(self):  # noqa: N802
            if self.path.rstrip("/") != "/compare":
                return self._send(404, {"error": "not found"})
            length = int(self.headers.get("Content-Length") or 0)
            if length <= 0 or length > MAX_BODY:
                return self._send(400, {"error": "cuerpo vacío o demasiado grande"})
            try:
                body = json.loads(self.rfile.read(length))
                lugar, rotacion = body["lugar"], body["rotacion_actual"]
                kwargs = {k: v for k, v in body.items() if k in ALLOWED and v is not None}
                with lock:
                    result = engine.compare(lugar, rotacion, **kwargs)
            except (KeyError, ValueError, LookupError, TypeError) as error:
                return self._send(400, {"error": str(error)})
            self._send(200, result)

        def log_message(self, fmt, *args):
            print("[district-api]", fmt % args, flush=True)

    return Handler


def main(argv=None):
    from . import RotationModelBuilder

    parser = argparse.ArgumentParser(description="District rotation engine over HTTP (demo)")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--panel", help="district panel run (default: the committed national panel)")
    args = parser.parse_args(argv)
    engine = RotationModelBuilder().build(args.panel, {})
    server = ThreadingHTTPServer((args.host, args.port), make_handler(engine))
    print(f"district engine on http://{args.host}:{args.port} (POST /compare)", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
