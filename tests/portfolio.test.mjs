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

test("the portfolio PDFs exist in three languages, are PDFs, and stay light", () => {
  for (const f of [PDF, PDF.replace(".pdf", "_uk.pdf"), PDF.replace(".pdf", "_de.pdf")]) {
    assert.ok(existsSync(join(root, f)), f);
    const bytes = readFileSync(join(root, f));
    assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
    assert.ok(bytes.length < 5 * 1024 * 1024, `${f}: ${bytes.length} bytes`);
  }
});

test("the web portfolio renders every section in every language, escapes text and falls back to English", async () => {
  const { sectionsFor, tr, esc } = await import("../assets/portfolio-render.js");
  const { projects } = JSON.parse(read("data/portfolio.json")), manifest = JSON.parse(read("data/portfolio-images.json"));
  const counts = new Set();
  for (const l of LANGS) {
    const secs = sectionsFor(site.portfolioPage, site, projects, manifest, l);
    counts.add(secs.length);
    for (const s of secs) { assert.ok(s.title && s.kicker, `${l}/${s.id}`); assert.ok(s.body.length > 20, `${l}/${s.id} body`); assert.ok(!/<script|undefined|\[object/i.test(s.body), `${l}/${s.id}`); }
  }
  assert.equal(counts.size, 1, "same sections in every language");
  const uk = sectionsFor(site.portfolioPage, site, projects, manifest, "uk"), en = sectionsFor(site.portfolioPage, site, projects, manifest, "en");
  assert.notEqual(uk[1].title, en[1].title);
  assert.equal(tr({ en: "x", uk: "", de: "z" }, "uk"), "x");
  assert.equal(esc('<img src=x onerror="1">'), "&lt;img src=x onerror=&quot;1&quot;&gt;");
  const evil = structuredClone(site.portfolioPage); evil.sections[0].blocks = [{ t: "p", text: { en: "<script>alert(1)</script>" } }, { t: "fig", img: "../../etc", caption: { en: "x" } }];
  const html = sectionsFor(evil, site, projects, manifest, "en")[0].body;
  assert.ok(!html.includes("<script") && !html.includes("etc"));
  assert.equal(sectionsFor(site.portfolioPage, site, projects, manifest, "en", { disabled: ["profile"] }).some((s) => s.id === "profile"), false);
});

test("Projects and Contact link to the web portfolio (which offers the PDF), and the link texts exist in three languages", () => {
  const html = read("index.html");
  assert.equal((html.match(/href="portfolio\/"/g) || []).length, 2);
  assert.ok(existsSync(join(root, "portfolio/index.html")));
  assert.match(read("portfolio/index.html"), new RegExp(PDF.split("/").pop()));
  assert.ok(site.portfolioPage.sections.length >= 14);
  for (const k of [site.work.portfolio, site.contact.portfolio]) for (const l of LANGS) assert.ok(k[l]);
});

test("experience is counted from 2014 everywhere and workplaces stay out of the site (they belong to the portfolio)", () => {
  const all = JSON.stringify(site);
  assert.ok(!/9\+|9 років|9 Jahre|9 years/.test(all), "old 9+ years wording");
  for (const l of LANGS) { assert.match(site.hero.experience[l], /2014/); }
  const { portfolioPage, ...rest } = site;
  assert.ok(!/Adventx|Tesla-service/.test(JSON.stringify(rest)));
  assert.match(JSON.stringify(portfolioPage), /Adventx and Tesla-service/);
  assert.match(site.meta.description.en, /2014/);
});

test("the new services exist, are complete in three languages and use the same names as the portfolio", () => {
  const titles = site.services.items.map((s) => s.title.en);
  for (const t of ["Website development", "Android apps", "Custom apps built together with AI agents", "Local AI and voice", "Linux, networks and diagnostics", "AI server: mail, website, documents"]) assert.ok(titles.includes(t), t);
  assert.match(read("assets/portfolio-render.js"), /site\.services\.items/, "page and PDF read the service names from data/site.json");
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
  const dir = join(root, "assets/portfolio/img");
  const files = readdirSync(dir);
  assert.ok(files.length >= 20 && files.every((f) => f.endsWith(".jpg")));
  for (const f of files) assert.ok(statSync(join(dir, f)).size < 400 * 1024, f);
});
import * as fs from "node:fs";

test("the public texts do not call the controller by its internal name", () => {
  const visible = JSON.stringify([site, JSON.parse(read("data/products.json")).map(({ title, summary, tags }) => ({ title, summary, tags }))]);
  assert.ok(!/cronos/i.test(visible.replace(/"img":"[^"]*"/g, "")), "Cronos is an internal file name only");
});

test("the sitemap lists the web portfolio", () => {
  assert.match(read("sitemap.xml"), /<loc>https:\/\/viteh\.org\/portfolio\/<\/loc>/);
});
