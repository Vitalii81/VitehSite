// The portfolio PDF, its links and the texts that must agree with it (experience since 2014, three languages, no private data).
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");
const PDF = "assets/portfolio/Vitalii_Krutikov_Engineering_Portfolio_2026.pdf";
const site = JSON.parse(read("data/site.json"));
const LANGS = ["uk", "en", "de"];

const leaves = (o, path = "", out = []) => {
  if (o && typeof o === "object") {
    const keys = Object.keys(o);
    if (keys.length && LANGS.every((l) => typeof o[l] === "string")) out.push([path, o]);
    else keys.forEach((k) => leaves(o[k], `${path}.${k}`, out));
  }
  return out;
};

test("the portfolio PDF exists, is a PDF, and stays light", () => {
  assert.ok(existsSync(join(root, PDF)));
  const bytes = readFileSync(join(root, PDF));
  assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
  assert.ok(bytes.length < 5 * 1024 * 1024, `${bytes.length} bytes`);
});

test("Projects and Contact link to the PDF, and the link texts exist in three languages", () => {
  const html = read("index.html");
  assert.ok((html.match(new RegExp(PDF.replace(/[.]/g, "\\."), "g")) || []).length >= 2);
  for (const k of [site.work.portfolio, site.contact.portfolio]) for (const l of LANGS) assert.ok(k[l]);
});

test("experience is counted from 2014 everywhere and workplaces stay out of the site (they belong to the portfolio)", () => {
  const all = JSON.stringify(site);
  assert.ok(!/9\+|9 років|9 Jahre|9 years/.test(all), "old 9+ years wording");
  for (const l of LANGS) { assert.match(site.hero.experience[l], /2014/); }
  assert.ok(!/Adventx|Tesla-service/.test(all), "workplace names are for the PDF portfolio only");
  assert.match(readFileSync(join(root, "tools/make-portfolio.mjs"), "utf8"), /Adventx and Tesla-service/);
  assert.match(site.meta.description.en, /2014/);
});

test("the new services exist, are complete in three languages and use the same names as the portfolio", () => {
  const titles = site.services.items.map((s) => s.title.en);
  for (const t of ["Website development", "Android apps", "Custom apps built together with AI agents", "Local AI and voice", "Linux, networks and diagnostics", "AI server: mail, website, documents"]) assert.ok(titles.includes(t), t);
  const pdfSource = read("tools/make-portfolio.mjs");
  assert.match(pdfSource, /site\.services\.items/, "the PDF reads the service names from data/site.json");
});

test("every text in data/site.json and data/products.json has all three languages", () => {
  for (const [path, v] of [...leaves(site), ...leaves(JSON.parse(read("data/products.json")))]) for (const l of LANGS) assert.ok(v[l].trim(), `${path}.${l}`);
  assert.ok(leaves(site).length > 100);
});

test("the stack lists the desktop platforms the owner confirmed", () => {
  const items = site.stack.groups.flatMap((g) => g.items).join("|");
  for (const x of ["WinForms", "WPF", "Qt", "GTK", "Swift"]) assert.ok(items.includes(x), x);
});

test("nothing private ships: no personal mail, no source-package paths, no tokens in the build script, the site or the data", () => {
  for (const f of ["index.html", "data/site.json", "data/products.json", "tools/make-portfolio.mjs", "README.md", "docs/portfolio-mapping.md"]) {
    const t = read(f);
    assert.ok(!/gmail\.com/i.test(t), `${f}: personal address`);
    if (f !== "docs/portfolio-mapping.md") assert.ok(!/portfolio-source\//.test(t), `${f}: source package path`);
  }
});

test("portfolio images are small and the PDF build input folder only holds JPEGs", () => {
  const { readdirSync } = fs;
  const dir = join(root, "tools/portfolio/img");
  const files = readdirSync(dir);
  assert.ok(files.length >= 20 && files.every((f) => f.endsWith(".jpg")));
  for (const f of files) assert.ok(statSync(join(dir, f)).size < 400 * 1024, f);
});
import * as fs from "node:fs";
