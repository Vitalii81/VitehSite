"""Lays the portfolio data out as the PDF that visitors download (see pdf.py for the writer and its limits).
Input is the SAME data the web page /portfolio/ renders: site.portfolioPage (cover, sections), data/portfolio.json (projects) and the image manifest.
Nothing here reads the network or the draft: build.py hands over already merged data (enabled items only, current texts, current pictures)."""
import re

from . import pdf
from .pdf import MM, PAGE_H, PAGE_W, MARGIN_X, MARGIN_TOP, MARGIN_BOTTOM, PANEL, INK, MUTED, ACC

SLOT_RE = re.compile(r"^assets/(?:portfolio/[a-z0-9-]+/[a-z0-9-]+|u/[\w.-]+)\.(?:webp|jpe?g|png)$")
IMG_RE = re.compile(r"^[a-z0-9-]+$")
CONTENT_W = PAGE_W - 2 * MARGIN_X
LEADING = 1.4


def tr(value, lang):
    """Same fallback as assets/portfolio-render.js: the language, else English, else any non-empty translation."""
    if isinstance(value, dict):
        return value.get(lang) or value.get("en") or next((v for v in value.values() if v), "")
    return "" if value is None else str(value)


# ---------- layout elements: height(doc, width) and draw(doc, x, top, width, ops) ----------

class Para:
    def __init__(self, text, size=9.6, color=INK, bold=False, after=2.2 * MM):
        self.text, self.size, self.color, self.bold, self.after = text, size, color, bold, after

    def lines(self, doc, w):
        return doc.wrap(self.text, self.size, w, self.bold) if self.text else []

    def height(self, doc, w):
        n = len(self.lines(doc, w))
        return n * self.size * LEADING + (self.after if n else 0)

    def draw(self, doc, x, top, w, ops):
        y = top
        for line in self.lines(doc, w):
            y -= self.size * LEADING
            if line:
                doc.text(x, y + self.size * 0.3, line, self.size, self.color, self.bold, ops)


class Fig:
    def __init__(self, data, caption="", max_h=70 * MM, ratio=None, fit="contain"):
        self.data, self.caption, self.max_h, self.ratio, self.fit = data, caption, max_h, ratio, fit

    def box(self, w):
        info = pdf.read_image(self.data) if self.data else None
        if not info and not self.ratio:
            return 0, 0
        ratio = self.ratio or info[1] / float(info[2])
        h = min(self.max_h, w / ratio)
        return w, h

    def height(self, doc, w):
        bw, bh = self.box(w)
        if not bh:
            return 0
        cap = Para(self.caption, 8, MUTED, after=0)
        return bh + 1.2 * MM + cap.height(doc, w) + 3 * MM

    def draw(self, doc, x, top, w, ops):
        bw, bh = self.box(w)
        if not bh:
            return
        doc.image(self.data, x, top - bh, bw, bh, self.fit, ops)
        Para(self.caption, 8, MUTED, after=0).draw(doc, x, top - bh - 1.2 * MM, w, ops)


class Stack:
    def __init__(self, children, gap=0):
        self.children, self.gap = [c for c in children if c is not None], gap

    def height(self, doc, w):
        return sum(c.height(doc, w) for c in self.children) + self.gap * max(len(self.children) - 1, 0)

    def draw(self, doc, x, top, w, ops):
        y = top
        for c in self.children:
            c.draw(doc, x, y, w, ops)
            y -= c.height(doc, w) + self.gap


class Card:
    def __init__(self, children, hi=False, pad=4 * MM):
        self.inner, self.hi, self.pad = Stack(children), hi, pad

    def height(self, doc, w):
        return self.inner.height(doc, w - 2 * self.pad) + 2 * self.pad + 3.5 * MM

    def draw(self, doc, x, top, w, ops):
        h = self.height(doc, w) - 3.5 * MM
        doc.rect(x, top - h, w, h, PANEL, ops)
        if self.hi:
            doc.rect(x, top - h, 1 * MM, h, ACC, ops)
        self.inner.draw(doc, x + self.pad, top - self.pad, w - 2 * self.pad, ops)


class Row:
    def __init__(self, cols, weights=None, gap=4 * MM):
        self.cols, self.weights, self.gap = cols, weights or [1] * len(cols), gap

    def widths(self, w):
        free = w - self.gap * (len(self.cols) - 1)
        return [free * x / float(sum(self.weights)) for x in self.weights]

    def height(self, doc, w):
        return max([c.height(doc, cw) for c, cw in zip(self.cols, self.widths(w))] or [0])

    def draw(self, doc, x, top, w, ops):
        for c, cw in zip(self.cols, self.widths(w)):
            c.draw(doc, x, top, cw, ops)
            x += cw + self.gap


# ---------- data -> elements ----------

class Builder:
    def __init__(self, page, site, projects, manifest, lang, read_asset):
        self.page, self.site, self.projects, self.manifest, self.lang, self.read = page, site, projects, manifest, lang, read_asset
        self.ui = page.get("ui", {})

    def t(self, v):
        return tr(v, self.lang)

    def block(self, b):
        t, kind = self.t, b.get("t")
        if kind == "p":
            return Para(t(b.get("text")))
        if kind == "h3":
            return Para(t(b.get("text")), 8.5, ACC, True, 2 * MM)
        if kind == "h4":
            return Para(t(b.get("text")), 8.5, ACC, True, 1 * MM)
        if kind == "note":
            return Para(t(b.get("text")), 8.5, MUTED)
        if kind == "focus":
            return Para("%s %s" % (t(b.get("label")), t(b.get("text"))))
        if kind == "list":
            return Stack([Para("• " + t(i), after=1 * MM) for i in b.get("items", [])])
        if kind == "caps":
            return Stack([Row([Para(t(i.get("k")), 8.5, ACC, True, 0), Para(t(i.get("v")), after=0)], [1, 3.4], 3 * MM) for i in b.get("items", [])], 2 * MM)
        if kind == "fig":
            name = b.get("img", "")
            data = self.read("assets/portfolio/img/%s.jpg" % name) if IMG_RE.match(name) else None
            return Fig(data, t(b.get("caption")), 55 * MM if b.get("small") else 92 * MM)
        if kind == "card":
            kids = [Para(t(b.get("title")), 8.5, ACC, True, 1 * MM)]
            for i, x in enumerate(b.get("text", [])):
                kids.append(Para(t(x), 9.6, MUTED if i and b.get("hi") else INK))
            if b.get("skills"):
                kids.append(Para("%s · %s" % (t(self.ui.get("skills")), t(b.get("skills"))), 8, MUTED, after=0))
            return Card(kids, bool(b.get("hi")))
        if kind == "two":
            return Row([Stack([self.block(x) for x in b.get("left", [])]), Stack([self.block(x) for x in b.get("right", [])])], [1, 1.1], 8 * MM)
        if kind == "grid2":
            cells = [Stack([self.block(x) for x in cell]) for cell in b.get("items", [])]
            rows = [Row(cells[i:i + 2] + ([Stack([])] if len(cells[i:i + 2]) == 1 else []), None, 4 * MM) for i in range(0, len(cells), 2)]
            return Stack(rows, 3 * MM)
        if kind == "webrow":
            items = [self.block(x) for x in b.get("items", [])]
            return Row(items, [3] + [1] * (len(items) - 1), 3 * MM) if items else None
        return None

    def services(self, s):
        cards = []
        for it in self.site.get("services", {}).get("items", []):
            cards.append(Card([Para(self.t(it.get("title")), 8.5, ACC, True, 0.8 * MM), Para(self.t(it.get("text")), 8.4, INK, False, 1 * MM),
                               Para(" · ".join(self.t(p) for p in it.get("points", [])), 7.6, MUTED, False, 0)], pad=3 * MM))
        return self.pairs(cards) + [Para(self.t(s.get("note")), 8.5, MUTED)]

    def pairs(self, cards):
        out = []
        for i in range(0, len(cards), 2):
            pair = cards[i:i + 2]
            out.append(Row(pair + ([Stack([])] if len(pair) == 1 else []), None, 4 * MM))
        return out

    def slots(self, p):
        """[(bytes, ratio)] of the project's final pictures (at most 3): factory files or uploads, never a placeholder."""
        by_slot = dict((m.get("slot"), m) for m in self.manifest if m.get("slug") == p.get("slug"))
        out = []
        for slot in p.get("slots", []):
            m = by_slot.get(slot)
            if not m or m.get("status") != "final" or not SLOT_RE.match(m.get("file", "")):
                continue
            data = self.read(m["file"])
            if data is None and m["file"].endswith(".webp"):
                data = self.read(m["file"][:-5] + ".jpg")             # the factory ships a JPEG twin of every WebP
            if data is None or not pdf.read_image(data):
                continue
            rm = re.match(r"^(\d{1,2}):(\d{1,2})$", m.get("ratio", ""))
            out.append((data, int(rm.group(1)) / float(rm.group(2)) if rm else 4 / 3.0))
            if len(out) == 3:
                break
        return out

    def archive(self, s):
        cfg = self.site.get("work", {}).get("archive", {})
        cats = dict((c.get("id"), self.t(c.get("label"))) for c in cfg.get("categories", []))
        cards = []
        for p in self.projects:
            kids = [Para(" · ".join(x for x in (cats.get(p.get("category"), p.get("category")), p.get("years")) if x), 7.6, MUTED, False, 1 * MM),
                    Para(self.t(p.get("title")), 9, ACC, True, 1.5 * MM)]
            shots = self.slots(p)
            if shots:
                kids.append(Row([Fig(d, "", 26 * MM, r, "cover") for d, r in shots], [r for _, r in shots], 1.5 * MM))
            kids += [Para(self.t(p.get("summary")), 8.4, INK, False, 1 * MM), Para(" · ".join(p.get("tags", [])), 7.6, MUTED, False, 0)]
            cards.append(Card(kids, pad=3 * MM))
        return self.pairs(cards) + [Para(self.t(s.get("note")), 8.5, MUTED)], self.t(s.get("lead")) or self.t(cfg.get("lead"))

    def sections(self):
        """[(kicker, title, lead, [elements])]"""
        out = []
        for s in self.page.get("sections", []):
            kicker, title, lead = self.t(s.get("kicker")), self.t(s.get("title")), self.t(s.get("lead"))
            if s.get("type") == "blocks":
                body = [self.block(b) for b in s.get("blocks", [])]
            elif s.get("type") == "services":
                body = self.services(s)
            elif s.get("type") == "archive":
                if not self.projects:
                    continue                                          # every project switched off: no empty archive section
                body, lead = self.archive(s)
            else:
                continue
            out.append((kicker, title, lead, [b for b in body if b is not None]))
        return out


def build_portfolio_pdf(page, site, projects, manifest, lang, read_asset):
    """Returns (pdf_bytes, texts) where texts lists every string drawn (tests read it instead of parsing the PDF)."""
    b = Builder(page, site, projects, manifest, lang, read_asset)
    ui, cover, t = b.ui, page.get("cover", {}), b.t
    doc = pdf.Doc(t(ui.get("title")) or "Portfolio")
    # cover
    half = 105 * MM
    doc.text(14 * MM, PAGE_H - 28 * MM, t(ui.get("year")), 8, ACC)
    y = PAGE_H - 48 * MM
    for part in t(cover.get("name")).split(" ", 1):
        doc.text(14 * MM, y, part, 28, INK, True)
        y -= 36
    Para(t(cover.get("roles")).replace(" · ", "\n"), 10, INK, after=0).draw(doc, 14 * MM, y - 6 * MM, half - 26 * MM, doc.ops)
    Para(t(cover.get("text")), 9, MUTED, after=0).draw(doc, 14 * MM, 120 * MM, half - 26 * MM, doc.ops)
    Para(t(cover.get("tags")), 8, ACC, after=0).draw(doc, 14 * MM, 62 * MM, half - 26 * MM, doc.ops)
    Para(t(cover.get("since")), 8, MUTED, after=0).draw(doc, 14 * MM, 30 * MM, half - 26 * MM, doc.ops)
    hero = read_asset("assets/portfolio/img/hero-unit.jpg")
    if hero:
        doc.image(hero, half, 0, PAGE_W - half, PAGE_H - 1.2 * MM, "cover")

    bottom, name = MARGIN_BOTTOM, t(cover.get("name")).upper()

    def start_page(kicker, title, lead, first):
        doc.new_page()
        doc.text(MARGIN_X, PAGE_H - 14 * MM, name, 7.5, INK, True)
        label = (t(ui.get("year")) or "").split(" / ")[0]
        doc.text(PAGE_W - MARGIN_X - doc.fonts["R"].width(label, 7.5), PAGE_H - 14 * MM, label, 7.5, MUTED)
        top = PAGE_H - 22 * MM
        head = [Para(kicker, 8, ACC, after=1.5 * MM), Para(title, 20 if first else 12, INK, True, 2 * MM)]
        if first and lead:
            head.append(Para(lead, 10, MUTED, after=4 * MM))
        for el in head:
            el.draw(doc, MARGIN_X, top, CONTENT_W, doc.ops)
            top -= el.height(doc, CONTENT_W)
        return top - 2 * MM

    for kicker, title, lead, body in b.sections():
        y = start_page(kicker, title, lead, True)
        for el in body:
            h = el.height(doc, CONTENT_W)
            if y - h < bottom and y < PAGE_H - 70 * MM:                # does not fit and the page already holds something: continue on a new page
                y = start_page(kicker, "%s …" % title, lead, False)
            el.draw(doc, MARGIN_X, y, CONTENT_W, doc.ops)
            y -= h
    out = doc.render({"left": t(ui.get("footer")), "skip_first": True})
    return out, doc.texts
