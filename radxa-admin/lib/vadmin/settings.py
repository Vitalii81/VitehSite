"""Live parameters: values the page reads at run time from the Worker (/api/settings), so changing them needs no build and no publication.
Today only the assistant's avatar. The Worker accepts a write only with the bearer secret kept in the file <data>/settings-token (same value as the
Worker secret SETTINGS_TOKEN, which deploy-worker.sh stores on each publication)."""
import json
import os

from .core import ApiError

SITE_URL = os.environ.get("VADMIN_SITE_URL", "https://viteh.org")


def token_path(paths):
    return os.path.join(paths.secret, "settings-token")


def values(draft):
    """The live values taken from the saved draft."""
    return {"assistantAvatar": draft["assistant"]["avatar"]}


def _curl(url, token, body):
    """The Radxa's Python has no TLS module (OpenWrt), so the request goes through curl; the key is passed on stdin, not on the command line."""
    import subprocess
    cmd = ["curl", "-sS", "-m", "15", "-X", "POST", url, "-H", "@-", "-H", "content-type: application/json", "-H", "user-agent: viteh-admin/1", "--data-binary", body]
    r = subprocess.run(cmd, input=("authorization: Bearer %s\n" % token).encode(), capture_output=True, timeout=20)
    if r.returncode:
        raise OSError(r.stderr.decode(errors="replace").strip() or "curl %d" % r.returncode)
    return r.stdout.decode()


def apply(paths, draft, run=_curl):
    try:
        with open(token_path(paths), encoding="utf-8") as f:
            token = f.read().strip()
    except OSError:
        token = ""
    if not token:
        raise ApiError("no_token", "Немає ключа живих параметрів (файл settings-token). Він з'являється після першої публікації з новим Worker", 409)
    try:
        answer = json.loads(run(SITE_URL + "/api/settings", token, json.dumps(values(draft))) or "{}")
    except Exception as e:
        raise ApiError("apply_failed", "Не вдалося застосувати на сайті: %s. Якщо Worker ще без цієї можливості, зробіть звичайну публікацію" % e, 502)
    if not answer.get("ok"):
        raise ApiError("apply_failed", "Сайт не прийняв параметри: %s" % answer.get("error", "?"), 502)
    return {"ok": True, "settings": answer.get("settings", {})}
