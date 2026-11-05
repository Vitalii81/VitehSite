// GET/POST /api/settings: small live parameters of the page (today: the assistant's avatar) that the admin can change without a new publication.
// Stored in the Durable Object ASSIST_GATE (the page's built-in value is the fallback); written only with the bearer secret SETTINGS_TOKEN.
const KEYS = { assistantAvatar: /^[a-z0-9-]{1,40}$/ };
const memory = { value: {} };          // used when the Durable Object binding is missing (tests, per isolate)

const json = (status, body, extra = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra } });

/** Keeps only known keys with valid values. */
export function cleanSettings(raw) {
  const out = {};
  if (raw && typeof raw === "object") for (const [key, ok] of Object.entries(KEYS)) if (typeof raw[key] === "string" && ok.test(raw[key])) out[key] = raw[key];
  return out;
}

function tokenOk(request, env) {
  const want = env && env.SETTINGS_TOKEN;
  const got = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!want || got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ got.charCodeAt(i);
  return diff === 0;
}

async function viaGate(env, path, body) {
  if (!(env && env.ASSIST_GATE)) return null;
  const stub = env.ASSIST_GATE.get(env.ASSIST_GATE.idFromName("assistant-gate"));
  const r = await stub.fetch("https://gate" + path, { method: "POST", body: JSON.stringify(body || {}) });
  return r.json();
}

export async function handleSettings(request, env) {
  if (request.method === "GET") {
    const got = await viaGate(env, "/settings-get").catch(() => null);
    return json(200, cleanSettings(got ? got.value : memory.value), { "cache-control": "public, max-age=15" });
  }
  if (request.method !== "POST") return json(405, { error: "method" }, { allow: "GET, POST" });
  if (!tokenOk(request, env)) return json(401, { error: "auth" });
  let body;
  try { body = JSON.parse(await request.text()); } catch { return json(400, { error: "bad_request" }); }
  const value = cleanSettings(body);
  const stored = await viaGate(env, "/settings-set", { value });
  if (!stored) memory.value = value;
  return json(200, { ok: true, settings: value });
}
