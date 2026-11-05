"""Draft model: normalisation of everything the browser sends. Unknown keys are dropped, sizes are capped.
Completeness (required fields, links, images) is NOT checked here; that is `check.py`, run before a build."""
import copy
import os
import re

from . import core
from .core import ApiError, LANGS, new_id, read_json, valid_slug

SECTION_IDS = ("hero", "trust", "services", "ai", "process", "work", "stack", "pricing", "faq", "contact")
MOVABLE_IDS = tuple(s for s in SECTION_IDS if s not in ("hero", "trust"))     # the hero and the capability strip keep their place
EFFECTS = ("floating", "reveal")
WIDGETS = ("gallery3d", "portfolioLink")
FORM_TYPES = ("text", "email", "tel", "textarea", "select", "checkbox")
RESERVED_FIELD_KEYS = {"hp", "t", "consent", "lang", "form"}
LIMITS = {"pages": 30, "blocks": 40, "forms": 10, "fields": 20, "extra": 30, "texts": 600, "list": 20, "options": 20}

CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f  ]")
UPLOAD_REF = re.compile(r"^u:[0-9a-f]{16}$")
ASSET_REF = re.compile(r"^assets/[A-Za-z0-9_.-]+\.(?:svg|png|jpe?g|webp|avif)$")
HREF_OK = re.compile(r"^(?:#[a-z0-9-]*|/(?!/)[A-Za-z0-9_\-./#?=&%]*|https?://[^\s\"'<>]+|mailto:[^\s\"'<>]+|tel:[+0-9 ()-]+)$")
KEY_RE = re.compile(r"^[a-z][a-z0-9_]{0,23}$")
TEXT_PATH = re.compile(r"^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*$")
ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,31}$")


class Context:
    """Read-only facts the sanitiser needs: block schemas, templates, factory data, known uploads."""

    def __init__(self, paths):
        self.paths = paths
        data = os.path.join(paths.src, "data")
        blocks = read_json(os.path.join(data, "blocks.json"), {}) or {}
        self.blocks = blocks.get("blocks", {})
        self.icons = blocks.get("icons", [])
        self.templates = read_json(os.path.join(data, "templates.json"), {}) or {}
        self.site = read_json(os.path.join(data, "site.json"), {}) or {}
        self.products = read_json(os.path.join(data, "products.json"), []) or []
        self.portfolio_images = read_json(os.path.join(data, "portfolio-images.json"), []) or []
        self.portfolio_projects = (read_json(os.path.join(data, "portfolio.json"), {}) or {}).get("projects", []) or []
        self.assistant_kb = (read_json(os.path.join(data, "assistant-kb.json"), {}) or {}).get("facts", [])
        self.uploads = (read_json(paths.uploads_index, {}) or {}).get("items", {})

    def categories(self):
        return [c.get("id") for c in self.site.get("work", {}).get("categories", [])]


def text(value, limit=200, multiline=False):
    value = "" if value is None else str(value)
    value = value.replace("\r\n", "\n").replace("\r", "\n")
    value = CONTROL.sub("", value)
    if not multiline:
        value = value.replace("\n", " ")
    return value.strip()[:limit]


def i18n(value, limit=200, multiline=False):
    src = value if isinstance(value, dict) else {}
    return {lang: text(src.get(lang, ""), limit, multiline) for lang in LANGS}


def boolean(value, default=False):
    return value if isinstance(value, bool) else default


def image_ref(value, ctx):
    value = text(value, 80)
    if value == "":
        return ""
    if UPLOAD_REF.match(value) and ctx.uploads.get(value[2:], {}).get("kind") == "image":
        return value
    if ASSET_REF.match(value):
        return value
    return ""


def gallery_file_ok(ref, ctx):
    """The public gallery script (assets/portfolio.js) accepts only .webp/.jpg/.png files in a slot; an AVIF upload would show nothing, so it is not accepted there."""
    return os.path.splitext(ctx.uploads.get(ref[2:], {}).get("file", ""))[1].lower() in (".webp", ".jpg", ".jpeg", ".png")


def link(value, limit=60):
    src = value if isinstance(value, dict) else {}
    href = text(src.get("href", ""), 300)
    return {"text": i18n(src.get("text"), limit), "href": href if HREF_OK.match(href) or href == "" else ""}


def clean_fields(schema, values, ctx, depth=0):
    """Applies a block's field schema to untrusted values; only keys of the schema survive."""
    src = values if isinstance(values, dict) else {}
    out = {}
    for field in schema:
        key, kind, raw = field["key"], field["type"], src.get(field["key"])
        limit = int(field.get("max", 400))
        if kind == "text":
            out[key] = i18n(raw, limit)
        elif kind == "longtext":
            out[key] = i18n(raw, limit, multiline=True)
        elif kind == "plain":
            out[key] = text(raw, limit)
        elif kind == "bool":
            out[key] = boolean(raw)
        elif kind == "select":
            options = field.get("options", [])
            out[key] = raw if raw in options else (options[0] if options else "")
        elif kind == "image":
            out[key] = image_ref(raw, ctx)
        elif kind == "link":
            out[key] = link(raw)
        elif kind == "form":
            out[key] = text(raw, 32) if ID_RE.match(text(raw, 32)) else ""
        elif kind == "list" and depth < 1:
            items = raw if isinstance(raw, list) else []
            cap = min(int(field.get("max", LIMITS["list"])), LIMITS["list"])
            out[key] = [clean_fields(field["fields"], item, ctx, depth + 1) for item in items[:cap]]
        else:
            out[key] = None
    return out


def clean_block(raw, ctx):
    raw = raw if isinstance(raw, dict) else {}
    btype = text(raw.get("type"), 30)
    schema = ctx.blocks.get(btype)
    if not schema:
        return None
    anchor = text(raw.get("anchor"), 40)
    bid = text(raw.get("id"), 32)
    return {
        "id": bid if ID_RE.match(bid) else new_id("b-"),
        "type": btype,
        "enabled": boolean(raw.get("enabled"), True),
        "anchor": anchor if valid_anchor(anchor) else "",
        "fields": clean_fields(schema["fields"], raw.get("fields"), ctx),
    }


def valid_anchor(anchor):
    return bool(anchor) and bool(re.match(r"^[a-z][a-z0-9-]{0,39}$", anchor))


def clean_blocks(raw, ctx):
    items = raw if isinstance(raw, list) else []
    blocks = [clean_block(b, ctx) for b in items[:LIMITS["blocks"]]]
    seen, out = set(), []
    for b in blocks:
        if b is None:
            continue
        while b["id"] in seen:
            b["id"] = new_id("b-")
        seen.add(b["id"])
        out.append(b)
    return out


def clean_form(raw, ctx):
    raw = raw if isinstance(raw, dict) else {}
    fields, seen = [], set()
    for f in (raw.get("fields") if isinstance(raw.get("fields"), list) else [])[:LIMITS["fields"]]:
        if not isinstance(f, dict):
            continue
        key, ftype = text(f.get("key"), 24), f.get("type")
        if not KEY_RE.match(key) or key in RESERVED_FIELD_KEYS or key in seen or ftype not in FORM_TYPES:
            continue
        seen.add(key)
        item = {"key": key, "type": ftype, "label": i18n(f.get("label"), 120), "required": boolean(f.get("required")),
                "max": min(max(int(f.get("max", 200)) if str(f.get("max", "")).isdigit() else 200, 1), 2000)}
        if ftype == "select":
            opts = f.get("options") if isinstance(f.get("options"), list) else []
            item["options"] = [i18n(o, 80) for o in opts[:LIMITS["options"]]]
        fields.append(item)
    return {
        "title": i18n(raw.get("title"), 120), "intro": i18n(raw.get("intro"), 400, True), "fields": fields,
        "consent": i18n(raw.get("consent"), 300), "consentRequired": boolean(raw.get("consentRequired"), True),
        "submit": i18n(raw.get("submit"), 40), "success": i18n(raw.get("success"), 300),
    }


def clean_page(raw, ctx):
    raw = raw if isinstance(raw, dict) else {}
    pid = text(raw.get("id"), 32)
    slug = text(raw.get("slug"), 48).lower()
    return {
        "id": pid if ID_RE.match(pid) else new_id("p-"),
        "slug": slug, "title": i18n(raw.get("title"), 120), "description": i18n(raw.get("description"), 300),
        "enabled": boolean(raw.get("enabled"), True), "inNav": boolean(raw.get("inNav")),
        "blocks": clean_blocks(raw.get("blocks"), ctx),
    }


def clean_service(raw, ctx):
    raw = raw if isinstance(raw, dict) else {}
    sid = text(raw.get("id"), 32)
    points = raw.get("points") if isinstance(raw.get("points"), list) else []
    return {
        "id": sid if ID_RE.match(sid) and sid.startswith("x-") else new_id("x-"),
        "icon": raw.get("icon") if raw.get("icon") in ctx.icons else "code",
        "title": i18n(raw.get("title"), 80), "text": i18n(raw.get("text"), 300, True),
        "points": [i18n(p, 80) for p in points[:6]],
        "model": upload_model_ref(raw.get("model"), ctx),
    }


def clean_project(raw, ctx):
    raw = raw if isinstance(raw, dict) else {}
    pid = text(raw.get("id"), 32)
    tags = raw.get("tags") if isinstance(raw.get("tags"), list) else []
    cats = ctx.categories()
    return {
        "id": pid if ID_RE.match(pid) and pid.startswith("x-") else new_id("x-"),
        "category": raw.get("category") if raw.get("category") in cats else (cats[0] if cats else ""),
        "image": image_ref(raw.get("image"), ctx) or "assets/product-dashboard.svg",
        "model": upload_model_ref(raw.get("model"), ctx),
        "title": i18n(raw.get("title"), 80), "summary": i18n(raw.get("summary"), 300, True), "status": i18n(raw.get("status"), 40),
        "tags": [text(t, 24) for t in tags[:8] if text(t, 24)],
    }


def upload_model_ref(value, ctx):
    value = text(value, 80)
    return value if UPLOAD_REF.match(value) and ctx.uploads.get(value[2:], {}).get("kind") == "model" else ""


def flag_map(raw, names, default=True):
    raw = raw if isinstance(raw, dict) else {}
    return {name: boolean(raw.get(name), default) for name in names}


def get_path(obj, path):
    cur = obj
    for part in path.split("."):
        if isinstance(cur, list) and part.isdigit() and int(part) < len(cur):
            cur = cur[int(part)]
        elif isinstance(cur, dict) and part in cur:
            cur = cur[part]
        else:
            return None
    return cur


def is_i18n_leaf(value):
    return isinstance(value, dict) and value and set(value.keys()) <= set(LANGS) and all(isinstance(v, str) for v in value.values())


def editable_texts(site):
    """Every translatable leaf of the factory site.json as {path: {uk,en,de}} (used by the editor and by the merge)."""
    out = {}

    def walk(node, path):
        if is_i18n_leaf(node):
            out[".".join(path)] = {lang: node.get(lang, "") for lang in LANGS}
        elif isinstance(node, dict):
            for k, v in node.items():
                if k in ("languages", "categories") and not path:
                    continue
                walk(v, path + [k])
        elif isinstance(node, list):
            for i, v in enumerate(node):
                walk(v, path + [str(i)])
    walk(site, [])
    return out


PLAIN_PATH = re.compile(r"^(?:stack\.groups\.\d{1,2}\.items\.\d{1,2}|contact\.details\.\d{1,2}\.value)$")


def editable_plain(site):
    """Visible strings of site.json that are NOT translated (technology names, e-mail, phone): {path: factory string}. Kept in draft.plain."""
    out = {}
    for gi, group in enumerate(site.get("stack", {}).get("groups", [])):
        for ii, item in enumerate(group.get("items", [])):
            if isinstance(item, str):
                out["stack.groups.%d.items.%d" % (gi, ii)] = item
    for di, det in enumerate(site.get("contact", {}).get("details", [])):
        if isinstance(det.get("value"), str):
            out["contact.details.%d.value" % di] = det["value"]
    return out


def clean_products(raw, ctx):
    """Text overrides of the FACTORY project cards (data/products.json): {id: {title, summary, status, tags, category}}, only real differences."""
    raw = raw if isinstance(raw, dict) else {}
    cats = ctx.categories()
    out = {}
    for p in ctx.products:
        src = raw.get(p.get("id"))
        if not isinstance(src, dict):
            continue
        kept = {}
        for field, limit, multi in (("title", 80, False), ("summary", 300, True), ("status", 40, False)):
            val = i18n(src.get(field), limit, multi)
            if any(val.values()) and val != {k: (p.get(field) or {}).get(k, "") for k in LANGS}:
                kept[field] = val
        if isinstance(src.get("tags"), list):
            tags = [text(t, 24) for t in src["tags"][:8] if text(t, 24)]
            if tags != list(p.get("tags") or []):
                kept["tags"] = tags
        if src.get("category") in cats and src.get("category") != p.get("category"):
            kept["category"] = src["category"]
        if kept:
            out[p["id"]] = kept
    return out


def clean_order(value):
    """The home page order of the movable sections: [] (the factory order) or a full permutation of MOVABLE_IDS.
    Unknown and repeated ids are dropped, missing ones keep their factory place at the end; a result equal to the factory order becomes []."""
    seen = []
    for sid in value if isinstance(value, list) else []:
        if isinstance(sid, str) and sid in MOVABLE_IDS and sid not in seen:
            seen.append(sid)
    if not seen:
        return []
    full = seen + [sid for sid in MOVABLE_IDS if sid not in seen]
    return [] if tuple(full) == MOVABLE_IDS else full


def _slug_order(value, slugs):
    """A full permutation of `slugs` from a browser list (unknown/repeated dropped, missing keep their factory place at the end), or [] when it equals the factory order."""
    seen = []
    for slug in value if isinstance(value, list) else []:
        if isinstance(slug, str) and slug in slugs and slug not in seen:
            seen.append(slug)
    full = seen + [x for x in slugs if x not in seen]
    return [] if not seen or full == slugs else full


def clean_portfolio(raw_draft, ctx):
    """The PORTFOLIO's own content (draft.portfolio): the single place where an item's text, pictures, order and on/off are edited. Feeds /portfolio/ and the PDF,
    and offers the items that the home page may pick (draft.site.gallery). Slugs come ONLY from the factory data/portfolio.json (no new items, no paths); an override is
    kept only where it differs from the factory, so an untouched draft stays empty. Older drafts kept parts of this elsewhere (images.portfolio, images.portfolioAlt,
    disabled.portfolio, texts["portfolioPage.*"]); they are read here and moved, so nothing is lost; a value already present in `portfolio` wins."""
    raw = raw_draft.get("portfolio") if isinstance(raw_draft.get("portfolio"), dict) else {}
    legacy_imgs = raw_draft.get("images") if isinstance(raw_draft.get("images"), dict) else {}
    legacy_dis = raw_draft.get("disabled") if isinstance(raw_draft.get("disabled"), dict) else {}
    legacy_texts = raw_draft.get("texts") if isinstance(raw_draft.get("texts"), dict) else {}
    factory = {p.get("slug"): p for p in ctx.portfolio_projects if isinstance(p, dict) and isinstance(p.get("slug"), str)}
    slugs = list(factory)
    out = {"disabled": [], "order": [], "items": {}, "images": {}, "alts": {}, "disabledSections": [], "texts": {}}
    off = raw.get("disabled") if isinstance(raw.get("disabled"), list) else []
    out["disabled"] = sorted({x for x in off if isinstance(x, str) and x in factory})
    out["order"] = _slug_order(raw.get("order"), slugs)
    items = raw.get("items") if isinstance(raw.get("items"), dict) else {}
    for slug, src in items.items():
        if slug not in factory or not isinstance(src, dict):
            continue
        base, kept = factory[slug], {}
        for field, limit in (("title", 80), ("summary", 600)):
            val = i18n(src.get(field), limit)
            if any(val.values()) and val != {k: (base.get(field) or {}).get(k, "") for k in LANGS}:
                kept[field] = val
        years = text(src.get("years"), 20)
        if "years" in src and years != (base.get("years") or ""):
            kept["years"] = years
        tags = [t for t in (text(x, 40) for x in (src.get("tags") if isinstance(src.get("tags"), list) else [])[:8]) if t]
        if "tags" in src and tags != list(base.get("tags") or []):
            kept["tags"] = tags
        if kept:
            out["items"][slug] = kept
    # picture slots, keyed "<slug>/<slot>" exactly as in data/portfolio-images.json; only uploaded images the public script can show
    known_slots = {"%s/%s" % (m.get("slug"), m.get("slot")) for m in ctx.portfolio_images if isinstance(m, dict)}
    imgs = dict(legacy_imgs.get("portfolio") if isinstance(legacy_imgs.get("portfolio"), dict) else {})
    imgs.update(raw.get("images") if isinstance(raw.get("images"), dict) else {})
    out["images"] = {k: v for k, v in ((k, image_ref(v, ctx)) for k, v in imgs.items()) if k in known_slots and v.startswith("u:") and gallery_file_ok(v, ctx)}
    alts = dict(legacy_imgs.get("portfolioAlt") if isinstance(legacy_imgs.get("portfolioAlt"), dict) else {})
    alts.update(raw.get("alts") if isinstance(raw.get("alts"), dict) else {})
    out["alts"] = {k: a for k, a in ((k, i18n(v, 200)) for k, v in alts.items() if k in known_slots) if any(a.get(l) for l in LANGS)}
    known_sections = {x.get("id") for x in ctx.site.get("portfolioPage", {}).get("sections", [])}
    secs = list(raw.get("disabledSections") if isinstance(raw.get("disabledSections"), list) else []) + list(legacy_dis.get("portfolio") if isinstance(legacy_dis.get("portfolio"), list) else [])
    out["disabledSections"] = sorted({x for x in secs if x in known_sections})
    leaves = editable_texts(ctx.site)
    texts = {k: v for k, v in legacy_texts.items() if isinstance(k, str) and k.startswith("portfolioPage.")}
    texts.update(raw.get("texts") if isinstance(raw.get("texts"), dict) else {})
    for path, value in list(texts.items())[:LIMITS["texts"]]:
        if isinstance(path, str) and path.startswith("portfolioPage.") and TEXT_PATH.match(path) and path in leaves:
            clean = i18n(value, 2000, True)
            if clean != {k: leaves[path].get(k, "") for k in LANGS}:
                out["texts"][path] = clean
    return out


def clean_site(raw, ctx):
    """What the HOME page takes from the portfolio: draft.site.gallery = {hidden: [slug], order: [slug]}. Only ids of items the home page can show (not the portfolio-only
    ones); texts and pictures are never stored here, they come from draft.portfolio."""
    raw = raw if isinstance(raw, dict) else {}
    g = raw.get("gallery") if isinstance(raw.get("gallery"), dict) else {}
    slugs = [p["slug"] for p in ctx.portfolio_projects if isinstance(p, dict) and isinstance(p.get("slug"), str) and not p.get("portfolioOnly")]
    hidden = g.get("hidden") if isinstance(g.get("hidden"), list) else []
    return {"gallery": {"hidden": sorted({x for x in hidden if isinstance(x, str) and x in slugs}), "order": _slug_order(g.get("order"), slugs)}}


ASSISTANT_AVATARS = ("consultant-f", "consultant-m", "expert", "engineer", "core")                  # looks in assets/assistant-avatars.js
ASSISTANT_LIMITS = {"hidden": 60, "hiddenLen": 60, "extra": 30, "fact": 1200}


def clean_assistant(raw, ctx):
    """The site assistant (draft.assistant). OFF by default. `facts` overrides the factory records of data/assistant-kb.json by id (only real differences are kept);
    `extra` holds records the owner added; `hidden` is the list of words the output filter always removes. A record is public only with public === true."""
    raw = raw if isinstance(raw, dict) else {}
    factory = {f.get("id"): f for f in ctx.assistant_kb if isinstance(f, dict) and isinstance(f.get("id"), str)}
    out = {"enabled": boolean(raw.get("enabled"), False), "avatar": raw.get("avatar") if raw.get("avatar") in ASSISTANT_AVATARS else "consultant-f", "hidden": [], "facts": {}, "extra": []}
    seen = set()
    for word in (raw.get("hidden") if isinstance(raw.get("hidden"), list) else [])[:ASSISTANT_LIMITS["hidden"]]:
        w = text(word, ASSISTANT_LIMITS["hiddenLen"])
        if w and w.lower() not in seen:
            seen.add(w.lower())
            out["hidden"].append(w)
    src = raw.get("facts") if isinstance(raw.get("facts"), dict) else {}
    for fid, base in factory.items():
        item = src.get(fid)
        if not isinstance(item, dict):
            continue
        kept = {}
        if "public" in item and boolean(item.get("public"), False) != (base.get("public") is True):          # a missing flag keeps the factory one
            kept["public"] = boolean(item.get("public"), False)
        for field, limit in (("topic", 120), ("text", ASSISTANT_LIMITS["fact"])):
            val = i18n(item.get(field), limit, field == "text")
            if any(val.values()) and val != {k: (base.get(field) or {}).get(k, "") for k in LANGS}:
                kept[field] = val
        if kept:
            out["facts"][fid] = kept
    ids = set()
    for item in (raw.get("extra") if isinstance(raw.get("extra"), list) else [])[:ASSISTANT_LIMITS["extra"]]:
        if not isinstance(item, dict):
            continue
        fid = text(item.get("id"), 32)
        if not (ID_RE.match(fid) and fid.startswith("x-")) or fid in ids:
            fid = new_id("x-")
        ids.add(fid)
        out["extra"].append({"id": fid, "public": boolean(item.get("public"), False), "topic": i18n(item.get("topic"), 120), "text": i18n(item.get("text"), ASSISTANT_LIMITS["fact"], True)})
    return out


def empty_draft():
    return {"rev": 0, "sections": {}, "order": [], "disabled": {"services": [], "projects": []}, "widgets": {}, "effects": {}, "texts": {},
            "extra": {"services": [], "projects": [], "home": []}, "images": {"hero": "", "projects": {}, "models": {}, "serviceModels": {}},
            "pages": [], "forms": {}, "plain": {}, "products": {}, "portfolio": {"disabled": [], "order": [], "items": {}, "images": {}, "alts": {}, "disabledSections": [], "texts": {}},
            "site": {"gallery": {"hidden": [], "order": []}},
            "assistant": {"enabled": False, "avatar": "consultant-f", "hidden": [], "facts": {}, "extra": []}}


def sanitize(raw, ctx):
    """Returns a clean draft; never raises on odd input (a damaged draft degrades to defaults)."""
    raw = raw if isinstance(raw, dict) else {}
    d = empty_draft()
    rev = raw.get("rev")
    d["rev"] = rev if isinstance(rev, int) and rev >= 0 else 0
    d["sections"] = flag_map(raw.get("sections"), SECTION_IDS)
    d["order"] = clean_order(raw.get("order"))
    d["widgets"] = flag_map(raw.get("widgets"), WIDGETS)
    d["effects"] = flag_map(raw.get("effects"), EFFECTS)

    extra = raw.get("extra") if isinstance(raw.get("extra"), dict) else {}
    d["extra"]["services"] = [clean_service(s, ctx) for s in (extra.get("services") if isinstance(extra.get("services"), list) else [])[:LIMITS["extra"]]]
    d["extra"]["projects"] = [clean_project(p, ctx) for p in (extra.get("projects") if isinstance(extra.get("projects"), list) else [])[:LIMITS["extra"]]]
    d["extra"]["home"] = clean_blocks(extra.get("home"), ctx)

    known_s = {"s%d" % i for i in range(len(ctx.site.get("services", {}).get("items", [])))} | {s["id"] for s in d["extra"]["services"]}
    known_p = {p.get("id") for p in ctx.products} | {p["id"] for p in d["extra"]["projects"]}
    dis = raw.get("disabled") if isinstance(raw.get("disabled"), dict) else {}
    d["disabled"]["services"] = sorted({x for x in (dis.get("services") or []) if x in known_s})
    d["disabled"]["projects"] = sorted({x for x in (dis.get("projects") or []) if x in known_p})

    texts = raw.get("texts") if isinstance(raw.get("texts"), dict) else {}
    leaves = editable_texts(ctx.site)
    for path, value in list(texts.items())[:LIMITS["texts"]]:
        if isinstance(path, str) and TEXT_PATH.match(path) and path in leaves and not path.startswith("portfolioPage."):          # portfolio texts live in draft.portfolio
            clean = i18n(value, 2000, True)
            if clean != {k: leaves[path].get(k, "") for k in LANGS}:
                d["texts"][path] = clean

    imgs = raw.get("images") if isinstance(raw.get("images"), dict) else {}
    d["images"]["hero"] = image_ref(imgs.get("hero"), ctx)
    for key, check, known in (("projects", image_ref, known_p), ("models", upload_model_ref, known_p), ("serviceModels", upload_model_ref, known_s)):
        src = imgs.get(key) if isinstance(imgs.get(key), dict) else {}
        d["images"][key] = {pid: check(v, ctx) for pid, v in src.items() if pid in known and check(v, ctx)}
    d["portfolio"] = clean_portfolio(raw, ctx)
    d["site"] = clean_site(raw.get("site"), ctx)
    d["products"] = clean_products(raw.get("products"), ctx)
    d["assistant"] = clean_assistant(raw.get("assistant"), ctx)
    plain, src = editable_plain(ctx.site), raw.get("plain") if isinstance(raw.get("plain"), dict) else {}
    for path, value in list(src.items())[:LIMITS["texts"]]:
        if isinstance(path, str) and PLAIN_PATH.match(path) and path in plain:
            clean = text(value, 120)
            if clean and clean != plain[path]:
                d["plain"][path] = clean

    pages, seen = [], set()
    for p in (raw.get("pages") if isinstance(raw.get("pages"), list) else [])[:LIMITS["pages"]]:
        page = clean_page(p, ctx)
        while page["id"] in seen:
            page["id"] = new_id("p-")
        seen.add(page["id"])
        pages.append(page)
    d["pages"] = pages

    forms = raw.get("forms") if isinstance(raw.get("forms"), dict) else {}
    for fid, form in list(forms.items())[:LIMITS["forms"]]:
        if isinstance(fid, str) and ID_RE.match(fid):
            d["forms"][fid] = clean_form(form, ctx)
    return d


def add_from_template(draft, kind, template_id, ctx):
    """Copies a template into the draft and returns the new id (the caller saves the draft)."""
    tpl = ctx.templates
    if kind == "service":
        item = copy.deepcopy(tpl["service"]["item"])
        item["id"] = new_id("x-")
        draft["extra"]["services"].append(clean_service(item, ctx))
        return draft["extra"]["services"][-1]["id"]
    if kind == "project":
        item = copy.deepcopy(tpl["project"]["item"])
        item["id"] = new_id("x-")
        draft["extra"]["projects"].append(clean_project(item, ctx))
        return draft["extra"]["projects"][-1]["id"]
    if kind == "section":
        spec = tpl.get("sections", {}).get(template_id)
        if not spec:
            raise ApiError("unknown_template", "Невідомий шаблон розділу")
        blocks = clean_blocks(copy.deepcopy(spec["blocks"]), ctx)
        draft["extra"]["home"].extend(blocks)
        return blocks[0]["id"] if blocks else ""
    if kind == "page":
        spec = tpl.get("pages", {}).get(template_id)
        if not spec:
            raise ApiError("unknown_template", "Невідомий шаблон сторінки")
        slug = base = re.sub(r"[^a-z0-9]+", "-", template_id.lower()).strip("-") or "page"
        taken = {p["slug"] for p in draft["pages"]}
        n = 2
        while slug in taken or not valid_slug(slug):
            slug = "%s-%d" % (base, n)
            n += 1
        page = clean_page({"slug": slug, "title": spec["title"], "description": spec["description"], "blocks": copy.deepcopy(spec["blocks"]), "enabled": True}, ctx)
        draft["pages"].append(page)
        return page["id"]
    if kind == "form":
        spec = tpl.get("forms", {}).get(template_id)
        if not spec:
            raise ApiError("unknown_template", "Невідомий шаблон форми")
        fid, n = template_id.replace("_", "-"), 2
        while fid in draft["forms"]:
            fid = "%s-%d" % (template_id.replace("_", "-"), n)
            n += 1
        draft["forms"][fid] = clean_form(copy.deepcopy(spec["form"]), ctx)
        return fid
    raise ApiError("unknown_kind", "Невідомий тип шаблону")
