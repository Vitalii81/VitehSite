import test from "node:test";
import assert from "node:assert/strict";
import { cleanHit, deviceOf, refHost, addHit, emptyDay, summarise, handleHit, handleStats, resetMemory } from "./stats.mjs";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120";
const headers = (ua = UA) => new Headers(ua ? { "user-agent": ua } : {});
const hit = (body, { origin = "https://viteh.org", ua = UA, cf = { country: "DE" } } = {}) => {
  const r = new Request("https://viteh.org/api/hit", { method: "POST", headers: { origin, "user-agent": ua }, body: JSON.stringify(body) });
  Object.defineProperty(r, "cf", { value: cf });
  return r;
};

test("only known pages from real browsers count, and only the allowed values are kept", () => {
  assert.equal(cleanHit({ p: "/admin" }, headers(), {}), null);
  assert.equal(cleanHit({ p: "/" }, headers("Googlebot/2.1"), {}), null);
  assert.equal(cleanHit({ p: "/" }, headers(""), {}), null);
  const h = cleanHit({ p: "/", l: "de", r: "https://www.google.com/search?q=secret", w: 1280, t: 5000, k: "leave" }, headers(), { country: "DE" });
  assert.deepEqual(h, { kind: "leave", path: "/", country: "DE", lang: "de", device: "desktop", ref: "google.com", seconds: 1800 });
  assert.equal(cleanHit({ p: "/", l: "<x>" }, headers(), { country: "zz!" }).country, "??");
  assert.equal(cleanHit({ p: "/", l: "<x>" }, headers(), {}).lang, "other");
});

test("device classes and referrer hosts", () => {
  assert.equal(deviceOf("Mozilla/5.0 (iPhone; CPU iPhone OS 17) Mobile", 390), "mobile");
  assert.equal(deviceOf("Mozilla/5.0 (iPad; CPU OS 17)", 820), "tablet");
  assert.equal(deviceOf("Mozilla/5.0 (Linux; Android 14; Tab)", 800), "tablet");
  assert.equal(refHost("https://viteh.org/portfolio/"), "");
  assert.equal(refHost("https://www.viteh.org/"), "");
  assert.equal(refHost("not a url"), "");
  assert.equal(refHost("https://user:pw@duckduckgo.com/?q=x#y"), "duckduckgo.com");
});

test("views and reading time are counted per day; a page left at once is no reading", () => {
  const day = emptyDay();
  addHit(day, { kind: "view", path: "/", country: "DE", lang: "de", device: "mobile", ref: "" }, 14);
  addHit(day, { kind: "view", path: "/portfolio/", country: "UA", lang: "uk", device: "desktop", ref: "google.com" }, 14);
  addHit(day, { kind: "leave", path: "/", seconds: 45 }, 14);
  addHit(day, { kind: "leave", path: "/", seconds: 0 }, 14);
  const s = summarise([["2026-11-08", day]]);
  assert.equal(s.views, 2);
  assert.equal(s.hours[14], 2);
  assert.deepEqual(s.refs.map((r) => r.key).sort(), ["(direct)", "google.com"]);
  assert.equal(s.avgSeconds, 45);
  assert.equal(s.bins[2].count, 1);
  assert.equal(s.pages.find((p) => p.key === "/").avgSeconds, 45);
});

test("a flood of distinct values cannot grow a day without limit", () => {
  const day = emptyDay();
  for (let i = 0; i < 500; i++) addHit(day, { kind: "view", path: "/", country: "DE", lang: "de", device: "desktop", ref: `h${i}.example.com` }, 0);
  assert.ok(Object.keys(day.refs).length <= 61);
  assert.equal(day.views, 500);
});

test("the endpoint takes hits from the site only, stores them and shows them only with the secret", async () => {
  resetMemory();
  const env = { SETTINGS_TOKEN: "s3cret-token" };
  assert.equal((await handleHit(hit({ p: "/" }, { origin: "https://evil.example" }), env)).status, 403);
  assert.equal((await handleHit(new Request("https://viteh.org/api/hit"), env)).status, 405);
  assert.equal((await handleHit(hit({ p: "/", l: "de" }), env)).status, 204);
  assert.equal((await handleHit(hit({ p: "/", k: "leave", t: 30 }), env)).status, 204);
  assert.equal((await handleHit(hit({ p: "/secret-page" }), env)).status, 204);        // answered like any hit, not counted
  const url = new URL("https://viteh.org/api/stats?days=7");
  assert.equal((await handleStats(new Request(url), env, url)).status, 401);
  const got = await handleStats(new Request(url, { headers: { authorization: "Bearer s3cret-token" } }), env, url);
  const body = await got.json();
  assert.equal(body.views, 1);
  assert.equal(body.avgSeconds, 30);
  assert.deepEqual(body.countries, [{ key: "DE", count: 1 }]);
  assert.ok(!JSON.stringify(body).includes("secret-page"));
});
