"""Visit statistics: the page counts visits without cookies (assets/stats.js -> Worker /api/hit) and the Worker keeps daily counters.
The admin reads them from /api/stats with the same bearer secret as the live settings (<data>/settings-token). The Radxa's Python has no TLS,
so the request goes through curl; the key is passed on stdin."""
import json

from .core import ApiError
from .settings import SITE_URL, token_path


def _curl(url, token):
    import subprocess
    r = subprocess.run(["curl", "-sS", "-m", "20", url, "-H", "@-", "-H", "user-agent: viteh-admin/1"],
                       input=("authorization: Bearer %s\n" % token).encode(), capture_output=True, timeout=25)
    if r.returncode:
        raise OSError(r.stderr.decode(errors="replace").strip() or "curl %d" % r.returncode)
    return r.stdout.decode()


def fetch(paths, days, run=_curl):
    try:
        days = max(1, min(400, int(days)))
    except (TypeError, ValueError):
        days = 30
    try:
        with open(token_path(paths), encoding="utf-8") as f:
            token = f.read().strip()
    except OSError:
        token = ""
    if not token:
        raise ApiError("no_token", "Немає ключа (файл settings-token). Він з'являється після першої публікації з новим Worker", 409)
    try:
        data = json.loads(run("%s/api/stats?days=%d" % (SITE_URL, days), token) or "{}")
    except Exception as e:
        raise ApiError("stats_failed", "Не вдалося отримати статистику: %s" % e, 502)
    if not data.get("ok"):
        raise ApiError("stats_failed", "Сайт не віддав статистику (%s). Якщо Worker ще без неї, зробіть публікацію" % data.get("error", "?"), 502)
    return data
