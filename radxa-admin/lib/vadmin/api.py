"""Request handling shared by the CGI script and the tests. `handle()` takes plain values and returns (status, headers, body_bytes)."""
import json
import os
import re
from http.cookies import SimpleCookie

from . import auth, build, core, deploy, editpage, ideas, schema, uploads
from .core import ApiError, LANGS, locked, read_json, write_json

COOKIE = "vadmin"
SECTION_LABELS = {
    "hero": "Перший екран (hero)", "trust": "Смуга можливостей", "services": "Послуги", "ai": "AI-агенти", "process": "Процес",
    "work": "Проєкти", "stack": "Технології", "pricing": "Формати співпраці", "faq": "Запитання й відповіді", "contact": "Контакти й форма",
}
EFFECT_LABELS = {"floating": "Плавне погойдування картинки на першому екрані", "reveal": "Поява блоків під час прокрутки"}
WIDGET_LABELS = {"gallery3d": "3D-галерея проєктів", "portfolioLink": "Портфоліо: сторінка /portfolio/ і посилання на неї в «Проєктах» і «Контактах»"}
MAX_UPLOAD_BODY = uploads.MODEL_MAX + 1024


def _json(status, value, headers=None):
    body = json.dumps(value, ensure_ascii=False).encode("utf-8")
    h = [("Content-Type", "application/json; charset=utf-8"), ("Cache-Control", "no-store"), ("X-Content-Type-Options", "nosniff")]
    return status, h + (headers or []), body


def _https(headers):
    """True when the browser reached us over https (Cloudflare tunnel). uhttpd passes CGI only a fixed set of headers (Origin, Referer,
    Cookie, Host, ...), not X-Forwarded-Proto or CF-*, so the page's own Origin/Referer scheme is the signal; the private http ports never match."""
    return (headers.get("origin") or headers.get("referer") or "").lower().startswith("https://")


def _session_cookie(value, clear=False, secure=False):
    c = "%s=%s; Path=/; HttpOnly; SameSite=Strict; Max-Age=%d%s" % (COOKIE, "" if clear else value, 0 if clear else auth.SESSION_SECONDS, "; Secure" if secure else "")
    return [("Set-Cookie", c)]


def _same_origin(headers):
    origin = headers.get("origin")
    if not origin:
        return True                                      # same-origin fetch() of a POST always sends Origin in current browsers; absent = non-browser client
    host = headers.get("host", "")
    return re.sub(r"^https?://", "", origin).rstrip("/") == host


def read_draft(paths, ctx):
    raw = read_json(paths.draft, None)
    return schema.sanitize(raw, ctx) if raw is not None else schema.sanitize({}, ctx)


def save_draft(paths, draft):
    draft["rev"] = int(draft.get("rev", 0)) + 1
    write_json(paths.draft, draft)
    return draft["rev"]


def catalog(paths, ctx):
    leaves = schema.editable_texts(ctx.site)
    groups = {}
    for path, value in leaves.items():
        parts = path.split(".")
        key = parts[0]
        if key == "portfolioPage" and len(parts) > 3 and parts[1] == "sections" and parts[2].isdigit():     # one group per portfolio section
            key = "portfolioPage:" + str((ctx.site["portfolioPage"]["sections"][int(parts[2])]).get("id", parts[2]))
        elif key == "portfolioPage":
            key = "portfolioPage:" + parts[1]
        groups.setdefault(key, {})[path] = value
    return {
        "langs": list(LANGS),
        "sections": [{"id": s, "label": SECTION_LABELS[s]} for s in schema.SECTION_IDS],
        "effects": [{"id": k, "label": v} for k, v in EFFECT_LABELS.items()],
        "widgets": [{"id": k, "label": v} for k, v in WIDGET_LABELS.items()],
        "blocks": ctx.blocks, "icons": ctx.icons, "factoryImages": factory_images(paths),
        "templates": {
            "service": ctx.templates.get("service", {}).get("label"), "project": ctx.templates.get("project", {}).get("label"),
            "sections": {k: v["label"] for k, v in ctx.templates.get("sections", {}).items()},
            "pages": {k: v["label"] for k, v in ctx.templates.get("pages", {}).items()},
            "forms": {k: v["label"] for k, v in ctx.templates.get("forms", {}).items()},
        },
        "factory": {
            "services": [{"id": "s%d" % i, "title": it.get("title"), "text": it.get("text"), "icon": it.get("icon"), "model": bool(it.get("model"))} for i, it in enumerate(ctx.site.get("services", {}).get("items", []))],
            "projects": [{"id": p["id"], "title": p.get("title"), "summary": p.get("summary"), "image": p.get("image"), "model": bool(p.get("model")), "status": p.get("status"), "tags": p.get("tags", []), "category": p.get("category")} for p in ctx.products],
            "categories": [{"id": c["id"], "label": c["label"]} for c in ctx.site.get("work", {}).get("categories", [])],
            "portfolio": [{"id": x.get("id"), "title": x.get("title")} for x in ctx.site.get("portfolioPage", {}).get("sections", [])],
            "gallery": [{"slug": x.get("slug"), "category": x.get("category"), "years": x.get("years", ""), "title": x.get("title"), "summary": x.get("summary"), "tags": x.get("tags", []),
                         "portfolioOnly": bool(x.get("portfolioOnly")), "slots": [{"key": "%s/%s" % (x.get("slug"), sl), "status": next((m.get("status") for m in ctx.portfolio_images if m.get("slug") == x.get("slug") and m.get("slot") == sl), "")} for sl in x.get("slots", [])]}
                        for x in ctx.portfolio_projects],
            "portfolioSlots": [{"key": "%s/%s" % (m.get("slug"), m.get("slot")), "alt": m.get("alt"), "status": m.get("status"), "ratio": m.get("ratio"), "hint": m.get("source_hint")} for m in ctx.portfolio_images],
        },
        "texts": dict((k, v) for k, v in groups.items() if not k.startswith("portfolioPage")),
        "portfolioTexts": dict((k, v) for k, v in groups.items() if k.startswith("portfolioPage")),
        "plain": schema.editable_plain(ctx.site),
        "assistantFacts": [f for f in ctx.assistant_kb if isinstance(f, dict)],         # factory records of data/assistant-kb.json (the tab «Помічник» overrides them by id)
    }


def status(paths, host, ctx=None):
    state = build.read_state(paths) or {}
    name = (host or "localhost").split(":")[0]
    ctx = ctx or schema.Context(paths)
    manifest = read_json(os.path.join(paths.builds, state["built"], "manifest.json"), {}) if state.get("built") else {}
    changed = (manifest or {}).get("draftDigest") != build.draft_digest(read_draft(paths, ctx))
    return {"built": state.get("built"), "builtAt": state.get("builtAt"), "published": state.get("published"), "changedSinceBuild": changed,
            "previewUrl": os.environ.get("VADMIN_PREVIEW_URL") or ("https://preview." + name.split(".", 1)[1] + "/" if name.startswith("admin.") else "http://%s:%s/" % (name, os.environ.get("VADMIN_PREVIEW_PORT", "8083"))), "deploy": deploy.view(paths), "deployCommand": ("./deploy-from-radxa.sh %s" % state["built"]) if state.get("built") else None}


def handle(paths, method, action, headers, body=b"", query=None, client="local"):
    """headers: lower-case dict. Never raises: every failure becomes a JSON error."""
    try:
        return _handle(paths, method, action, headers, body, query or {}, client)
    except ApiError as e:
        return _json(e.status, {"ok": False, "error": e.code, "message": e.message, "details": e.details})
    except Exception as e:                                                # a bug must not leak a traceback to the browser
        import sys
        sys.stderr.write("vadmin: internal error: %s: %s\n" % (type(e).__name__, e))
        return _json(500, {"ok": False, "error": "internal", "message": "Внутрішня помилка сервера. Деталі в журналі nginx/CGI"})


def _handle(paths, method, action, headers, body, query, client):
    if method not in ("GET", "POST"):
        raise ApiError("method", "Метод не підтримується", 405)
    if method == "POST":
        if headers.get("x-vadmin") != "1" and not headers.get("origin"):                 # uhttpd drops X-Vadmin; a browser POST always carries Origin
            raise ApiError("csrf", "Відхилено: немає службового заголовка", 403)
        if not _same_origin(headers):
            raise ApiError("origin", "Відхилено: запит з іншого походження", 403)
        if len(body) > MAX_UPLOAD_BODY:
            raise ApiError("too_large", "Запит завеликий", 413)

    if action == "login" and method == "POST":
        data = _body_json(body)
        cookie = auth.login(paths, str(data.get("passphrase", "")), client)
        return _json(200, {"ok": True}, _session_cookie(cookie, secure=_https(headers)))

    jar = SimpleCookie()
    try:
        jar.load(headers.get("cookie", ""))
    except Exception:
        pass
    if not auth.check_session(paths, jar[COOKIE].value if COOKIE in jar else ""):
        if action == "edit-page" and method == "GET":                # opened in a browser tab: a page with a link to the login, not JSON
            return editpage.login_page()
        raise ApiError("auth", "Потрібен вхід", 401)

    if action == "logout" and method == "POST":
        return _json(200, {"ok": True}, _session_cookie("", clear=True, secure=_https(headers)))

    ctx = schema.Context(paths)
    host = headers.get("host", "")

    if method == "GET":
        if action == "bootstrap":
            return _json(200, {"ok": True, "draft": read_draft(paths, ctx), "catalog": catalog(paths, ctx), "status": status(paths, host, ctx),
                               "uploads": uploads.listing(paths), "builds": build.list_builds(paths)})
        if action == "edit-page":
            lang = str((query.get("lang") or [""])[0])
            return editpage.render_page(paths, ctx, read_draft(paths, ctx), lang, uploads.listing(paths), factory_images(paths), SECTION_LABELS, str((query.get("page") or [""])[0]))
        if action == "ideas":
            return _json(200, dict(ideas.view(ctx), ok=True, added=[s["title"] for s in read_draft(paths, ctx)["extra"]["services"]]))
        if action == "status":
            return _json(200, {"ok": True, "status": status(paths, host, ctx), "builds": build.list_builds(paths)})
        if action == "file":
            return _file(paths, str((query.get("id") or [""])[0]))
        if action == "check":
            from . import check
            return _json(200, {"ok": True, "problems": check.validate(read_draft(paths, ctx), ctx, paths.src)})
        raise ApiError("unknown_action", "Невідома дія", 404)

    # ---- writes (one at a time) ----
    with locked(paths):
        if action == "save":
            data = _body_json(body)
            current = read_draft(paths, ctx)
            if int(data.get("rev", -1)) != current["rev"]:
                raise ApiError("conflict", "Чернетку змінено в іншій вкладці. Оновіть сторінку, щоб не втратити правки", 409, {"rev": current["rev"]})
            clean = schema.sanitize(data.get("draft"), ctx)
            clean["rev"] = current["rev"]
            return _json(200, {"ok": True, "rev": save_draft(paths, clean), "draft": clean})
        if action == "avatar-upload":                          # one picture or a ZIP with a picture per mood (see avatar.py)
            from . import avatar
            from urllib.parse import unquote
            name = str((query.get("name") or [""])[0]) or unquote(headers.get("x-filename", "idle"))
            return _json(200, {"ok": True, "frames": avatar.store(paths, body, name), "uploads": uploads.listing(paths)})
        if action == "apply-settings":                         # parameters that need no new publication (see settings.py)
            from . import settings
            return _json(200, settings.apply(paths, read_draft(paths, ctx)))
        if action == "template":
            data = _body_json(body)
            draft = read_draft(paths, ctx)
            if int(data.get("rev", -1)) != draft["rev"]:
                raise ApiError("conflict", "Чернетку змінено в іншій вкладці. Оновіть сторінку", 409, {"rev": draft["rev"]})
            new_id = schema.add_from_template(draft, str(data.get("kind", "")), str(data.get("id", "")), ctx)
            save_draft(paths, draft)
            return _json(200, {"ok": True, "newId": new_id, "draft": draft})
        if action == "idea-add":
            data = _body_json(body)
            draft = read_draft(paths, ctx)
            if int(data.get("rev", -1)) != draft["rev"]:
                raise ApiError("conflict", "Чернетку змінено в іншій вкладці. Оновіть сторінку", 409, {"rev": draft["rev"]})
            new_id = ideas.add(draft, str(data.get("id", "")), ctx)
            save_draft(paths, draft)
            return _json(200, {"ok": True, "newId": new_id, "draft": draft})
        if action == "upload":
            from urllib.parse import unquote
            # uhttpd drops custom headers, so the page sends the name in the query (?name=); X-Filename stays for other clients
            name = str((query.get("name") or [""])[0]) or unquote(headers.get("x-filename", "file"))
            item = uploads.store(paths, body, name, twin_of=str((query.get("twin") or [""])[0]) or None)           # ?twin=<WebP upload id>: the JPEG twin used by the PDF only
            return _json(200, {"ok": True, "item": item, "uploads": uploads.listing(paths)})
        if action == "delete-upload":
            data = _body_json(body)
            refs = build.referenced_uploads(read_draft(paths, ctx))
            for b in build.list_builds(paths):
                refs |= build.referenced_uploads(read_json(os.path.join(paths.builds, b["id"], "draft.json"), {}) or {})
            uploads.delete(paths, str(data.get("id", "")), refs)
            return _json(200, {"ok": True, "uploads": uploads.listing(paths)})
        if action == "build":
            result = build.build(paths, ctx)
            if not result["ok"]:
                return _json(422, {"ok": False, "error": "check_failed", "message": "Пакет не зібрано: виправте помилки", "problems": result["problems"]})
            return _json(200, {"ok": True, "result": result, "status": status(paths, host, ctx), "builds": build.list_builds(paths)})
        if action == "rollback":
            data = _body_json(body)
            bid = str(data.get("id", ""))
            snap = read_json(os.path.join(paths.builds, bid, "draft.json"), None) if re.match(r"^[0-9]{8}-[0-9]{6}-[0-9a-f]{8}$", bid) else None
            if snap is None:
                raise ApiError("no_build", "Збірку не знайдено", 404)
            current = read_draft(paths, ctx)
            clean = schema.sanitize(snap, ctx)
            clean["rev"] = current["rev"]
            save_draft(paths, clean)
            build.set_current(paths, bid)
            state = build.read_state(paths)
            state["built"] = bid
            write_json(paths.state, state)
            return _json(200, {"ok": True, "draft": clean, "status": status(paths, host, ctx), "builds": build.list_builds(paths)})
        if action == "deploy":
            data = _body_json(body)
            deploy.request(paths, str(data.get("id", "")))
            return _json(200, {"ok": True, "status": status(paths, host, ctx)})
        if action == "preview":
            data = _body_json(body)
            bid = str(data.get("id", ""))
            if not re.match(r"^[0-9]{8}-[0-9]{6}-[0-9a-f]{8}$", bid) or not os.path.isdir(os.path.join(paths.builds, bid)):
                raise ApiError("no_build", "Збірку не знайдено", 404)
            build.set_current(paths, bid)
            return _json(200, {"ok": True, "status": status(paths, host, ctx)})
    raise ApiError("unknown_action", "Невідома дія", 404)


MIME = {"jpg": "image/jpeg", "png": "image/png", "webp": "image/webp", "avif": "image/avif", "glb": "application/octet-stream"}


def _file(paths, uid):
    """Shows an owner upload inside the admin. Only known ids; never a path; the browser may not sniff or run it."""
    item = (read_json(paths.uploads_index, {}) or {}).get("items", {}).get(uid) if re.match(r"^[0-9a-f]{16}$", uid) else None
    if not item:
        raise ApiError("no_file", "Файл не знайдено", 404)
    with open(os.path.join(paths.uploads, item["file"]), "rb") as fh:
        data = fh.read()
    return 200, [("Content-Type", MIME.get(item["file"].rsplit(".", 1)[-1], "application/octet-stream")), ("X-Content-Type-Options", "nosniff"),
                 ("Content-Security-Policy", "sandbox; default-src 'none'"), ("Cache-Control", "private, max-age=3600")], data


def factory_images(paths):
    out = []
    folder = os.path.join(paths.src, "assets")
    for name in sorted(os.listdir(folder)) if os.path.isdir(folder) else []:
        ref = "assets/" + name
        if schema.ASSET_REF.match(ref) and not name.startswith(("favicon", "og-")):
            out.append(ref)
    return out


def _body_json(body):
    if len(body) > core.MAX_JSON:
        raise ApiError("too_large", "Запит завеликий", 413)
    try:
        value = json.loads(body.decode("utf-8") or "{}")
    except ValueError:
        raise ApiError("bad_json", "Некоректний JSON")
    if not isinstance(value, dict):
        raise ApiError("bad_json", "Очікувався об'єкт JSON")
    return value
