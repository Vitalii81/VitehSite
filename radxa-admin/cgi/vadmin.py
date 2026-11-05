#!/usr/bin/env python3
"""CGI entry: /cgi-bin/vadmin?action=...  One short-lived process per request, standard library only.
The admin site is private (127.0.0.1 and the tailnet); this script still authenticates every call."""
import os
import sys
from http import HTTPStatus

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "lib"))

from urllib.parse import parse_qs                       # noqa: E402
from vadmin import api, core                            # noqa: E402


def main():
    method = os.environ.get("REQUEST_METHOD", "GET").upper()
    query = parse_qs(os.environ.get("QUERY_STRING", ""))
    action = (query.get("action") or [""])[0]
    headers = {}
    for key, value in os.environ.items():
        if key.startswith("HTTP_"):
            headers[key[5:].replace("_", "-").lower()] = value
    if os.environ.get("CONTENT_TYPE"):
        headers["content-type"] = os.environ["CONTENT_TYPE"]
    length = int(os.environ.get("CONTENT_LENGTH") or 0)
    if length > api.MAX_UPLOAD_BODY:
        body, too_big = b"", True
    else:
        body, too_big = sys.stdin.buffer.read(length) if length else b"", False
    client = os.environ.get("REMOTE_ADDR", "unknown")
    if client in ("127.0.0.1", "::1") and headers.get("cf-connecting-ip"):        # through the Cloudflare tunnel every request comes from loopback
        client = headers["cf-connecting-ip"][:64]
    if too_big:
        status, out_headers, payload = 413, [("Content-Type", "application/json")], b'{"ok":false,"error":"too_large"}'
    else:
        status, out_headers, payload = api.handle(core.Paths(), method, action, headers, body, query, client)
    out = sys.stdout.buffer
    try:                                                                 # uhttpd on the Radxa ignores "Status: 401" without the reason text and answers 200
        phrase = HTTPStatus(status).phrase
    except ValueError:
        phrase = "Error"
    out.write(("Status: %d %s\r\n" % (status, phrase)).encode())
    for name, value in out_headers:
        out.write(("%s: %s\r\n" % (name, value)).encode())
    out.write(("Content-Length: %d\r\n\r\n" % len(payload)).encode())
    out.write(payload)


if __name__ == "__main__":
    main()
