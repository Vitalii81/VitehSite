"""Tests of the Radxa admin library (standard library only). Run: python3 -m unittest discover -s radxa-admin/tests   (or `node --test`)."""
import ast
import json
import os
import re
import shutil
import struct
import sys
import tempfile
import time
import unittest
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, os.path.join(HERE, "..", "lib"))

from vadmin import api, auth, build, check, core, ideas, imgconv, pdf, portfolio_pdf, render, richtext, schema, uploads   # noqa: E402
from vadmin.core import ApiError   # noqa: E402


def read_file(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def read_json_file(path):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def png():
    def chunk(t, d):
        c = struct.pack(">I", len(d)) + t + d
        return c + struct.pack(">I", zlib.crc32(t + d))
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(b"\x00\xff\x00\x00")) + chunk(b"IEND", b"")


def glb(json_obj=None, wrong_length=False):
    doc = json.dumps(json_obj or {"asset": {"version": "2.0"}}).encode()
    doc += b" " * (-len(doc) % 4)
    total = 12 + 8 + len(doc)
    return struct.pack("<4sII", b"glTF", 2, total + (5 if wrong_length else 0)) + struct.pack("<I4s", len(doc), b"JSON") + doc


class World:
    """A temp state directory plus a COPY of the site files, so tests can alter the source without touching the repository."""

    def __init__(self, copy_src=False):
        self.dir = tempfile.mkdtemp(prefix="vadmin-test-")
        self.src = REPO
        if copy_src:
            self.src = os.path.join(self.dir, "src")
            os.makedirs(self.src)
            for name in ("index.html", "impressum.html", "datenschutz.html", "robots.txt", "assets", "data", "portfolio"):
                p = os.path.join(REPO, name)
                (shutil.copytree if os.path.isdir(p) else shutil.copy)(p, os.path.join(self.src, name))
        self.paths = core.Paths(root=os.path.join(self.dir, "root"), secret=os.path.join(self.dir, "secret"), src=self.src)
        self.paths.ensure()
        os.makedirs(self.paths.secret, mode=0o700, exist_ok=True)

    def ctx(self):
        return schema.Context(self.paths)

    def draft(self):
        return schema.empty_draft()

    def save(self, draft):
        core.write_json(self.paths.draft, schema.sanitize(draft, self.ctx()))

    def site(self, bid):
        return os.path.join(self.paths.builds, bid, "site")

    def read(self, bid, rel):
        with open(os.path.join(self.site(bid), rel), encoding="utf-8") as fh:
            return fh.read()

    def close(self):
        shutil.rmtree(self.dir, ignore_errors=True)


class Base(unittest.TestCase):
    def setUp(self):
        self.w = World()
        self.addCleanup(self.w.close)


class SchemaTests(Base):
    def test_unknown_keys_dropped_lengths_capped_control_chars_removed(self):
        d = {"rev": 3, "evil": {"x": 1}, "sections": {"hero": False, "nope": True}, "pages": [{"slug": "a", "title": {"uk": "A\x00B" * 200, "xx": "bad"}, "blocks": [{"type": "nope"}, {"type": "divider", "fields": {"style": "<b>", "extra": 1}}]}]}
        c = schema.sanitize(d, self.w.ctx())
        self.assertNotIn("evil", c)
        self.assertEqual(c["sections"], {s: (s != "hero") for s in schema.SECTION_IDS})
        title = c["pages"][0]["title"]
        self.assertEqual(set(title), {"uk", "en", "de"})
        self.assertLessEqual(len(title["uk"]), 120)
        self.assertNotIn("\x00", title["uk"])
        blocks = c["pages"][0]["blocks"]
        self.assertEqual([b["type"] for b in blocks], ["divider"])
        self.assertEqual(blocks[0]["fields"], {"style": "line"})          # an invalid choice falls back to the first option

    def test_sanitize_is_idempotent_and_survives_garbage(self):
        ctx = self.w.ctx()
        for junk in (None, [], "x", 5, {"pages": "x", "forms": [], "extra": 7, "texts": []}):
            c = schema.sanitize(junk, ctx)
            self.assertEqual(c, schema.sanitize(c, ctx))

    def test_texts_only_accept_known_paths_and_drop_unchanged_values(self):
        ctx = self.w.ctx()
        leaves = schema.editable_texts(ctx.site)
        path = "hero.lead"
        changed = dict(leaves[path], de="Neu")
        c = schema.sanitize({"texts": {path: changed, "hero.nope": changed, "../x": changed, path + "x": changed, "faq.items.0.q": leaves["faq.items.0.q"]}}, ctx)
        self.assertEqual(list(c["texts"]), [path])                          # unknown paths and unchanged values are dropped
        self.assertEqual(c["texts"][path]["de"], "Neu")

    def test_templates_create_valid_content(self):
        ctx, d = self.w.ctx(), schema.empty_draft()
        for kind, tid in (("page", "service"), ("page", "landing"), ("page", "about"), ("page", "contacts"), ("page", "blank"),
                          ("form", "project_request"), ("form", "repair"), ("form", "consultation"), ("service", ""), ("project", ""), ("section", "about"), ("section", "cta"), ("section", "gallery")):
            schema.add_from_template(d, kind, tid, ctx)
        self.assertEqual(len(d["pages"]), 5)
        self.assertEqual(len({p["slug"] for p in d["pages"]}), 5)
        self.assertTrue(all(core.valid_slug(p["slug"]) for p in d["pages"]))
        self.assertEqual(sorted(d["forms"]), ["consultation", "project-request", "repair"])
        for form in d["forms"].values():
            self.assertTrue(any(f["type"] == "email" and f["required"] for f in form["fields"]))
        with self.assertRaises(ApiError):
            schema.add_from_template(d, "page", "nope", ctx)
        again = schema.add_from_template(d, "page", "service", ctx)
        self.assertEqual(len({p["slug"] for p in d["pages"]}), 6, "a second page from the same template gets its own address")
        self.assertTrue(again)

    def test_slug_rules(self):
        for ok in ("a", "service-1", "about-us", "x9"):
            self.assertTrue(core.valid_slug(ok), ok)
        for bad in ("", "A", "a_b", "a b", "-a", "a-", "a--b", "api", "admin", "assets", "s", "data", "a/b", "../x", "x" * 49, None):
            self.assertFalse(core.valid_slug(bad), repr(bad))

    def test_factory_blocks_have_three_language_examples(self):
        for name, spec in self.w.ctx().blocks.items():
            for field in spec["fields"]:
                self.assertTrue(field["label"].keys() >= {"uk", "en", "de"}, (name, field["key"]))
            self.assertIn("example", spec)


class RichTextTests(unittest.TestCase):
    def test_html_is_escaped_and_markup_is_minimal(self):
        out = richtext.render_rich('<script>alert(1)</script> **bold** & [site](https://example.com/a?b=1&c=2)\n\n- one\n- two')
        self.assertNotIn("<script", out)
        self.assertIn("&lt;script&gt;", out)
        self.assertIn("<strong>bold</strong>", out)
        self.assertIn('<a href="https://example.com/a?b=1&amp;c=2" rel="noopener noreferrer">site</a>', out)
        self.assertIn("<ul><li>one</li><li>two</li></ul>", out)

    def test_unsafe_urls_stay_as_text(self):
        for url in ("javascript:alert(1)", "data:text/html,x", "//evil.example/x", "vbscript:x"):
            out = richtext.render_rich("[click](%s)" % url)
            self.assertNotIn("<a ", out, url)

    def test_attribute_breakout_is_impossible(self):
        out = richtext.render_rich('[x](https://a.example/"onmouseover="alert(1))')
        self.assertNotIn('onmouseover="', out)


class RenderTests(Base):
    def test_all_three_languages_are_written_and_missing_ones_fall_back(self):
        html = render.tl({"uk": "Привіт", "en": "", "de": ""})
        for lang in ("uk", "en", "de"):
            self.assertIn('lang="%s"' % lang, html)
        self.assertEqual(html.count("Привіт"), 3)                          # empty languages show the filled one, never an empty heading
        self.assertEqual(render.tl({"uk": "", "en": "", "de": ""}).count("<span"), 3)

    def test_user_text_cannot_inject_markup(self):
        ctx, d = self.w.ctx(), schema.empty_draft()
        pid = schema.add_from_template(d, "page", "blank", ctx)
        page = next(p for p in d["pages"] if p["id"] == pid)
        page["title"] = {"uk": "<img src=x onerror=alert(1)>", "en": "", "de": ""}
        page["blocks"][0]["fields"]["title"] = {"uk": '"><script>alert(1)</script>', "en": "", "de": ""}
        page["blocks"][0]["fields"]["body"] = {"uk": "<b>x</b>", "en": "", "de": ""}
        self.w.save(d)
        r = build.build(self.w.paths)
        self.assertTrue(r["ok"], r)
        html = self.w.read(r["id"], "s/blank/index.html")
        self.assertNotIn("<script>alert", html)
        self.assertNotIn("<img src=x", html)
        self.assertNotIn("<b>x</b>", html)


class CheckTests(Base):
    def problems(self, d):
        return check.validate(schema.sanitize(d, self.w.ctx()), self.w.ctx(), self.w.src)

    def codes(self, d):
        return {p["code"] for p in self.problems(d)}

    def test_clean_templates_need_only_a_form_choice(self):
        ctx, d = self.w.ctx(), schema.empty_draft()
        schema.add_from_template(d, "page", "service", ctx)
        self.assertEqual(self.problems(d), [])
        schema.add_from_template(d, "page", "contacts", ctx)
        self.assertEqual({p["code"] for p in self.problems(d)}, {"required"})   # the form block has no form chosen yet

    def test_empty_page_and_bad_slug(self):
        ctx, d = self.w.ctx(), schema.empty_draft()
        schema.add_from_template(d, "page", "blank", ctx)
        d["pages"][0]["blocks"] = []
        d["pages"][0]["slug"] = "api"
        self.assertEqual(self.codes(d), {"empty_page", "slug"})
        d["pages"][0]["slug"] = "ok"
        d["pages"].append(dict(d["pages"][0], id="p-2", blocks=[]))
        self.assertIn("slug_dup", self.codes(d))

    def test_required_field_needs_at_least_one_language(self):
        ctx, d = self.w.ctx(), schema.empty_draft()
        schema.add_from_template(d, "page", "blank", ctx)
        title = d["pages"][0]["blocks"][0]["fields"]["title"]
        for l in title:
            title[l] = ""
        self.assertIn("required", self.codes(d))
        title["de"] = "Nur Deutsch"
        self.assertNotIn("required", self.codes(d))

    def test_missing_images_are_found(self):
        ctx, d = self.w.ctx(), schema.empty_draft()
        schema.add_from_template(d, "page", "blank", ctx)
        d["pages"][0]["blocks"][0]["fields"]["image"] = "assets/does-not-exist.svg"
        self.assertIn("image_missing", self.codes(d))

    def test_links_to_disabled_or_unknown_pages_and_sections(self):
        ctx, d = self.w.ctx(), schema.empty_draft()
        schema.add_from_template(d, "page", "about", ctx)
        schema.add_from_template(d, "page", "service", ctx)
        cta = next(b for b in d["pages"][0]["blocks"] if b["type"] == "cta")
        cta["fields"]["button"]["href"] = "/s/service/"
        self.assertEqual(self.codes(d), set())
        d["pages"][1]["enabled"] = False
        self.assertEqual(self.codes(d), {"link_disabled"})
        cta["fields"]["button"]["href"] = "/s/ghost/"
        self.assertEqual(self.codes(d), {"link_disabled"})
        cta["fields"]["button"]["href"] = "/#contact"
        d["sections"]["contact"] = False
        self.assertIn("link_disabled", self.codes(d))
        d["sections"]["contact"] = True
        cta["fields"]["button"]["href"] = "#nowhere"
        self.assertIn("link_anchor", self.codes(d))

    def test_links_inside_long_texts_are_checked_too(self):
        ctx, d = self.w.ctx(), schema.empty_draft()
        schema.add_from_template(d, "page", "blank", ctx)
        d["pages"][0]["blocks"][0]["fields"]["body"]["uk"] = "див. [тут](/s/ghost/)"
        self.assertIn("link_disabled", self.codes(d))

    def test_disabling_a_section_the_factory_markup_links_to_is_refused(self):
        d = schema.empty_draft()
        d["sections"]["contact"] = False
        self.assertIn("link_disabled", self.codes(d))          # hero/projects/pricing still link to #contact
        d["sections"].update({"hero": False, "work": False, "pricing": False})
        self.assertNotIn("link_disabled", self.codes(d))

    def test_form_rules(self):
        ctx, d = self.w.ctx(), schema.empty_draft()
        fid = schema.add_from_template(d, "form", "consultation", ctx)
        self.assertEqual(self.problems(d), [])
        d["forms"][fid]["fields"] = [f for f in d["forms"][fid]["fields"] if f["type"] != "email"]
        self.assertIn("form_email", self.codes(d))
        d["forms"][fid]["fields"] = []
        self.assertIn("form_empty", self.codes(d))

    def test_only_one_product_grid_per_page(self):
        ctx, d = self.w.ctx(), schema.empty_draft()
        pid = schema.add_from_template(d, "page", "landing", ctx)
        page = next(p for p in d["pages"] if p["id"] == pid)
        for b in page["blocks"]:
            if b["type"] == "form":
                b["fields"]["form"] = "x"
        page["blocks"].append({"id": "b-extra", "type": "projects", "enabled": True, "anchor": "", "fields": json.loads(json.dumps(ctx.blocks["projects"]["example"]))})
        self.assertIn("grid_dup", self.codes(d))


class BuildTests(unittest.TestCase):
    def setUp(self):
        self.w = World(copy_src=True)
        self.addCleanup(self.w.close)

    def test_empty_draft_reproduces_the_factory_site_exactly(self):
        r = build.build(self.w.paths)                                       # no draft.json at all
        self.assertTrue(r["ok"], r)
        for rel in ("index.html", "assets/app.js", "assets/styles.css"):
            self.assertEqual(read_file(os.path.join(self.w.src, rel)), self.w.read(r["id"], rel), rel)
        for rel in ("data/site.json", "data/products.json"):
            self.assertEqual(read_json_file(os.path.join(self.w.src, rel)), json.loads(self.w.read(r["id"], rel)), rel)
        for rel in ("data/blocks.json", "data/templates.json"):
            self.assertFalse(os.path.exists(os.path.join(self.w.site(r["id"]), rel)), "the builder's own data is not published")

    def test_a_damaged_draft_falls_back_to_the_factory_site(self):
        with open(self.w.paths.draft, "w") as fh:
            fh.write("{ not json")
        r = build.build(self.w.paths)
        self.assertTrue(r["ok"], r)
        self.assertEqual(self.w.read(r["id"], "index.html"), read_file(os.path.join(self.w.src, "index.html")))

    def test_disabled_things_are_removed_not_hidden(self):
        d = self.w.draft()
        d["sections"].update({"faq": False, "stack": False, "trust": False, "ai": False})
        d["disabled"]["services"] = ["s0", "s1"]
        d["disabled"]["projects"] = ["iot-module"]
        d["widgets"]["gallery3d"] = False
        self.w.save(d)
        r = build.build(self.w.paths)
        html = self.w.read(r["id"], "index.html")
        for sid in ("faq", "stack", "ai"):
            self.assertNotIn('id="%s"' % sid, html)
            self.assertNotIn('href="#%s"' % sid, html, "its menu link is gone too")
        self.assertNotIn('class="trust"', html)
        self.assertNotIn("display:none", html.replace(" ", ""))
        self.assertNotIn("gallery3d.js", html)
        site = json.loads(self.w.read(r["id"], "data/site.json"))
        self.assertEqual(len(site["services"]["items"]), len(read_json_file(os.path.join(self.w.src, "data/site.json"))["services"]["items"]) - 2)
        self.assertEqual(site["faq"]["items"], [])
        products = json.loads(self.w.read(r["id"], "data/products.json"))
        self.assertNotIn("iot-module", [p["id"] for p in products])
        self.assertTrue(all("model" not in p for p in products))
        pub = self.w.site(r["id"])
        self.assertFalse(os.path.exists(os.path.join(pub, "assets/gallery3d.js")))
        self.assertFalse(os.path.exists(os.path.join(pub, "assets/vendor")))
        self.assertFalse(os.path.exists(os.path.join(pub, "assets/models")))

    def test_text_overrides_extra_items_and_extra_sections(self):
        ctx, d = self.w.ctx(), self.w.draft()
        d["texts"]["hero.lead"] = {"uk": "Новий", "en": "New", "de": "Neu"}
        sid = schema.add_from_template(d, "service", "", ctx)
        d["extra"]["services"][0]["title"] = {"uk": "Моя послуга", "en": "My service", "de": "Mein Service"}
        schema.add_from_template(d, "project", "", ctx)
        schema.add_from_template(d, "section", "cta", ctx)
        self.w.save(d)
        r = build.build(self.w.paths)
        self.assertTrue(r["ok"], r)
        site = json.loads(self.w.read(r["id"], "data/site.json"))
        self.assertEqual(site["hero"]["lead"]["de"], "Neu")
        self.assertEqual(site["services"]["items"][-1]["title"]["en"], "My service")
        self.assertEqual(len(json.loads(self.w.read(r["id"], "data/products.json"))), len(json.load(open(os.path.join(REPO, "data/products.json"), encoding="utf-8"))) + 1, "the factory projects plus the one added")
        html = self.w.read(r["id"], "index.html")
        self.assertIn("cta-box", html)
        self.assertLess(html.index("cta-box"), html.index('id="contact"'), "extra sections sit before the contact section")
        self.assertIn("assets/blocks.css", html)
        self.assertTrue(sid)

    def test_pages_sitemap_nav_and_forms_json(self):
        ctx, d = self.w.ctx(), self.w.draft()
        schema.add_from_template(d, "form", "consultation", ctx)
        a = schema.add_from_template(d, "page", "service", ctx)
        b = schema.add_from_template(d, "page", "about", ctx)
        c = schema.add_from_template(d, "page", "landing", ctx)
        for p in d["pages"]:
            if p["id"] == a:
                p["inNav"] = True
            if p["id"] == b:
                p["enabled"] = False
            if p["id"] == c:
                for blk in p["blocks"]:
                    if blk["type"] == "form":
                        blk["fields"]["form"] = "consultation"
        self.w.save(d)
        r = build.build(self.w.paths)
        self.assertTrue(r["ok"], r)
        pub = self.w.site(r["id"])
        self.assertTrue(os.path.isfile(os.path.join(pub, "s/service/index.html")))
        self.assertTrue(os.path.isfile(os.path.join(pub, "s/landing/index.html")))
        self.assertFalse(os.path.exists(os.path.join(pub, "s/about")), "a disabled page is not built")
        sm = self.w.read(r["id"], "sitemap.xml")
        self.assertIn("https://viteh.org/s/service/", sm)
        self.assertNotIn("/s/about/", sm)
        self.assertRegex(sm, r"<lastmod>\d{4}-\d{2}-\d{2}</lastmod>")
        self.assertIn('href="/s/service/"', self.w.read(r["id"], "index.html"), "the home menu links the page marked 'in menu'")
        self.assertNotIn('href="/s/landing/"', self.w.read(r["id"], "index.html"))
        page = self.w.read(r["id"], "s/service/index.html")
        self.assertIn('href="/#services"', page, "menu anchors point back to the home page")
        self.assertIn('data-page="page"', page)
        forms = json.loads(self.w.read(r["id"], "forms.json"))
        self.assertEqual(list(forms), ["consultation"])
        self.assertTrue(all(set(f) >= {"key", "type", "label", "required", "max"} for f in forms["consultation"]["fields"]))
        self.assertIn('data-vform="consultation"', self.w.read(r["id"], "s/landing/index.html"))
        self.assertNotIn('href="#top"', self.w.read(r["id"], "s/landing/index.html"), "the footer logo leads home, not to a missing anchor")

    def test_project_archive_ships_and_an_uploaded_picture_fills_a_slot(self):
        r = build.build(self.w.paths)
        self.assertTrue(r["ok"], r)
        factory = json.loads(self.w.read(r["id"], "data/portfolio-images.json"))
        self.assertEqual(factory, json.load(open(os.path.join(REPO, "data/portfolio-images.json"), encoding="utf-8")), "an empty draft keeps the factory manifest")
        self.assertTrue(self.w.read(r["id"], "data/portfolio.json"))
        pub = self.w.site(r["id"])
        final = {"assets/portfolio/%s/%s.%s" % (m["slug"], m["slot"], ext) for m in factory if m["status"] == "final" for ext in ("webp", "jpg")}
        shipped = {os.path.relpath(os.path.join(rt, f), pub) for rt, _, fs in os.walk(os.path.join(pub, "assets/portfolio")) for f in fs if not f.endswith(".pdf") and not rt.endswith("/img")}
        self.assertEqual(shipped - final, set(), "no placeholder files in the package, only the slots that are final in the factory manifest")
        self.assertFalse(os.path.exists(os.path.join(pub, "tools")))
        img = uploads.store(self.w.paths, png(), "board.png")
        d = self.w.draft()
        d["images"]["portfolio"] = {"prometheus-controller/board-photo": img["ref"], "no-such/slot": img["ref"], "can-helper/window": "assets/product-pcb.svg"}
        self.w.save(d)
        r = build.build(self.w.paths)
        self.assertTrue(r["ok"], r)
        by = {"%s/%s" % (m["slug"], m["slot"]): m for m in json.loads(self.w.read(r["id"], "data/portfolio-images.json"))}
        self.assertEqual((by["prometheus-controller/board-photo"]["status"], by["prometheus-controller/board-photo"]["file"]), ("final", "assets/u/" + img["file"]))
        self.assertEqual(by["can-helper/window"]["status"], "placeholder", "only uploaded images may fill a slot")
        self.assertTrue(os.path.isfile(os.path.join(self.w.site(r["id"]), "assets/u", img["file"])))

    def test_portfolio_link_can_be_switched_off(self):
        r = build.build(self.w.paths)
        self.assertEqual(self.w.read(r["id"], "index.html").count('href="portfolio/"'), 2)
        self.assertTrue(os.path.isfile(os.path.join(self.w.site(r["id"]), "portfolio/index.html")))

        d = self.w.draft()
        d["widgets"]["portfolioLink"] = False
        self.w.save(d)
        r = build.build(self.w.paths)
        self.assertTrue(r["ok"], r)
        html = self.w.read(r["id"], "index.html")
        self.assertNotIn('href="portfolio/"', html)
        self.assertFalse(os.path.exists(os.path.join(self.w.site(r["id"]), "portfolio")), "the page is not shipped while its link is off")
        self.assertNotIn("portfolio-link", html)
        self.assertIn('id="contact"', html)

    def test_portfolio_texts_are_editable_and_sections_can_be_switched_off(self):
        ctx = self.w.ctx()
        leaves = schema.editable_texts(ctx.site)
        path = "portfolioPage.sections.0.title"
        self.assertIn(path, leaves)
        self.assertEqual(set(leaves[path]), {"uk", "en", "de"})
        self.assertIn("portfolioPage:profile", api.catalog(self.w.paths, ctx)["portfolioTexts"], "the portfolio page texts are edited with the portfolio, not among the site texts")
        self.assertNotIn("portfolioPage:profile", api.catalog(self.w.paths, ctx)["texts"])
        d = self.w.draft()
        d["texts"][path] = {"uk": "Новий", "en": "New", "de": "Neu"}
        d["disabled"]["portfolio"] = ["web", "no-such-section"]
        self.w.save(d)
        r = build.build(self.w.paths)
        self.assertTrue(r["ok"], r)
        site = json.loads(self.w.read(r["id"], "data/site.json"))
        secs = site["portfolioPage"]["sections"]
        self.assertEqual(secs[0]["title"]["de"], "Neu")
        self.assertNotIn("web", [x["id"] for x in secs])
        self.assertIn("android", [x["id"] for x in secs])
        clean = schema.sanitize(d, ctx)
        self.assertEqual(clean["portfolio"]["disabledSections"], ["web"], "unknown ids are dropped by the sanitiser; the old key was migrated")
        self.assertNotIn("portfolio", clean["disabled"])
        self.assertEqual(clean["portfolio"]["texts"][path]["de"], "Neu")
        self.assertNotIn(path, clean["texts"])

    def test_archive_slot_alt_texts_are_editable(self):
        ctx = self.w.ctx()
        self.assertEqual(len(api.catalog(self.w.paths, ctx)["factory"]["portfolioSlots"]), len(ctx.portfolio_images))
        d = self.w.draft()
        d["images"]["portfolioAlt"] = {"can-helper/window": {"uk": "Вікно CanHelper", "en": "", "de": ""}, "no-such/slot": {"en": "x"}, "can-helper/device": {"uk": "", "en": "", "de": ""}}
        self.w.save(d)
        clean = schema.sanitize(d, ctx)["portfolio"]["alts"]
        self.assertEqual(list(clean), ["can-helper/window"], "unknown slots and empty texts are dropped")
        r = build.build(self.w.paths)
        self.assertTrue(r["ok"], r)
        by = {"%s/%s" % (m["slug"], m["slot"]): m for m in json.loads(self.w.read(r["id"], "data/portfolio-images.json"))}
        alt = by["can-helper/window"]["alt"]
        self.assertEqual(alt["uk"], "Вікно CanHelper")
        self.assertTrue(alt["en"] and alt["de"], "languages left empty keep the factory text")
        self.assertEqual(by["can-helper/window"]["status"], "placeholder", "an alt text alone does not publish a picture")

    def test_uploads_replace_images_and_models(self):
        ctx, d = self.w.ctx(), self.w.draft()
        img = uploads.store(self.w.paths, png(), "hero photo.png")
        model = uploads.store(self.w.paths, glb(), "cronos.glb")
        d = self.w.draft()
        d["images"]["hero"] = img["ref"]
        d["images"]["projects"]["cronos-controller"] = img["ref"]
        d["images"]["models"]["iot-module"] = model["ref"]
        self.w.save(d)
        r = build.build(self.w.paths)
        self.assertTrue(r["ok"], r)
        self.assertIn("assets/u/" + img["file"], self.w.read(r["id"], "index.html"))
        products = {p["id"]: p for p in json.loads(self.w.read(r["id"], "data/products.json"))}
        self.assertEqual(products["cronos-controller"]["image"], "assets/u/" + img["file"])
        self.assertEqual(products["iot-module"]["model"], "assets/models/u-" + model["file"])
        self.assertTrue(os.path.isfile(os.path.join(self.w.site(r["id"]), "assets/u", img["file"])))
        self.assertTrue(os.path.isfile(os.path.join(self.w.site(r["id"]), "assets/models", "u-" + model["file"])))

    def test_the_preview_folder_follows_the_current_build(self):
        first = build.build(self.w.paths)
        self.assertTrue(first["ok"], first)
        preview = self.w.paths.preview
        self.assertEqual(re.sub(r"\?v=%s" % first["id"], "", read_file(os.path.join(preview, "index.html"))), self.w.read(first["id"], "index.html"), "the preview differs from the package only by the cache-busting ?v=<build id>")
        marker = os.path.join(preview, "old-only.txt")
        with open(marker, "w") as fh:
            fh.write("stale")                                  # anything not in the next build must disappear
        ctx, d = self.w.ctx(), self.w.draft()
        schema.add_from_template(d, "page", "about", ctx)
        self.w.save(d)
        second = build.build(self.w.paths)
        self.assertTrue(second["ok"], second)
        self.assertFalse(os.path.exists(marker))
        self.assertEqual(sorted(os.listdir(preview)), sorted(os.listdir(self.w.site(second["id"]))))
        self.assertFalse(os.path.exists(preview + ".new"))
        build.set_current(self.w.paths, first["id"])                      # rollback switches the preview back
        self.assertEqual(sorted(os.listdir(preview)), sorted(os.listdir(self.w.site(first["id"]))))

    def test_a_check_failure_builds_nothing(self):
        ctx, d = self.w.ctx(), self.w.draft()
        schema.add_from_template(d, "page", "contacts", ctx)           # the form block has no form
        self.w.save(d)
        r = build.build(self.w.paths)
        self.assertFalse(r["ok"])
        self.assertTrue(r["problems"])
        self.assertEqual(os.listdir(self.w.paths.builds), [], "no package and no temp directory is left behind")

    def test_a_third_party_request_in_the_package_stops_the_build(self):
        with open(os.path.join(self.w.src, "index.html"), "a", encoding="utf-8") as fh:
            fh.write('<script src="https://cdn.example.com/lib.js"></script>')
        with self.assertRaises(ApiError) as ctx:
            build.build(self.w.paths)
        self.assertEqual(ctx.exception.code, "external_request")
        self.assertEqual(os.listdir(self.w.paths.builds), [])

    def test_scan_knows_the_difference_between_a_request_and_a_link(self):
        d = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, d, True)
        def put(name, text):
            with open(os.path.join(d, name), "w") as fh:
                fh.write(text)
        put("ok.html", '<a href="https://example.com/">x</a><link rel="canonical" href="https://viteh.org/"><link rel="alternate" hreflang="de" href="https://viteh.org/?lang=de"><img src="/a.png">')
        self.assertEqual(build.scan_external(d), [])
        for name, text in (("a.html", '<img src="https://x.example/a.png">'), ("b.html", '<link rel="stylesheet" href="https://fonts.example/css">'),
                           ("c.css", "@import url(https://x.example/a.css);"), ("d.css", "a{background:url('//x.example/a.png')}"), ("e.js", 'fetch("https://x.example/api")'),
                           ("f.html", '<iframe src="//x.example/"></iframe>')):
            put(name, text)
            self.assertIn(name, build.scan_external(d), name)

    def test_manifest_matches_files_and_detects_changes(self):
        r = build.build(self.w.paths)
        self.assertTrue(build.verify_build(self.w.paths, r["id"])["ok"])
        with open(os.path.join(self.w.site(r["id"]), "index.html"), "a") as fh:
            fh.write("x")
        v = build.verify_build(self.w.paths, r["id"])
        self.assertFalse(v["ok"])
        self.assertEqual(v["bad"], ["index.html"])

    def test_history_keeps_20_builds_and_never_drops_the_published_one(self):
        ids = []
        for i in range(23):
            time.sleep(0.002)
            r = build.build(self.w.paths)
            ids.append(r["id"])
            if i == 0:
                st = build.read_state(self.w.paths)
                st["published"] = r["id"]
                core.write_json(self.w.paths.state, st)
        kept = [b["id"] for b in build.list_builds(self.w.paths)]
        self.assertEqual(len(kept), 21)                                      # 20 newest + the published one
        self.assertIn(ids[0], kept)
        self.assertNotIn(ids[1], kept)
        self.assertEqual(os.path.realpath(os.path.join(self.w.paths.builds, "current")), os.path.realpath(os.path.join(self.w.paths.builds, ids[-1])))

    def test_unused_uploads_are_collected_but_referenced_and_fresh_ones_stay(self):
        old = uploads.store(self.w.paths, png(), "old.png")
        index = core.read_json(self.w.paths.uploads_index)
        index["items"][old["id"]]["created"] = "20200101-000000"
        core.write_json(self.w.paths.uploads_index, index)
        fresh = uploads.store(self.w.paths, png(), "fresh.png")
        used = uploads.store(self.w.paths, png(), "used.png")
        index = core.read_json(self.w.paths.uploads_index)
        index["items"][used["id"]]["created"] = "20200101-000000"
        core.write_json(self.w.paths.uploads_index, index)
        d = self.w.draft()
        d["images"]["hero"] = used["ref"]
        self.w.save(d)
        build.build(self.w.paths)
        items = core.read_json(self.w.paths.uploads_index)["items"]
        self.assertNotIn(old["id"], items)
        self.assertIn(fresh["id"], items)
        self.assertIn(used["id"], items)
        self.assertFalse(os.path.exists(os.path.join(self.w.paths.uploads, old["file"])))

    def test_rollback_restores_the_draft_of_a_build(self):
        d = self.w.draft()
        d["sections"]["faq"] = False
        self.w.save(d)
        first = build.build(self.w.paths)["id"]
        d = self.w.draft()
        d["sections"]["stack"] = False
        self.w.save(d)
        build.build(self.w.paths)
        snap = core.read_json(os.path.join(self.w.paths.builds, first, "draft.json"))
        self.assertFalse(snap["sections"]["faq"])
        self.assertTrue(snap["sections"]["stack"])


class ServiceModelTests(unittest.TestCase):
    """3D models on service cards: replace, add, strip when the widget is off, and the checks for missing factory files."""

    def setUp(self):
        self.w = World(copy_src=True)
        self.addCleanup(self.w.close)

    def test_factory_services_carry_models_and_posters_and_empty_draft_keeps_them(self):
        r = build.build(self.w.paths)
        site = json.loads(self.w.read(r["id"], "data/site.json"))
        with_model = [it for it in site["services"]["items"] if it.get("model")]
        self.assertGreaterEqual(len(with_model), 3)
        for it in with_model:
            self.assertTrue(os.path.isfile(os.path.join(self.w.site(r["id"]), it["model"])))
            for theme in ("light", "dark"):
                self.assertTrue(os.path.isfile(os.path.join(self.w.site(r["id"]), "%s-%s.webp" % (it["poster"], theme))))
        for rel in ("assets/env/studio.hdr", "assets/viewer-settings.js", "assets/gallery3d.js"):
            self.assertTrue(os.path.isfile(os.path.join(self.w.site(r["id"]), rel)), rel)

    def test_replacing_a_service_model_uses_the_upload_and_drops_the_factory_poster(self):
        model = uploads.store(self.w.paths, glb(), "mine.glb")
        d = self.w.draft()
        d["images"]["serviceModels"]["s0"] = model["ref"]
        self.w.save(d)
        r = build.build(self.w.paths)
        self.assertTrue(r["ok"], r)
        first = json.loads(self.w.read(r["id"], "data/site.json"))["services"]["items"][0]
        self.assertEqual(first["model"], "assets/models/u-" + model["file"])
        self.assertNotIn("poster", first)
        self.assertTrue(os.path.isfile(os.path.join(self.w.site(r["id"]), first["model"])))

    def test_a_new_service_can_have_a_model_and_unknown_service_ids_are_dropped(self):
        ctx, d = self.w.ctx(), self.w.draft()
        schema.add_from_template(d, "service", "", ctx)
        model = uploads.store(self.w.paths, glb(), "new.glb")
        d["extra"]["services"][0]["model"] = model["ref"]
        d["extra"]["services"][0]["title"] = {"uk": "Нова", "en": "New", "de": "Neu"}
        d["images"]["serviceModels"]["s999"] = model["ref"]
        d["images"]["serviceModels"]["s1"] = "u:ffffffffffffffff"        # not an upload we know
        clean = schema.sanitize(d, self.w.ctx())               # a fresh context sees the new upload
        self.assertEqual(clean["images"]["serviceModels"], {})
        self.assertEqual(clean["extra"]["services"][0]["model"], model["ref"])
        self.w.save(d)
        r = build.build(self.w.paths)
        last = json.loads(self.w.read(r["id"], "data/site.json"))["services"]["items"][-1]
        self.assertEqual(last["model"], "assets/models/u-" + model["file"])

    def test_widget_off_strips_models_posters_and_every_3d_file(self):
        d = self.w.draft()
        d["widgets"]["gallery3d"] = False
        self.w.save(d)
        r = build.build(self.w.paths)
        site = json.loads(self.w.read(r["id"], "data/site.json"))
        self.assertTrue(all("model" not in it and "poster" not in it for it in site["services"]["items"]))
        products = json.loads(self.w.read(r["id"], "data/products.json"))
        self.assertTrue(all("model" not in p and "poster" not in p for p in products))
        pub = self.w.site(r["id"])
        for rel in ("assets/models", "assets/posters", "assets/env", "assets/vendor", "assets/gallery3d.js", "assets/viewer-settings.js"):
            self.assertFalse(os.path.exists(os.path.join(pub, rel)), rel)
        self.assertNotIn("gallery3d.js", self.w.read(r["id"], "index.html"))

    def test_a_missing_factory_model_or_poster_blocks_the_build(self):
        os.remove(os.path.join(self.w.src, "assets/models/service-ai.glb"))
        r = build.build(self.w.paths)
        self.assertFalse(r["ok"])
        self.assertIn("model_missing", {p["code"] for p in r["problems"]})
        shutil.copy(os.path.join(REPO, "assets/models/service-ai.glb"), os.path.join(self.w.src, "assets/models/service-ai.glb"))
        os.remove(os.path.join(self.w.src, "assets/posters/service-ai-dark.webp"))
        r = build.build(self.w.paths)
        self.assertIn("poster_missing", {p["code"] for p in r["problems"]})

    def test_disabling_the_service_or_replacing_its_model_silences_the_check(self):
        os.remove(os.path.join(self.w.src, "assets/models/service-ai.glb"))
        d = self.w.draft()
        d["disabled"]["services"] = ["s2"]
        self.w.save(d)
        self.assertTrue(build.build(self.w.paths)["ok"])
        model = uploads.store(self.w.paths, glb(), "m.glb")
        d = self.w.draft()
        d["images"]["serviceModels"]["s2"] = model["ref"]
        self.w.save(d)
        self.assertTrue(build.build(self.w.paths)["ok"])


class UploadTests(Base):
    def test_accepts_the_four_image_types_and_glb_and_names_are_random(self):
        names = set()
        for data, kind, ext in ((b"\xff\xd8\xff\xe0" + b"0" * 40, "image", "jpg"), (png(), "image", "png"), (b"RIFF\x20\x00\x00\x00WEBPVP8 " + b"0" * 30, "image", "webp"),
                                (b"\x00\x00\x00\x1cftypavif" + b"0" * 30, "image", "avif"), (glb(), "model", "glb")):
            item = uploads.store(self.w.paths, data, "../../evil name.exe")
            self.assertEqual((item["kind"], item["file"].rsplit(".", 1)[1]), (kind, ext))
            self.assertRegex(item["file"], r"^[0-9a-f]{16}\.(jpg|png|webp|avif|glb)$")
            self.assertNotIn("/", item["name"])
            names.add(item["file"])
        self.assertEqual(len(names), 5)

    def test_refused_types(self):
        for data, code in ((b"<svg xmlns='http://www.w3.org/2000/svg' onload='alert(1)'></svg>" + b" " * 40, "svg_refused"), (b'<?xml version="1.0"?><svg/>' + b" " * 40, "svg_refused"),
                           (b"MZ" + b"0" * 100, "bad_type"), (b"GIF89a" + b"0" * 100, "bad_type"), (b"%PDF-1.7" + b"0" * 100, "bad_type"), (b"#!/bin/sh\nrm -rf /" + b"0" * 50, "bad_type"),
                           (b"PK\x03\x04" + b"0" * 100, "bad_type")):
            with self.assertRaises(ApiError) as cm:
                uploads.store(self.w.paths, data, "x.png")
            self.assertEqual(cm.exception.code, code)

    def test_size_limits(self):
        with self.assertRaises(ApiError) as cm:
            uploads.store(self.w.paths, b"\xff\xd8\xff" + b"0" * uploads.IMAGE_MAX, "big.jpg")
        self.assertEqual(cm.exception.code, "too_large")
        with self.assertRaises(ApiError):
            uploads.store(self.w.paths, glb({"asset": {"version": "2.0"}, "x": "y" * (uploads.MODEL_MAX)}), "big.glb")

    def test_glb_must_be_self_contained_and_consistent(self):
        for doc, wrong, code in (({"asset": {"version": "2.0"}, "buffers": [{"uri": "https://evil.example/x.bin", "byteLength": 1}]}, False, "glb_external"),
                                 ({"asset": {"version": "2.0"}, "images": [{"uri": "tex.png"}]}, False, "glb_external"), ({"asset": {"version": "2.0"}}, True, "bad_glb"),
                                 ({"asset": {"version": "2.0"}, "extensionsRequired": ["VENDOR_weird"]}, False, "glb_ext")):
            with self.assertRaises(ApiError) as cm:
                uploads.store(self.w.paths, glb(doc, wrong), "m.glb")
            self.assertEqual(cm.exception.code, code)
        uploads.store(self.w.paths, glb({"asset": {"version": "2.0"}, "buffers": [{"uri": "data:application/octet-stream;base64,AAAA", "byteLength": 3}]}), "ok.glb")

    def test_deleting_a_used_upload_is_refused(self):
        item = uploads.store(self.w.paths, png(), "a.png")
        with self.assertRaises(ApiError) as cm:
            uploads.delete(self.w.paths, item["id"], {item["id"]})
        self.assertEqual(cm.exception.code, "in_use")
        uploads.delete(self.w.paths, item["id"], set())
        self.assertFalse(os.path.exists(os.path.join(self.w.paths.uploads, item["file"])))
        with self.assertRaises(ApiError):
            uploads.delete(self.w.paths, "../../etc/passwd", set())


class AuthTests(Base):
    PHRASE = "correct horse battery staple 42"

    def test_phrase_rules_and_storage(self):
        with self.assertRaises(ApiError):
            auth.set_passphrase(self.w.paths, "short")
        auth.set_passphrase(self.w.paths, self.PHRASE)
        self.assertEqual(oct(os.stat(self.w.paths.auth).st_mode & 0o777), "0o600")
        raw = read_file(self.w.paths.auth)
        self.assertNotIn(self.PHRASE, raw)
        self.assertIn("iterations", raw)

    def test_login_session_and_tamper(self):
        auth.set_passphrase(self.w.paths, self.PHRASE)
        cookie = auth.login(self.w.paths, self.PHRASE, "1.2.3.4")
        self.assertTrue(auth.check_session(self.w.paths, cookie))
        self.assertFalse(auth.check_session(self.w.paths, cookie[:-1] + ("0" if cookie[-1] != "0" else "1")))
        self.assertFalse(auth.check_session(self.w.paths, "9999999999.abcd." + "0" * 64))
        self.assertFalse(auth.check_session(self.w.paths, ""))
        self.assertFalse(auth.check_session(self.w.paths, cookie, now=time.time() + auth.SESSION_SECONDS + 5), "sessions expire")
        auth.revoke_all(self.w.paths)
        self.assertFalse(auth.check_session(self.w.paths, cookie), "revoking rotates the key")

    def test_five_failures_lock_the_client_for_15_minutes_but_not_others(self):
        auth.set_passphrase(self.w.paths, self.PHRASE)
        now = 1_000_000.0
        for i in range(auth.MAX_FAILS):
            with self.assertRaises(ApiError) as cm:
                auth.login(self.w.paths, "wrong", "6.6.6.6", now + i)
            self.assertEqual(cm.exception.status, 401)
        with self.assertRaises(ApiError) as cm:
            auth.login(self.w.paths, self.PHRASE, "6.6.6.6", now + 10)        # even the right phrase is refused while locked
        self.assertEqual(cm.exception.status, 429)
        self.assertTrue(auth.login(self.w.paths, self.PHRASE, "7.7.7.7", now + 10))
        self.assertTrue(auth.login(self.w.paths, self.PHRASE, "6.6.6.6", now + auth.LOCK_SECONDS + 100), "the lock expires")

    def test_not_configured(self):
        with self.assertRaises(ApiError) as cm:
            auth.login(self.w.paths, "x", "1.1.1.1")
        self.assertEqual(cm.exception.code, "not_configured")


class ApiTests(Base):
    PHRASE = "correct horse battery staple 42"

    def setUp(self):
        Base.setUp(self)
        auth.set_passphrase(self.w.paths, self.PHRASE)
        self.h = {"x-vadmin": "1", "host": "radxa:8082", "origin": "http://radxa:8082"}

    def call(self, method, action, body=None, headers=None, cookie=None, raw=None):
        h = dict(self.h, **(headers or {}))
        if cookie:
            h["cookie"] = "vadmin=" + cookie
        data = raw if raw is not None else (json.dumps(body).encode() if body is not None else b"")
        status, hd, out = api.handle(self.w.paths, method, action, h, data, {}, "10.0.0.5")
        return status, dict(hd), json.loads(out)

    def login(self):
        st, hd, _ = self.call("POST", "login", {"passphrase": self.PHRASE})
        self.assertEqual(st, 200)
        return hd["Set-Cookie"].split(";")[0].split("=", 1)[1]

    def test_everything_needs_a_session_and_the_csrf_headers(self):
        self.assertEqual(self.call("GET", "bootstrap")[0], 401)
        self.assertEqual(self.call("POST", "build", {})[0], 401)
        self.assertEqual(self.call("POST", "login", {"passphrase": self.PHRASE}, headers={"x-vadmin": "", "origin": ""})[0], 403)
        self.assertEqual(self.call("POST", "login", {"passphrase": self.PHRASE}, headers={"origin": "http://evil.example"})[0], 403)
        self.assertEqual(self.call("DELETE", "bootstrap")[0], 405)

    def test_cookie_flags(self):
        _, hd, _ = self.call("POST", "login", {"passphrase": self.PHRASE})
        flags = hd["Set-Cookie"]
        for needle in ("HttpOnly", "SameSite=Strict", "Path=/", "Max-Age="):
            self.assertIn(needle, flags)

    def test_origin_alone_is_enough_because_uhttpd_drops_x_vadmin(self):
        h = {"host": "admin.viteh.org", "origin": "https://admin.viteh.org"}
        st, hd, _ = self.call("POST", "login", {"passphrase": self.PHRASE}, headers=dict(h, **{"x-vadmin": ""}))
        self.assertEqual(st, 200)
        self.assertIn("; Secure", hd["Set-Cookie"], "https origin gives a Secure cookie")
        _, hd, _ = self.call("POST", "login", {"passphrase": self.PHRASE})
        self.assertNotIn("Secure", hd["Set-Cookie"], "the private http ports keep a plain cookie")

    def test_deploy_button_queues_and_the_agent_reports_back(self):
        from vadmin import deploy
        cookie = self.login()
        self.assertEqual(self.call("POST", "deploy", {"id": "20260101-000000-deadbeef"}, cookie=cookie)[0], 404)
        self.assertEqual(self.call("POST", "deploy", {"id": "../x"}, cookie=cookie)[0], 404)
        self.assertEqual(self.call("POST", "deploy", {"id": "20260101-000000-deadbeef"})[0], 401)
        st, _, r = self.call("POST", "build", {}, cookie=cookie)
        bid = r["result"]["id"]
        st, _, r = self.call("POST", "deploy", {"id": bid}, cookie=cookie)
        self.assertEqual((st, r["status"]["deploy"]["state"]), (200, "queued"))
        self.assertFalse(r["status"]["deploy"]["agentOnline"])
        self.assertEqual(self.call("POST", "deploy", {"id": bid}, cookie=cookie)[0], 409, "one publish at a time")
        self.assertEqual(deploy.next_request(self.w.paths), bid)
        self.assertEqual(deploy.next_request(self.w.paths), "", "a running request is not handed out twice")
        deploy.report(self.w.paths, bid, True, "Published.")
        d = self.call("GET", "status", cookie=cookie)[2]["status"]["deploy"]
        self.assertEqual((d["state"], d["log"], d["agentOnline"]), ("ok", "Published.", True))
        with self.assertRaises(core.ApiError):
            deploy.report(self.w.paths, "20260101-000000-deadbeef", True, "")

    def test_cgi_status_line_has_the_reason_phrase(self):
        """uhttpd on the Radxa turns "Status: 401" without the text into a 200, which would show the login error as a success."""
        import subprocess, sys
        env = dict(os.environ, REQUEST_METHOD="GET", QUERY_STRING="action=status", VADMIN_ROOT=self.w.paths.root, VADMIN_SECRET=self.w.paths.secret)
        out = subprocess.run([sys.executable, os.path.join(REPO, "radxa-admin/cgi/vadmin.py")], env=env, input=b"", capture_output=True).stdout.decode()
        self.assertEqual(out.split("\r\n", 1)[0], "Status: 401 Unauthorized")

    def test_save_uses_revisions_and_reports_conflicts(self):
        cookie = self.login()
        _, _, boot = self.call("GET", "bootstrap", cookie=cookie)
        d = boot["draft"]
        st, _, r = self.call("POST", "save", {"draft": d, "rev": d["rev"]}, cookie=cookie)
        self.assertEqual((st, r["rev"]), (200, d["rev"] + 1))
        st, _, r = self.call("POST", "save", {"draft": d, "rev": d["rev"]}, cookie=cookie)
        self.assertEqual((st, r["error"]), (409, "conflict"))

    def test_build_flow_and_error_shapes(self):
        cookie = self.login()
        _, _, boot = self.call("GET", "bootstrap", cookie=cookie)
        st, _, r = self.call("POST", "template", {"kind": "page", "id": "contacts", "rev": boot["draft"]["rev"]}, cookie=cookie)
        self.assertEqual(st, 200)
        st, _, r = self.call("POST", "build", {}, cookie=cookie)
        self.assertEqual((st, r["error"]), (422, "check_failed"))
        self.assertTrue(r["problems"])
        self.assertEqual(self.call("POST", "unknown", {}, cookie=cookie)[0], 404)
        self.assertEqual(self.call("POST", "template", {"kind": "nope", "id": "x", "rev": r and 0}, cookie=cookie)[0] in (400, 409), True)

    def test_internal_errors_do_not_leak_tracebacks(self):
        cookie = self.login()
        os.rename(os.path.join(self.w.paths.src, "data"), os.path.join(self.w.paths.src, "data-moved"))
        try:
            st, _, r = self.call("GET", "bootstrap", cookie=cookie)
            self.assertIn(st, (200, 500))
            self.assertNotIn("Traceback", json.dumps(r))
        finally:
            os.rename(os.path.join(self.w.paths.src, "data-moved"), os.path.join(self.w.paths.src, "data"))

    def test_uploaded_files_are_served_only_by_id_with_safe_headers(self):
        cookie = self.login()
        st, _, r = self.call("POST", "upload", raw=png(), headers={"x-filename": "a%20b.png"}, cookie=cookie)
        self.assertEqual(st, 200)
        self.assertEqual(r["item"]["name"], "a b.png")
        uid = r["item"]["id"]
        status, headers, body = api.handle(self.w.paths, "GET", "file", dict(self.h, cookie="vadmin=" + cookie), b"", {"id": [uid]}, "x")
        self.assertEqual(status, 200)
        hd = dict(headers)
        self.assertEqual(hd["X-Content-Type-Options"], "nosniff")
        self.assertIn("sandbox", hd["Content-Security-Policy"])
        self.assertEqual(hd["Content-Type"], "image/png")
        for bad in ("../../etc/passwd", "0" * 16, ""):
            self.assertEqual(api.handle(self.w.paths, "GET", "file", dict(self.h, cookie="vadmin=" + cookie), b"", {"id": [bad]}, "x")[0], 404)


class EditPageTests(Base):
    """The "edit on the page" view: an authenticated, all-enabled copy of the home page; the overlay never reaches a package."""
    PHRASE = "correct horse battery staple 42"

    def setUp(self):
        Base.setUp(self)
        auth.set_passphrase(self.w.paths, self.PHRASE)
        self.h = {"host": "admin.viteh.org", "origin": "https://admin.viteh.org"}
        st, hd, _ = api.handle(self.w.paths, "POST", "login", self.h, json.dumps({"passphrase": self.PHRASE}).encode(), {}, "10.0.0.5")
        self.cookie = dict(hd)["Set-Cookie"].split(";")[0].split("=", 1)[1]

    def page(self, lang="uk", cookie=True):
        h = dict(self.h, cookie="vadmin=" + self.cookie) if cookie else dict(self.h)
        return api.handle(self.w.paths, "GET", "edit-page", h, b"", {"lang": [lang]}, "10.0.0.5")

    def embedded(self, html, script_id):
        m = re.search(r'<script type="application/json" id="%s">(.*?)</script>' % script_id, html, re.S)
        self.assertTrue(m, script_id)
        return json.loads(m.group(1))

    def save(self, draft):
        self.w.save(draft)

    def test_without_a_session_it_is_a_plain_page_with_a_login_link_and_no_data(self):
        st, hd, body = self.page(cookie=False)
        html = body.decode()
        self.assertEqual(st, 401)
        self.assertIn("text/html", dict(hd)["Content-Type"])
        self.assertIn('href="/"', html)
        for needle in ("ve-site", "ve-boot", "edit-overlay", "Viteh", "hero"):
            self.assertNotIn(needle, html)

    def test_everything_is_switched_on_but_the_real_draft_is_embedded_untouched(self):
        d = self.w.draft()
        d["sections"].update({"faq": False, "stack": False})
        d["disabled"]["services"] = ["s0"]
        d["disabled"]["projects"] = ["iot-module"]
        d["widgets"]["gallery3d"] = False
        self.save(d)
        st, hd, body = self.page()
        html = body.decode()
        self.assertEqual(st, 200)
        self.assertEqual(dict(hd)["Cache-Control"], "no-store")
        self.assertIn('<base href="/">', html)
        for sid in ("faq", "stack", "services", "contact"):
            self.assertIn('id="%s"' % sid, html)
        factory = read_json_file(os.path.join(REPO, "data/site.json"))
        self.assertEqual(self.embedded(html, "ve-site")["services"]["items"], factory["services"]["items"], "no card is dropped")
        self.assertEqual([p["id"] for p in self.embedded(html, "ve-products")], [p["id"] for p in read_json_file(os.path.join(REPO, "data/products.json"))])
        boot = self.embedded(html, "ve-boot")
        self.assertEqual(boot["draft"]["sections"]["faq"], False)
        self.assertEqual(boot["draft"]["disabled"]["services"], ["s0"])
        self.assertFalse(boot["gallery"])
        self.assertIn('src="edit-overlay.js?v=', html)
        self.assertIn("assets/gallery3d.js", html, "the 3D module stays on the page even when the widget is off in the draft")

    def test_draft_text_with_script_tags_cannot_break_the_page(self):
        evil = "</script><script>window.pwned=1</script><!-- \u2028"
        d = self.w.draft()
        d["texts"]["hero.lead"] = {"uk": evil, "en": evil, "de": evil}
        d["extra"]["services"] = [{"id": "x-1", "icon": "code", "title": {"uk": evil}, "text": {"uk": "t"}, "points": [{"uk": evil}]}]
        self.save(d)
        html = self.page()[2].decode()
        self.assertNotIn("<script>window.pwned", html)
        self.assertEqual(html.lower().count("</script>"), html.lower().count("<script"), "every script element is closed by its own tag")
        kept = schema.text(evil, 2000, True)               # the sanitiser has already removed the line separator; the rest must survive byte for byte
        self.assertEqual(self.embedded(html, "ve-site")["hero"]["lead"]["uk"], kept)
        self.assertEqual(self.embedded(html, "ve-boot")["draft"]["texts"]["hero.lead"]["en"], kept)
        self.assertIn("</script><script>window.pwned=1</script>", kept)

    def test_uploads_are_served_through_the_file_action_and_the_order_is_applied(self):
        item = uploads.store(self.w.paths, png(), "pic.png")
        d = self.w.draft()
        d["images"]["hero"] = item["ref"]
        d["images"]["projects"]["iot-module"] = item["ref"]
        d["order"] = ["faq", "services"]
        self.save(d)
        html = self.page()[2].decode()
        file_url = "cgi-bin/vadmin-api?action=file&amp;id=" + item["id"]
        self.assertIn(file_url, html, "the hero image")
        prods = {p["id"]: p for p in self.embedded(html, "ve-products")}
        self.assertEqual(prods["iot-module"]["image"], "cgi-bin/vadmin-api?action=file&id=" + item["id"])
        self.assertLess(html.index('id="faq"'), html.index('id="services"'))
        self.assertEqual(self.embedded(html, "ve-boot")["draft"]["order"], schema.clean_order(["faq", "services"]))

    def test_upload_name_comes_from_the_query_because_uhttpd_drops_custom_headers(self):
        h = dict(self.h, cookie="vadmin=" + self.cookie)
        st, _, out = api.handle(self.w.paths, "POST", "upload", h, png(), {"name": ["my photo.png"]}, "10.0.0.5")
        self.assertEqual(st, 200)
        self.assertEqual(json.loads(out)["item"]["name"], "my photo.png")

    def test_a_package_never_contains_the_overlay_or_its_data(self):
        d = self.w.draft()
        d["order"] = ["faq", "services"]
        d["texts"]["hero.lead"] = {"uk": "x", "en": "x", "de": "x"}
        self.save(d)
        self.page()
        w = World(copy_src=True)
        self.addCleanup(w.close)
        w.save(d)
        r = build.build(w.paths)
        self.assertTrue(r["ok"], r)
        site = w.site(r["id"])
        for root, _, names in os.walk(site):
            for name in names:
                self.assertNotIn("edit-", name)
                if name.rsplit(".", 1)[-1] in ("html", "js", "css", "json", "xml"):
                    text = read_file(os.path.join(root, name))
                    for needle in ("edit-overlay", "edit-core", "preview-tip", "vpv-", "VPreview", "ve-boot", "ve-site", "ve-edit", "VEdit"):
                        self.assertNotIn(needle, text, "%s in %s" % (needle, name))


TOYOTA = "Toyota Prius hybrid-battery monitor"       # the English title of the factory project "toyota-hv-monitor"
PDF_EN = "assets/portfolio/Vitalii_Krutikov_Engineering_Portfolio_2026.pdf"


def pdf_text(data):
    """All text of a PDF, or None when pypdf (a development-machine package, not needed on the Radxa) is not installed."""
    try:
        import io
        import pypdf
    except ImportError:
        return None
    return "\n".join(page.extract_text() for page in pypdf.PdfReader(io.BytesIO(data)).pages)


class PortfolioDraftTests(Base):
    """The project gallery in the draft: texts, switches, order, picture slots; nothing a browser sends can name a new item or a file."""

    def test_sanitize_keeps_only_known_projects_and_real_changes(self):
        ctx = self.w.ctx()
        slugs = [p["slug"] for p in ctx.portfolio_projects]
        factory = ctx.portfolio_projects[1]
        d = self.w.draft()
        d["portfolio"] = {
            "disabled": ["toyota-hv-monitor", "../../etc/passwd", "no-such", 5, "toyota-hv-monitor"],
            "order": ["lvgl-smartwatch", "../x", "lvgl-smartwatch", "toyota-hv-monitor"],
            "items": {
                "toyota-hv-monitor": {"title": {"uk": "T" * 500, "en": "New", "de": "<b>x</b>"}, "summary": {"uk": "s\x00s", "en": "", "de": ""}, "years": "2" * 99, "tags": ["a"] * 20 + [" "], "evil": 1},
                factory["slug"]: {"title": factory["title"], "summary": factory["summary"], "years": factory["years"], "tags": list(factory["tags"])},      # equal to the factory: dropped
                "no-such": {"title": {"en": "x"}}, "../x": {"title": {"en": "x"}},
            },
        }
        p = schema.sanitize(d, ctx)["portfolio"]
        self.assertEqual(p["disabled"], ["toyota-hv-monitor"])
        self.assertEqual(p["order"][:2], ["lvgl-smartwatch", "toyota-hv-monitor"])
        self.assertEqual(sorted(p["order"]), sorted(slugs), "a full permutation: missing projects keep their place at the end")
        self.assertEqual(list(p["items"]), ["toyota-hv-monitor"])
        it = p["items"]["toyota-hv-monitor"]
        self.assertEqual(len(it["title"]["uk"]), 80)
        self.assertEqual(it["title"]["de"], "<b>x</b>", "stored as text; every output escapes it")
        self.assertEqual(it["summary"]["uk"], "ss")
        self.assertEqual(len(it["years"]), 20)
        self.assertEqual(len(it["tags"]), 8)
        self.assertNotIn("evil", it)
        self.assertEqual(schema.sanitize(schema.sanitize(d, ctx), ctx)["portfolio"], p, "idempotent")

    def test_untouched_gallery_and_factory_order_are_stored_as_nothing(self):
        ctx = self.w.ctx()
        slugs = [p["slug"] for p in ctx.portfolio_projects]
        empty = {"disabled": [], "order": [], "items": {}, "images": {}, "alts": {}, "disabledSections": [], "texts": {}}
        self.assertEqual(schema.sanitize({}, ctx)["portfolio"], empty)
        self.assertEqual(schema.sanitize({"portfolio": {"order": slugs}}, ctx)["portfolio"]["order"], [])
        self.assertEqual(schema.sanitize({"portfolio": "junk"}, ctx)["portfolio"], empty)
        self.assertEqual(schema.sanitize({"portfolio": {"items": {"toyota-hv-monitor": {"title": {"uk": "", "en": "", "de": ""}}}}}, ctx)["portfolio"]["items"], {}, "an emptied title is not an override")

    def test_a_slot_takes_only_uploaded_files_the_public_script_can_show(self):
        png_item = uploads.store(self.w.paths, png(), "a.png")
        avif = uploads.store(self.w.paths, b"\x00\x00\x00\x1cftypavif" + b"\x00" * 40, "a.avif")
        ctx = self.w.ctx()
        d = {"images": {"portfolio": {"toyota-hv-monitor/device-photo": png_item["ref"], "can-helper/window": avif["ref"], "lvgl-smartwatch/home": "assets/hero-illustration.svg", "x/y": png_item["ref"]}}}
        self.assertEqual(schema.sanitize(d, ctx)["portfolio"]["images"], {"toyota-hv-monitor/device-photo": png_item["ref"]})
        self.assertNotIn("portfolio", schema.sanitize(d, ctx)["images"], "the old key is gone")


class PortfolioBuildTests(unittest.TestCase):
    def setUp(self):
        self.w = World(copy_src=True)
        self.addCleanup(self.w.close)

    def build(self, draft=None):
        if draft is not None:
            self.w.save(draft)
        r = build.build(self.w.paths)
        self.assertTrue(r["ok"], r)
        return r["id"]

    def test_an_empty_draft_ships_the_factory_gallery_and_the_factory_pdfs_byte_for_byte(self):
        bid = self.build()
        for rel in ("data/portfolio.json", "data/portfolio-images.json") + tuple("assets/portfolio/" + n for n in build.PDF_NAMES.values()):
            with open(os.path.join(self.w.src, rel), "rb") as a, open(os.path.join(self.w.site(bid), rel), "rb") as b:
                self.assertEqual(a.read(), b.read(), rel)

    def test_changes_that_the_pdf_does_not_show_keep_the_factory_pdfs(self):
        d = self.w.draft()
        d["texts"]["hero.lead"] = {"uk": "x", "en": "x", "de": "x"}
        d["order"] = ["faq", "services"]
        bid = self.build(d)
        with open(os.path.join(self.w.src, PDF_EN), "rb") as a, open(os.path.join(self.w.site(bid), PDF_EN), "rb") as b:
            self.assertEqual(a.read(), b.read())

    def test_a_disabled_project_is_removed_from_the_data_the_files_and_the_pdf(self):
        before = pdf_text(read_bytes(os.path.join(self.w.src, PDF_EN)))
        d = self.w.draft()
        d["portfolio"]["disabled"] = ["toyota-hv-monitor"]
        bid = self.build(d)
        site = self.w.site(bid)
        data = json.loads(self.w.read(bid, "data/portfolio.json"))
        self.assertNotIn("toyota-hv-monitor", [p["slug"] for p in data["projects"]])
        self.assertEqual(len(data["projects"]), len(self.w.ctx().portfolio_projects) - 1)
        self.assertNotIn("toyota-hv-monitor", [m["slug"] for m in json.loads(self.w.read(bid, "data/portfolio-images.json"))])
        self.assertFalse(os.path.exists(os.path.join(site, "assets/portfolio/toyota-hv-monitor")), "its pictures are not shipped")
        self.assertTrue(os.path.isdir(os.path.join(site, "assets/portfolio/lvgl-smartwatch")))
        for name in build.PDF_NAMES.values():
            raw = read_bytes(os.path.join(site, "assets/portfolio", name))
            self.assertTrue(raw.startswith(b"%PDF-"))
            self.assertNotEqual(raw, read_bytes(os.path.join(self.w.src, "assets/portfolio", name)), "generated, not the factory file")
        text = pdf_text(read_bytes(os.path.join(site, PDF_EN)))
        if text is not None:
            self.assertIn(TOYOTA, before, "the factory PDF does show it")
            self.assertNotIn(TOYOTA, text)
            self.assertIn("LVGL smartwatch prototype", text)
            self.assertIn("Prometheus: control board", text, "projects that only the portfolio shows stay in the PDF")

    def test_the_pdf_follows_the_portfolio_texts_pictures_order_and_switches(self):
        item = uploads.store(self.w.paths, png(), "shot.png")
        d = self.w.draft()
        d["portfolio"]["items"] = {"lvgl-smartwatch": {"title": {"uk": "Годинник-Тест", "en": "Watch-Test", "de": "Uhr-Test"}}}
        d["portfolio"]["disabled"] = ["toyota-hv-monitor"]
        d["portfolio"]["order"] = ["lvgl-smartwatch"]
        d["images"]["portfolio"] = {"prometheus-controller/board-photo": item["ref"]}
        site_on = self.w.site(self.build(d))
        data = json.loads(read_file(os.path.join(site_on, "data/portfolio.json")))
        self.assertEqual(data["projects"][0]["slug"], "lvgl-smartwatch")
        self.assertEqual(data["projects"][0]["title"]["en"], "Watch-Test")
        text = pdf_text(read_bytes(os.path.join(site_on, PDF_EN)))
        uk = pdf_text(read_bytes(os.path.join(site_on, "assets/portfolio", build.PDF_NAMES["uk"])))
        if text is not None:
            self.assertIn("Watch-Test", text)
            self.assertNotIn(TOYOTA, text)
            self.assertIn("Годинник-Тест", uk)
        d["widgets"]["portfolioLink"] = False                           # the widget only controls the page /portfolio/ and its links: the PDF is still made from the portfolio
        d["site"] = {"gallery": {"hidden": ["lvgl-smartwatch"], "order": []}}
        site_off = self.w.site(self.build(d))
        text = pdf_text(read_bytes(os.path.join(site_off, PDF_EN)))
        if text is not None:
            self.assertIn("Watch-Test", text, "hidden on the home page, still in the PDF")
            self.assertNotIn(TOYOTA, text)

    def test_no_pdf_work_needs_the_network_or_external_tools(self):
        for name in ("pdf.py", "portfolio_pdf.py"):
            src = read_file(os.path.join(REPO, "radxa-admin/lib/vadmin", name))
            for banned in ("subprocess", "urllib", "socket", "http.client", "os.system"):
                self.assertNotIn(banned, src, name)

    def test_the_package_never_contains_overlay_or_editor_data_for_the_gallery(self):
        d = self.w.draft()
        d["portfolio"]["disabled"] = ["toyota-hv-monitor"]
        d["portfolio"]["items"] = {"can-helper": {"title": {"uk": "u", "en": "e", "de": "d"}}}
        site = self.w.site(self.build(d))
        for root, _, names in os.walk(site):
            for name in names:
                if name.rsplit(".", 1)[-1] in ("html", "js", "css", "json", "xml"):
                    text = read_file(os.path.join(root, name))
                    for needle in ("ve-portfolio", "ve-boot", "VEdit", "edit-overlay", "factoryGallery", '"disabled": true', '"disabled":true'):
                        self.assertNotIn(needle, text, "%s in %s" % (needle, name))


class PdfImageConversionTests(unittest.TestCase):
    """A PNG with transparency (or 16 bit) is converted to JPEG on a white background for the PDF only; the standard library does it."""

    def rgba_png(self, w=64, h=48):
        raw = b"".join(b"\x00" + b"".join(bytes((x * 4 % 256, y * 5 % 256, 120, 0 if x < 16 else 255)) for x in range(w)) for y in range(h))
        def chunk(t, d):
            c = struct.pack(">I", len(d)) + t + d
            return c + struct.pack(">I", zlib.crc32(t + d))
        return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")

    def test_alpha_png_becomes_a_valid_jpeg_with_a_white_background(self):
        data = self.rgba_png()
        self.assertIsNone(pdf.read_image(data), "PDF cannot embed it as it is")
        jpeg = pdf.embeddable(data)
        self.assertTrue(jpeg.startswith(b"\xff\xd8") and jpeg.endswith(b"\xff\xd9"))
        self.assertEqual(pdf.read_image(jpeg)[:3], ("jpeg", 64, 48))
        try:
            import io
            from PIL import Image
        except ImportError:
            return
        img = Image.open(io.BytesIO(jpeg)).convert("RGB")
        self.assertGreater(min(img.getpixel((4, 20))), 235, "transparent pixels are white")
        r, g, b = img.getpixel((50, 10))
        self.assertTrue(abs(r - 200) < 25 and abs(g - 50) < 25 and abs(b - 120) < 25, (r, g, b))

    def test_webp_and_avif_stay_out_and_big_or_odd_pngs_do_not_crash(self):
        self.assertIsNone(pdf.embeddable(b"RIFF\x00\x00\x00\x00WEBPVP8 "))
        self.assertIsNone(pdf.embeddable(b"\x00\x00\x00\x1cftypavif" + b"\x00" * 20))
        self.assertIsNone(pdf.embeddable(self.rgba_png()[:60]))
        self.assertIsNone(pdf.embeddable(None))

    def test_the_pdf_has_every_enabled_project_with_its_pictures_including_converted_uploads(self):
        site = read_json_file(os.path.join(REPO, "data/site.json"))
        projects = read_json_file(os.path.join(REPO, "data/portfolio.json"))["projects"]
        manifest = read_json_file(os.path.join(REPO, "data/portfolio-images.json"))
        up = self.rgba_png()
        files = {"assets/u/aaaaaaaaaaaaaaaa.png": up}
        manifest = [dict(m) for m in manifest]
        for m in manifest:                                           # an upload (transparent PNG) fills a slot that is a placeholder in the factory
            if (m["slug"], m["slot"]) == ("can-helper", "window"):
                m.update(file="assets/u/aaaaaaaaaaaaaaaa.png", status="final", ratio="4:3")
        read = lambda rel: files.get(rel) or (read_bytes(os.path.join(REPO, rel)) if os.path.isfile(os.path.join(REPO, rel)) else None)
        count = lambda ps: portfolio_pdf.build_portfolio_pdf(site["portfolioPage"], site, ps, manifest, "en", read)[0].count(b"/Subtype /Image")
        base = count([])
        for slug in ("lvgl-smartwatch", "toyota-hv-monitor", "can-helper"):
            proj = [p for p in projects if p["slug"] == slug]
            slots = [m for m in manifest if m["slug"] == slug and m["slot"] in proj[0]["slots"] and m["status"] == "final"]
            self.assertGreaterEqual(len(slots), 1, slug)
            self.assertEqual(count(proj) - base, min(len(slots), 3), "every final picture of %s is in the PDF" % slug)
        data, texts = portfolio_pdf.build_portfolio_pdf(site["portfolioPage"], site, projects, manifest, "en", read)
        for p in projects:
            self.assertTrue(any(p["title"]["en"] in t or t in p["title"]["en"] for t in texts), p["slug"])
        text = pdf_text(data)
        if text is not None:
            flat = " ".join(text.split())
            for p in projects:
                self.assertIn(" ".join(p["title"]["en"].split()), flat, p["slug"])


class PortfolioPdfTests(unittest.TestCase):
    """The standard-library PDF writer: real Cyrillic text, valid structure, pictures embedded as they are."""

    def make(self, lang="uk", projects=None):
        site = read_json_file(os.path.join(REPO, "data/site.json"))
        pj = projects if projects is not None else read_json_file(os.path.join(REPO, "data/portfolio.json"))["projects"]
        mf = read_json_file(os.path.join(REPO, "data/portfolio-images.json"))
        read = lambda rel: read_bytes(os.path.join(REPO, rel)) if os.path.isfile(os.path.join(REPO, rel)) else None
        return portfolio_pdf.build_portfolio_pdf(site["portfolioPage"], site, pj, mf, lang, read)

    def test_a_valid_multipage_pdf_with_selectable_text_in_all_languages(self):
        for lang, word in (("uk", "Інженерія"), ("en", "Engineering, end to end"), ("de", "Engineering von A bis Z")):
            data, texts = self.make(lang)
            self.assertTrue(data.startswith(b"%PDF-") and data.rstrip().endswith(b"%%EOF"))
            self.assertTrue(any(word in t for t in texts), lang)
            self.assertLess(len(data), 4 * 1024 * 1024)
            text = pdf_text(data)
            if text is not None:
                self.assertIn(word, text)
                import io
                import pypdf
                self.assertGreater(len(pypdf.PdfReader(io.BytesIO(data)).pages), 10)

    def test_the_output_is_reproducible(self):
        self.assertEqual(self.make("en")[0], self.make("en")[0])

    def test_images_png_is_embedded_unencoded_and_unsupported_formats_are_skipped(self):
        doc = pdf.Doc("t")
        self.assertTrue(doc.image(png(), 10, 10, 50, 50))
        self.assertTrue(doc.image(read_bytes(os.path.join(REPO, "assets/portfolio/img/hero-unit.jpg")), 10, 10, 50, 50))
        self.assertFalse(doc.image(b"RIFF\x00\x00\x00\x00WEBPVP8 ", 0, 0, 5, 5), "WebP cannot be decoded without extra packages")
        self.assertIsNone(pdf.read_image(b"\x89PNG\r\n\x1a\n"))
        self.assertTrue(doc.render().startswith(b"%PDF-"))

    def test_a_missing_project_list_or_picture_does_not_break_the_document(self):
        data, texts = self.make("en", projects=[])
        self.assertTrue(data.startswith(b"%PDF-"))
        self.assertFalse(any("Prometheus" in t for t in texts))


class EditPagePortfolioTests(EditPageTests):
    """The portfolio gallery in the on-page editor: shown (not stripped), every project present with its switch state, data embedded for the fetch stub."""

    def test_the_home_page_has_the_gallery_with_only_the_selection_controls(self):
        d = self.w.draft()
        d["portfolio"]["disabled"] = ["toyota-hv-monitor"]
        d["portfolio"]["items"] = {"can-helper": {"title": {"uk": "Мій CanHelper", "en": "My CanHelper", "de": "Mein CanHelper"}}}
        d["site"] = {"gallery": {"hidden": ["lvgl-smartwatch"], "order": []}}
        item = uploads.store(self.w.paths, png(), "shot.png")
        d["portfolio"]["images"] = {"lvgl-smartwatch/home": item["ref"]}
        self.save(d)
        html = self.page()[2].decode()
        self.assertIn('src="assets/portfolio.js"', html)
        self.assertIn('id="archiveGrid"', html)
        data = self.embedded(html, "ve-portfolio")
        slugs = [p["slug"] for p in data["projects"]]
        self.assertNotIn("toyota-hv-monitor", slugs, "an item switched off in the portfolio is not offered to the home page")
        self.assertIn("lvgl-smartwatch", data["home"], "hidden on the home page: still listed, so the overlay can show it dimmed")
        self.assertNotIn("prometheus-controller", data["home"], "portfolio-only items are never on the home page")
        by = dict((p["slug"], p) for p in data["projects"])
        self.assertEqual(by["can-helper"]["title"]["en"], "My CanHelper", "texts come from the portfolio")
        manifest = dict(("%s/%s" % (m["slug"], m["slot"]), m) for m in self.embedded(html, "ve-portfolio-images"))
        self.assertEqual(manifest["lvgl-smartwatch/home"]["file"], "assets/u/%s.jpg" % item["id"])
        self.assertIn('"/data/portfolio.json":"ve-portfolio"', html)
        boot = self.embedded(html, "ve-boot")
        self.assertEqual(boot["page"], "home")
        self.assertEqual(boot["draft"]["site"]["gallery"]["hidden"], ["lvgl-smartwatch"])
        self.assertEqual(boot["draft"]["portfolio"]["disabled"], ["toyota-hv-monitor"], "the real draft is embedded untouched")
        self.assertNotIn("toyota-hv-monitor", boot["homeBase"])
        self.assertNotIn("data-ve", html, "the page-marking flag belongs to the portfolio page only")

    def test_the_portfolio_page_is_editable_with_every_item_and_marked_texts(self):
        d = self.w.draft()
        d["portfolio"]["disabled"] = ["toyota-hv-monitor"]
        d["portfolio"]["disabledSections"] = ["web"]
        d["site"] = {"gallery": {"hidden": ["can-helper"], "order": []}}
        self.save(d)
        st, hd, body = api.handle(self.w.paths, "GET", "edit-page", dict(self.h, cookie="vadmin=" + self.cookie), b"", {"lang": ["uk"], "page": ["portfolio"]}, "10.0.0.5")
        html = body.decode()
        self.assertEqual(st, 200)
        self.assertIn('data-page="portfolio" data-ve="1"', html.replace('lang="uk" ', ""))
        self.assertIn('assets/portfolio-page.js', html)
        self.assertNotIn('id="archiveGrid"', html)
        data = self.embedded(html, "ve-portfolio")
        by = dict((p["slug"], p) for p in data["projects"])
        self.assertEqual(len(by), len(read_json_file(os.path.join(REPO, "data/portfolio.json"))["projects"]), "every item, switched-off ones too")
        self.assertTrue(by["toyota-hv-monitor"]["disabled"])
        self.assertIn("prometheus-controller", by, "portfolio-only items are edited here")
        self.assertNotIn("home", data, "the portfolio page ignores the home page's selection")
        self.assertIn("can-helper", by, "hidden on the home page, still in the portfolio")
        site = self.embedded(html, "ve-site")
        self.assertIn("web", [x["id"] for x in site["portfolioPage"]["sections"]], "switched-off sections are shown (dimmed by the overlay)")
        boot = self.embedded(html, "ve-boot")
        self.assertEqual(boot["page"], "portfolio")
        self.assertEqual(boot["portfolioSections"][0]["id"], site["portfolioPage"]["sections"][0]["id"])
        self.assertEqual(boot["draft"]["portfolio"]["disabledSections"], ["web"])
        self.assertIn("overlay", html.lower().replace("edit-overlay", "overlay"))

    def test_the_gallery_view_never_leaks_into_a_package(self):
        d = self.w.draft()
        d["portfolio"]["disabled"] = ["toyota-hv-monitor"]
        self.save(d)
        self.page()
        w = World(copy_src=True)
        self.addCleanup(w.close)
        w.save(d)
        r = build.build(w.paths)
        self.assertTrue(r["ok"], r)
        self.assertNotIn("ve-portfolio", w.read(r["id"], "index.html"))
        self.assertIn("assets/portfolio.js", w.read(r["id"], "index.html"))


def read_bytes(path):
    with open(path, "rb") as fh:
        return fh.read()



class EditableEverythingGuard(unittest.TestCase):
    """Owner's rule: everything a visitor can read on the site is editable. A visible text of data/site.json, data/products.json or the static
    markup that is neither editable (draft.texts / draft.plain / draft.products) nor listed below, WITH the reason, fails here."""
    NOT_TEXT = {"t", "id", "img", "type", "icon", "model", "poster", "orbit", "code", "url", "href", "demo", "slug", "category", "image"}      # markup switches, file names, ids: not visible text
    EXEMPT_PLAIN = {
        "languages": "names of the languages in the switch (Українська / English / Deutsch, UA / EN / DE): constants, each language is written in itself",
        "brand.name": "the ViTeh wordmark: part of the logo markup, <title> suffixes, the mail subject of the Worker and the JSON-LD; changing it is a code change",
    }
    STATIC_EXEMPT = {
        "ViTeh": "the wordmark (see brand.name)",
        "This site needs JavaScript": "the <noscript> fallback must work without scripts, so it cannot come from site.json; it is shown only when scripts are off (never on a live page)",
    }

    def setUp(self):
        self.site = read_json_file(os.path.join(REPO, "data/site.json"))
        self.w = World()
        self.addCleanup(self.w.close)
        self.ctx = self.w.ctx()

    def leaves(self, node, path):
        if isinstance(node, dict) and node and all(k in ("uk", "en", "de") for k in node):
            yield ".".join(path), True
        elif isinstance(node, dict):
            for k, v in node.items():
                for x in self.leaves(v, path + [k]):
                    yield x
        elif isinstance(node, list):
            for i, v in enumerate(node):
                for x in self.leaves(v, path + [str(i)]):
                    yield x
        elif isinstance(node, str) and path and path[-1] not in self.NOT_TEXT and node.strip():
            yield ".".join(path), False

    def test_every_visible_string_of_site_json_is_editable_or_explained(self):
        texts, plain = schema.editable_texts(self.ctx.site), schema.editable_plain(self.ctx.site)
        missing = []
        for path, translated in self.leaves(self.site, []):
            if translated and path in texts:
                continue
            if not translated and path in plain:
                continue
            if any(path == k or path.startswith(k + ".") for k in self.EXEMPT_PLAIN):
                continue
            missing.append(path)
        self.assertEqual(missing, [], "not editable and not in EXEMPT_PLAIN (with a reason): %s" % missing[:10])

    def test_every_exemption_has_a_reason(self):
        for table in (self.EXEMPT_PLAIN, self.STATIC_EXEMPT):
            for key, reason in table.items():
                self.assertGreater(len(reason), 20, key)

    def test_legal_pages_are_part_of_the_editable_texts(self):
        texts = schema.editable_texts(self.ctx.site)
        self.assertIn("legal.imprint.title", texts)
        self.assertTrue(any(k.startswith("legal.privacy.sections.") for k in texts))

    def test_every_text_field_of_a_factory_project_card_can_be_overridden(self):
        first = self.ctx.products[0]
        other = [c for c in self.ctx.categories() if c != first["category"]][0]
        word = {"uk": "У", "en": "E", "de": "D"}
        d = {"products": {first["id"]: {"title": word, "summary": word, "status": word, "tags": ["один", "two"], "category": other, "evil": 1}, "no-such": {"title": word}}}
        clean = schema.sanitize(d, self.ctx)["products"]
        self.assertEqual(list(clean), [first["id"]])
        self.assertEqual(sorted(clean[first["id"]]), ["category", "status", "summary", "tags", "title"])
        d["products"][first["id"]]["category"] = "../x"
        self.assertNotIn("category", schema.sanitize(d, self.ctx)["products"][first["id"]], "only known categories")
        self.assertEqual(schema.sanitize({"products": {first["id"]: {"title": first["title"], "tags": first["tags"]}}}, self.ctx)["products"], {}, "an unchanged value is not an override")

    def test_plain_values_accept_only_known_paths_and_sync_the_link(self):
        d = {"plain": {"contact.details.0.value": "me@example.org", "contact.details.1.value": "+49 30 1234567", "stack.groups.0.items.0": "ESP32-S3", "stack.groups.9.items.0": "x", "brand.name": "Evil", "contact.details.0.href": "javascript:alert(1)"}}
        clean = schema.sanitize(d, self.ctx)["plain"]
        self.assertEqual(sorted(clean), ["contact.details.0.value", "contact.details.1.value", "stack.groups.0.items.0"])
        site = build.merged_site(schema.sanitize(d, self.ctx), self.ctx, render.Assets(self.ctx))
        mail, phone = site["contact"]["details"][0], site["contact"]["details"][1]
        self.assertEqual((mail["value"], mail["href"]), ("me@example.org", "mailto:me@example.org"))
        self.assertEqual((phone["href"], phone["demo"]), ("tel:+49301234567", False), "a real number is no longer a demo")
        self.assertEqual(site["stack"]["groups"][0]["items"][0], "ESP32-S3")
        bad = build.merged_site(schema.sanitize({"plain": {"contact.details.0.value": "not an email <x>"}}, self.ctx), self.ctx, render.Assets(self.ctx))
        self.assertEqual(bad["contact"]["details"][0]["href"], "mailto:info@viteh.org", "a value that is no e-mail address keeps the old link")

    def test_static_markup_has_no_unexplained_visible_text(self):
        html = read_file(os.path.join(REPO, "index.html"))
        body = html[html.index("<body"):]
        found = []
        for m in re.finditer(r"<(\w+)([^>]*)>([^<>]*[A-Za-z\u0400-\u04ff]{2,}[^<>]*)</\1>", body):
            if "data-i18n" not in m.group(2) and m.group(1) not in ("script", "style"):
                found.append(m.group(3).strip())
        for text in found:
            self.assertTrue(any(text.startswith(k) for k in self.STATIC_EXEMPT), "static text without data-i18n and without an exemption: %r" % text)
        app = read_file(os.path.join(REPO, "assets/app.js"))
        for lit in re.findall(r"textContent\s*=\s*[\"'`]([^\"'`]*[A-Za-z]{3}[^\"'`]*)[\"'`]", app):
            self.fail("app.js writes a literal text: %r" % lit)


class AuditBuildTests(unittest.TestCase):
    """The audit fields in a real build: factory project texts, plain values, legal texts; the factory site stays byte-identical when untouched."""

    def setUp(self):
        self.w = World(copy_src=True)
        self.addCleanup(self.w.close)

    def test_overrides_reach_the_package_and_nothing_else_changes(self):
        d = self.w.draft()
        d["products"] = {"iot-module": {"title": {"uk": "Мій IoT", "en": "My IoT", "de": "Mein IoT"}, "tags": ["BLE5"], "category": "software"}}
        d["plain"] = {"contact.details.0.value": "me@example.org", "stack.groups.0.items.0": "ESP32-S3"}
        d["texts"]["legal.imprint.title"] = {"uk": "Вихідні дані", "en": "Legal notice", "de": "Impressum neu"}
        self.w.save(d)
        r = build.build(self.w.paths)
        self.assertTrue(r["ok"], r)
        prod = dict((p["id"], p) for p in json.loads(self.w.read(r["id"], "data/products.json")))
        factory = dict((p["id"], p) for p in read_json_file(os.path.join(REPO, "data/products.json")))
        self.assertEqual(prod["iot-module"]["title"]["en"], "My IoT")
        self.assertEqual((prod["iot-module"]["tags"], prod["iot-module"]["category"]), (["BLE5"], "software"))
        self.assertEqual(prod["iot-module"]["summary"], factory["iot-module"]["summary"])
        self.assertEqual(prod["sensor-node"], factory["sensor-node"], "other cards are untouched")
        site = json.loads(self.w.read(r["id"], "data/site.json"))
        self.assertEqual(site["contact"]["details"][0]["href"], "mailto:me@example.org")
        self.assertEqual(site["stack"]["groups"][0]["items"][0], "ESP32-S3")
        self.assertEqual(site["legal"]["imprint"]["title"]["en"], "Legal notice")

    def test_empty_products_plain_and_legal_leave_the_factory_json_identical(self):
        r = build.build(self.w.paths)
        for rel in ("data/site.json", "data/products.json"):
            self.assertEqual(read_json_file(os.path.join(self.w.src, rel)), json.loads(self.w.read(r["id"], rel)), rel)


class EditPageAuditTests(EditPageTests):
    def test_the_boot_data_carries_what_the_overlay_needs_for_the_new_bindings(self):
        html = self.page()[2].decode()
        boot = self.embedded(html, "ve-boot")
        self.assertIn("iot-module", boot["factoryProducts"])
        self.assertEqual(boot["factoryProducts"]["iot-module"]["tags"], read_json_file(os.path.join(REPO, "data/products.json"))[2]["tags"])
        self.assertIn("stack.groups.0.items.0", boot["editablePlain"])
        self.assertIn("contact.details.0.value", boot["editablePlain"])
        self.assertTrue(boot["categories"] and boot["archiveCategories"])
        self.assertIn("legal.imprint.title", boot["editable"])
        self.assertIn("years", boot["factoryGallery"]["can-helper"])
        self.assertIn("ui.gallery3d.badge", boot["editable"], "the 'other texts' dialog lists it")

    def test_overlay_in_a_package_still_never_appears_with_the_new_fields(self):
        d = self.w.draft()
        d["products"] = {"iot-module": {"tags": ["x"]}}
        d["plain"] = {"stack.groups.0.items.0": "ESP32-S3"}
        self.save(d)
        w = World(copy_src=True)
        self.addCleanup(w.close)
        w.save(d)
        r = build.build(w.paths)
        for root, _, names in os.walk(w.site(r["id"])):
            for name in names:
                if name.rsplit(".", 1)[-1] in ("html", "js", "css", "json"):
                    text = read_file(os.path.join(root, name))
                    for needle in ("ve-boot", "factoryProducts", "editablePlain", "edit-overlay", "VEdit", "otherTexts"):
                        self.assertNotIn(needle, text, "%s in %s" % (needle, name))


class SeparationTests(unittest.TestCase):
    """Stage 3: the portfolio is edited ONLY in draft.portfolio; the home page (draft.site) only selects items by id; /portfolio/ and the PDF ignore that selection."""

    def setUp(self):
        self.w = World(copy_src=True)
        self.addCleanup(self.w.close)

    def build(self, draft=None):
        if draft is not None:
            self.w.save(draft)
        r = build.build(self.w.paths)
        self.assertTrue(r["ok"], r)
        return r["id"]

    def projects(self, bid, rel="data/portfolio.json"):
        return json.loads(self.w.read(bid, rel))

    def test_fields_are_separated_in_the_schema(self):
        ctx = self.w.ctx()
        d = schema.sanitize({"site": {"gallery": {"hidden": ["can-helper", "prometheus-controller", "../x", 3], "order": ["lvgl-smartwatch", "can-helper", "nope"],
                                                  "items": {"can-helper": {"title": {"en": "Sneaky"}}}, "images": {"x/y": "u:0123456789abcdef"}}, "title": "x"}}, ctx)
        self.assertEqual(sorted(d["site"]), ["gallery"])
        self.assertEqual(sorted(d["site"]["gallery"]), ["hidden", "order"], "the home page stores ids only: no texts, no pictures")
        self.assertEqual(d["site"]["gallery"]["hidden"], ["can-helper"], "portfolio-only and unknown ids are not selectable")
        self.assertEqual(d["site"]["gallery"]["order"][:2], ["lvgl-smartwatch", "can-helper"])
        self.assertEqual(d["portfolio"]["items"], {}, "nothing leaks from site into portfolio")
        for key in ("portfolio", "portfolioAlt"):
            self.assertNotIn(key, d["images"])
        self.assertNotIn("portfolio", d["disabled"])
        self.assertEqual(schema.sanitize(d, ctx), d, "idempotent")

    def test_old_drafts_are_migrated_without_loss(self):
        item = uploads.store(self.w.paths, png(), "a.png")
        ctx = self.w.ctx()
        old = {"rev": 7, "disabled": {"services": [], "projects": [], "portfolio": ["web"]},
               "images": {"hero": "", "projects": {}, "models": {}, "serviceModels": {}, "portfolio": {"can-helper/window": item["ref"]},
                          "portfolioAlt": {"can-helper/window": {"uk": "Вікно", "en": "", "de": ""}}},
               "texts": {"portfolioPage.sections.0.title": {"uk": "А", "en": "B", "de": "C"}, "hero.lead": {"uk": "h", "en": "h", "de": "h"}},
               "portfolio": {"disabled": ["toyota-hv-monitor"], "order": [], "items": {"can-helper": {"years": "2030"}}}}
        new = schema.sanitize(old, ctx)
        self.assertEqual(new["portfolio"]["images"], {"can-helper/window": item["ref"]})
        self.assertEqual(new["portfolio"]["alts"]["can-helper/window"]["uk"], "Вікно")
        self.assertEqual(new["portfolio"]["disabledSections"], ["web"])
        self.assertEqual(new["portfolio"]["texts"]["portfolioPage.sections.0.title"]["de"], "C")
        self.assertEqual(new["portfolio"]["disabled"], ["toyota-hv-monitor"])
        self.assertEqual(new["portfolio"]["items"]["can-helper"]["years"], "2030")
        self.assertEqual(list(new["texts"]), ["hero.lead"], "site texts stay, portfolio texts moved")
        self.assertEqual(new["rev"], 7)
        # the migrated draft builds the same package as the new-format draft
        self.w.save(old)
        b1 = self.build()
        d2 = schema.sanitize(old, ctx)
        core.write_json(self.w.paths.draft, d2)
        b2 = self.build()
        for rel in ("data/portfolio.json", "data/portfolio-images.json", "data/site.json", "index.html"):
            self.assertEqual(self.w.read(b1, rel), self.w.read(b2, rel), rel)

    def test_an_empty_draft_builds_the_factory_site_byte_for_byte(self):
        bid = self.build()
        for rel in ("index.html", "data/site.json", "data/products.json", "data/portfolio.json", "data/portfolio-images.json", "portfolio/index.html",
                    "assets/portfolio.js", "assets/portfolio-page.js", "assets/portfolio-render.js") + tuple("assets/portfolio/" + n for n in build.PDF_NAMES.values()):
            self.assertEqual(read_bytes(os.path.join(self.w.src, rel)), read_bytes(os.path.join(self.w.site(bid), rel)), rel)
        self.assertNotIn("home", self.projects(bid), "no home selection key: the public script uses its default")

    def test_a_portfolio_change_shows_on_the_home_page_the_portfolio_page_and_in_the_pdf(self):
        d = self.w.draft()
        d["portfolio"]["items"] = {"lvgl-smartwatch": {"title": {"uk": "Годинник-Х", "en": "Watch-X", "de": "Uhr-X"}, "years": "2031"}}
        bid = self.build(d)
        data = self.projects(bid)
        self.assertEqual(next(p for p in data["projects"] if p["slug"] == "lvgl-smartwatch")["title"]["en"], "Watch-X", "the one file the home gallery and /portfolio/ both read")
        self.assertNotIn("home", data)
        text = pdf_text(read_bytes(os.path.join(self.w.site(bid), PDF_EN)))
        if text is not None:
            self.assertIn("Watch-X", text)
            self.assertIn("2031", text)

    def test_hiding_on_the_home_page_leaves_the_portfolio_page_and_the_pdf_alone(self):
        base = self.build(self.w.draft())
        base_pdf = read_bytes(os.path.join(self.w.site(base), PDF_EN))
        base_data = self.projects(base)["projects"]
        d = self.w.draft()
        d["site"] = {"gallery": {"hidden": ["toyota-hv-monitor"], "order": ["lvgl-smartwatch", "can-helper"]}}
        bid = self.build(d)
        data = self.projects(bid)
        self.assertEqual(data["projects"], base_data, "/portfolio/ reads the full portfolio: the same items, texts and order as before")
        self.assertNotIn("toyota-hv-monitor", data["home"])
        self.assertEqual(data["home"][:2], ["lvgl-smartwatch", "can-helper"])
        self.assertNotIn("prometheus-controller", data["home"])
        self.assertEqual(read_bytes(os.path.join(self.w.site(bid), PDF_EN)), base_pdf, "the PDF does not depend on the home page's selection")
        self.assertEqual(self.w.read(bid, "data/portfolio-images.json"), self.w.read(base, "data/portfolio-images.json"))
        self.assertTrue(os.path.isdir(os.path.join(self.w.site(bid), "assets/portfolio/toyota-hv-monitor")), "its pictures still ship: /portfolio/ and the PDF use them")

    def test_switching_an_item_off_in_the_portfolio_removes_it_from_all_three(self):
        d = self.w.draft()
        d["portfolio"]["disabled"] = ["toyota-hv-monitor"]
        bid = self.build(d)
        data = self.projects(bid)
        self.assertNotIn("toyota-hv-monitor", [p["slug"] for p in data["projects"]])
        self.assertNotIn("home", data, "no explicit home selection: the home page simply gets the portfolio without it")
        text = pdf_text(read_bytes(os.path.join(self.w.site(bid), PDF_EN)))
        if text is not None:
            self.assertNotIn(TOYOTA, text)

    def test_the_home_cannot_change_portfolio_content_and_the_portfolio_cannot_hide_the_home_selection(self):
        d = self.w.draft()
        d["site"] = {"gallery": {"hidden": [], "order": [], "items": {"can-helper": {"title": {"en": "X"}}}}}
        self.assertEqual(schema.sanitize(d, self.w.ctx())["portfolio"]["items"], {})
        d = self.w.draft()
        d["portfolio"]["order"] = ["can-helper", "lvgl-smartwatch"]
        bid = self.build(d)
        self.assertEqual([p["slug"] for p in self.projects(bid)["projects"]][:2], ["can-helper", "lvgl-smartwatch"], "the portfolio's own order; the home page follows it unless it has its own")


class PreviewTests(unittest.TestCase):
    """The hover previews of the admin: every id the admin lists has words and a picture (or a live demo), and the files are small."""
    WEB = os.path.join(REPO, "radxa-admin", "web")
    MAX_BYTES = 40 * 1024

    @classmethod
    def setUpClass(cls):
        cls.manifest = read_json_file(os.path.join(cls.WEB, "previews", "manifest.json"))
        cls.w = World()
        cls.catalog = api.catalog(cls.w.paths, schema.Context(cls.w.paths))

    @classmethod
    def tearDownClass(cls):
        cls.w.close()

    def expected_keys(self):
        c = self.catalog
        keys = ["section:%s" % s["id"] for s in c["sections"]]
        keys += ["service:%s" % s["id"] for s in c["factory"]["services"]] + ["service:custom"]
        keys += ["project:%s" % p["id"] for p in c["factory"]["projects"]] + ["project:custom"]
        keys += ["portfolio:item", "portfolio:section", "site:gallery"]      # the portfolio editor and the home page's selection
        keys += ["block:%s" % t for t in c["blocks"]]
        keys += ["effect:%s" % e["id"] for e in c["effects"]] + ["widget:%s" % w["id"] for w in c["widgets"]]
        return keys

    def test_every_listed_item_has_a_preview_entry_and_no_entry_is_orphaned(self):
        keys = self.expected_keys()
        self.assertEqual(sorted(keys), sorted(self.manifest), "manifest and the admin's lists differ")
        self.assertEqual(set(schema.EFFECTS), {k.split(":")[1] for k in keys if k.startswith("effect:")})
        self.assertEqual(set(schema.WIDGETS), {k.split(":")[1] for k in keys if k.startswith("widget:")})

    def test_every_entry_has_words_and_a_picture_or_a_demo(self):
        for key, entry in self.manifest.items():
            kind = key.split(":")[0]
            self.assertTrue(entry.get("image") or entry.get("demo"), "%s has neither a picture nor a demo" % key)
            if kind in ("section", "block", "effect", "widget") or key.endswith(":custom"):      # factory cards show their own title and text
                self.assertGreater(len(entry.get("title", "")), 2, key)
                self.assertGreater(len(entry.get("text", "")), 20, key)
            if kind == "effect":
                self.assertIn(entry.get("demo"), ("float", "reveal"), key)
            else:
                self.assertTrue(entry.get("image"), key)

    def test_factory_cards_get_their_words_from_the_catalog(self):
        for s in self.catalog["factory"]["services"]:
            self.assertTrue(s["title"] and s["text"], s["id"])
        for p in self.catalog["factory"]["projects"]:
            self.assertTrue(p["title"] and p["summary"], p["id"])

    def test_pictures_exist_are_webp_and_small(self):
        for key, entry in self.manifest.items():
            if not entry.get("image"):
                continue
            path = os.path.normpath(os.path.join(self.WEB, entry["image"]))
            self.assertTrue(path.startswith(os.path.join(self.WEB, "previews") + os.sep), "%s points outside previews/" % key)
            self.assertTrue(os.path.isfile(path), "%s: %s is missing (node tools/make-admin-previews.mjs)" % (key, entry["image"]))
            with open(path, "rb") as fh:
                head = fh.read(12)
            self.assertTrue(head[:4] == b"RIFF" and head[8:12] == b"WEBP", "%s is not a WebP" % entry["image"])
            self.assertLessEqual(os.path.getsize(path), self.MAX_BYTES, entry["image"])

    def test_every_picture_in_the_folder_is_used(self):
        used = {os.path.basename(e["image"]) for e in self.manifest.values() if e.get("image")}
        have = {n for n in os.listdir(os.path.join(self.WEB, "previews")) if n.endswith(".webp")}
        self.assertEqual(have - used, set(), "unused previews: delete them or add them to the manifest")

    def test_the_admin_pages_load_the_preview_files(self):
        index = read_file(os.path.join(self.WEB, "index.html"))
        self.assertLess(index.index("preview-tip.js"), index.index("admin.js"), "VPreview must exist before admin.js runs")
        self.assertIn("preview-tip.css", index)
        self.assertIn("preview-tip.js", read_file(os.path.join(REPO, "radxa-admin", "install-on-radxa.sh")), "the installer cache-busts the new files")


class OrderTests(unittest.TestCase):
    def setUp(self):
        self.w = World(copy_src=True)
        self.addCleanup(self.w.close)

    def sections(self, html):
        return re.findall(r'<section class="[^"]*" id="(\w+)"', html)

    def test_sanitize_keeps_a_permutation_or_empty(self):
        ctx = self.w.ctx()
        f = lambda v: schema.sanitize({"order": v}, ctx)["order"]
        self.assertEqual(f(None), [])
        self.assertEqual(f("faq"), [])
        self.assertEqual(f(list(schema.MOVABLE_IDS)), [], "the factory order is stored as empty")
        self.assertEqual(f(["hero", "trust", "nope", 5, None]), [], "hero and trust cannot be moved, junk is dropped")
        got = f(["faq", "faq", "contact", "bogus"])
        self.assertEqual(got[:2], ["faq", "contact"])
        self.assertEqual(sorted(got), sorted(schema.MOVABLE_IDS), "missing sections keep their factory order at the end")
        self.assertEqual(len(got), len(set(got)))
        d = schema.sanitize({"order": got}, ctx)
        self.assertEqual(d, schema.sanitize(d, ctx))

    def test_empty_order_changes_nothing_and_the_natural_order_is_a_noop(self):
        html = read_file(os.path.join(self.w.src, "index.html"))
        self.assertEqual(build.reorder_nav(build.reorder_sections(html, list(schema.MOVABLE_IDS)), list(schema.MOVABLE_IDS)), html)
        d = self.w.draft()
        d["order"] = []
        self.w.save(d)
        r = build.build(self.w.paths)
        self.assertEqual(self.w.read(r["id"], "index.html"), html)

    def test_build_moves_sections_and_the_menu_and_keeps_everything_else(self):
        order = ["faq", "pricing", "work", "services", "ai", "process", "stack", "contact"]
        d = self.w.draft()
        d["order"] = order
        d["sections"]["ai"] = False
        self.w.save(d)
        r = build.build(self.w.paths)
        html = self.w.read(r["id"], "index.html")
        self.assertEqual(self.sections(html), [s for s in order if s != "ai"])
        nav = html[html.index('<nav class="nav"'):html.index("</nav>")]
        links = re.findall(r'href="#(\w+)"', nav)
        self.assertEqual(links, ["faq", "pricing", "work", "services", "process", "contact"], "the menu follows the order, the call-to-action stays last")
        self.assertLess(html.index('class="hero"'), html.index('class="trust"'))
        self.assertLess(html.index('class="trust"'), html.index('id="faq"'))
        self.assertLess(html.index('id="contact"'), html.index("</main>"))
        self.assertEqual(html.count("<section"), html.count("</section>"))

    def test_generated_pages_get_the_same_menu_order(self):
        d = self.w.draft()
        d["order"] = ["faq", "contact"]
        d["pages"] = [{"slug": "about", "title": {"uk": "Про нас", "en": "About", "de": "Über"}, "description": {"uk": "d"}, "enabled": True, "inNav": True, "blocks": [{"type": "divider", "fields": {"style": "line"}}]}]
        self.w.save(d)
        r = build.build(self.w.paths)
        self.assertTrue(r["ok"], r)
        page = self.w.read(r["id"], "s/about/index.html")
        links = re.findall(r'href="/#(\w+)"', page[page.index('<nav class="nav"'):page.index("</nav>")])
        self.assertEqual(links[0], "faq")

    def test_rollback_restores_the_order_of_that_build(self):
        d = self.w.draft()
        d["order"] = ["faq", "contact"]
        self.w.save(d)
        r = build.build(self.w.paths)
        snap = read_json_file(os.path.join(self.w.paths.builds, r["id"], "draft.json"))
        self.assertEqual(snap["order"][:2], ["faq", "contact"])


class CompatTests(unittest.TestCase):
    def test_sources_parse_as_python_3_7(self):
        """The Radxa's Python may be old: no walrus, match, or other newer syntax."""
        root = os.path.join(HERE, "..")
        for base, _, files in os.walk(root):
            if "tests" in base.split(os.sep):
                continue
            for name in files:
                if name.endswith(".py"):
                    path = os.path.join(base, name)
                    with open(path, encoding="utf-8") as fh:
                        ast.parse(fh.read(), filename=path, feature_version=(3, 7))

    def test_no_third_party_imports(self):
        stdlib = set(sys.stdlib_module_names) if hasattr(sys, "stdlib_module_names") else None
        if stdlib is None:
            self.skipTest("needs Python 3.10+ to list the standard library")
        root = os.path.join(HERE, "..")
        for base, _, files in os.walk(root):
            if "tests" in base.split(os.sep):
                continue
            for name in files:
                if name.endswith(".py"):
                    tree = ast.parse(open(os.path.join(base, name), encoding="utf-8").read())
                    for node in ast.walk(tree):
                        mods = [a.name.split(".")[0] for a in node.names] if isinstance(node, ast.Import) else [node.module.split(".")[0]] if isinstance(node, ast.ImportFrom) and node.level == 0 and node.module else []
                        for m in mods:
                            self.assertTrue(m in stdlib or m == "vadmin", "%s imports %s" % (name, m))


class IdeasCatalogTests(ApiTests):
    """The admin-only service-ideas catalog: sanitised like any custom service, added DISABLED, never part of a package."""

    def add(self, cookie, idea, rev):
        return self.call("POST", "idea-add", {"id": idea, "rev": rev}, cookie=cookie)

    def test_every_catalog_card_survives_the_sanitiser_unchanged(self):
        ctx = self.w.ctx()
        items = ideas.load()
        self.assertGreaterEqual(len(items), 5)
        self.assertEqual(len({i["id"] for i in items}), len(items))
        for it in items:
            card = it["card"]
            self.assertIn(card["icon"], ctx.icons, it["id"])
            clean = schema.clean_service(dict(card, id=""), ctx)
            for key in ("title", "text", "points"):
                self.assertEqual(clean[key], card[key], "%s.%s was truncated or altered" % (it["id"], key))
            for lang in core.LANGS:
                self.assertTrue(card["title"][lang] and card["text"][lang] and all(p[lang] for p in card["points"]), "%s %s incomplete" % (it["id"], lang))
            self.assertTrue(all(s["url"].startswith("https://") for s in it["sources"]))
            self.assertIn(it["readiness"], ideas.READINESS)

    def test_the_view_needs_a_session(self):
        self.assertEqual(self.call("GET", "ideas")[0], 401)
        self.assertEqual(self.call("POST", "idea-add", {"id": "idea-cra", "rev": 0})[0], 401)
        cookie = self.login()
        st, _, r = self.call("GET", "ideas", cookie=cookie)
        self.assertEqual(st, 200)
        self.assertTrue(r["items"] and r["readiness"]["help"])

    def test_adding_creates_a_disabled_custom_service_once(self):
        cookie = self.login()
        st, _, r = self.add(cookie, "idea-gateway", 0)
        self.assertEqual(st, 200, r)
        d = r["draft"]
        svc = d["extra"]["services"][0]
        self.assertEqual(d["disabled"]["services"], [svc["id"]], "added disabled")
        self.assertTrue(svc["id"].startswith("x-"))
        self.assertIn("MQTT", svc["title"]["en"] + svc["text"]["en"])
        self.assertEqual(self.add(cookie, "idea-gateway", d["rev"])[0], 409, "no duplicate")
        self.assertEqual(self.add(cookie, "nope", d["rev"])[0], 404)
        self.assertEqual(self.add(cookie, "idea-hmi", d["rev"] - 1)[0], 409, "stale revision")
        st, _, r = self.call("GET", "ideas", cookie=cookie)
        self.assertIn(svc["title"]["uk"], [t["uk"] for t in r["added"]])

    def test_a_disabled_idea_is_not_on_the_site_and_the_catalog_is_not_in_the_package(self):
        w = World(copy_src=True)
        self.addCleanup(w.close)
        draft = schema.empty_draft()
        ideas.add(draft, "idea-cra", w.ctx())
        w.save(draft)
        base = World(copy_src=True)
        self.addCleanup(base.close)
        r = build.build(w.paths)
        self.assertTrue(r["ok"], r)
        site = w.site(r["id"])
        self.assertNotIn("CRA", w.read(r["id"], "data/site.json"))
        for root, dirs, files in os.walk(site):
            for name in files + dirs:
                self.assertNotIn("service-ideas", name)
                self.assertNotEqual(name, "catalog")
        draft["disabled"]["services"] = []
        w.save(draft)
        r2 = build.build(w.paths)
        self.assertIn("Cyber Resilience Act", w.read(r2["id"], "data/site.json"), "once the owner enables it, the service is published like any custom one")
        self.assertNotIn("sources", w.read(r2["id"], "data/site.json"))

    def test_a_broken_catalog_file_gives_an_empty_list(self):
        d = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, d, True)
        open(os.path.join(d, "service-ideas.json"), "w").write("{not json")
        old = os.environ.get("VADMIN_CATALOG")
        os.environ["VADMIN_CATALOG"] = d
        try:
            self.assertEqual(ideas.load(), [])
        finally:
            os.environ.pop("VADMIN_CATALOG") if old is None else os.environ.__setitem__("VADMIN_CATALOG", old)


class LegalEditPageTests(EditPageTests):
    """Impressum / Datenschutz on the page: same pattern as page=portfolio. (Inherits the login helpers; the inherited tests are skipped here.)"""
    def legal(self, page, cookie=True, lang="uk"):
        h = dict(self.h, cookie="vadmin=" + self.cookie) if cookie else dict(self.h)
        return api.handle(self.w.paths, "GET", "edit-page", h, b"", {"lang": [lang], "page": [page]}, "10.0.0.5")

    def test_without_a_session_there_is_only_the_login_page(self):
        for page in ("impressum", "datenschutz"):
            st, hd, body = self.legal(page, cookie=False)
            self.assertEqual(st, 401, page)
            self.assertNotIn(b"ve-site", body)
            self.assertNotIn(b"Impressum", body)

    def test_both_pages_are_served_with_the_overlay_and_the_embedded_site(self):
        for page, kind in (("impressum", "imprint"), ("datenschutz", "privacy")):
            st, hd, body = self.legal(page)
            html = body.decode()
            self.assertEqual(st, 200, page)
            self.assertIn('data-legal="%s"' % kind, html)
            self.assertIn("edit-overlay.js", html)
            self.assertIn("jpeg-twin.js", html)
            self.assertIn('id="legalBody"', html)
            boot = self.embedded(html, "ve-boot")
            self.assertEqual(boot["page"], page)
            self.assertIn("legal.%s.title" % kind, boot["editable"])
            self.assertIn("legal.%s.sections.0.p" % kind, boot["editable"])
            site = self.embedded(html, "ve-site")
            self.assertIn(kind, site["legal"])
            self.assertEqual(dict(hd)["Cache-Control"], "no-store")

    def test_unknown_page_names_fall_back_to_home(self):
        st, hd, body = self.legal("../etc/passwd")
        self.assertEqual(self.embedded(body.decode(), "ve-boot")["page"], "home")

    def test_the_draft_text_is_shown_and_the_overlay_never_reaches_a_package(self):
        d = self.w.draft()
        d["texts"] = {"legal.imprint.sections.0.p": {"uk": "Рядок 1\nРядок 2", "en": "Line 1\nLine 2", "de": "Zeile 1\nZeile 2"}}
        self.save(d)
        html = self.legal("impressum")[2].decode()
        self.assertEqual(self.embedded(html, "ve-site")["legal"]["imprint"]["sections"][0]["p"]["en"], "Line 1\nLine 2", "line breaks of a legal paragraph survive")
        w = World(copy_src=True)
        self.addCleanup(w.close)
        w.save(d)
        r = build.build(w.paths)
        self.assertTrue(r["ok"], r)
        for name in ("impressum.html", "datenschutz.html"):
            self.assertEqual(w.read(r["id"], name), read_file(os.path.join(REPO, name)), "the legal pages ship exactly as in the repository")
        for root, _, names in os.walk(w.site(r["id"])):
            for name in names:
                self.assertFalse(name.startswith(("edit-", "preview-tip", "jpeg-twin")), name)
        self.assertEqual(json.loads(w.read(r["id"], "data/site.json"))["legal"]["imprint"]["sections"][0]["p"]["en"], "Line 1\nLine 2")

    def test_texts_go_only_into_the_draft_not_into_the_factory_files(self):
        before = read_file(os.path.join(REPO, "data/site.json"))
        d = self.w.draft()
        d["texts"] = {"legal.privacy.title": {"uk": "Приватність", "en": "Privacy!", "de": "Datenschutz!"}}
        self.save(d)
        self.legal("datenschutz")
        self.assertEqual(read_file(os.path.join(REPO, "data/site.json")), before)
        self.assertEqual(core.read_json(self.w.paths.draft)["texts"]["legal.privacy.title"]["en"], "Privacy!")

    def test_the_overlay_links_the_four_editable_pages(self):
        js = read_file(os.path.join(HERE, "..", "web", "edit-overlay.js"))
        for page in ("home", "portfolio", "impressum", "datenschutz"):
            self.assertRegex(js, r"\b%s:" % page)
        self.assertIn("bindLegal", js)

    # the inherited EditPageTests are covered by their own class
    for _name in [n for n in dir(EditPageTests) if n.startswith("test_")]:
        locals()[_name] = None
    del _name


class PreviewCacheTests(Base):
    def setUp(self):
        Base.setUp(self)
        self.w2 = World(copy_src=True)
        self.addCleanup(self.w2.close)

    def test_preview_references_carry_the_build_id_and_the_publish_package_is_untouched(self):
        r = build.build(self.w2.paths)
        bid = r["id"]
        site = self.w2.site(bid)
        prev = self.w2.paths.preview
        home = read_file(os.path.join(prev, "index.html"))
        self.assertIn('href="assets/styles.css?v=%s"' % bid, home)
        self.assertIn('src="assets/app.js?v=%s"' % bid, home)
        self.assertIn('src="../assets/portfolio-page.js?v=%s"' % bid, read_file(os.path.join(prev, "portfolio", "index.html")))
        self.assertIn('from "./portfolio-render.js?v=%s"' % bid, read_file(os.path.join(prev, "assets", "portfolio-page.js")), "ES module imports are stamped too, or they stay cached")
        self.assertNotIn("?v=", read_file(os.path.join(prev, "assets", "styles.css")))
        # the package that is published is what it was: no query strings, and its manifest still verifies
        for name in ("index.html", "impressum.html", "datenschutz.html", "portfolio/index.html", "assets/portfolio-page.js", "assets/gallery3d.js"):
            self.assertNotIn("?v=", read_file(os.path.join(site, name)), name)
            self.assertEqual(read_file(os.path.join(site, name)), read_file(os.path.join(self.w2.src, name)), name + " is byte-identical to the source")
        self.assertTrue(build.verify_build(self.w2.paths, bid)["ok"])

    def test_every_html_asset_reference_is_stamped_and_nothing_else_changes(self):
        r = build.build(self.w2.paths)
        for root, _, names in os.walk(self.w2.paths.preview):
            for name in names:
                if not name.endswith(".html"):
                    continue
                text = read_file(os.path.join(root, name))
                for ref in re.findall(r'(?:href|src)="((?:\.\./|/)?assets/[^"]+\.(?:js|css)[^"]*)"', text):
                    self.assertTrue(ref.endswith("?v=" + r["id"]), "%s: %s" % (name, ref))
        # same files in the same places as in the package
        pkg = sorted(os.path.relpath(os.path.join(a, n), self.w2.site(r["id"])) for a, _, ns in os.walk(self.w2.site(r["id"])) for n in ns)
        prv = sorted(os.path.relpath(os.path.join(a, n), self.w2.paths.preview) for a, _, ns in os.walk(self.w2.paths.preview) for n in ns)
        self.assertEqual(pkg, prv)

    def test_a_rollback_to_an_older_build_restamps_the_preview(self):
        a = build.build(self.w2.paths)["id"]
        d = self.w2.draft()
        d["texts"] = {"hero.lead": {"uk": "Інше", "en": "Other", "de": "Anders"}}
        self.w2.save(d)
        b = build.build(self.w2.paths)["id"]
        self.assertIn("?v=" + b, read_file(os.path.join(self.w2.paths.preview, "index.html")))
        build.set_current(self.w2.paths, a)
        home = read_file(os.path.join(self.w2.paths.preview, "index.html"))
        self.assertIn("?v=" + a, home)
        self.assertNotIn("?v=" + b, home)


class WebpTwinTests(Base):
    WEBP = b"RIFF\x20\x00\x00\x00WEBPVP8 " + b"0" * 30

    def jpeg(self):
        return imgconv.encode_jpeg(16, 16, bytes([200, 50, 120]) * 256)

    def setUp(self):
        Base.setUp(self)
        self.w2 = World(copy_src=True)
        self.addCleanup(self.w2.close)
        self.p = self.w2.paths

    def upload_webp(self):
        return uploads.store(self.p, self.WEBP, "photo.webp")

    def draft_with(self, item):
        d = self.w2.draft()
        d["portfolio"]["images"] = {"can-helper/window": item["ref"]}
        return d

    def pdf_images(self, bid):
        return read_bytes(os.path.join(self.w2.site(bid), PDF_EN)).count(b"/Subtype /Image")

    def test_a_twin_is_stored_for_a_webp_only_and_is_not_listed(self):
        main = self.upload_webp()
        twin = uploads.store(self.p, self.jpeg(), "photo.jpg", twin_of=main["id"])
        self.assertEqual(twin["twinOf"], main["id"])
        self.assertEqual([i["id"] for i in uploads.listing(self.p)], [main["id"]], "the twin follows its WebP and has no row of its own")
        self.assertEqual(core.read_json(self.p.uploads_index)["items"][main["id"]]["twin"], twin["id"])
        again = uploads.store(self.p, self.jpeg(), "photo.jpg", twin_of=main["id"])
        self.assertFalse(os.path.exists(os.path.join(self.p.uploads, twin["file"])), "a second twin replaces the first")
        self.assertTrue(os.path.exists(os.path.join(self.p.uploads, again["file"])))

    def test_bad_twins_are_refused(self):
        main = self.upload_webp()
        for data in (self.WEBP, png(), b"\xff\xd8\xff" + b"0" * 40):
            with self.assertRaises(ApiError):
                uploads.store(self.p, data, "x.jpg", twin_of=main["id"])
        jpg = uploads.store(self.p, self.jpeg(), "plain.jpg")
        with self.assertRaises(ApiError):
            uploads.store(self.p, self.jpeg(), "x.jpg", twin_of=jpg["id"])
        with self.assertRaises(ApiError):
            uploads.store(self.p, self.jpeg(), "x.jpg", twin_of="0123456789abcdef")

    def test_the_pdf_uses_the_twin_the_page_does_not_and_no_twin_means_no_picture(self):
        main = self.upload_webp()
        without = build.build(self.p) if False else None
        self.w2.save(self.draft_with(main))
        base = build.build(self.p)
        self.assertTrue(base["ok"], base)
        n0 = self.pdf_images(base["id"])
        self.assertIn("assets/u/%s.webp" % main["id"], json.dumps(json.loads(self.w2.read(base["id"], "data/portfolio-images.json"))))
        twin = uploads.store(self.p, self.jpeg(), "photo.jpg", twin_of=main["id"])
        r = build.build(self.p)
        self.assertTrue(r["ok"], r)
        self.assertEqual(self.pdf_images(r["id"]), n0 + 1, "the WebP picture is in the PDF now")
        site = self.w2.site(r["id"])
        self.assertTrue(os.path.isfile(os.path.join(site, "assets/u/%s.webp" % main["id"])))
        shipped = [n for _, _, ns in os.walk(site) for n in ns]
        self.assertNotIn(twin["file"], shipped, "the twin is never a page asset")
        self.assertFalse(any(twin["id"] in f for f in json.dumps(read_json_file(os.path.join(site, "manifest.json")) if os.path.isfile(os.path.join(site, "manifest.json")) else {}).split()))
        self.assertNotIn(twin["id"], self.w2.read(r["id"], "data/portfolio-images.json"))

    def test_deleting_the_webp_removes_the_twin_and_gc_keeps_the_twin_of_a_used_webp(self):
        main = self.upload_webp()
        twin = uploads.store(self.p, self.jpeg(), "photo.jpg", twin_of=main["id"])
        self.w2.save(self.draft_with(main))
        index = core.read_json(self.p.uploads_index)
        for item in index["items"].values():
            item["created"] = "20000101-000000"
        core.write_json(self.p.uploads_index, index)
        build.gc_uploads(self.p)
        self.assertTrue(os.path.exists(os.path.join(self.p.uploads, twin["file"])), "the twin lives as long as its WebP is in use")
        uploads.delete(self.p, main["id"], set())
        self.assertFalse(os.path.exists(os.path.join(self.p.uploads, twin["file"])))
        self.assertEqual(core.read_json(self.p.uploads_index)["items"], {})

    def test_the_api_takes_the_twin_in_the_query(self):
        auth.set_passphrase(self.p, "correct horse battery staple 42")
        h = {"host": "admin.viteh.org", "origin": "https://admin.viteh.org", "x-vadmin": "1"}
        st, hd, _ = api.handle(self.p, "POST", "login", h, json.dumps({"passphrase": "correct horse battery staple 42"}).encode(), {}, "10.0.0.5")
        h["cookie"] = "vadmin=" + dict(hd)["Set-Cookie"].split(";")[0].split("=", 1)[1]
        st, hd, body = api.handle(self.p, "POST", "upload", h, self.WEBP, {"name": ["a.webp"]}, "10.0.0.5")
        main = json.loads(body)["item"]
        st, hd, body = api.handle(self.p, "POST", "upload", h, self.jpeg(), {"name": ["a.jpg"], "twin": [main["id"]]}, "10.0.0.5")
        out = json.loads(body)
        self.assertEqual(st, 200)
        self.assertEqual([i["id"] for i in out["uploads"]], [main["id"]])

    def test_the_browser_side_makes_a_white_1600px_jpeg_and_never_throws(self):
        js = read_file(os.path.join(HERE, "..", "web", "jpeg-twin.js"))
        for needle in ("1600", '"#fff"', "image/jpeg", "twin="):
            self.assertIn(needle, js)
        self.assertIn("jpeg-twin.js", read_file(os.path.join(HERE, "..", "web", "index.html")))
        self.assertIn("VTwin.attach", read_file(os.path.join(HERE, "..", "web", "admin.js")))
        self.assertIn("VTwin?.attach", read_file(os.path.join(HERE, "..", "web", "edit-overlay.js")))


class EditableEverythingGuardPages(unittest.TestCase):
    """The guard of the three newer pages: the static markup of /portfolio/, impressum.html and datenschutz.html shows no text that is neither bound to data
    (data-i18n / data-p / generated from site.json by app.js) nor listed here WITH the reason."""
    EXEMPT = {
        "Skip to content": None,
        "ViTeh": "the wordmark (see EditableEverythingGuard.EXEMPT_PLAIN brand.name)",
        "JavaScript is required": "the <noscript> fallback must work without scripts, so it cannot come from site.json",
        "PDF": "the file-type label of the <noscript> download link (a constant, like a file extension); shown only when scripts are off",
    }
    LITERAL_EXEMPT = {
        "The portfolio could not be loaded.": "the error fallback shown only when data/site.json itself failed to load, so no editable text can exist then",
    }

    def static_texts(self, rel):
        html = read_file(os.path.join(REPO, rel))
        body = html[html.index("<body"):]
        body = re.sub(r"<(script|style|svg)\b.*?</\1>", "", body, flags=re.S)
        found = []
        for m in re.finditer(r"<(\w+)([^>]*)>([^<>]*[A-Za-zЀ-ӿ]{2,}[^<>]*)</\1>", body):
            if not re.search(r"data-(?:i18n|p)\b", m.group(2)) and not re.search(r'\bid="(?:legalTitle|legalBody|year)"', m.group(2)):
                found.append(m.group(3).strip())
        return found

    def test_no_unexplained_static_text_on_the_new_pages(self):
        for rel in ("impressum.html", "datenschutz.html", "portfolio/index.html"):
            for text in self.static_texts(rel):
                self.assertTrue(any(text.startswith(k) for k in self.EXEMPT), "%s: static text without data binding and without an exemption: %r" % (rel, text))

    def test_every_exemption_has_a_reason(self):
        for key, reason in list(self.EXEMPT.items()) + list(self.LITERAL_EXEMPT.items()):
            if reason is not None:
                self.assertGreater(len(reason), 20, key)

    def test_the_legal_and_portfolio_scripts_write_no_literal_text(self):
        for rel in ("assets/app.js", "assets/portfolio-page.js", "assets/portfolio-render.js"):
            for lit in re.findall(r"textContent\s*=\s*[\"'`]([^\"'`]*[A-Za-z]{3}[^\"'`]*)[\"'`]", read_file(os.path.join(REPO, rel))):
                self.assertTrue(any(lit.startswith(k) for k in self.LITERAL_EXEMPT), "%s writes a literal text: %r" % (rel, lit))

    def test_every_legal_text_has_an_overlay_binding(self):
        site = read_json_file(os.path.join(REPO, "data/site.json"))
        w = World()
        self.addCleanup(w.close)
        texts = schema.editable_texts(w.ctx().site)
        for kind in ("imprint", "privacy"):
            self.assertIn("legal.%s.title" % kind, texts)
            for i, block in enumerate(site["legal"][kind]["sections"]):
                self.assertIn("legal.%s.sections.%d.h" % (kind, i), texts)
                self.assertIn("legal.%s.sections.%d.p" % (kind, i), texts)
        for k in ("back", "demo"):
            self.assertIn("legal." + k, texts)


if __name__ == "__main__":
    unittest.main()
