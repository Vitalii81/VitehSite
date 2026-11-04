"""Pre-build validation. Returns a list of problems {code, where, message}; an empty list means the package may be built."""
import os
import re

from . import richtext
from .core import LANGS, valid_slug
from .schema import SECTION_IDS, FORM_TYPES

# Home sections that the factory markup links to (see index.html): hero buttons, product and pricing cards, header button.
FACTORY_LINKS = {"contact": ("hero", "work", "pricing"), "services": ("hero",)}


def filled(value):
    if isinstance(value, dict):
        return any((value.get(l) or "").strip() for l in LANGS)
    return bool(value and str(value).strip())


def _problem(out, code, where, message):
    out.append({"code": code, "where": where, "message": message})


def image_exists(ref, ctx, src):
    if not ref:
        return False
    if ref.startswith("u:"):
        item = ctx.uploads.get(ref[2:])
        return bool(item) and os.path.isfile(os.path.join(ctx.paths.uploads, item["file"]))
    return os.path.isfile(os.path.join(src, ref))


def _check_fields(schema, values, where, ctx, src, out, hrefs):
    for field in schema:
        key, kind, value = field["key"], field["type"], (values or {}).get(field["key"])
        label = field["label"].get("uk", key)
        here = "%s → %s" % (where, label)
        if kind in ("text", "longtext"):
            if field.get("required") and not filled(value):
                _problem(out, "required", here, "Обов'язкове поле порожнє (потрібна хоча б одна мова)")
            if kind == "longtext":
                for lang in LANGS:
                    hrefs.extend((here, u) for u in richtext.links_in((value or {}).get(lang, "")))
        elif kind == "plain":
            if field.get("required") and not filled(value):
                _problem(out, "required", here, "Обов'язкове поле порожнє")
        elif kind == "image":
            if field.get("required") and not value:
                _problem(out, "required", here, "Потрібне зображення")
            elif value and not image_exists(value, ctx, src):
                _problem(out, "image_missing", here, "Файл зображення не знайдено: %s" % value)
        elif kind == "link":
            text_ok, href = filled((value or {}).get("text")), (value or {}).get("href", "")
            if field.get("required") and not (text_ok and href):
                _problem(out, "required", here, "Потрібні текст і адреса кнопки")
            if href and not text_ok:
                _problem(out, "link_text", here, "У посилання є адреса, але немає тексту")
            if href:
                hrefs.append((here, href))
        elif kind == "form":
            if field.get("required") and not value:
                _problem(out, "required", here, "Оберіть форму")
        elif kind == "list":
            items = value or []
            if field.get("required") and not items:
                _problem(out, "required", here, "Додайте хоча б один елемент")
            for i, item in enumerate(items, 1):
                _check_fields(field["fields"], item, "%s #%d" % (here, i), ctx, src, out, hrefs)


def validate(draft, ctx, src):
    out, hrefs = [], []
    pages = draft["pages"]
    slugs = {}
    for p in pages:
        title = (p["title"].get("uk") or p["title"].get("en") or p["slug"] or p["id"])
        where = "Сторінка «%s»" % title
        if not valid_slug(p["slug"]):
            _problem(out, "slug", where, "Адреса має складатися з a-z, 0-9 і «-» та не збігатися з службовими (api, admin, assets…)")
        elif p["slug"] in slugs:
            _problem(out, "slug_dup", where, "Адреса «%s» вже використовується" % p["slug"])
        slugs[p["slug"]] = p
        if not filled(p["title"]):
            _problem(out, "required", where, "Потрібна назва хоча б однією мовою")
    enabled_pages = {p["slug"] for p in pages if p["enabled"]}

    forms = draft["forms"]
    for fid, form in forms.items():
        where = "Форма «%s»" % (form["title"].get("uk") or fid)
        if not form["fields"]:
            _problem(out, "form_empty", where, "У формі немає полів")
        if not any(f["type"] == "email" and f["required"] for f in form["fields"]):
            _problem(out, "form_email", where, "Потрібне обов'язкове поле типу email (щоб відповісти заявнику)")
        if not filled(form["submit"]):
            _problem(out, "required", where, "Потрібен текст кнопки")
        if form["consentRequired"] and not filled(form["consent"]):
            _problem(out, "required", where, "Потрібен текст згоди")
        for f in form["fields"]:
            if not filled(f["label"]):
                _problem(out, "required", where + " → " + f["key"], "Потрібен підпис поля")
            if f["type"] == "select" and not f.get("options"):
                _problem(out, "form_options", where + " → " + f["key"], "Для списку потрібні варіанти")

    def check_blocks(blocks, where, anchors_scope):
        enabled = [b for b in blocks if b["enabled"]]
        if not enabled:
            _problem(out, "empty_page", where, "Немає жодного увімкненого блока")
        if sum(1 for b in enabled if ctx.blocks[b["type"]].get("singleton") == "productGrid") > 1:
            _problem(out, "grid_dup", where, "На сторінці може бути лише один блок «Картки проєктів» або «3D-галерея»")
        anchors = {b["anchor"] for b in enabled if b.get("anchor")}
        scope_hrefs = []
        for b in enabled:
            schema = ctx.blocks[b["type"]]
            bwhere = "%s → %s" % (where, schema["label"].get("uk", b["type"]))
            _check_fields(schema["fields"], b["fields"], bwhere, ctx, src, out, scope_hrefs)
            for f in schema["fields"]:
                if f["type"] == "form" and b["fields"].get(f["key"]) and b["fields"][f["key"]] not in forms:
                    _problem(out, "form_missing", bwhere, "Форму «%s» не знайдено" % b["fields"][f["key"]])
        return scope_hrefs, anchors

    for p in pages:
        if not p["enabled"]:
            continue
        where = "Сторінка «%s»" % (p["title"].get("uk") or p["slug"])
        h, anchors = check_blocks(p["blocks"], where, "page")
        hrefs.extend((w, u, "page", anchors) for w, u in h)

    home_blocks = [b for b in draft["extra"]["home"]]
    if home_blocks:
        h, anchors = check_blocks(home_blocks, "Головна → додаткові розділи", "home")
        hrefs.extend((w, u, "home", anchors) for w, u in h)
        if draft["sections"].get("work", True) and any(ctx.blocks[b["type"]].get("singleton") == "productGrid" and b["enabled"] for b in home_blocks):
            _problem(out, "grid_dup", "Головна", "Розділ «Проєкти» вже є на головній: приберіть додатковий блок карток або вимкніть розділ")

    sections = {s: draft["sections"].get(s, True) for s in SECTION_IDS}
    for target, users in FACTORY_LINKS.items():
        if not sections[target]:
            on = [u for u in users if sections.get(u)]
            if on:
                _problem(out, "link_disabled", "Головна", "Розділ «%s» вимкнено, але на нього посилаються розділи: %s" % (target, ", ".join(on)))

    for item in hrefs:
        where, href = item[0], item[1]
        scope = item[2] if len(item) > 2 else None
        anchors = item[3] if len(item) > 3 else set()
        m = re.match(r"^/s/([a-z0-9-]+)/?(?:#.*)?$", href)
        if m and m.group(1) not in enabled_pages:
            _problem(out, "link_disabled", where, "Посилання веде на вимкнену або неіснуючу сторінку: %s" % href)
        m = re.match(r"^/#([a-z]+)$", href)
        if m and m.group(1) in SECTION_IDS and not sections[m.group(1)]:
            _problem(out, "link_disabled", where, "Посилання веде на вимкнений розділ: %s" % href)
        if href.startswith("#") and len(href) > 1:
            anchor = href[1:]
            if scope == "home" and anchor in SECTION_IDS:
                if not sections[anchor]:
                    _problem(out, "link_disabled", where, "Посилання веде на вимкнений розділ: %s" % href)
            elif anchor != "top" and anchor not in anchors:
                _problem(out, "link_anchor", where, "Якір %s не знайдено на цій сторінці (задайте його в полі «Якір» потрібного блока)" % href)
    return out
