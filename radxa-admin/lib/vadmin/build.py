"""Builds the static package: factory files + draft -> builds/<id>/site (+ manifest.json, draft.json snapshot).
Nothing is shown or hidden by CSS: disabled sections, items and widgets are removed from the HTML and from the JSON."""
import contextlib
import copy
import os
import re
import shutil
import tarfile
import time

from . import assistant, check, core, portfolio_pdf, render, schema
from .core import ApiError, LANGS, read_json, sha256_file, stamp, write_json
from .richtext import esc
from .schema import SECTION_IDS

BUILD_ID = re.compile(r"^[0-9]{8}-[0-9]{6}-[0-9a-f]{8}$")
PUBLIC_FILES = ("index.html", "impressum.html", "datenschutz.html", "robots.txt")
GALLERY_DIRS = ("vendor", "models", "env", "posters")           # 3D gallery: library, models, lighting, posters
GALLERY_FILES = ("gallery3d.js", "viewer-settings.js")
ASSISTANT_FILES = ("assistant.js", "assistant.css")              # shipped only while the assistant is switched on in the draft
PDF_NAMES = {"en": "Vitalii_Krutikov_Engineering_Portfolio_2026.pdf", "uk": "Vitalii_Krutikov_Engineering_Portfolio_2026_uk.pdf", "de": "Vitalii_Krutikov_Engineering_Portfolio_2026_de.pdf"}
# Lists that the public JS renders from site.json; a disabled section gets empty lists (the heading texts stay).
SECTION_LISTS = {"hero": ["hero.badges"], "trust": ["trust.items"], "services": ["services.items"], "ai": ["ai.features"], "process": ["process.steps"],
                 "stack": ["stack.groups"], "pricing": ["pricing.models"], "faq": ["faq.items"], "contact": ["contact.details"]}
EXTERNAL_TAG = re.compile(r"<(?:script|img|iframe|source|video|audio|embed|object)\b[^>]*?\b(?:src|data)\s*=\s*[\"']\s*(?:https?:)?//", re.I)
EXTERNAL_LINK = re.compile(r"<link\b[^>]*?\brel\s*=\s*[\"'][^\"']*(?:stylesheet|preload|icon|modulepreload|prefetch|preconnect|dns-prefetch)[^\"']*[\"'][^>]*?\bhref\s*=\s*[\"']\s*(?:https?:)?//", re.I)
EXTERNAL_LINK2 = re.compile(r"<link\b[^>]*?\bhref\s*=\s*[\"']\s*(?:https?:)?//[^>]*?\brel\s*=\s*[\"'][^\"']*(?:stylesheet|preload|icon|modulepreload|prefetch|preconnect|dns-prefetch)", re.I)
EXTERNAL_CSS = re.compile(r"(?:url\(\s*[\"']?|@import\s+[\"']?)\s*(?:https?:)?//", re.I)
EXTERNAL_JS = re.compile(r"\b(?:fetch|import|importScripts)\s*\(\s*[\"'`]\s*(?:https?:)?//|\.src\s*=\s*[\"']\s*https?://|new\s+(?:Worker|EventSource|WebSocket)\s*\(\s*[\"']\s*(?:https?:|wss?:)?//", re.I)


def read_text(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def write_text(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(data)


# ---------- home page transformation ----------

def section_span(html, sid):
    if sid == "hero":
        pattern = r'<section class="hero">'
    elif sid == "trust":
        pattern = r'<section class="trust"[^>]*>'
    else:
        pattern = r'<section class="[^"]*" id="%s">' % sid
    m = re.search(pattern, html)
    if not m:
        raise ApiError("src_changed", "У index.html не знайдено розділ «%s»: файли сайту на Radxa відрізняються від очікуваних" % sid, 500)
    end = html.index("</section>", m.end()) + len("</section>")
    while html[end:end + 1] == "\n":
        end += 1
    return m.start(), end


def remove_section(html, sid):
    a, b = section_span(html, sid)
    return html[:a] + html[b:]


def nav_span(html):
    a = html.index('<nav class="nav"')
    return a, html.index("</nav>", a)


def drop_nav_links(html, sid):
    a, b = nav_span(html)
    nav = re.sub(r'[ \t]*<a [^>]*href="#%s"[^>]*>.*?</a>\n?' % re.escape(sid), "", html[a:b], flags=re.S)
    return html[:a] + nav + html[b:]


def nav_page_links(pages):
    return "".join('<a href="/s/%s/">%s</a>\n        ' % (esc(p["slug"]), render.tl(p["title"])) for p in pages if p["enabled"] and p["inNav"])


def insert_nav_pages(html, pages):
    links = nav_page_links(pages)
    if not links:
        return html
    a, b = nav_span(html)
    nav = html[a:b]
    cta = nav.find('<a class="nav-cta"')
    nav = nav[:cta] + links + nav[cta:] if cta != -1 else nav + links
    return html[:a] + nav + html[b:]


def reorder_sections(html, order):
    """Moves the movable <section>s of the factory markup into `order` (a full permutation of MOVABLE_IDS). Only the sections change
    places: the whitespace between them and everything around them stays byte for byte. Runs before any section is removed."""
    spans = []
    for sid in schema.MOVABLE_IDS:
        a, _ = section_span(html, sid)
        core_end = html.index("</section>", a) + len("</section>")
        spans.append((sid, html.rfind("\n", 0, a) + 1, core_end))      # from the start of the line, so the indentation travels along
    spans.sort(key=lambda x: x[1])
    for (_, _, end), (_, start, _) in zip(spans, spans[1:]):
        if html[end:start].strip():
            raise ApiError("src_changed", "У index.html між розділами є сторонній вміст: порядок розділів змінити не можна", 500)
    chunk = {sid: html[a:b] for sid, a, b in spans}
    seps = [html[end:start] for (_, _, end), (_, start, _) in zip(spans, spans[1:])]
    out = chunk[order[0]]
    for sep, sid in zip(seps, order[1:]):
        out += sep + chunk[sid]
    return html[:spans[0][1]] + out + html[spans[-1][2]:]


def reorder_nav(html, order):
    """The menu follows the section order (the call-to-action link stays last, pages are added after this step)."""
    a, b = nav_span(html)
    nav = html[a:b]
    found = []
    for sid in schema.MOVABLE_IDS:
        m = re.search(r'[ \t]*<a (?![^>]*nav-cta)[^>]*href="#%s"[^>]*>.*?</a>\n?' % re.escape(sid), nav, flags=re.S)
        if m:
            found.append((m.start(), m.end(), sid, m.group(0)))
    found.sort()
    texts = {sid: txt for _, _, sid, txt in found}
    ranked = [texts[sid] for sid in order if sid in texts]
    out, pos = "", 0
    for (start, end, _, _), txt in zip(found, ranked):
        out += nav[pos:start] + txt
        pos = end
    return html[:a] + out + nav[pos:] + html[b:]


def transform_home(html, draft, ctx, assets, forms):
    sections = {s: draft["sections"].get(s, True) for s in SECTION_IDS}
    if draft.get("order"):
        html = reorder_nav(reorder_sections(html, draft["order"]), draft["order"])
    for sid in SECTION_IDS:
        if not sections[sid]:
            html = remove_section(html, sid)
            if sid not in ("hero", "trust"):
                html = drop_nav_links(html, sid)
    html = insert_nav_pages(html, draft["pages"])
    if sections["hero"] and draft["images"]["hero"]:
        url = assets.url(draft["images"]["hero"])
        html = html.replace('src="assets/hero-illustration.svg"', 'src="%s"' % esc(url.lstrip("/")), 1)
    if not draft["widgets"].get("gallery3d", True):
        html = re.sub(r'[ \t]*<script type="module" src="assets/gallery3d.js"></script>\n?', "", html)
    if not draft["widgets"].get("portfolioLink", True):          # the link to the portfolio PDF is removed from the HTML, not hidden by CSS
        html = re.sub(r'[ \t]*<p class="portfolio-link">.*?</p>\n?', "", html, flags=re.S)
    head_add = ""
    if not (draft["effects"].get("floating", True) and draft["effects"].get("reveal", True)):
        head_add += '  <link rel="stylesheet" href="assets/fx.css">\n'
    extra = [b for b in draft["extra"]["home"] if b["enabled"]]
    if extra:
        head_add += '  <link rel="stylesheet" href="assets/blocks.css">\n'
        body = render.render_blocks(extra, ctx, assets, forms)
        marker = '<section class="section contact-section" id="contact">'
        html = html.replace(marker, body + "    " + marker, 1) if sections["contact"] and marker in html else html.replace("</main>", body + "  </main>", 1)
        if render.uses(extra, "form"):
            html = html.replace("</body>", '  <script src="assets/forms.js" defer></script>\n</body>', 1)
    if draft["assistant"]["enabled"]:                       # off (the default): nothing at all is added to the HTML
        head_add += '  <link rel="stylesheet" href="assets/assistant.css">\n'
        html = html.replace('<script src="assets/app.js" defer></script>\n', '<script src="assets/app.js" defer></script>\n  <script src="assets/assistant.js" defer></script>\n', 1)
    if head_add:
        html = re.sub(r'(<link rel="stylesheet" href="assets/styles.css">\n)', lambda m: m.group(1) + head_add, html, count=1)
    return html


# ---------- data files ----------

def merged_site(draft, ctx, assets, all_portfolio_sections=False):
    site = copy.deepcopy(ctx.site)
    gallery = draft["widgets"].get("gallery3d", True)
    for mapping in (draft["texts"], draft["portfolio"]["texts"]):          # the home page's own texts, then the portfolio page's (kept in draft.portfolio)
        for path, value in mapping.items():
            parent = schema.get_path(site, path.rsplit(".", 1)[0]) if "." in path else site
            last = path.rsplit(".", 1)[-1]
            if isinstance(parent, list) and last.isdigit() and int(last) < len(parent):
                parent[int(last)] = value
            elif isinstance(parent, dict) and last in parent:
                parent[last] = value
    apply_plain(site, draft["plain"])
    if "portfolioPage" in site and not all_portfolio_sections:   # sections of the web portfolio switched off in the admin are removed from the data, not hidden
        site["portfolioPage"]["sections"] = [x for x in site["portfolioPage"]["sections"] if x.get("id") not in draft["portfolio"]["disabledSections"]]
    items = site["services"]["items"]
    kept = []
    for i, it in enumerate(items):
        sid = "s%d" % i
        if sid in draft["disabled"]["services"]:
            continue
        override = draft["images"]["serviceModels"].get(sid)
        if override:                                         # the factory poster belongs to the factory model
            it["model"] = assets.url(override).lstrip("/")
            it.pop("poster", None)
            it.pop("orbit", None)
        kept.append(it)
    for s in draft["extra"]["services"]:
        if s["id"] not in draft["disabled"]["services"]:
            item = {"icon": s["icon"], "title": s["title"], "text": s["text"], "points": [p for p in s["points"] if render.has(p)]}
            if s.get("model"):
                item["model"] = assets.url(s["model"]).lstrip("/")
            kept.append(item)
    if not gallery:
        for it in kept:
            it.pop("model", None)
            it.pop("poster", None)
            it.pop("orbit", None)
    site["services"]["items"] = kept
    for sid, paths in SECTION_LISTS.items():
        if not draft["sections"].get(sid, True):
            for path in paths:
                parent = schema.get_path(site, path.rsplit(".", 1)[0])
                if isinstance(parent, dict):
                    parent[path.rsplit(".", 1)[1]] = []
    return site


EMAIL_RE = re.compile(r"^[^\s@<>\"']+@[^\s@<>\"']+\.[^\s@<>\"']+$")
PHONE_RE = re.compile(r"^\+?[0-9 ()-]{5,30}$")


def apply_plain(site, plain):
    """Untranslated strings from the draft (technology names, contact values). A changed e-mail or phone also fixes the link behind it and drops the "demo" mark."""
    for path, value in plain.items():
        parent = schema.get_path(site, path.rsplit(".", 1)[0])
        last = path.rsplit(".", 1)[1]
        if isinstance(parent, list) and last.isdigit() and int(last) < len(parent):
            parent[int(last)] = value
        elif isinstance(parent, dict) and last in parent:
            parent[last] = value
            if last == "value" and "href" in parent:
                if parent["href"].startswith("mailto:") and EMAIL_RE.match(value):
                    parent["href"] = "mailto:" + value
                elif (parent["href"].startswith("tel:") or parent.get("demo")) and PHONE_RE.match(value):
                    parent["href"] = "tel:" + re.sub(r"[^+0-9]", "", value)
                parent["demo"] = False


def merged_products(draft, ctx, assets):
    gallery = draft["widgets"].get("gallery3d", True)
    out = []
    for p in copy.deepcopy(ctx.products) + [dict(x) for x in draft["extra"]["projects"]]:
        pid = p["id"]
        if pid in draft["disabled"]["projects"]:
            continue
        p.update(copy.deepcopy(draft["products"].get(pid, {})))               # text overrides of a factory card (title, summary, status, tags, category)
        for field in ("title", "summary", "status"):
            if pid in draft["products"] and field in draft["products"][pid]:
                base = next((q for q in ctx.products if q["id"] == pid), {}).get(field) or {}
                p[field] = {lang: draft["products"][pid][field].get(lang) or base.get(lang, "") for lang in LANGS}
        img = draft["images"]["projects"].get(pid) or p.get("image", "")
        p["image"] = assets.url(img).lstrip("/") if img.startswith("u:") else img
        model = draft["images"]["models"].get(pid) or p.get("model", "")
        if model.startswith("u:"):
            model = assets.url(model).lstrip("/")
        if gallery and model:
            p["model"] = model
            if draft["images"]["models"].get(pid):
                p.pop("poster", None)                       # the factory poster belongs to the factory model
                p.pop("orbit", None)
        else:
            p.pop("model", None)
            p.pop("poster", None)
            p.pop("orbit", None)
        out.append(p)
    return out


def merged_portfolio(draft, ctx, keep_disabled=False):
    """The project gallery (data/portfolio.json "projects") with the draft applied: the owner's order and text overrides; projects switched off are
    REMOVED, or only flagged "disabled" when `keep_disabled` (the on-page editor shows them dimmed; a package never gets the flag)."""
    cfg = draft["portfolio"]
    by_slug = dict((p["slug"], copy.deepcopy(p)) for p in ctx.portfolio_projects)
    out = []
    for slug in cfg["order"] or [p["slug"] for p in ctx.portfolio_projects]:
        p, ov = by_slug[slug], cfg["items"].get(slug, {})
        for field in ("title", "summary"):
            if field in ov:
                p[field] = {lang: ov[field].get(lang) or (p.get(field) or {}).get(lang, "") for lang in LANGS}
        for field in ("years", "tags"):
            if field in ov:
                p[field] = ov[field]
        if slug in cfg["disabled"]:
            if not keep_disabled:
                continue
            p["disabled"] = True
        out.append(p)
    return out


def home_gallery(draft, ctx, include_hidden=False):
    """Slugs of the portfolio items the HOME page shows, in order. The home page only SELECTS (draft.site.gallery: hidden, order); an item switched off in the
    portfolio is not offered, and items that belong to the portfolio page alone (portfolioOnly) never are. Texts and pictures come from draft.portfolio."""
    base = [p["slug"] for p in merged_portfolio(draft, ctx) if not p.get("portfolioOnly")]
    g = draft["site"]["gallery"]
    ordered = [x for x in g["order"] if x in base] + [x for x in base if x not in g["order"]]
    return [x for x in ordered if include_hidden or x not in g["hidden"]]


def home_is_explicit(draft):
    return bool(draft["site"]["gallery"]["hidden"] or draft["site"]["gallery"]["order"])


def merged_portfolio_images(draft, ctx, assets, keep_disabled=False):
    """The image manifest of the project archive. A slot filled in the admin (an uploaded image) becomes "final" and points at the upload;
    every other slot keeps its factory status. Placeholder files never exist in the package, so a placeholder slot shows nothing to visitors.
    Slots of projects that are switched off are dropped together with the project."""
    out = []
    off = set() if keep_disabled else set(draft["portfolio"]["disabled"])
    for m in copy.deepcopy(ctx.portfolio_images):
        if m.get("slug") in off:
            continue
        key = "%s/%s" % (m.get("slug"), m.get("slot"))
        alt = draft["portfolio"]["alts"].get(key)
        if alt:                                              # an alt text typed in the admin replaces the factory one, language by language
            m["alt"] = {lang: alt.get(lang) or m["alt"].get(lang, "") for lang in LANGS}
        ref = draft["portfolio"]["images"].get(key)
        if ref:
            m["file"] = assets.url(ref).lstrip("/")
            m["status"] = "final"
        out.append(m)
    return out


def pdf_inputs(draft, ctx, assets):
    """Everything the portfolio PDF shows. It comes from draft.portfolio ONLY (enabled items in the portfolio's order, enabled sections, the portfolio's texts and pictures),
    exactly like the page /portfolio/, and does not depend on which items the home page selects or on the "portfolioLink" widget."""
    return {"site": merged_site(draft, ctx, assets), "projects": merged_portfolio(draft, ctx), "manifest": merged_portfolio_images(draft, ctx, assets)}


def make_portfolio_pdfs(paths, draft, ctx, assets, site_dir):
    """The downloadable portfolio PDFs (uk, en, de). When the draft changes nothing the PDF shows, the factory (Chrome-made, designed) files stay;
    otherwise they are generated here from the merged data, with no network and no external tools, and replace the factory ones in the package."""
    if "portfolioPage" not in ctx.site or not ctx.portfolio_projects:
        return
    probe = pdf_inputs(schema.sanitize({}, ctx), ctx, render.Assets(ctx))
    real = pdf_inputs(draft, ctx, assets)
    pick = lambda d: {"page": d["site"]["portfolioPage"], "services": d["site"]["services"]["items"], "archive": d["site"]["work"]["archive"], "projects": d["projects"], "manifest": d["manifest"]}
    if pick(real) == pick(probe):
        return
    uploads = dict((public, ctx.uploads[uid]["file"]) for uid, public in assets.used.items() if uid in ctx.uploads)
    root = os.path.realpath(paths.src)

    def read_asset(rel):
        if rel in uploads:
            path = os.path.join(paths.uploads, uploads[rel])
        else:
            path = os.path.realpath(os.path.join(root, rel))
            if not path.startswith(root + os.sep):
                return None
        try:
            with open(path, "rb") as fh:
                return fh.read()
        except OSError:
            return None

    for lang, name in PDF_NAMES.items():
        data, _ = portfolio_pdf.build_portfolio_pdf(real["site"]["portfolioPage"], real["site"], real["projects"], real["manifest"], lang, read_asset)
        write_bytes(os.path.join(site_dir, "assets", "portfolio", name), data)


def write_bytes(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as fh:
        fh.write(data)


def forms_for_worker(draft):
    """What worker/forms.mjs needs to validate a submission. Labels are English (uk as fallback) for the notification mail."""
    out = {}
    for fid, form in draft["forms"].items():
        lab = lambda v: render.fill(v)["en"]
        out[fid] = {"title": lab(form["title"]), "consentRequired": form["consentRequired"], "fields": [
            dict({"key": f["key"], "type": f["type"], "label": lab(f["label"]), "required": f["required"], "max": f["max"]},
                 **({"options": [lab(o) for o in f.get("options", [])]} if f["type"] == "select" else {})) for f in form["fields"]]}
    return out


# ---------- pages ----------

def page_parts(src):
    html = read_text(os.path.join(src, "index.html"))
    return {
        "theme": re.search(r"<script>.*?</script>", html, re.S).group(0),
        "header": re.search(r'<header class="topbar".*?</header>', html, re.S).group(0),
        "footer": re.search(r'<footer class="footer">.*?</footer>', html, re.S).group(0),
    }


def prepare_shell(parts, draft):
    header = parts["header"]
    if draft.get("order"):
        header = reorder_nav(header, draft["order"])
    for sid in SECTION_IDS:
        if not draft["sections"].get(sid, True) and sid not in ("hero", "trust"):
            header = drop_nav_links(header, sid)
    header = insert_nav_pages(header, draft["pages"])
    header = re.sub(r'href="#([a-z]+)"', r'href="/#\1"', header)
    header = header.replace('href="/#top"', 'href="/"').replace('href="assets/', 'href="/assets/').replace('src="assets/', 'src="/assets/')
    footer = parts["footer"].replace('href="#top"', 'href="/"').replace('href="impressum.html"', 'href="/impressum.html"').replace('href="datenschutz.html"', 'href="/datenschutz.html"').replace('src="assets/', 'src="/assets/').replace('href="assets/', 'href="/assets/')
    return header, footer


def render_page(page, draft, ctx, assets, forms, shell, effects_css):
    header, footer, theme = shell
    f = render.fill
    title, desc = f(page["title"]), f(page["description"])
    body = render.render_blocks(page["blocks"], ctx, assets, forms)
    scripts = '  <script src="/assets/app.js" defer></script>\n'
    if render.uses(page["blocks"], "form"):
        scripts += '  <script src="/assets/forms.js" defer></script>\n'
    if draft["widgets"].get("gallery3d", True) and (render.uses(page["blocks"], "gallery3d") or render.uses(page["blocks"], "projects")):
        scripts = '  <script type="module" src="/assets/gallery3d.js"></script>\n' + scripts
    base = ctx.site.get("brand", {}).get("url", "https://viteh.org/").rstrip("/")
    return """<!doctype html>
<html lang="en" data-page="page" data-title='%s' data-desc='%s'>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>%s — ViTeh</title>
  <meta name="description" content="%s">
  <link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
  <link rel="canonical" href="%s/s/%s/">
  %s
  <link rel="stylesheet" href="/assets/styles.css">
  <link rel="stylesheet" href="/assets/blocks.css">
%s</head>
<body>
  <a class="skip-link" href="#main" data-i18n="ui.skip">Skip to content</a>
  %s
  <main id="main">
%s  </main>
  %s
%s</body>
</html>
""" % (render.json_attr(title), render.json_attr(desc), esc(title["en"]), esc(desc["en"]), esc(base), esc(page["slug"]), theme, effects_css, header, body, footer, scripts)


def sitemap(draft, ctx, built_at):
    base = ctx.site.get("brand", {}).get("url", "https://viteh.org/").rstrip("/")
    urls = [("/", base + "/")] + [("/s/%s/" % p["slug"], "%s/s/%s/" % (base, p["slug"])) for p in draft["pages"] if p["enabled"]]
    rows = []
    for _, loc in urls:
        alts = "".join('\n    <xhtml:link rel="alternate" hreflang="%s" href="%s?lang=%s"/>' % (l, loc, l) for l in LANGS)
        rows.append("  <url>\n    <loc>%s</loc>\n    <lastmod>%s-%s-%s</lastmod>%s\n    <xhtml:link rel=\"alternate\" hreflang=\"x-default\" href=\"%s\"/>\n  </url>" % (loc, built_at[0:4], built_at[4:6], built_at[6:8], alts, loc))
    return ('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n%s\n</urlset>\n' % "\n".join(rows))


def fx_css(draft):
    css = "/* generated: visual effects switched off in the admin */\n"
    if not draft["effects"].get("floating", True):
        css += ".hero-media img { animation: none !important; }\n"
    if not draft["effects"].get("reveal", True):
        css += ".js .reveal { opacity: 1 !important; transform: none !important; transition: none !important; }\n"
    return css


# ---------- safety scan ----------

def scan_external(site_dir):
    """No third-party requests: reports every resource-loading reference to a foreign host in our own files (vendor/ is exempt: documented)."""
    found = []
    for root, _, files in os.walk(site_dir):
        for name in files:
            rel = os.path.relpath(os.path.join(root, name), site_dir)
            if rel.startswith(os.path.join("assets", "vendor")):
                continue
            ext = name.rsplit(".", 1)[-1].lower()
            if ext not in ("html", "css", "js", "mjs", "svg"):
                continue
            text = read_text(os.path.join(root, name))
            hits = []
            if ext in ("html", "svg"):
                hits += EXTERNAL_TAG.findall(text) + EXTERNAL_LINK.findall(text) + EXTERNAL_LINK2.findall(text)
                hits += EXTERNAL_CSS.findall(text)
            elif ext == "css":
                hits += EXTERNAL_CSS.findall(text)
            else:
                hits += EXTERNAL_JS.findall(text)
            if hits:
                found.append(rel)
    return found


# ---------- orchestration ----------

def draft_digest(draft):
    """Hash of the draft content without its revision counter, to tell "changed since the last build" from "saved again"."""
    import hashlib
    import json
    body = {k: v for k, v in draft.items() if k != "rev"}
    return hashlib.sha256(json.dumps(body, sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest()


def read_state(paths):
    return read_json(paths.state, {}) or {}


def build(paths, ctx=None):
    paths.ensure()
    ctx = ctx or schema.Context(paths)
    raw = read_json(paths.draft, None)
    draft = schema.sanitize(raw, ctx) if raw is not None else schema.sanitize({}, ctx)
    problems = check.validate(draft, ctx, paths.src)
    if problems:
        return {"ok": False, "problems": problems}

    stamp_now = stamp()
    bid = "%s-%s" % (stamp_now, core.new_id())
    tmp = os.path.join(paths.builds, ".tmp-" + bid)
    site_dir = os.path.join(tmp, "site")
    try:
        os.makedirs(site_dir)
        assets = render.Assets(ctx)
        forms = draft["forms"]
        gallery_on = draft["widgets"].get("gallery3d", True)

        for name in PUBLIC_FILES:
            if os.path.isfile(os.path.join(paths.src, name)):
                shutil.copyfile(os.path.join(paths.src, name), os.path.join(site_dir, name))
        assets_src = os.path.join(paths.src, "assets")
        for root, _, files in os.walk(assets_src):
            for f in files:
                rel = os.path.relpath(os.path.join(root, f), assets_src).replace(os.sep, "/")
                if not gallery_on and (rel.split("/")[0] in GALLERY_DIRS or rel in GALLERY_FILES):
                    continue
                if not draft["assistant"]["enabled"] and rel in ASSISTANT_FILES:
                    continue
                dest = os.path.join(site_dir, "assets", rel)
                os.makedirs(os.path.dirname(dest), exist_ok=True)
                shutil.copyfile(os.path.join(root, f), dest)

        if draft["widgets"].get("portfolioLink", True):          # the web portfolio ships only while its link is switched on
            for rel in ("portfolio/index.html",):
                if os.path.isfile(os.path.join(paths.src, rel)):
                    os.makedirs(os.path.dirname(os.path.join(site_dir, rel)), exist_ok=True)
                    shutil.copyfile(os.path.join(paths.src, rel), os.path.join(site_dir, rel))
        html = transform_home(read_text(os.path.join(paths.src, "index.html")), draft, ctx, assets, forms)
        site = merged_site(draft, ctx, assets)
        products = merged_products(draft, ctx, assets)
        for name, merged_data, factory_data in (("site.json", site, ctx.site), ("products.json", products, ctx.products)):
            if merged_data == factory_data:                      # nothing changed: the factory file as it is, byte for byte
                os.makedirs(os.path.join(site_dir, "data"), exist_ok=True)
                shutil.copyfile(os.path.join(paths.src, "data", name), os.path.join(site_dir, "data", name))
            else:
                write_json(os.path.join(site_dir, "data", name), merged_data)
        if ctx.portfolio_images and os.path.isfile(os.path.join(paths.src, "data", "portfolio.json")):
            merged = merged_portfolio(draft, ctx)
            if merged == ctx.portfolio_projects and not home_is_explicit(draft):         # untouched: the factory file as it is, byte for byte
                shutil.copyfile(os.path.join(paths.src, "data", "portfolio.json"), os.path.join(site_dir, "data", "portfolio.json"))
            else:
                data = {"projects": merged}
                if home_is_explicit(draft):                       # the home page's own selection and order (ids only); /portfolio/ and the PDF ignore it
                    data["home"] = home_gallery(draft, ctx)
                write_json(os.path.join(site_dir, "data", "portfolio.json"), data)
                for slug in draft["portfolio"]["disabled"]:       # the pictures of a removed project do not ship either
                    shutil.rmtree(os.path.join(site_dir, "assets", "portfolio", slug), ignore_errors=True)
            images = merged_portfolio_images(draft, ctx, assets)
            if images == ctx.portfolio_images:
                shutil.copyfile(os.path.join(paths.src, "data", "portfolio-images.json"), os.path.join(site_dir, "data", "portfolio-images.json"))
            else:
                write_json(os.path.join(site_dir, "data", "portfolio-images.json"), images)
        make_portfolio_pdfs(paths, draft, ctx, assets, site_dir)

        shell_parts = page_parts(paths.src)
        header, footer = prepare_shell(shell_parts, draft)
        shell = (header, footer, shell_parts["theme"])
        effects_css = '  <link rel="stylesheet" href="/assets/fx.css">\n' if not (draft["effects"].get("floating", True) and draft["effects"].get("reveal", True)) else ""
        for page in draft["pages"]:
            if page["enabled"]:
                write_text(os.path.join(site_dir, "s", page["slug"], "index.html"), render_page(page, draft, ctx, assets, forms, shell, effects_css))
        write_text(os.path.join(site_dir, "index.html"), html)
        if effects_css:
            write_text(os.path.join(site_dir, "assets", "fx.css"), fx_css(draft))
        write_text(os.path.join(site_dir, "sitemap.xml"), sitemap(draft, ctx, stamp_now))
        write_json(os.path.join(site_dir, "forms.json"), forms_for_worker(draft))
        if draft["assistant"]["enabled"]:                       # private: under /api/, which only the Worker answers (see assistant.py)
            write_json(os.path.join(site_dir, assistant.PRIVATE_PATH), assistant.build_kb(draft, ctx, site, products))

        for uid, public in assets.used.items():
            item = ctx.uploads[uid]
            dest = os.path.join(site_dir, public)
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            shutil.copyfile(os.path.join(paths.uploads, item["file"]), dest)

        foreign = scan_external(site_dir)
        if foreign:
            raise ApiError("external_request", "У пакеті знайдено запити до сторонніх хостів: %s" % ", ".join(sorted(foreign)), 500)

        files = {}
        for root, _, names in os.walk(site_dir):
            for n in names:
                p = os.path.join(root, n)
                files[os.path.relpath(p, site_dir).replace(os.sep, "/")] = sha256_file(p)
        manifest = {"id": bid, "created": stamp_now, "draftDigest": draft_digest(draft), "files": dict(sorted(files.items())), "count": len(files),
                    "bytes": sum(os.path.getsize(os.path.join(site_dir, p)) for p in files)}
        write_json(os.path.join(tmp, "manifest.json"), manifest)
        write_json(os.path.join(tmp, "draft.json"), draft)
        final = os.path.join(paths.builds, bid)
        os.rename(tmp, final)
    except BaseException:
        shutil.rmtree(tmp, ignore_errors=True)
        raise

    state = read_state(paths)
    state.update({"built": bid, "builtAt": stamp_now})
    write_json(paths.state, state)
    set_current(paths, bid)
    prune(paths)
    return {"ok": True, "id": bid, "files": manifest["count"], "bytes": manifest["bytes"]}


def set_current(paths, bid):
    link, tmp = os.path.join(paths.builds, "current"), os.path.join(paths.builds, ".current-tmp")
    if os.path.lexists(tmp):
        os.unlink(tmp)
    os.symlink(bid, tmp)
    os.replace(tmp, link)
    sync_preview(paths, bid)


def sync_preview(paths, bid):
    """uhttpd resolves its document root once at start, so a moving `current` link would show a stale build. The preview
    server therefore serves a fixed folder whose contents are swapped here (children are renamed in, not copied in place)."""
    src = os.path.join(paths.builds, bid, "site")
    if not os.path.isdir(src):
        return
    new = paths.preview + ".new"
    shutil.rmtree(new, ignore_errors=True)
    shutil.copytree(src, new)
    os.makedirs(paths.preview, exist_ok=True)
    for name in os.listdir(paths.preview):
        full = os.path.join(paths.preview, name)
        shutil.rmtree(full) if os.path.isdir(full) and not os.path.islink(full) else os.unlink(full)
    for name in os.listdir(new):
        os.rename(os.path.join(new, name), os.path.join(paths.preview, name))
    os.rmdir(new)


def list_builds(paths):
    """Newest first. The id carries only a one-second timestamp, so ties (two builds in one second) are ordered by the manifest's mtime."""
    state = read_state(paths)
    found = []
    for name in os.listdir(paths.builds) if os.path.isdir(paths.builds) else []:
        if not BUILD_ID.match(name):                       # skips "current", temp directories and anything foreign
            continue
        mpath = os.path.join(paths.builds, name, "manifest.json")
        manifest = read_json(mpath, None)
        if manifest:
            found.append((manifest.get("created") or "", os.stat(mpath).st_mtime_ns, name, manifest))
    out = []
    for created, _, name, manifest in sorted(found, reverse=True):
        out.append({"id": name, "created": created, "files": manifest.get("count"), "bytes": manifest.get("bytes"), "digest": manifest.get("draftDigest"),
                    "current": state.get("built") == name, "published": state.get("published") == name})
    return out


def prune(paths, keep=core.KEEP_BUILDS):
    """Keeps the newest `keep` builds (and always the published one), then removes uploads nobody references any more."""
    state = read_state(paths)
    builds = [b["id"] for b in list_builds(paths)]
    for bid in builds[keep:]:
        if bid not in (state.get("published"), state.get("built")):
            shutil.rmtree(os.path.join(paths.builds, bid), ignore_errors=True)
    for name in os.listdir(paths.builds):
        if name.startswith(".tmp-"):
            shutil.rmtree(os.path.join(paths.builds, name), ignore_errors=True)
    gc_uploads(paths)


def referenced_uploads(draft):
    refs = set()

    def walk(node):
        if isinstance(node, str) and node.startswith("u:") and len(node) == 18:
            refs.add(node[2:])
        elif isinstance(node, dict):
            for v in node.values():
                walk(v)
        elif isinstance(node, list):
            for v in node:
                walk(v)
    walk(draft)
    return refs


def gc_uploads(paths):
    index = read_json(paths.uploads_index, {"items": {}}) or {"items": {}}
    keep = referenced_uploads(read_json(paths.draft, {}) or {})
    for b in list_builds(paths):
        keep |= referenced_uploads(read_json(os.path.join(paths.builds, b["id"], "draft.json"), {}) or {})
    changed = False
    for uid in list(index.get("items", {})):
        item = index["items"][uid]
        if uid not in keep and item.get("created", "") < stamp_minutes_ago(60 * 24):      # a fresh upload has a day to be used
            with contextlib.suppress(OSError):
                os.unlink(os.path.join(paths.uploads, item["file"]))
            del index["items"][uid]
            changed = True
    if changed:
        write_json(paths.uploads_index, index)


def stamp_minutes_ago(minutes):
    return time.strftime("%Y%m%d-%H%M%S", time.gmtime(time.time() - minutes * 60))


def export_tar(paths, bid, fileobj):
    """Streams manifest.json + site/ as a tar (used over ssh by deploy-from-radxa.sh)."""
    base = os.path.join(paths.builds, bid)
    if not re.match(r"^[0-9]{8}-[0-9]{6}-[0-9a-f]{8}$", bid) or not os.path.isfile(os.path.join(base, "manifest.json")):
        raise ApiError("no_build", "Збірку не знайдено", 404)
    with tarfile.open(fileobj=fileobj, mode="w|") as tar:
        tar.add(os.path.join(base, "manifest.json"), arcname="manifest.json")
        tar.add(os.path.join(base, "site"), arcname="site")


def verify_build(paths, bid):
    base = os.path.join(paths.builds, bid)
    manifest = read_json(os.path.join(base, "manifest.json"), None)
    if not manifest:
        raise ApiError("no_build", "Збірку не знайдено", 404)
    bad = [p for p, digest in manifest["files"].items() if not os.path.isfile(os.path.join(base, "site", p)) or sha256_file(os.path.join(base, "site", p)) != digest]
    return {"ok": not bad, "bad": bad, "count": manifest["count"]}
