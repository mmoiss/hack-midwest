#!/usr/bin/env python3
"""Stand-in for the real POST /events (CONTRACT.md). Always 200 {"alerts": []};
logs each call so the hook-firing smoke test has something to watch.

Run: python3 hooks/mock_events_server.py (default port 8787)
"""
import json
import os
from http.server import BaseHTTPRequestHandler, HTTPServer

PORT = int(os.environ.get("PORT", "8787"))


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length) if length else b"{}"
        try:
            payload = json.loads(body or b"{}")
        except json.JSONDecodeError:
            payload = {}
        print(f"[mock /events] auth={self.headers.get('Authorization', '<none>')} "
              f"agent={payload.get('agent')} file={payload.get('file')} "
              f"diff_len={len(payload.get('diff', ''))}")
        self._reply(200, {"alerts": []})

    def _reply(self, status, obj):
        body = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        pass


if __name__ == "__main__":
    HTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
