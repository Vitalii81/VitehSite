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
