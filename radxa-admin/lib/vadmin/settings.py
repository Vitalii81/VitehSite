"""Live parameters: values the page reads at run time from the Worker (/api/settings), so changing them needs no build and no publication.
Today only the assistant's avatar. The Worker accepts a write only with the bearer secret kept in the file <data>/settings-token (same value as the
Worker secret SETTINGS_TOKEN, which deploy-worker.sh stores on each publication)."""
import json
import os
import urllib.request

from .core import ApiError

SITE_URL = os.environ.get("VADMIN_SITE_URL", "https://viteh.org")


def token_path(paths):
    return os.path.join(paths.secret, "settings-token")


def values(draft):
    """The live values taken from the saved draft."""
    return {"assistantAvatar": draft["assistant"]["avatar"]}


def apply(paths, draft, opener=urllib.request.urlopen):
    try:
        with open(token_path(paths), encoding="utf-8") as f:
            token = f.read().strip()
    except OSError:
        token = ""
    if not token:
        raise ApiError("no_token", "Немає ключа живих параметрів (файл settings-token). Він з'являється після першої публікації з новим Worker", 409)
    body = json.dumps(values(draft)).encode()
    request = urllib.request.Request(SITE_URL + "/api/settings", data=body, method="POST",
                                     headers={"authorization": "Bearer " + token, "content-type": "application/json", "user-agent": "viteh-admin/1"})
    try:
        with opener(request, timeout=15) as r:
            answer = json.loads(r.read().decode() or "{}")
    except Exception as e:
        raise ApiError("apply_failed", "Не вдалося застосувати на сайті: %s. Якщо Worker ще без цієї можливості, зробіть звичайну публікацію" % e, 502)
    return {"ok": True, "settings": answer.get("settings", {})}
