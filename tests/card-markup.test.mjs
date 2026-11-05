import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const site = JSON.parse(readFileSync(join(root, "data/site.json"), "utf8"));

// Card texts may use **key**, ~~minor~~ and {{aspect}}; app.js renders them as DOM nodes. Broken pairs would show up as literal marks.
test("service card emphasis marks are balanced in every language", () => {
  for (const [i, item] of site.services.items.entries()) {
    for (const value of [item.text, ...item.points]) {
      for (const lang of ["uk", "en", "de"]) {
        const s = value[lang];
        assert.equal((s.match(/\*\*/g) || []).length % 2, 0, `services.items.${i} ${lang}: unbalanced ** in "${s}"`);
        assert.equal((s.match(/~~/g) || []).length % 2, 0, `services.items.${i} ${lang}: unbalanced ~~ in "${s}"`);
        assert.equal((s.match(/\{\{/g) || []).length, (s.match(/\}\}/g) || []).length, `services.items.${i} ${lang}: unbalanced {{ }} in "${s}"`);
        assert.ok(!/\*\*\s*\*\*|~~\s*~~|\{\{\s*\}\}/.test(s), `services.items.${i} ${lang}: empty mark in "${s}"`);
      }
    }
  }
});

test("cards without a 3D model use the text emphasis", () => {
  for (const [i, item] of site.services.items.entries()) {
    if (item.model) continue;
    assert.match(item.text.en, /\*\*|\{\{/, `services.items.${i} has neither a model nor emphasised text`);
  }
});
