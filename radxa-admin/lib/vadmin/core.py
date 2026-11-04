"""Paths, locking and atomic JSON I/O. Everything lives below one root so tests can point it at a temp directory."""
import contextlib
import fcntl
import hashlib
import json
import os
import re
import secrets
import tempfile
import time

LANGS = ("uk", "en", "de")
MAX_JSON = 1024 * 1024                    # draft and API bodies
KEEP_BUILDS = 20

DEFAULT_ROOT = "/srv/fwportal/staging/viteh-site"
DEFAULT_SECRET = "/srv/fwportal/admin-secret"


class Paths:
    def __init__(self, root=None, secret=None, src=None):
        self.root = root or os.environ.get("VADMIN_ROOT", DEFAULT_ROOT)
        self.secret = secret or os.environ.get("VADMIN_SECRET", DEFAULT_SECRET)
        self.src = src or os.environ.get("VADMIN_SRC", os.path.join(self.root, "src"))
        self.draft = os.path.join(self.root, "draft.json")
        self.state = os.path.join(self.root, "state.json")
        self.uploads = os.path.join(self.root, "uploads")
        self.uploads_index = os.path.join(self.uploads, "index.json")
        self.builds = os.path.join(self.root, "builds")
        self.lock = os.path.join(self.root, ".lock")
        self.auth = os.path.join(self.secret, "auth.json")
        self.attempts = os.path.join(self.secret, "attempts.json")

    def ensure(self):
        for d in (self.root, self.uploads, self.builds):
            os.makedirs(d, mode=0o755, exist_ok=True)


class ApiError(Exception):
    """An error that is safe to show to the (authenticated) owner."""
    def __init__(self, code, message=None, status=400, details=None):
        Exception.__init__(self, message or code)
        self.code, self.message, self.status, self.details = code, message or code, status, details


def read_json(path, default=None, limit=MAX_JSON * 4):
    try:
        with open(path, "rb") as fh:
            raw = fh.read(limit + 1)
        if len(raw) > limit:
            return default
        return json.loads(raw.decode("utf-8"))
    except (OSError, ValueError):
        return default


def write_json(path, value, mode=0o644):
    """Atomic: write to a temp file in the same directory, fsync, rename."""
    directory = os.path.dirname(path) or "."
    os.makedirs(directory, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=".tmp-", dir=directory)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(value, fh, ensure_ascii=False, indent=1, sort_keys=False)
            fh.write("\n")
            fh.flush()
            os.fsync(fh.fileno())
        os.chmod(tmp, mode)
        os.replace(tmp, path)
    except BaseException:
        with contextlib.suppress(OSError):
            os.unlink(tmp)
        raise


@contextlib.contextmanager
def locked(paths):
    """One writer at a time (draft save, build, upload, rollback)."""
    paths.ensure()
    with open(paths.lock, "a") as fh:
        fcntl.flock(fh, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(fh, fcntl.LOCK_UN)


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def new_id(prefix=""):
    return prefix + secrets.token_hex(4)


SLUG_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
RESERVED_SLUGS = {"api", "admin", "assets", "data", "s", "cgi-bin", "index", "impressum", "datenschutz", "sitemap", "robots", "forms"}


def valid_slug(slug):
    return bool(isinstance(slug, str) and 1 <= len(slug) <= 48 and SLUG_RE.match(slug) and slug not in RESERVED_SLUGS)


def stamp():
    return time.strftime("%Y%m%d-%H%M%S", time.gmtime())
