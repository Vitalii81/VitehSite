"""Admin-only catalog of ready-to-enable service cards (catalog/service-ideas.json).
The file is never part of the site source or of a package: the build copies only named site files. A card enters the draft through
schema.clean_service (the same limits as any custom service) and is ALWAYS added disabled, so the owner switches it on when ready."""
import os

from . import schema
from .core import ApiError, LANGS, read_json

READINESS = {"idea": "ідея", "learning": "вчу", "help": "зможу з допомогою", "ready": "готово"}
DEFAULT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "catalog")


def _file():
    return os.path.join(os.environ.get("VADMIN_CATALOG", DEFAULT_DIR), "service-ideas.json")


def _safe_url(url):
    return isinstance(url, str) and url.startswith("https://") and len(url) <= 300 and not any(c in url for c in " \"'<>")


def load():
    """Cleaned catalog items; a malformed file yields an empty list rather than an error page."""
    raw = read_json(_file(), {}) or {}
    out = []
    for it in (raw.get("items") if isinstance(raw.get("items"), list) else [])[:100]:
        if not isinstance(it, dict) or not isinstance(it.get("card"), dict):
            continue
        card = it["card"]
        out.append({
            "id": schema.text(it.get("id"), 40),
            "readiness": it.get("readiness") if it.get("readiness") in READINESS else "idea",
            "need": it.get("need") if isinstance(it.get("need"), int) else 0,
            "sources": [{"title": schema.text(s.get("title"), 120), "url": s["url"]} for s in (it.get("sources") or []) if isinstance(s, dict) and _safe_url(s.get("url"))],
            "card": {"icon": card.get("icon"), "title": schema.i18n(card.get("title"), 80), "text": schema.i18n(card.get("text"), 300, True),
                     "points": [schema.i18n(p, 80) for p in (card.get("points") or [])[:6]]},
        })
    return out


def view(ctx):
    items = load()
    for it in items:
        if it["card"]["icon"] not in ctx.icons:
            it["card"]["icon"] = "code"
    return {"items": items, "readiness": READINESS}


def add(draft, idea_id, ctx):
    """Appends the card as a DISABLED custom service and returns its new id."""
    item = next((i for i in load() if i["id"] == idea_id), None)
    if not item:
        raise ApiError("no_idea", "Ідею не знайдено в каталозі", 404)
    title = item["card"]["title"]
    if any(s["title"] == schema.i18n(title, 80) for s in draft["extra"]["services"]):
        raise ApiError("duplicate", "Ця послуга вже є в чернетці", 409)
    if len(draft["extra"]["services"]) >= schema.LIMITS["extra"]:
        raise ApiError("limit", "Забагато власних послуг (максимум %d)" % schema.LIMITS["extra"])
    svc = schema.clean_service(dict(item["card"], id=""), ctx)
    draft["extra"]["services"].append(svc)
    draft["disabled"]["services"].append(svc["id"])
    return svc["id"]
