"""Static HTML for blocks, pages and forms. All visitor-facing text is rendered in the three languages at build time;
CSS (assets/blocks.css) shows the one that matches <html lang>. Every value goes through esc() or richtext."""
import json

from .core import LANGS
from .richtext import esc, render_rich

ORDER = ("en", "uk", "de")


def fill(value):
    """Missing languages fall back to en, then uk, then de, so no language ever shows an empty heading."""
    src = value if isinstance(value, dict) else {}
    best = next((src[l] for l in ORDER if (src.get(l) or "").strip()), "")
    return {l: (src.get(l) or "").strip() or best for l in LANGS}


def tl(value):
    """Inline text in three languages."""
    v = fill(value)
    return "".join('<span class="tl" lang="%s">%s</span>' % (l, esc(v[l])) for l in LANGS)


def tlb(value):
    """Long text (paragraphs, lists) in three languages."""
    v = fill(value)
    return "".join('<div class="tlb" lang="%s">%s</div>' % (l, render_rich(v[l])) for l in LANGS)


def has(value):
    return any((value or {}).get(l, "").strip() for l in LANGS) if isinstance(value, dict) else bool(value)


def json_attr(value):
    return esc(json.dumps(value, ensure_ascii=False, separators=(",", ":")))


class Assets:
    """Resolves image references to public paths and remembers which uploads the package needs."""

    def __init__(self, ctx):
        self.ctx = ctx
        self.used = {}                     # upload id -> public path

    def url(self, ref):
        if not ref:
            return ""
        if ref.startswith("u:"):
            item = self.ctx.uploads.get(ref[2:])
            if not item:
                return ""
            path = "assets/u/%s" % item["file"] if item["kind"] == "image" else "assets/models/u-%s" % item["file"]
            self.used[ref[2:]] = path
            return "/" + path
        return "/" + ref


def img(assets, ref, alt, cls="", loading="lazy"):
    src = assets.url(ref)
    if not src:
        return ""
    a = fill(alt)
    return '<img%s src="%s" alt="%s" data-alt=\'%s\' loading="%s">' % (
        ' class="%s"' % cls if cls else "", esc(src), esc(a["en"]), json_attr(a), loading)


def link(item, cls):
    item = item or {}
    if not item.get("href") or not has(item.get("text")):
        return ""
    href = item["href"]
    rel = ' rel="noopener noreferrer"' if href.startswith(("http://", "https://")) else ""
    return '<a class="%s" href="%s"%s>%s</a>' % (cls, esc(href), rel, tl(item["text"]))


def heading(f, narrow=False):
    parts = []
    if has(f.get("eyebrow")):
        parts.append('<p class="eyebrow">%s</p>' % tl(f["eyebrow"]))
    if has(f.get("title")):
        parts.append("<h2>%s</h2>" % tl(f["title"]))
    if has(f.get("lead")):
        parts.append('<div class="section-lead">%s</div>' % tlb(f["lead"]))
    return '<div class="section-heading reveal">%s</div>' % "".join(parts) if parts else ""


def wrap(block, inner, cls="section", container="container", alt=False):
    anchor = ' id="%s"' % esc(block["anchor"]) if block.get("anchor") else ""
    return '<section class="%s%s"%s><div class="%s">%s</div></section>\n' % (cls, " alt" if alt else "", anchor, container, inner)


def icon(name):
    return '<svg class="ico" aria-hidden="true"><use href="/assets/icons.svg#i-%s"/></svg>' % esc(name)


def r_hero(b, f, ctx, assets, forms):
    image = img(assets, f.get("image"), f.get("alt"), loading="eager")
    copy = ""
    if has(f.get("eyebrow")):
        copy += '<p class="eyebrow">%s</p>' % tl(f["eyebrow"])
    copy += "<h1>%s</h1>" % tl(f["title"])
    if has(f.get("lead")):
        copy += '<div class="lead">%s</div>' % tlb(f["lead"])
    actions = link(f.get("primary"), "btn primary") + link(f.get("secondary"), "btn ghost")
    if actions:
        copy += '<div class="actions">%s</div>' % actions
    anchor = ' id="%s"' % esc(b["anchor"]) if b.get("anchor") else ""
    media = '<figure class="hero-media">%s</figure>' % image if image else ""
    return '<section class="hero%s"%s><div class="container hero-grid"><div class="hero-copy">%s</div>%s</div></section>\n' % (
        "" if image else " hero-solo", anchor, copy, media)


def r_services(b, f, ctx, assets, forms):
    cards = ""
    for it in f.get("items", []):
        cards += '<article class="card reveal"><div class="card-icon">%s</div><h3>%s</h3>%s</article>' % (
            icon(it.get("icon") or "code"), tl(it["title"]), '<div class="card-text">%s</div>' % tlb(it["text"]) if has(it.get("text")) else "")
    return wrap(b, heading(f) + '<div class="card-grid">%s</div>' % cards)


def r_projects(b, f, ctx, assets, forms):
    only = ' data-only-models="1"' if f.get("onlyModels") else ""
    return wrap(b, heading(f) + '<div class="filters" id="categoryFilters" role="group"></div><div class="product-grid" id="productGrid"%s></div>' % only, alt=True)


def r_gallery3d(b, f, ctx, assets, forms):
    return wrap(b, heading(f) + '<div class="product-grid" id="productGrid" data-only-models="1"></div>', alt=True)


def r_agents(b, f, ctx, assets, forms):
    items = "".join('<li><span class="dot">%s</span><div><h3>%s</h3>%s</div></li>' % (icon("check"), tl(i["title"]), '<div class="feature-text">%s</div>' % tlb(i["text"]) if has(i.get("text")) else "")
                    for i in f.get("items", []))
    image = img(assets, f.get("image"), f.get("alt"))
    media = '<figure class="ai-media reveal">%s</figure>' % image if image else ""
    inner = '<div class="ai-copy reveal">%s<ul class="feature-list">%s</ul></div>%s' % (
        "".join(x for x in (
            '<p class="eyebrow">%s</p>' % tl(f["eyebrow"]) if has(f.get("eyebrow")) else "",
            "<h2>%s</h2>" % tl(f["title"]),
            '<div class="section-lead">%s</div>' % tlb(f["lead"]) if has(f.get("lead")) else "")), items, media)
    return wrap(b, inner, container="container ai-grid" if image else "container", alt=True)


def r_steps(b, f, ctx, assets, forms):
    li = "".join('<li class="reveal"><div class="num" aria-hidden="true">%d</div><h3>%s</h3>%s</li>' % (
        n, tl(i["title"]), '<div class="card-text">%s</div>' % tlb(i["text"]) if has(i.get("text")) else "") for n, i in enumerate(f.get("items", []), 1))
    return wrap(b, heading(f) + '<ol class="steps">%s</ol>' % li)


def r_stack(b, f, ctx, assets, forms):
    groups = ""
    for g in f.get("items", []):
        tags = [t.strip() for t in (g.get("tags") or "").split(",") if t.strip()][:30]
        groups += '<div class="stack-group reveal"><h3>%s</h3><ul>%s</ul></div>' % (tl(g["title"]), "".join("<li>%s</li>" % esc(t) for t in tags))
    return wrap(b, heading(f) + '<div class="stack-grid">%s</div>' % groups)


def r_pricing(b, f, ctx, assets, forms):
    cards = ""
    for it in f.get("items", []):
        cards += '<article class="price-card reveal%s"><h3>%s</h3>%s%s</article>' % (
            " featured" if it.get("featured") else "", tl(it["title"]),
            '<div class="price-tag">%s</div>' % tl(it["price"]) if has(it.get("price")) else "",
            '<div class="card-text">%s</div>' % tlb(it["text"]) if has(it.get("text")) else "")
    return wrap(b, heading(f) + '<div class="pricing-grid">%s</div>' % cards, alt=True)


def r_faq(b, f, ctx, assets, forms):
    items = "".join('<details class="reveal"><summary>%s</summary><div class="answer">%s</div></details>' % (tl(i["q"]), tlb(i["a"])) for i in f.get("items", []))
    return wrap(b, heading(f) + '<div class="faq">%s</div>' % items, container="container narrow")


def r_text_image(b, f, ctx, assets, forms):
    image = img(assets, f.get("image"), f.get("alt"))
    copy = "".join(x for x in (
        '<p class="eyebrow">%s</p>' % tl(f["eyebrow"]) if has(f.get("eyebrow")) else "", "<h2>%s</h2>" % tl(f["title"]),
        '<div class="rich">%s</div>' % tlb(f["body"])))
    media = '<figure class="ti-media reveal">%s</figure>' % image if image else ""
    cls = "container ti-grid%s%s" % (" ti-left" if f.get("side") == "left" else "", "" if image else " ti-solo")
    return wrap(b, '<div class="ti-copy reveal">%s</div>%s' % (copy, media), container=cls)


def r_gallery(b, f, ctx, assets, forms):
    figs = ""
    for it in f.get("items", []):
        im = img(assets, it.get("image"), it.get("alt"))
        if im:
            figs += "<figure class=\"reveal\">%s%s</figure>" % (im, "<figcaption>%s</figcaption>" % tl(it["caption"]) if has(it.get("caption")) else "")
    return wrap(b, (heading({"title": f.get("title")}) if has(f.get("title")) else "") + '<div class="photo-grid">%s</div>' % figs)


def r_cta(b, f, ctx, assets, forms):
    inner = "<h2>%s</h2>%s%s" % (tl(f["title"]), '<div class="section-lead">%s</div>' % tlb(f["lead"]) if has(f.get("lead")) else "", link(f.get("button"), "btn primary"))
    return wrap(b, '<div class="cta-box reveal">%s</div>' % inner)


def r_divider(b, f, ctx, assets, forms):
    return '<div class="container"><hr class="divider divider-%s"></div>\n' % esc(f.get("style") or "line")


def form_html(fid, form):
    f_html = ""
    for fld in form["fields"]:
        key, fcls, req = fld["key"], "field", fld["required"]
        dom = "%s-%s" % (fid, key)
        label = '<label for="%s">%s</label>' % (esc(dom), tl(fld["label"]))
        if fld["type"] == "textarea":
            ctl = '<textarea id="%s" name="%s" rows="5" maxlength="%d"%s></textarea>' % (esc(dom), esc(key), fld["max"], " required" if req else "")
        elif fld["type"] == "select":
            opts = "".join('<option value="%d" data-i18n-opt=\'%s\'>%s</option>' % (i, json_attr(fill(o)), esc(fill(o)["en"])) for i, o in enumerate(fld.get("options", [])))
            ctl = '<select id="%s" name="%s"%s>%s</select>' % (esc(dom), esc(key), " required" if req else "", opts)
        elif fld["type"] == "checkbox":
            f_html += '<label class="consent"><input type="checkbox" name="%s"%s><span>%s</span></label>' % (esc(key), " required" if req else "", tl(fld["label"]))
            continue
        else:
            ac = {"email": "email", "tel": "tel"}.get(fld["type"], "off")
            ctl = '<input id="%s" name="%s" type="%s" autocomplete="%s" maxlength="%d"%s>' % (esc(dom), esc(key), fld["type"], ac, fld["max"], " required" if req else "")
        f_html += '<div class="%s">%s%s</div>' % (fcls, label, ctl)
    consent = ""
    if form["consentRequired"]:
        consent = '<label class="consent"><input type="checkbox" name="consent" required><span>%s</span></label>' % tl(form["consent"])
    msgs = {"ok": fill(form["success"]), "required": {"uk": "Заповніть, будь ласка, обов'язкові поля.", "en": "Please fill in the required fields.", "de": "Bitte füllen Sie die Pflichtfelder aus."},
            "error": {"uk": "Не вдалося надіслати. Спробуйте пізніше.", "en": "Could not send. Please try again later.", "de": "Senden fehlgeschlagen. Bitte versuchen Sie es später erneut."}}
    return ('<form class="contact-form reveal" data-vform="%s" data-msg=\'%s\' novalidate>%s%s'
            '<div class="hp" aria-hidden="true"><label>Website <input type="text" name="hp" tabindex="-1" autocomplete="off"></label></div>%s'
            '<button class="btn primary wide" type="submit"><span>%s</span>%s</button><p class="form-status" role="status" aria-live="polite"></p></form>') % (
        esc(fid), json_attr(msgs), ('<div class="form-intro">%s</div>' % tlb(form["intro"])) if has(form.get("intro")) else "", f_html, consent, tl(form["submit"]), icon("arrow"))


def r_form(b, f, ctx, assets, forms):
    form = forms.get(f.get("form"))
    if not form:
        return ""
    return wrap(b, heading(f) + '<div class="form-wrap">%s</div>' % form_html(f["form"], form), container="container narrow", cls="section contact-section")


RENDERERS = {"hero": r_hero, "services": r_services, "projects": r_projects, "gallery3d": r_gallery3d, "agents": r_agents, "steps": r_steps,
             "stack": r_stack, "pricing": r_pricing, "faq": r_faq, "form": r_form, "text_image": r_text_image, "gallery": r_gallery, "cta": r_cta, "divider": r_divider}


def render_blocks(blocks, ctx, assets, forms):
    return "".join(RENDERERS[b["type"]](b, b["fields"], ctx, assets, forms) for b in blocks if b["enabled"] and b["type"] in RENDERERS)


def uses(blocks, kind):
    return any(b["enabled"] and b["type"] == kind for b in blocks)
