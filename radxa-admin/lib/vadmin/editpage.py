"""The "edit on the page" view: the home page exactly as the build would render it, but with every section and card switched on,
the owner's uploads served by the admin's own `file` action, and the two data files embedded in the page.
The overlay (web/edit-overlay.js + edit-core.js + edit-overlay.css) is attached HERE and nowhere else: build.build() never
touches this module, so a published package cannot contain the overlay (tests/test_vadmin.py checks that)."""
import copy
import json
import os
import re

from . import build, render, schema
from . import core
from .core import LANGS
from .richtext import esc

FILE_ACTION = "/cgi-bin/vadmin-api?action=file&id="
# fetch() of the data files is answered from the page itself, so the view needs no public data folder next to the admin.
FETCH_STUB = ('(function(){var f=window.fetch,m={"/data/site.json":"ve-site","/data/products.json":"ve-products","/data/portfolio.json":"ve-portfolio","/data/portfolio-images.json":"ve-portfolio-images"};'
              'window.fetch=function(u){try{var p=new URL(typeof u==="string"?u:u.url,location.href).pathname,id=m[p];'
              'if(id)return Promise.resolve(new Response(document.getElementById(id).textContent,{status:200,headers:{"Content-Type":"application/json"}}));}'
              'catch(e){}return f.apply(this,arguments);};})();')
HTML_HEADERS = [("Content-Type", "text/html; charset=utf-8"), ("Cache-Control", "no-store"), ("X-Content-Type-Options", "nosniff"),
                ("X-Frame-Options", "DENY"), ("Referrer-Policy", "no-referrer"), ("Content-Security-Policy", "frame-ancestors 'none'")]


PAGES = ("home", "portfolio", "impressum", "datenschutz")
LEGAL_FILES = {"impressum": ("impressum.html", "imprint"), "datenschutz": ("datenschutz.html", "privacy")}


class EditAssets(render.Assets):
    """Uploads are shown through the authenticated `file` action instead of being copied into a package."""

    def url(self, ref):
        if ref and ref.startswith("u:"):
            return FILE_ACTION + ref[2:] if ref[2:] in self.ctx.uploads else ""
        return super().url(ref)


def view_draft(draft):
    """A copy of the draft for rendering only: nothing is switched off (the owner sees disabled things dimmed, the overlay marks them)."""
    view = copy.deepcopy(draft)
    view["sections"] = {sid: True for sid in schema.SECTION_IDS}
    view["disabled"]["services"] = []
    view["disabled"]["projects"] = []
    view["widgets"]["gallery3d"] = True
    return view


def json_script(script_id, value):
    """A JSON data block that cannot end the <script> element early: < > & and the JS line separators are written as \\u escapes."""
    text = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    for ch, rep in (("<", "\\u003c"), (">", "\\u003e"), ("&", "\\u0026"), (" ", "\\u2028"), (" ", "\\u2029")):
        text = text.replace(ch, rep)
    return '<script type="application/json" id="%s">%s</script>' % (script_id, text)


def overlay_version():
    """Cache-buster for the overlay files (the installer copies web/ next to lib/, so the layout is the same in the repository and on the Radxa)."""
    web = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "web")
    stamps = [int(os.path.getmtime(os.path.join(web, n))) for n in ("edit-core.js", "edit-overlay.js", "edit-overlay.css", "preview-tip.js", "preview-tip.css", "jpeg-twin.js") if os.path.isfile(os.path.join(web, n))]
    return str(max(stamps)) if stamps else "0"


def login_page():
    """What an anonymous visitor gets: a plain page with a link to the admin's login, no site data at all."""
    html = ('<!doctype html>\n<html lang="uk"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">\n'
            '<meta name="robots" content="noindex, nofollow"><title>ViTeh — потрібен вхід</title></head>\n'
            '<body style="font-family:system-ui,sans-serif;max-width:34rem;margin:4rem auto;padding:0 1rem;line-height:1.5">\n'
            '<h1>Потрібен вхід</h1><p>Щоб редагувати сторінку, спершу увійдіть в адмінку.</p><p><a href="/">Відкрити адмінку</a></p>\n</body></html>\n')
    return 401, HTML_HEADERS, html.encode("utf-8")


def render_page(paths, ctx, draft, lang, uploads, factory_images, section_labels, page="home"):
    """Returns (status, headers, body) of an editable page. `draft` is the REAL draft (embedded for the overlay to patch and save).
    page="home": the home page as the build renders it; the overlay edits the site's own texts and only SELECTS portfolio items (show/hide, order on the home page).
    page="portfolio": /portfolio/; the overlay edits the portfolio's own content (items, pictures, order, on/off, the page's texts).
    page="impressum" / "datenschutz": impressum.html / datenschutz.html; the overlay edits the legal texts (site.json `legal`, kept in draft.texts)."""
    lang = lang if lang in LANGS else "uk"
    page = page if page in PAGES else "home"
    view = view_draft(draft)
    assets = EditAssets(ctx)
    if page == "home":
        html = build.transform_home(build.read_text(os.path.join(paths.src, "index.html")), view, ctx, assets, view["forms"])
        site = build.merged_site(view, ctx, assets)
        products = build.merged_products(view, ctx, assets)
        gallery = {"projects": build.merged_portfolio(draft, ctx), "home": build.home_gallery(draft, ctx, include_hidden=True)}      # items hidden on the home page stay, dimmed by the overlay
    elif page in LEGAL_FILES:
        html = build.read_text(os.path.join(paths.src, LEGAL_FILES[page][0]))
        site = build.merged_site(view, ctx, assets)
        products = []
        gallery = {"projects": build.merged_portfolio(draft, ctx)}
    else:
        html = build.read_text(os.path.join(paths.src, "portfolio", "index.html"))
        site = build.merged_site(view, ctx, assets, all_portfolio_sections=True)                  # every section is shown (switched-off ones are dimmed by the overlay)
        products = []
        gallery = {"projects": build.merged_portfolio(draft, ctx, keep_disabled=True)}
    gallery_images = build.merged_portfolio_images(draft, ctx, assets, keep_disabled=(page == "portfolio"))
    for m in gallery_images:                                                            # uploads must pass the public script's file-name check; the overlay points them at the file action
        if m.get("file", "").startswith(FILE_ACTION.lstrip("/")):
            m["file"] = "assets/u/%s.jpg" % m["file"].split("id=")[1]
    factory_gallery = dict((p["slug"], {"title": p.get("title"), "summary": p.get("summary"), "years": p.get("years", ""), "tags": p.get("tags", []), "category": p.get("category"),
                                        "portfolioOnly": bool(p.get("portfolioOnly")), "slots": ["%s/%s" % (p["slug"], sl) for sl in p.get("slots", [])]}) for p in ctx.portfolio_projects)
    boot = {
        "page": page, "rev": draft["rev"], "draft": draft, "lang": lang, "api": "/cgi-bin/vadmin-api", "adminUrl": "/",
        "editable": schema.editable_texts(ctx.site), "order": list(schema.MOVABLE_IDS), "labels": section_labels,
        "factory": {"services": len(ctx.site.get("services", {}).get("items", [])), "projects": [p.get("id") for p in ctx.products]},
        "uploads": uploads, "factoryImages": factory_images, "gallery": bool(draft["widgets"].get("gallery3d", True)),
        "factoryGallery": factory_gallery, "editablePlain": schema.editable_plain(ctx.site),
        "factoryProducts": dict((p["id"], {"title": p.get("title"), "summary": p.get("summary"), "status": p.get("status"), "tags": p.get("tags", []), "category": p.get("category")}) for p in ctx.products),
        "categories": [{"id": c.get("id"), "label": c.get("label")} for c in ctx.site.get("work", {}).get("categories", [])],
        "archiveCategories": [c.get("id") for c in ctx.site.get("work", {}).get("archive", {}).get("categories", [])],
        "galleryOrder": [p["slug"] for p in ctx.portfolio_projects],                                  # every portfolio item in factory order (portfolio page)
        "homeBase": [p["slug"] for p in build.merged_portfolio(draft, ctx) if not p.get("portfolioOnly")],        # what the home page can pick from, in the portfolio's order
        "portfolioSections": [{"id": x.get("id"), "title": x.get("title")} for x in ctx.site.get("portfolioPage", {}).get("sections", [])],
    }
    marker = {"home": '<html lang="en" data-page="home">', "portfolio": '<html lang="en" data-page="portfolio">'}.get(page) or '<html lang="en" data-page="legal" data-legal="%s">' % LEGAL_FILES[page][1]
    if marker not in html:
        raise core.ApiError("src_changed", "У файлах сайту на Radxa не знайдено очікуваної розмітки сторінки", 500)
    html = html.replace(marker, marker.replace('lang="en"', 'lang="%s"' % esc(lang)).replace(">", ' data-ve="1">' if page == "portfolio" else ">", 1), 1)
    head = ('  <base href="/">\n  <meta name="robots" content="noindex, nofollow">\n  %s\n  %s\n  %s\n  %s\n  %s\n  <script>%s</script>\n'
            % (json_script("ve-site", site), json_script("ve-products", products), json_script("ve-portfolio", gallery), json_script("ve-portfolio-images", gallery_images), json_script("ve-boot", boot), FETCH_STUB))
    html = html.replace('<meta charset="utf-8">\n', '<meta charset="utf-8">\n' + head, 1)
    v = overlay_version()
    html = html.replace("</head>", '  <link rel="stylesheet" href="edit-overlay.css?v=%s">\n  <link rel="stylesheet" href="preview-tip.css?v=%s">\n</head>' % (v, v), 1)
    html = html.replace("<body>", '<body class="ve-edit">', 1)
    html = html.replace("</body>", '  <script src="edit-core.js?v=%s"></script>\n  <script src="preview-tip.js?v=%s"></script>\n  <script src="jpeg-twin.js?v=%s"></script>\n  <script src="edit-overlay.js?v=%s" defer></script>\n</body>' % (v, v, v, v), 1)
    return 200, HTML_HEADERS, html.encode("utf-8")
