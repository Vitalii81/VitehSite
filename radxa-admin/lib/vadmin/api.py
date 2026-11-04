"""Request handling shared by the CGI script and the tests. `handle()` takes plain values and returns (status, headers, body_bytes)."""
import json
import os
import re
from http.cookies import SimpleCookie

from . import auth, build, core, schema, uploads
from .core import ApiError, LANGS, locked, read_json, write_json

COOKIE = "vadmin"
SECTION_LABELS = {
    "hero": "Перший екран (hero)", "trust": "Смуга можливостей", "services": "Послуги", "ai": "AI-агенти", "process": "Процес",
    "work": "Проєкти", "stack": "Технології", "pricing": "Формати співпраці", "faq": "Запитання й відповіді", "contact": "Контакти й форма",
}
EFFECT_LABELS = {"floating": "Плавне погойдування картинки на першому екрані", "reveal": "Поява блоків під час прокрутки"}
WIDGET_LABELS = {"gallery3d": "3D-галерея проєктів", "portfolioLink": "Посилання на портфоліо (PDF) у «Проєктах» і «Контактах»"}
MAX_UPLOAD_BODY = uploads.MODEL_MAX + 1024


def _json(status, value, headers=None):
    body = json.dumps(value, ensure_ascii=False).encode("utf-8")
    h = [("Content-Type", "application/json; charset=utf-8"), ("Cache-Control", "no-store"), ("X-Content-Type-Options", "nosniff")]
    return status, h + (headers or []), body


def _session_cookie(value, clear=False):
    c = "%s=%s; Path=/; HttpOnly; SameSite=Strict; Max-Age=%d" % (COOKIE, "" if clear else value, 0 if clear else auth.SESSION_SECONDS)
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
        groups.setdefault(path.split(".")[0], {})[path] = value
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
            "services": [{"id": "s%d" % i, "title": it.get("title"), "icon": it.get("icon"), "model": bool(it.get("model"))} for i, it in enumerate(ctx.site.get("services", {}).get("items", []))],
            "projects": [{"id": p["id"], "title": p.get("title"), "image": p.get("image"), "model": bool(p.get("model"))} for p in ctx.products],
            "categories": [{"id": c["id"], "label": c["label"]} for c in ctx.site.get("work", {}).get("categories", [])],
        },
        "texts": groups,
    }


def status(paths, host, ctx=None):
    state = build.read_state(paths) or {}
    name = (host or "localhost").split(":")[0]
    ctx = ctx or schema.Context(paths)
    manifest = read_json(os.path.join(paths.builds, state["built"], "manifest.json"), {}) if state.get("built") else {}
    changed = (manifest or {}).get("draftDigest") != build.draft_digest(read_draft(paths, ctx))
    return {"built": state.get("built"), "builtAt": state.get("builtAt"), "published": state.get("published"), "changedSinceBuild": changed,
            "previewUrl": os.environ.get("VADMIN_PREVIEW_URL") or "http://%s:%s/" % (name, os.environ.get("VADMIN_PREVIEW_PORT", "8083")), "deployCommand": ("./deploy-from-radxa.sh %s" % state["built"]) if state.get("built") else None}


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
        if headers.get("x-vadmin") != "1":
            raise ApiError("csrf", "Відхилено: немає службового заголовка", 403)
        if not _same_origin(headers):
            raise ApiError("origin", "Відхилено: запит з іншого походження", 403)
        if len(body) > MAX_UPLOAD_BODY:
            raise ApiError("too_large", "Запит завеликий", 413)

    if action == "login" and method == "POST":
        data = _body_json(body)
        cookie = auth.login(paths, str(data.get("passphrase", "")), client)
        return _json(200, {"ok": True}, _session_cookie(cookie))

    jar = SimpleCookie()
    try:
        jar.load(headers.get("cookie", ""))
    except Exception:
        pass
    if not auth.check_session(paths, jar[COOKIE].value if COOKIE in jar else ""):
        raise ApiError("auth", "Потрібен вхід", 401)

    if action == "logout" and method == "POST":
        return _json(200, {"ok": True}, _session_cookie("", clear=True))

    ctx = schema.Context(paths)
    host = headers.get("host", "")

    if method == "GET":
        if action == "bootstrap":
            return _json(200, {"ok": True, "draft": read_draft(paths, ctx), "catalog": catalog(paths, ctx), "status": status(paths, host, ctx),
                               "uploads": uploads.listing(paths), "builds": build.list_builds(paths)})
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
        if action == "template":
            data = _body_json(body)
            draft = read_draft(paths, ctx)
            if int(data.get("rev", -1)) != draft["rev"]:
                raise ApiError("conflict", "Чернетку змінено в іншій вкладці. Оновіть сторінку", 409, {"rev": draft["rev"]})
            new_id = schema.add_from_template(draft, str(data.get("kind", "")), str(data.get("id", "")), ctx)
            save_draft(paths, draft)
            return _json(200, {"ok": True, "newId": new_id, "draft": draft})
        if action == "upload":
            from urllib.parse import unquote
            name = unquote(headers.get("x-filename", "file"))
            item = uploads.store(paths, body, name)
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
