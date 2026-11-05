"""Publish queue. The Radxa has no Cloudflare keys, so the button only queues a request; deploy-agent.sh on the main PC picks it up over
ssh (`vadmin-cli.py deploy-next`), runs deploy-from-radxa.sh and reports back (`deploy-report`). State lives in deploy.json."""
import re
import time

from .core import ApiError, read_json, write_json

BUILD_ID = re.compile(r"^[0-9]{8}-[0-9]{6}-[0-9a-f]{8}$")
AGENT_FRESH = 90            # seconds since the agent last asked for work
RUNNING_MAX = 20 * 60       # a deploy that reports nothing for this long is shown as failed
LOG_MAX = 6000


def _read(paths):
    return read_json(paths.deploy, {}) or {}


def request(paths, bid, now=None):
    now = now or time.time()
    if not BUILD_ID.match(bid) or not read_json(paths.builds + "/" + bid + "/manifest.json", None):
        raise ApiError("no_build", "Збірку не знайдено", 404)
    cur = _read(paths)
    if cur.get("state") in ("queued", "running") and now - cur.get("at", 0) < RUNNING_MAX:
        raise ApiError("busy", "Публікація вже триває", 409)
    cur = {"id": bid, "state": "queued", "at": now, "requestedAt": now, "log": "", "agentSeenAt": cur.get("agentSeenAt", 0)}
    write_json(paths.deploy, cur)
    return view(paths, now)


def next_request(paths, now=None):
    """Called by the agent: heartbeat plus take the queued request (moves it to running)."""
    now = now or time.time()
    cur = _read(paths)
    cur["agentSeenAt"] = now
    bid = ""
    if cur.get("state") == "queued":
        cur.update(state="running", at=now)
        bid = cur["id"]
    write_json(paths.deploy, cur)
    return bid


def report(paths, bid, ok, log, now=None):
    now = now or time.time()
    cur = _read(paths)
    if cur.get("id") != bid:
        raise ApiError("no_request", "Немає такого запиту на публікацію", 404)
    cur.update(state="ok" if ok else "failed", at=now, finishedAt=now, log=(log or "")[-LOG_MAX:])
    write_json(paths.deploy, cur)


def view(paths, now=None):
    now = now or time.time()
    cur = _read(paths)
    if not cur:
        return {"state": "idle", "agentOnline": False}
    state = cur.get("state", "idle")
    if state == "running" and now - cur.get("at", 0) > RUNNING_MAX:
        state = "failed"
        cur["log"] = (cur.get("log") or "") + "\nАгент довго не відповідає"
    return {"state": state, "id": cur.get("id"), "log": cur.get("log", ""), "requestedAt": cur.get("requestedAt"), "finishedAt": cur.get("finishedAt"),
            "agentOnline": now - cur.get("agentSeenAt", 0) < AGENT_FRESH}
