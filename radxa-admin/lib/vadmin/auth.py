"""Owner login. One long passphrase; only a salted PBKDF2 hash is stored (admin-secret/auth.json, outside the repository).
Sessions are HMAC-signed cookies; failed attempts are limited per client address and globally."""
import base64
import hashlib
import hmac
import secrets
import time

from . import core
from .core import ApiError, read_json, write_json

ITERATIONS = 200000
MIN_PASSPHRASE = 20
SESSION_SECONDS = 8 * 3600
MAX_FAILS = 5
LOCK_SECONDS = 15 * 60
GLOBAL_MAX_FAILS = 100                               # across all addresses; an owner locked out by someone else's attempts can run `vadmin-cli.py unlock`


def _hash(passphrase, salt, iterations):
    return hashlib.pbkdf2_hmac("sha256", passphrase.encode("utf-8"), salt, iterations)


def set_passphrase(paths, passphrase):
    if len(passphrase) < MIN_PASSPHRASE:
        raise ApiError("weak", "Фраза має містити щонайменше %d символів" % MIN_PASSPHRASE)
    salt = secrets.token_bytes(16)
    write_json(paths.auth, {
        "iterations": ITERATIONS, "salt": base64.b64encode(salt).decode(), "hash": base64.b64encode(_hash(passphrase, salt, ITERATIONS)).decode(),
        "session_key": base64.b64encode(secrets.token_bytes(32)).decode(),
    }, mode=0o600)


def _record(paths):
    rec = read_json(paths.auth, None)
    if not rec or not all(k in rec for k in ("salt", "hash", "session_key", "iterations")):
        raise ApiError("not_configured", "Пароль не налаштовано: виконайте install-on-radxa.sh --set-password", 503)
    return rec


def _attempts(paths, now):
    data = read_json(paths.attempts, {}) or {}
    return {k: [t for t in v if now - t < LOCK_SECONDS] for k, v in data.items() if isinstance(v, list)}


def login(paths, passphrase, client, now=None):
    """Returns a session cookie value or raises ApiError. The passphrase is never logged."""
    now = now if now is not None else time.time()
    rec = _record(paths)
    attempts = _attempts(paths, now)
    mine, total = attempts.get(client, []), sum(len(v) for v in attempts.values())
    if len(mine) >= MAX_FAILS or total >= GLOBAL_MAX_FAILS:
        raise ApiError("locked", "Забагато спроб. Спробуйте за 15 хвилин", 429)
    ok = hmac.compare_digest(_hash(passphrase or "", base64.b64decode(rec["salt"]), rec["iterations"]), base64.b64decode(rec["hash"]))
    if not ok:
        attempts.setdefault(client, []).append(now)
        write_json(paths.attempts, attempts, mode=0o600)
        raise ApiError("bad_login", "Невірна фраза", 401)
    if client in attempts:
        del attempts[client]
        write_json(paths.attempts, attempts, mode=0o600)
    return make_session(rec, now)


def make_session(rec, now):
    expires = str(int(now) + SESSION_SECONDS)
    nonce = secrets.token_hex(8)
    body = "%s.%s" % (expires, nonce)
    sig = hmac.new(base64.b64decode(rec["session_key"]), body.encode(), hashlib.sha256).hexdigest()
    return "%s.%s" % (body, sig)


def check_session(paths, cookie, now=None):
    now = now if now is not None else time.time()
    try:
        expires, nonce, sig = (cookie or "").split(".")
        rec = _record(paths)
    except (ValueError, ApiError):
        return False
    good = hmac.new(base64.b64decode(rec["session_key"]), ("%s.%s" % (expires, nonce)).encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(sig, good) and expires.isdigit() and int(expires) > now


def unlock(paths):
    """Clears the failed-attempt counters (the owner's way out of a lock caused by other people's attempts)."""
    write_json(paths.attempts, {}, mode=0o600)


def revoke_all(paths):
    """Rotates the session key: every cookie issued so far stops working."""
    rec = _record(paths)
    rec["session_key"] = base64.b64encode(secrets.token_bytes(32)).decode()
    write_json(paths.auth, rec, mode=0o600)
