import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");
const catalog = JSON.parse(read("radxa-admin/catalog/service-ideas.json"));
const icons = JSON.parse(read("data/blocks.json")).icons;
const L = ["uk", "en", "de"];

test("catalog cards: three languages, known icon, limits, balanced emphasis marks", () => {
  assert.ok(catalog.items.length >= 5);
  assert.equal(new Set(catalog.items.map((i) => i.id)).size, catalog.items.length);
  for (const it of catalog.items) {
    const c = it.card;
    assert.ok(icons.includes(c.icon), `${it.id}: icon ${c.icon}`);
    assert.ok(["idea", "learning", "help", "ready"].includes(it.readiness), `${it.id}: readiness`);
    assert.ok(c.points.length >= 1 && c.points.length <= 6);
    const fields = [["title", c.title, 80], ["text", c.text, 300], ...c.points.map((p, n) => [`point${n}`, p, 80])];
    for (const [name, v, max] of fields) for (const l of L) {
      const s = v[l];
      assert.ok(s && s.length <= max, `${it.id}.${name}.${l} empty or longer than ${max}`);
      assert.equal((s.match(/\*\*/g) || []).length % 2, 0, `${it.id}.${name}.${l}: ** unbalanced`);
      assert.equal((s.match(/~~/g) || []).length % 2, 0, `${it.id}.${name}.${l}: ~~ unbalanced`);
      assert.equal((s.match(/\{\{/g) || []).length, (s.match(/\}\}/g) || []).length, `${it.id}.${name}.${l}: {{ }} unbalanced`);
    }
    for (const l of L) assert.match(c.text[l], /\*\*|\{\{/, `${it.id}: no emphasis in text ${l} (cards have no 3D model)`);
    for (const s of it.sources) assert.match(s.url, /^https:\/\/[^\s"'<>]+$/, `${it.id}: source url`);
  }
});

test("the catalog never reaches the public site: nothing public references it and it lives outside the package sources", () => {
  const walk = (dir, out = []) => {
    for (const n of readdirSync(dir)) {
      const p = join(dir, n);
      if (n === "node_modules" || n === ".git") continue;
      statSync(p).isDirectory() ? walk(p, out) : out.push(p);
    }
    return out;
  };
  for (const d of ["assets", "data", "portfolio"]) for (const f of walk(join(root, d))) {
    if (!/\.(html|js|json|css|mjs)$/.test(f)) continue;
    assert.ok(!readFileSync(f, "utf8").includes("service-ideas"), `${f} mentions the catalog`);
  }
  for (const f of ["index.html", "impressum.html", "datenschutz.html", "sitemap.xml", "robots.txt"]) assert.ok(!read(f).includes("service-ideas"), f);
  assert.ok(existsSync(join(root, "docs/market-needs-2026.md")));
});

test("installer and push script ship the catalog folder with the admin code", () => {
  assert.match(read("radxa-admin/install-on-radxa.sh"), /"\$HERE\/catalog"/);
  assert.match(read("radxa-admin/push-to-radxa.sh"), /radxa-admin\/catalog/);
});
