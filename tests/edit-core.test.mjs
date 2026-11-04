// Pure logic of the on-page editor overlay (radxa-admin/web/edit-core.js): node -> draft path, writing a change, switches, order, media.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import C from "../radxa-admin/web/edit-core.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const site = JSON.parse(readFileSync(join(root, "data/site.json"), "utf8"));
const L = ["uk", "en", "de"];

// the same walk as schema.editable_texts in Python: every {uk,en,de} leaf except languages/legal/categories at the top
const editable = {};
(function walk(node, path) {
  if (node && typeof node === "object" && !Array.isArray(node) && Object.keys(node).length && Object.keys(node).every((k) => L.includes(k)) && Object.values(node).every((v) => typeof v === "string")) editable[path.join(".")] = node;
  else if (Array.isArray(node)) node.forEach((v, i) => walk(v, [...path, String(i)]));
  else if (node && typeof node === "object") for (const [k, v] of Object.entries(node)) { if (!path.length && ["languages", "legal", "categories"].includes(k)) continue; walk(v, [...path, k]); }
})(site, []);

const newDraft = () => ({ rev: 0, sections: {}, order: [], disabled: { services: [], projects: [], portfolio: [] }, texts: {}, extra: { services: [], projects: [], home: [] }, images: { hero: "", projects: {}, models: {}, serviceModels: {} } });
const envOf = (draft) => ({ draft, editable, factoryServices: site.services.items.length });

test("node descriptions map to the paths of site.json", () => {
  assert.equal(C.sitePath({ i18n: "hero.lead" }), "hero.lead");
  assert.equal(C.sitePath({ i18n: "a b" }), null);
  assert.equal(C.sitePath({ card: "services", index: 3, field: "title" }), "services.items.3.title");
  assert.equal(C.sitePath({ card: "services", index: 3, point: 1 }), "services.items.3.points.1");
  assert.equal(C.sitePath({ card: "ai", index: 0, field: "text" }), "ai.features.0.text");
  assert.equal(C.sitePath({ card: "process", index: 2, field: "title" }), "process.steps.2.title");
  assert.equal(C.sitePath({ card: "trust", index: 1 }), "trust.items.1");
  assert.equal(C.sitePath({ card: "heroBadges", index: 0 }), "hero.badges.0");
  assert.equal(C.sitePath({ card: "pricing", index: 1, point: 0 }), "pricing.models.1.points.0");
  assert.equal(C.sitePath({ card: "price", field: "price" }), "pricing.price");
  assert.equal(C.sitePath({ card: "faq", index: 4, field: "q" }), "faq.items.4.q");
  assert.equal(C.sitePath({ card: "contact", index: 0, field: "label" }), "contact.details.0.label");
  for (const bad of [{ card: "services", index: -1, field: "title" }, { card: "services", index: "1", field: "title" }, { card: "faq", index: 0, field: "x" }, { card: "nope", index: 0 }, { card: "services", index: 0, field: "icon" }, null])
    assert.equal(C.sitePath(bad), null, JSON.stringify(bad));
});

test("every path the overlay can build for the factory page exists in the editable catalogue", () => {
  const some = [{ card: "services", index: 11, field: "text" }, { card: "services", index: 0, point: 0 }, { card: "ai", index: 3, field: "title" }, { card: "process", index: 0, field: "text" },
    { card: "trust", index: 0 }, { card: "heroBadges", index: 2 }, { card: "pricing", index: 0, field: "title" }, { card: "price", field: "ribbon" }, { card: "price", field: "cta" }, { card: "faq", index: 0, field: "a" }, { card: "contact", index: 1, field: "label" }, { i18n: "nav.cta" }];
  const env = envOf(newDraft());
  for (const d of some) assert.ok(C.bindingFor(d, env), JSON.stringify(d));
});

test("plain strings and factory project cards are not editable; the owner's own cards are", () => {
  const draft = newDraft();
  draft.extra.services.push({ id: "x-aa", title: { uk: "Т", en: "T", de: "T" }, text: { uk: "t", en: "t", de: "t" }, points: [{ uk: "p", en: "p", de: "p" }], model: "" });
  draft.extra.projects.push({ id: "x-bb", title: { uk: "П", en: "P", de: "P" }, summary: { uk: "s", en: "s", de: "s" }, status: { uk: "z", en: "z", de: "z" } });
  const env = envOf(draft);
  assert.equal(C.bindingFor({ card: "contact", index: 0, field: "value" }, env), null, "an e-mail address is a plain string, not a translated text");
  assert.equal(C.bindingFor({ card: "products", id: "iot-module", field: "title" }, env), null);
  assert.equal(C.bindingFor({ card: "products", id: "x-bb", field: "bogus" }, env), null);
  const n = env.factoryServices;
  assert.deepEqual(C.bindingFor({ card: "services", index: n, field: "title" }, env), { kind: "extraService", id: "x-aa", field: "title", point: null, key: "service:x-aa:title" });
  assert.equal(C.bindingFor({ card: "services", index: n, point: 0 }, env).field, "points");
  assert.equal(C.bindingFor({ card: "services", index: n, point: 5 }, env), null);
  assert.equal(C.bindingFor({ card: "services", index: n + 1, field: "title" }, env), null);
  assert.equal(C.bindingFor({ card: "products", id: "x-bb", field: "summary" }, env).kind, "extraProject");
});

test("writing a text changes one language only, keeps the others, ignores no-ops and caps the length", () => {
  const draft = newDraft();
  const env = envOf(draft);
  const b = C.bindingFor({ i18n: "hero.lead" }, env);
  assert.equal(C.writeText(b, env, "uk", C.readText(b, env, "uk")), null, "an unchanged text is not a change");
  assert.equal(C.writeText(b, env, "en", "  New\nlead  "), "New lead");
  assert.deepEqual(Object.keys(draft.texts), ["hero.lead"]);
  assert.equal(draft.texts["hero.lead"].en, "New lead");
  assert.equal(draft.texts["hero.lead"].uk, editable["hero.lead"].uk);
  assert.equal(draft.texts["hero.lead"].de, editable["hero.lead"].de);
  assert.equal(C.readText(b, env, "en"), "New lead");
  assert.equal(C.writeText(b, env, "xx", "q"), null);
  assert.equal(C.writeText(b, env, "de", "x".repeat(5000)).length, C.MAX.text);
  assert.equal(editable["hero.lead"].en.length > 10, true, "the factory catalogue is never mutated");
});

test("owner's own service and project texts are written into the extra lists", () => {
  const draft = newDraft();
  draft.extra.services.push({ id: "x-aa", title: { uk: "Т", en: "T", de: "T" }, text: { uk: "t", en: "t", de: "t" }, points: [{ uk: "p", en: "p", de: "p" }], model: "" });
  draft.extra.projects.push({ id: "x-bb", title: { uk: "П", en: "P", de: "P" }, summary: { uk: "s", en: "s", de: "s" }, status: { uk: "z", en: "z", de: "z" } });
  const env = envOf(draft);
  const n = env.factoryServices;
  C.writeText(C.bindingFor({ card: "services", index: n, field: "title" }, env), env, "de", "Neu");
  C.writeText(C.bindingFor({ card: "services", index: n, point: 0 }, env), env, "uk", "Пункт");
  C.writeText(C.bindingFor({ card: "products", id: "x-bb", field: "status" }, env), env, "en", "x".repeat(100));
  assert.equal(draft.extra.services[0].title.de, "Neu");
  assert.equal(draft.extra.services[0].points[0].uk, "Пункт");
  assert.equal(draft.extra.projects[0].status.en.length, 40);
  assert.deepEqual(draft.texts, {}, "nothing goes into the factory text overrides");
});

test("switches: sections, services (factory s<i> and own x-...) and projects", () => {
  const draft = newDraft();
  draft.extra.services.push({ id: "x-aa", title: {}, text: {}, points: [], model: "" });
  C.setEnabled(draft, { type: "section", id: "faq" }, false);
  C.setEnabled(draft, { type: "service", id: C.serviceId(draft, 2, 12) }, false);
  C.setEnabled(draft, { type: "service", id: C.serviceId(draft, 12, 12) }, false);
  C.setEnabled(draft, { type: "project", id: "iot-module" }, false);
  assert.equal(draft.sections.faq, false);
  assert.deepEqual(draft.disabled, { services: ["s2", "x-aa"], projects: ["iot-module"], portfolio: [] });
  assert.ok(C.isOff(draft, { type: "service", id: "s2" }) && C.isOff(draft, { type: "section", id: "faq" }));
  C.setEnabled(draft, { type: "service", id: "s2" }, true);
  C.setEnabled(draft, { type: "section", id: "faq" }, true);
  assert.deepEqual(draft.disabled.services, ["x-aa"]);
  assert.equal(C.isOff(draft, { type: "section", id: "faq" }), false);
  assert.equal(C.serviceId(draft, 13, 12), null);
});

test("order: moves one step, stays inside the list, an order equal to the factory one is stored as empty", () => {
  const draft = newDraft();
  assert.deepEqual(C.effectiveOrder(draft), C.MOVABLE);
  assert.equal(C.moveSection(draft, "services", -1), false, "the first one cannot go up");
  assert.equal(C.moveSection(draft, "contact", 1), false, "the last one cannot go down");
  assert.equal(C.moveSection(draft, "hero", 1), false, "the hero is not movable");
  assert.equal(C.moveSection(draft, "faq", -1), true);
  assert.deepEqual(draft.order, ["services", "ai", "process", "work", "stack", "faq", "pricing", "contact"]);
  assert.equal(C.moveSection(draft, "faq", 1), true);
  assert.deepEqual(draft.order, [], "back to the factory order = the build matches the factory page");
});

test("media: hero, project image and model, service model (factory and own); an empty ref returns to the factory file", () => {
  const draft = newDraft();
  draft.extra.services.push({ id: "x-aa", title: {}, text: {}, points: [], model: "" });
  C.setMedia(draft, { type: "hero" }, "u:0123456789abcdef");
  C.setMedia(draft, { type: "projectImage", id: "iot-module" }, "u:1111111111111111");
  C.setMedia(draft, { type: "projectModel", id: "iot-module" }, "u:2222222222222222");
  C.setMedia(draft, { type: "serviceModel", id: "s1" }, "u:3333333333333333");
  C.setMedia(draft, { type: "serviceModel", id: "x-aa" }, "u:4444444444444444");
  assert.equal(draft.images.hero, "u:0123456789abcdef");
  assert.deepEqual(draft.images.projects, { "iot-module": "u:1111111111111111" });
  assert.deepEqual(draft.images.models, { "iot-module": "u:2222222222222222" });
  assert.deepEqual(draft.images.serviceModels, { s1: "u:3333333333333333" });
  assert.equal(draft.extra.services[0].model, "u:4444444444444444");
  assert.equal(C.mediaRef(draft, { type: "serviceModel", id: "x-aa" }), "u:4444444444444444");
  C.setMedia(draft, { type: "projectImage", id: "iot-module" }, "");
  C.setMedia(draft, { type: "serviceModel", id: "x-aa" }, "");
  assert.deepEqual(draft.images.projects, {});
  assert.equal(draft.extra.services[0].model, "");
});

test("picker lists factory pictures for images only, uploads by kind", () => {
  const boot = { uploads: [{ ref: "u:a", kind: "image", name: "a.png" }, { ref: "u:b", kind: "model", name: "b.glb" }], factoryImages: ["assets/hero-illustration.svg"] };
  assert.deepEqual(C.pickerItems("image", boot).map((i) => i.ref), ["assets/hero-illustration.svg", "u:a"]);
  assert.deepEqual(C.pickerItems("model", boot).map((i) => i.ref), ["u:b"]);
  assert.equal(C.imageSrc("u:abc", "/cgi-bin/vadmin-api"), "/cgi-bin/vadmin-api?action=file&id=abc");
  assert.equal(C.imageSrc("assets/x.svg", "/api"), "/assets/x.svg");
});

test("save indicator: typing is unsaved at once, 'saved' only when nothing is pending", () => {
  const I = C.saveIndicator;
  assert.equal(I({ state: "saved", dirty: false, typing: false }), "saved");
  assert.equal(I({ state: "saved", dirty: false, typing: true }), "dirty", "text typed but the field not left yet");
  assert.equal(I({ state: "saved", dirty: true, typing: false }), "dirty", "committed, not saved");
  assert.equal(I({ state: "saving", dirty: false, typing: false }), "saving");
  assert.equal(I({ state: "saving", dirty: false, typing: true }), "dirty", "typing during a save request: the new text is not in it");
  assert.equal(I({ state: "dirty", dirty: false, typing: false }), "saved", "after a successful save the stale 'dirty' state does not stick");
  assert.equal(I({ state: "error", dirty: true, typing: true }), "error");
  assert.equal(I({ state: "conflict", dirty: false, typing: false }), "conflict");
});

test("save indicator over a typing session: type, leave the field, save", () => {
  const s = { state: "saved", dirty: false, typing: false };
  const steps = [];
  s.typing = true; steps.push(C.saveIndicator(s));                         // input event
  s.typing = false; s.dirty = true; s.state = "dirty"; steps.push(C.saveIndicator(s));   // focusout -> commit -> markDirty
  s.dirty = false; s.state = "saving"; steps.push(C.saveIndicator(s));     // save() started
  s.state = "saved"; steps.push(C.saveIndicator(s));                       // save() succeeded
  assert.deepEqual(steps, ["dirty", "dirty", "saving", "saved"]);
});

// ---- the project gallery ("Замовні розробки", data/portfolio.json, kept in draft.portfolio) ----
const gallerySource = JSON.parse(readFileSync(join(root, "data/portfolio.json"), "utf8")).projects;
const factoryGallery = Object.fromEntries(gallerySource.map((p) => [p.slug, { title: p.title, summary: p.summary }]));
const galleryEnv = (draft) => ({ draft, editable, factoryServices: site.services.items.length, factoryGallery });
const ALL = gallerySource.map((p) => p.slug);
const VISIBLE = gallerySource.filter((p) => !p.portfolioOnly).map((p) => p.slug);

test("gallery texts: binding, read, write into draft.portfolio.items, caps", () => {
  const d = newDraft();
  const b = C.bindingFor({ card: "gallery", slug: "toyota-hv-monitor", field: "title" }, galleryEnv(d));
  assert.equal(b.kind, "gallery");
  assert.equal(C.readText(b, galleryEnv(d), "en"), gallerySource.find((p) => p.slug === "toyota-hv-monitor").title.en);
  assert.equal(C.writeText(b, galleryEnv(d), "en", "My title\n"), "My title");
  assert.equal(d.portfolio.items["toyota-hv-monitor"].title.en, "My title");
  assert.equal(d.portfolio.items["toyota-hv-monitor"].title.uk, gallerySource.find((p) => p.slug === "toyota-hv-monitor").title.uk, "other languages keep the factory text");
  assert.equal(C.writeText(b, galleryEnv(d), "en", "My title"), null, "no change, nothing written");
  assert.equal(C.writeText(b, galleryEnv(d), "en", "x".repeat(500)).length, 80);
  const s = C.bindingFor({ card: "gallery", slug: "toyota-hv-monitor", field: "summary" }, galleryEnv(d));
  assert.equal(C.writeText(s, galleryEnv(d), "de", "y".repeat(900)).length, 600);
  for (const bad of [{ card: "gallery", slug: "nope", field: "title" }, { card: "gallery", slug: "../x", field: "title" }, { card: "gallery", slug: "toyota-hv-monitor", field: "years" }, { card: "gallery", slug: "toyota-hv-monitor", field: "__proto__" }]) {
    assert.equal(C.bindingFor(bad, galleryEnv(d)), null, JSON.stringify(bad));
  }
});

test("home selection vs portfolio content: separate switches, separate orders, slot images in draft.portfolio", () => {
  const d = newDraft();
  // the HOME page only hides/shows (draft.site.gallery); the portfolio switches items on/off (draft.portfolio.disabled)
  C.setEnabled(d, { type: "gallery", id: "can-helper" }, false);
  C.setEnabled(d, { type: "gallery", id: "can-helper" }, false);
  assert.deepEqual(d.site.gallery.hidden, ["can-helper"]);
  assert.equal(C.isOff(d, { type: "gallery", id: "can-helper" }), true);
  assert.equal(C.isOff(d, { type: "portfolio", id: "can-helper" }), false, "hiding on the home page does not touch the portfolio");
  assert.equal(d.portfolio?.disabled?.length ?? 0, 0);
  C.setEnabled(d, { type: "gallery", id: "can-helper" }, true);
  assert.deepEqual(d.site.gallery.hidden, []);
  C.setEnabled(d, { type: "portfolio", id: "can-helper" }, false);
  assert.deepEqual(d.portfolio.disabled, ["can-helper"]);
  assert.deepEqual(d.site.gallery.hidden, [], "switching it off in the portfolio does not touch the home selection");
  C.setEnabled(d, { type: "ppsection", id: "web" }, false);
  assert.deepEqual(d.portfolio.disabledSections, ["web"]);
  assert.equal(C.isOff(d, { type: "ppsection", id: "web" }), true);

  const d2 = newDraft();
  assert.equal(C.moveGallery(d2, VISIBLE[0], -1, VISIBLE, VISIBLE, "home"), false, "the first one cannot go up");
  assert.equal(C.moveGallery(d2, VISIBLE[0], 1, VISIBLE, VISIBLE, "home"), true);
  assert.ok(d2.site.gallery.order.indexOf(VISIBLE[1]) < d2.site.gallery.order.indexOf(VISIBLE[0]));
  assert.equal(d2.portfolio?.order?.length ?? 0, 0, "the home order is not the portfolio order");
  assert.equal(C.moveGallery(d2, VISIBLE[0], -1, VISIBLE, VISIBLE, "home"), true);
  assert.deepEqual(d2.site.gallery.order, [], "back to the default is stored as nothing");
  assert.equal(C.moveGallery(d2, ALL[0], 1, ALL, ALL, "portfolio"), true);
  assert.ok(d2.portfolio.order.length === ALL.length);
  assert.deepEqual(d2.site.gallery.order, [], "the portfolio order does not touch the home selection");
  assert.ok(ALL.includes("prometheus-controller") && !VISIBLE.includes("prometheus-controller"));

  C.setMedia(d2, { type: "gallerySlot", id: "toyota-hv-monitor/device-photo" }, "u:0123456789abcdef");
  assert.equal(C.mediaRef(d2, { type: "gallerySlot", id: "toyota-hv-monitor/device-photo" }), "u:0123456789abcdef");
  assert.equal(d2.portfolio.images["toyota-hv-monitor/device-photo"], "u:0123456789abcdef");
  assert.equal(d2.images?.portfolio, undefined, "no picture of the portfolio lives in draft.images any more");
  C.setMedia(d2, { type: "gallerySlot", id: "toyota-hv-monitor/device-photo" }, "");
  assert.deepEqual(d2.portfolio.images, {});
  const boot = { factoryImages: ["assets/a.svg"], uploads: [{ kind: "image", ref: "u:0123456789abcdef", name: "a" }] };
  assert.deepEqual(C.pickerItems("image", boot, true).map((i) => i.ref), ["u:0123456789abcdef"], "a gallery slot offers uploads only");
  assert.equal(C.pickerItems("image", boot).length, 2);
});

// ---- factory project cards, tags, plain strings, categories (audit "everything is editable") ----
const products = JSON.parse(readFileSync(join(root, "data/products.json"), "utf8"));
const factoryProducts = Object.fromEntries(products.map((p) => [p.id, { title: p.title, summary: p.summary, status: p.status, tags: p.tags, category: p.category }]));
const editablePlain = {};
site.stack.groups.forEach((g, gi) => g.items.forEach((it, ii) => { if (typeof it === "string") editablePlain[`stack.groups.${gi}.items.${ii}`] = it; }));
site.contact.details.forEach((d, i) => { if (typeof d.value === "string") editablePlain[`contact.details.${i}.value`] = d.value; });
const fullEnv = (draft) => ({ draft, editable, factoryServices: site.services.items.length, factoryGallery, factoryProducts, editablePlain });

test("a factory project card: title/summary/status go to draft.products, tags per chip, category", () => {
  const d = newDraft();
  const id = products[0].id;
  const t = C.bindingFor({ card: "products", id, field: "title" }, fullEnv(d));
  assert.equal(t.kind, "productText");
  assert.equal(C.writeText(t, fullEnv(d), "uk", "Новий"), "Новий");
  assert.equal(d.products[id].title.uk, "Новий");
  assert.equal(d.products[id].title.en, products[0].title.en, "other languages keep the factory text");
  assert.equal(C.bindingFor({ card: "products", id: "nope", field: "title" }, fullEnv(d)), null);
  const tag = C.bindingFor({ card: "tag", id, index: 1 }, fullEnv(d));
  assert.equal(C.readText(tag, fullEnv(d), "uk"), products[0].tags[1]);
  assert.equal(C.writeText(tag, fullEnv(d), "uk", "Zephyr"), "Zephyr");
  assert.deepEqual(d.products[id].tags, products[0].tags.map((x, i) => (i === 1 ? "Zephyr" : x)));
  assert.equal(C.writeText(tag, fullEnv(d), "uk", ""), null, "an emptied tag is not saved");
  assert.equal(C.bindingFor({ card: "tag", id: "nope", index: 0 }, fullEnv(d)), null);
  const other = ["software", "hardware", "ai", "automation"].find((c) => c !== products[0].category);
  C.setCategory(d, id, other, factoryProducts);
  assert.equal(C.categoryOf(d, id, factoryProducts), other);
  C.setCategory(d, id, products[0].category, factoryProducts);
  assert.equal(d.products[id].category, undefined, "back to the factory category");
});

test("plain strings: stack items and contact values; only known paths", () => {
  const d = newDraft();
  const b = C.bindingFor({ plain: "stack.groups.0.items.0" }, fullEnv(d));
  assert.equal(C.readText(b, fullEnv(d), "uk"), site.stack.groups[0].items[0]);
  assert.equal(C.writeText(b, fullEnv(d), "en", "ESP32-S3"), "ESP32-S3");
  assert.equal(d.plain["stack.groups.0.items.0"], "ESP32-S3");
  assert.equal(C.writeText(b, fullEnv(d), "en", site.stack.groups[0].items[0]), site.stack.groups[0].items[0]);
  assert.equal(d.plain["stack.groups.0.items.0"], undefined, "the factory value is not an override");
  for (const bad of ["brand.name", "contact.details.0.href", "stack.groups.0.items.x", "__proto__"]) assert.equal(C.bindingFor({ plain: bad }, fullEnv(d)), null, bad);
  const mail = C.bindingFor({ plain: "contact.details.0.value" }, fullEnv(d));
  assert.equal(C.writeText(mail, fullEnv(d), "uk", "me@example.org"), "me@example.org");
});

test("gallery years and tags", () => {
  const d = newDraft();
  const slug = "can-helper";
  const y = C.bindingFor({ card: "galleryYears", slug }, galleryEnv(d));
  const g = { ...factoryGallery, [slug]: { ...factoryGallery[slug], years: "2022", tags: ["C#", "WPF"] } };
  const env = { ...galleryEnv(d), factoryGallery: g };
  assert.equal(C.writeText(y, env, "uk", "2023"), "2023");
  assert.equal(d.portfolio.items[slug].years, "2023");
  const t = C.bindingFor({ card: "galleryTag", slug, index: 0 }, env);
  assert.equal(C.writeText(t, env, "uk", "C# 12"), "C# 12");
  assert.deepEqual(d.portfolio.items[slug].tags, ["C# 12", "WPF"]);
});
