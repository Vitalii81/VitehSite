// Project archive 2022-2025: data, image-slot manifest, the placeholder rule and the page logic.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { filterProjects, projectSlots, ratioOf, slotUrl } from "../assets/portfolio.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const json = (p) => JSON.parse(readFileSync(join(root, p), "utf8"));
const { projects } = json("data/portfolio.json");
const manifest = json("data/portfolio-images.json");
const site = json("data/site.json");
const L = ["uk", "en", "de"];

test("every project is complete in three languages and uses a known category", () => {
  const cats = site.work.archive.categories.map((c) => c.id);
  assert.equal(new Set(projects.map((p) => p.slug)).size, projects.length);
  for (const p of projects) {
    assert.match(p.slug, /^[a-z0-9-]+$/); assert.ok(cats.includes(p.category), p.slug);
    for (const l of L) { assert.ok(p.title[l] && p.summary[l], `${p.slug}.${l}`); }
    assert.ok(p.tags.length && p.slots.length);
  }
  for (const c of site.work.archive.categories) for (const l of L) assert.ok(c.label[l]);
});

test("manifest: one entry per project slot, valid ratio, alt in three languages, honest status", () => {
  const keys = manifest.map((m) => `${m.slug}/${m.slot}`);
  assert.equal(new Set(keys).size, keys.length);
  const wanted = projects.flatMap((p) => p.slots.map((s) => `${p.slug}/${s}`));
  assert.deepEqual([...keys].sort(), [...wanted].sort());
  for (const m of manifest) {
    assert.equal(m.file, `assets/portfolio/${m.slug}/${m.slot}.webp`);
    assert.match(m.ratio, /^\d{1,2}:\d{1,2}$/); assert.ok(["placeholder", "final"].includes(m.status));
    for (const l of L) assert.ok(m.alt[l]);
    assert.ok(m.source_hint);
  }
});

test("the publication build holds no placeholder pictures: placeholder slots have no file, final slots have light files", () => {
  for (const m of manifest) {
    const base = join(root, "assets/portfolio", m.slug, m.slot);
    if (m.status === "placeholder") assert.ok(!existsSync(base + ".webp") && !existsSync(base + ".jpg"), `${m.slug}/${m.slot} is a placeholder but has a file`);
    else for (const ext of [".webp", ".jpg"]) { assert.ok(existsSync(base + ext), base + ext); assert.ok(statSync(base + ext).size <= 200 * 1024, base + ext); }
  }
  const dir = join(root, "assets/portfolio");
  const known = new Set(manifest.flatMap((m) => [`${m.slug}/${m.slot}.webp`, `${m.slug}/${m.slot}.jpg`]));
  for (const slug of readdirSync(dir).filter((n) => statSync(join(dir, n)).isDirectory())) for (const f of readdirSync(join(dir, slug))) assert.ok(known.has(`${slug}/${f}`), `stray file ${slug}/${f}`);
});

test("placeholder files are only generated into tools/ (git-ignored) and the generator and the importer exist", () => {
  assert.match(readFileSync(join(root, ".gitignore"), "utf8"), /tools\/portfolio\/placeholders\//);
  for (const f of ["tools/make-portfolio-placeholders.mjs", "tools/portfolio-images.mjs", "tools/lib/headless.mjs"]) assert.ok(existsSync(join(root, f)), f);
  assert.match(readFileSync(join(root, "tools/make-portfolio-placeholders.mjs"), "utf8"), /PLACEHOLDER/);
});

test("page logic: placeholders stay hidden for visitors and are labelled in preview; only safe paths load", () => {
  const ph = { slug: "a", slot: "b", file: "assets/portfolio/a/b.webp", status: "placeholder", ratio: "3:2" };
  const fin = { ...ph, slot: "c", file: "assets/portfolio/a/c.webp", status: "final" };
  assert.equal(slotUrl(ph), null);
  assert.equal(slotUrl(ph, { preview: true }), "tools/portfolio/placeholders/a/b.webp");
  assert.equal(slotUrl(fin), "assets/portfolio/a/c.webp");
  assert.equal(slotUrl({ ...fin, file: "assets/u/x1.png" }), "assets/u/x1.png");
  for (const bad of ["https://evil/x.webp", "//evil/x.webp", "assets/portfolio/../x.webp", "javascript:1", "", null]) assert.equal(slotUrl({ ...fin, file: bad }), null, String(bad));
  const slots = projectSlots({ slug: "a", slots: ["b", "c"] }, [ph, fin]);
  assert.deepEqual(slots.map((s) => s.entry.slot), ["c"]);
  assert.deepEqual(projectSlots({ slug: "a", slots: ["b", "c"] }, [ph, fin], { preview: true }).map((s) => s.placeholder), [true, false]);
  assert.equal(ratioOf({ ratio: "16:9" }), "16 / 9"); assert.equal(ratioOf({ ratio: "x" }), "4 / 3");
  assert.equal(filterProjects(projects, "all").length, projects.length);
  assert.ok(filterProjects(projects, "hmi").every((p) => p.category === "hmi"));
});

test("nothing from the owner's confirm-list leaks: no customers, contracts or private words in the archive data", () => {
  const all = JSON.stringify([projects, manifest.map((m) => m.alt)]);
  assert.ok(!/договір|contract|Sinnexel|Vertrag|\bNDA\b|@|https?:/i.test(all));
});
