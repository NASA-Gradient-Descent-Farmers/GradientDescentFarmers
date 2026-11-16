"""The district rotation engine over HTTP: YoliA's live answers for any place in Mexico.

    python -m gradientdescentfarmers.model_builder.rotations.serve --port 8765                    # committed panel
    python -m gradientdescentfarmers.model_builder.rotations.serve --panel gs://gdfarming-farm-data/district_panel

On Cloud Run (deploy/district-api/) the panel comes from YOLIA_DISTRICT_PANEL (a gs:// prefix = its latest run). The
service checks `latest.json` every REFRESH_S seconds and switches to a new run when the monthly build publishes one, so
answers always use the newest data without a redeploy.

    GET  /health                       -> {"ok": true, "run_id": ...}
    GET  /district?municipio=..&estado=..
                                       -> {state_id, ddr, estado, distrito, municipio, lugar, regimenes:
                                           {riego|temporal: [{id, rotacion, etiqueta, estructura, ha}]}}
    POST /compare  {lugar, rotacion_actual (text, or a structure such as [{"pv": "maize"}]), estado?, agua?,
                    prioridades?, residuo?, tiene_animales?, pendiente?, suelo?, mes_siembra?, mes_cosecha?, costos?,
                    rendimiento_propio?, propuestas?, escenarios?}
                                       -> the engine's result (compare.comparar_rotaciones), or {"error": "..."} (400)

Standard library HTTP server, CORS open (the web app calls it from the browser), one comparison at a time per instance
(the engine caches tables in module globals; Cloud Run scales out by instances). No authentication: cap instances on
the host.
"""
from __future__ import annotations

import argparse
import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Lock
from urllib.parse import parse_qs, urlparse

ALLOWED = {"estado", "agua", "prioridades", "residuo", "tiene_animales", "pendiente", "suelo", "mes_siembra",
           "mes_cosecha", "costos", "rendimiento_propio", "propuestas", "escenarios", "n_alternativas"}
MAX_BODY = 32_000
REFRESH_S = int(os.environ.get("YOLIA_REFRESH_S", "600"))


class Engine:
    """The engine bound to a panel; with a gs:// source it follows the bucket's latest run."""

    def __init__(self, source: str | None):
        self.source = source
        self.lock = Lock()
        self.run_id = None
        self.engine = None
        self.checked = 0.0
        self._load()

    def _load(self):
        from . import RotationModelBuilder
        from .panel import resolve
        from .panel_store import local

        path = local(self.source) if self.source else None
        engine = RotationModelBuilder().build(str(path) if path else None, {})
        manifest = json.loads((resolve(engine.run) / "manifest.json").read_text(encoding="utf-8"))
        self.engine, self.run_id, self.checked = engine, manifest.get("run_id"), time.time()
        print(f"[district-api] panel run {self.run_id}", flush=True)

    def maybe_refresh(self):
        """At most every REFRESH_S: if the bucket's latest run changed, download it and switch (never fails a request)."""
        if not (self.source or "").startswith("gs://") or "/runs/" in self.source or time.time() - self.checked < REFRESH_S:
            return
        self.checked = time.time()
        try:
            from .panel_store import latest_of

            bucket = self.source[5:].split("/", 1)[0]
            if latest_of(bucket) != self.run_id:
                with self.lock:
                    self._load()
        except Exception as error:  # noqa: BLE001 - keep serving the run we have
            print(f"[district-api] refresh failed: {error}", flush=True)

    def compare(self, lugar, rotacion, **kwargs):
        with self.lock:
            return self.engine.compare(lugar, rotacion, **kwargs)

    def district(self, municipio, estado):
        from . import districts, panel

        with self.lock:
            panel.use(self.engine.run)
            return districts.district(municipio, estado)


def make_handler(engine):
    """`engine` has compare(lugar, rotacion, **kw), and optionally district(municipio, estado), maybe_refresh(), run_id."""

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
            # the browser's CORS pre-check: headers only (a 204 must not carry a body)
            self.send_response(204)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Max-Age", "3600")
            self.end_headers()

        def do_GET(self):  # noqa: N802
            url = urlparse(self.path)
            if url.path.rstrip("/") == "/health":
                return self._send(200, {"ok": True, "run_id": getattr(engine, "run_id", None)})
            if url.path.rstrip("/") == "/district" and hasattr(engine, "district"):
                getattr(engine, "maybe_refresh", lambda: None)()
                q = {k: v[0] for k, v in parse_qs(url.query).items()}
                if not q.get("municipio"):
                    return self._send(400, {"error": "falta municipio"})
                try:
                    return self._send(200, engine.district(q["municipio"][:120], (q.get("estado") or None) and q["estado"][:60]))
                except LookupError as error:
                    return self._send(404, {"error": str(error)})
            self._send(404, {"error": "not found"})

        def do_POST(self):  # noqa: N802
            if self.path.rstrip("/") != "/compare":
                return self._send(404, {"error": "not found"})
            getattr(engine, "maybe_refresh", lambda: None)()
            length = int(self.headers.get("Content-Length") or 0)
            if length <= 0 or length > MAX_BODY:
                return self._send(400, {"error": "cuerpo vacío o demasiado grande"})
            try:
                body = json.loads(self.rfile.read(length))
                lugar, rotacion = body["lugar"], body["rotacion_actual"]
                kwargs = {k: v for k, v in body.items() if k in ALLOWED and v is not None}
                result = engine.compare(lugar, rotacion, **kwargs)
            except (KeyError, ValueError, LookupError, TypeError) as error:
                return self._send(400, {"error": str(error)})
            self._send(200, result)

        def log_message(self, fmt, *args):
            print("[district-api]", fmt % args, flush=True)

    return Handler


def main(argv=None):
    parser = argparse.ArgumentParser(description="District rotation engine over HTTP")
    parser.add_argument("--host", default=os.environ.get("HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("PORT", "8765")))
    parser.add_argument("--panel", default=os.environ.get("YOLIA_DISTRICT_PANEL"),
                        help="panel run folder, or gs://<bucket>/district_panel (latest; followed as it changes)")
    args = parser.parse_args(argv)
    engine = Engine(args.panel)
    server = ThreadingHTTPServer((args.host, args.port), make_handler(engine))
    print(f"district engine on http://{args.host}:{args.port} (run {engine.run_id})", flush=True)
    threading.Thread(target=server.serve_forever, daemon=False).start()


if __name__ == "__main__":
    main()
