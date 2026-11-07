// Visit statistics without cookies: POST /api/hit (from assets/stats.js) adds to daily counters, GET /api/stats (bearer SETTINGS_TOKEN) reads them.
// Stored in the Durable Object ASSIST_GATE as one object per day. Nothing that identifies a visitor is kept: no IP address, no cookie, no id, no full URL,
// no user agent; the page, the country Cloudflare reports, the referring host, a coarse device class, the language, the hour and how long the page was
// visible are counted. Visitors are not recognised across pages, so the numbers are page views, not people.
import { originAllowed } from "./contact.mjs";

export const PAGES = new Set(["/", "/portfolio/", "/impressum.html", "/datenschutz.html"]);
const KEEP_DAYS = 400, MAX_KEYS = 60, MAX_SECONDS = 1800;
export const DURATION_BINS = ["<10s", "10-30s", "30-60s", "1-3min", ">3min"];
const BOT = /bot|crawl|spider|slurp|headless|lighthouse|curl|wget|python|node-fetch|preview|monitor|uptime|facebookexternalhit|embedly|whatsapp|telegram/i;
const DEVICES = ["mobile", "tablet", "desktop"];

const json = (status, body, extra = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra } });
const memory = { days: new Map() };          // used when the Durable Object binding is missing (tests, per isolate)

export const dayKey = (ms) => new Date(ms).toISOString().slice(0, 10);
export const emptyDay = () => ({ views: 0, pages: {}, countries: {}, refs: {}, devices: {}, langs: {}, hours: Array(24).fill(0), dur: { n: 0, sum: 0, bins: Array(5).fill(0), pages: {} } });

export function deviceOf(ua, width) {
  if (/ipad|tablet|kindle|silk/i.test(ua) || (/android/i.test(ua) && !/mobile/i.test(ua))) return "tablet";
  if (/mobi|iphone|ipod|android/i.test(ua)) return "mobile";
  return Number(width) > 0 && Number(width) < 700 ? "mobile" : "desktop";
}

/** The host of the referrer, without path or query; "" for a visit from the site itself or without a usable referrer. */
export function refHost(ref, ownHosts = ["viteh.org", "www.viteh.org"]) {
  try {
    const host = new URL(String(ref)).hostname.toLowerCase().replace(/^www\./, "");
    return host && !ownHosts.includes(host) && /^[a-z0-9.-]{1,80}$/.test(host) ? host : "";
  } catch { return ""; }
}

/** What the page sent, reduced to the few allowed values; null when it is not a countable hit. */
export function cleanHit(raw, headers, cf) {
  if (!raw || typeof raw !== "object") return null;
  const ua = String(headers.get("user-agent") || "");
  if (!ua || BOT.test(ua)) return null;
  const path = String(raw.p || "");
  if (!PAGES.has(path)) return null;
  const kind = raw.k === "leave" ? "leave" : "view";
  const country = /^[A-Z]{2}$/.test(String(cf && cf.country || "")) ? cf.country : "??";
  const lang = /^(uk|en|de)$/.test(String(raw.l)) ? raw.l : "other";
  const seconds = Math.max(0, Math.min(MAX_SECONDS, Math.round(Number(raw.t) || 0)));
  return { kind, path, country, lang, device: deviceOf(ua, raw.w), ref: refHost(raw.r), seconds };
}

const bump = (map, key) => { if (!(key in map) && Object.keys(map).length >= MAX_KEYS) key = "other"; map[key] = (map[key] || 0) + 1; };
const binOf = (s) => (s < 10 ? 0 : s < 30 ? 1 : s < 60 ? 2 : s < 180 ? 3 : 4);

export function addHit(day, hit, hour) {
  if (hit.kind === "leave") {
    if (hit.seconds < 1) return day;                  // a page left at once is not a reading
    day.dur.n += 1; day.dur.sum += hit.seconds; day.dur.bins[binOf(hit.seconds)] += 1;
    const p = day.dur.pages[hit.path] || (day.dur.pages[hit.path] = { n: 0, sum: 0 });
    p.n += 1; p.sum += hit.seconds;
    return day;
  }
  day.views += 1; day.hours[hour] += 1;
  bump(day.pages, hit.path); bump(day.countries, hit.country); bump(day.refs, hit.ref || "(direct)"); bump(day.devices, hit.device); bump(day.langs, hit.lang);
  return day;
}

/** Sums the days into one report. */
export function summarise(days) {
  const total = emptyDay(); const perDay = [];
  for (const [date, d] of days) {
    perDay.push({ date, views: d.views, avgSeconds: d.dur.n ? Math.round(d.dur.sum / d.dur.n) : 0 });
    total.views += d.views; d.hours.forEach((n, h) => { total.hours[h] += n; });
    for (const k of ["pages", "countries", "refs", "devices", "langs"]) for (const [key, n] of Object.entries(d[k])) total[k][key] = (total[k][key] || 0) + n;
    total.dur.n += d.dur.n; total.dur.sum += d.dur.sum; d.dur.bins.forEach((n, i) => { total.dur.bins[i] += n; });
    for (const [p, v] of Object.entries(d.dur.pages)) { const t = total.dur.pages[p] || (total.dur.pages[p] = { n: 0, sum: 0 }); t.n += v.n; t.sum += v.sum; }
  }
  const sorted = (m) => Object.entries(m).sort((a, b) => b[1] - a[1]).map(([key, count]) => ({ key, count }));
  return {
    views: total.views, days: perDay, hours: total.hours, bins: DURATION_BINS.map((label, i) => ({ label, count: total.dur.bins[i] })),
    avgSeconds: total.dur.n ? Math.round(total.dur.sum / total.dur.n) : 0,
    pages: sorted(total.pages).map((p) => ({ ...p, avgSeconds: total.dur.pages[p.key] ? Math.round(total.dur.pages[p.key].sum / total.dur.pages[p.key].n) : 0 })),
    countries: sorted(total.countries), refs: sorted(total.refs), devices: sorted(total.devices), langs: sorted(total.langs),
  };
}

/** Storage side, shared by the Durable Object and the in-memory fallback: `store` has get(key), put(key, value), list({prefix}), delete(keys). */
export async function recordHit(store, hit, now = Date.now()) {
  const key = "day:" + dayKey(now);
  const day = (await store.get(key)) || emptyDay();
  await store.put(key, addHit(day, hit, new Date(now).getUTCHours()));
  const stamp = dayKey(now);
  if ((await store.get("stats-pruned")) !== stamp) {
    await store.put("stats-pruned", stamp);
    const old = [...(await store.list({ prefix: "day:" })).keys()].filter((k) => k < "day:" + dayKey(now - KEEP_DAYS * 86400000));
    if (old.length) await store.delete(old);
  }
}

export async function readDays(store, days, now = Date.now()) {
  const from = "day:" + dayKey(now - (Math.max(1, Math.min(KEEP_DAYS, days)) - 1) * 86400000);
  const all = await store.list({ prefix: "day:" });
  return [...all.entries()].filter(([k]) => k >= from).sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([k, v]) => [k.slice(4), v]);
}

const memoryStore = () => ({
  get: async (k) => memory.days.get(k), put: async (k, v) => { memory.days.set(k, v); },
  list: async ({ prefix }) => new Map([...memory.days].filter(([k]) => k.startsWith(prefix))), delete: async (keys) => { for (const k of keys) memory.days.delete(k); },
});
export const resetMemory = () => memory.days.clear();

async function viaGate(env, path, body) {
  if (!(env && env.ASSIST_GATE)) return null;
  const stub = env.ASSIST_GATE.get(env.ASSIST_GATE.idFromName("assistant-gate"));
  return (await stub.fetch("https://gate" + path, { method: "POST", body: JSON.stringify(body || {}) })).json();
}

function tokenOk(request, env) {
  const want = env && env.SETTINGS_TOKEN;
  const got = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!want || got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ got.charCodeAt(i);
  return diff === 0;
}

export async function handleHit(request, env) {
  if (request.method !== "POST") return json(405, { error: "method" }, { allow: "POST" });
  if (!originAllowed(request.headers.get("origin"))) return json(403, { error: "origin" });
  let body;
  try { body = JSON.parse((await request.text()).slice(0, 2000)); } catch { return json(204, {}); }
  const hit = cleanHit(body, request.headers, request.cf);
  if (hit) {
    try { if (!(await viaGate(env, "/stats-hit", hit))) await recordHit(memoryStore(), hit); } catch (e) { console.error("stats hit failed:", e && e.message); }
  }
  return new Response(null, { status: 204 });
}

export async function handleStats(request, env, url) {
  if (request.method !== "GET") return json(405, { error: "method" }, { allow: "GET" });
  if (!tokenOk(request, env)) return json(401, { error: "auth" });
  const days = Number(url.searchParams.get("days")) || 30;
  const got = await viaGate(env, "/stats-get", { days }).catch(() => null);
  const list = got ? got.days : await readDays(memoryStore(), days);
  return json(200, { ok: true, since: list.length ? list[0][0] : null, ...summarise(list) });
}

/** The Durable Object side: called by AssistantGate for /stats-hit and /stats-get. */
export async function gateStats(storage, path, body) {
  if (path === "/stats-hit") { await recordHit(storage, body); return { ok: true }; }
  return { days: await readDays(storage, Number(body.days) || 30) };
}
