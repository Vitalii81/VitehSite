#!/usr/bin/env python3
"""Try the admin on any computer without nginx:  python3 radxa-admin/dev-server.py [--port 8082] [--data DIR]
Serves the admin UI and the API (same code as the CGI) on --port, and the last built package on --preview-port. Binds to 127.0.0.1 only."""
import argparse
import mimetypes
import os
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlsplit

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "lib"))
from vadmin import api, core   # noqa: E402

PATHS = None


class Base(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass

    def _send(self, status, headers, body):
        self.send_response(status)
        for k, v in headers:
            self.send_header(k, v)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _static(self, root, rel):
        rel = unquote(rel).lstrip("/") or "index.html"
        full = os.path.realpath(os.path.join(root, rel))
        if not full.startswith(os.path.realpath(root) + os.sep) and full != os.path.realpath(root):
            return self._send(403, [], b"forbidden")
        if os.path.isdir(full):
            full = os.path.join(full, "index.html")
        if not os.path.isfile(full):
            return self._send(404, [("Content-Type", "text/plain")], b"not found")
        with open(full, "rb") as fh:
            data = fh.read()
        self._send(200, [("Content-Type", mimetypes.guess_type(full)[0] or "application/octet-stream"), ("Cache-Control", "no-store")], data)


class Preview(Base):
    """The last built package at the root of its own port, like :8081 on the Radxa (generated pages use root-relative URLs)."""
    def do_GET(self):
        self._static(os.path.join(PATHS.builds, "current", "site"), urlsplit(self.path).path)


class Handler(Base):
    server_version = "vadmin-dev"

    def _api(self, method):
        parts = urlsplit(self.path)
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length) if 0 < length <= api.MAX_UPLOAD_BODY else b""
        headers = {k.lower(): v for k, v in self.headers.items()}
        query = parse_qs(parts.query)
        self._send(*api.handle(PATHS, method, (query.get("action") or [""])[0], headers, body, query, self.client_address[0]))

    def do_GET(self):
        path = urlsplit(self.path).path
        if path == "/cgi-bin/vadmin-api":
            return self._api("GET")
        if path.startswith("/site-assets/"):
            return self._static(os.path.join(PATHS.src, "assets"), path[len("/site-assets"):])
        self._static(os.path.join(HERE, "web"), path)

    def do_POST(self):
        if urlsplit(self.path).path == "/cgi-bin/vadmin-api":
            return self._api("POST")
        self._send(404, [], b"not found")


def main():
    global PATHS
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8082)
    ap.add_argument("--preview-port", type=int, default=8081)
    ap.add_argument("--data", default=os.path.join(HERE, ".dev-data"), help="state directory (default: radxa-admin/.dev-data)")
    ap.add_argument("--src", default=os.path.dirname(HERE), help="site files (default: the repository root)")
    ap.add_argument("--passphrase", help="set the login phrase non-interactively (testing only)")
    args = ap.parse_args()
    PATHS = core.Paths(root=os.path.join(args.data, "staging"), secret=os.path.join(args.data, "secret"), src=args.src)
    PATHS.ensure()
    os.makedirs(PATHS.secret, mode=0o700, exist_ok=True)
    if args.passphrase or not os.path.exists(PATHS.auth):
        from vadmin import auth
        auth.set_passphrase(PATHS, args.passphrase or "dev-only-passphrase-change-me")
        print("Login phrase:", args.passphrase or "dev-only-passphrase-change-me")
    os.environ["VADMIN_PREVIEW_URL"] = "http://127.0.0.1:%d/" % args.preview_port
    print("Admin: http://127.0.0.1:%d/   Preview of the last build: %s" % (args.port, os.environ["VADMIN_PREVIEW_URL"]))
    threading.Thread(target=ThreadingHTTPServer(("127.0.0.1", args.preview_port), Preview).serve_forever, daemon=True).start()
    ThreadingHTTPServer(("127.0.0.1", args.port), Handler).serve_forever()


if __name__ == "__main__":
    main()
