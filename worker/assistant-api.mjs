// POST /api/assistant: the thin layer between the visitor and the owner's own model pool. See assistant.mjs for the logic.
import { originAllowed } from "./contact.mjs";
import { gateStats } from "./stats.mjs";
import {
  Gate, LIMITS, OutputGuard, PRIVATE_KB_PATH, briefMessages, buildBriefPrompt, buildSystemPrompt, gateClient, looksLikeInjection, parseBackends, refusalText, sseDeltas, upstreamRequest, validateRequest,
} from "./assistant.mjs";

const jsonResponse = (status, body, extra = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra } });
const localGate = new Gate();          // used when the Durable Object binding ASSIST_GATE is not configured (per isolate)

/** Durable Object: one global instance that keeps the queue, leases and per-IP counters. Binding name ASSIST_GATE (see docs/assistant-llama-server.md). */
export class AssistantGate {
  constructor(state) { this.state = state; this.gate = new Gate(); }
  async fetch(request) {
    const body = await request.json();
    const path = new URL(request.url).pathname;
    if (path === "/settings-get") return jsonResponse(200, { value: (await this.state.storage.get("settings")) || {} });          // see settings.mjs
    if (path === "/settings-set") { await this.state.storage.put("settings", body.value || {}); return jsonResponse(200, { ok: true }); }
    if (path === "/stats-hit" || path === "/stats-get") return jsonResponse(200, await gateStats(this.state.storage, path, body));          // see stats.mjs
    this.gate.setBackends(Array.isArray(body.ids) ? body.ids : [], body.slots && typeof body.slots === "object" ? body.slots : {});
    if (path === "/acquire") return jsonResponse(200, await this.gate.acquire(String(body.ip || "unknown"), Array.isArray(body.avoid) ? body.avoid : []));
    if (path === "/release") { this.gate.release(String(body.lease)); return jsonResponse(200, { ok: true }); }
    if (path === "/down") { this.gate.markDown(String(body.id)); return jsonResponse(200, { ok: true }); }
    return jsonResponse(404, { error: "not_found" });
  }
}

async function loadKb(env, url) {
  try {
    const r = env.ASSETS ? await env.ASSETS.fetch(new Request(new URL(PRIVATE_KB_PATH, url))) : null;
    if (!r || !r.ok) return null;
    const kb = await r.json();
    return kb && Array.isArray(kb.records) ? kb : null;
  } catch { return null; }
}

/** Connects to the first backend that answers; a failed one is marked down and the next is tried. Returns {response, lease, release} or {error}. */
async function connect(gate, ip, backends, system, messages, mode) {
  const tried = [];
  for (let attempt = 0; attempt < backends.length; attempt += 1) {
    const got = await gate.acquire(ip, tried);
    if (!got.ok) return { error: got.reason };
    const backend = backends.find((b) => b.id === got.backend);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LIMITS.connectMs);
    try {
      const { url, init } = upstreamRequest(backend, system, messages, mode);
      let response;
      for (let attempt = 0; attempt < 2; attempt++) {          // one quick retry: a busy shared server often answers the second time
        try { response = await fetch(url, { ...init, signal: controller.signal }); if (response.ok && response.body) break; } catch (e) { if (attempt) throw e; }
        if (attempt === 0) await new Promise((r) => setTimeout(r, 400));
      }
      clearTimeout(timer);
      if (response && response.ok && response.body) return { response, lease: got.lease, controller };
      throw new Error(`HTTP ${response ? response.status : "none"}`);
    } catch (e) {
      clearTimeout(timer);
      console.error(`assistant backend "${backend.id}" failed:`, e && e.message);
      tried.push(backend.id);
      await gate.down(backend.id);
      await gate.release(got.lease);
    }
  }
  return { error: "none" };
}

export async function handleAssistant(request, env, url, deps = {}) {
  if (request.method !== "POST") return jsonResponse(405, { error: "method" }, { allow: "POST" });
  if (!originAllowed(request.headers.get("origin"))) return jsonResponse(403, { error: "origin" });
  if (!(request.headers.get("content-type") || "").toLowerCase().startsWith("application/json")) return jsonResponse(415, { error: "type" });
  const raw = await request.text();
  if (raw.length > LIMITS.body) return jsonResponse(413, { error: "too_large" });
  let body;
  try { body = JSON.parse(raw); } catch { return jsonResponse(400, { error: "bad_request" }); }
  const req = validateRequest(body);
  if (!req.ok) return jsonResponse(req.error === "too_long" ? 413 : 400, { error: req.error });

  const kb = await loadKb(env, url);
  if (!kb) return jsonResponse(503, { error: "disabled" });
  const backends = parseBackends(env.ASSISTANT_BACKENDS);
  if (!backends.length) return jsonResponse(503, { error: "no_backend" });

  const encode = (obj) => new TextEncoder().encode(JSON.stringify(obj) + "\n");
  const streamHeaders = { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" };
  const last = req.messages[req.messages.length - 1];
  if (req.mode === "chat" && looksLikeInjection(last.content)) {            // answered here, the model is never asked
    const text = JSON.stringify({ t: refusalText(req.lang), refused: true }) + "\n" + JSON.stringify({ done: true }) + "\n";
    return new Response(text, { status: 200, headers: streamHeaders });
  }

  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  const gate = gateClient(env, backends.map((b) => b.id), deps.gate || localGate, Object.fromEntries(backends.map((b) => [b.id, b.slots])));
  const system = req.mode === "brief" ? buildBriefPrompt(req) : buildSystemPrompt({ kb, lang: req.lang, messages: req.messages });
  const connected = await connect(gate, ip, backends, system, req.mode === "brief" ? briefMessages(req.messages) : req.messages, req.mode);
  if (connected.error === "rate") return jsonResponse(429, { error: "rate" }, { "retry-after": "600" });
  if (connected.error === "busy") return jsonResponse(503, { error: "busy" }, { "retry-after": "60" });
  if (connected.error) return jsonResponse(503, { error: "no_backend" });

  const guard = new OutputGuard({ hidden: kb.hidden, cards: req.mode === "brief" ? [] : kb.cards });
  const titleOf = (id) => { const c = (kb.cards || []).find((x) => x.id === id); return c ? (c.title[req.lang] || c.title.en || "") : ""; };
  let released = false;
  const free = async () => { if (!released) { released = true; await gate.release(connected.lease); } };
  const deadline = setTimeout(() => connected.controller.abort(), LIMITS.totalMs);

  const stream = new ReadableStream({
    async start(controller) {
      let sent = 0;
      try {
        for await (const delta of sseDeltas(connected.response.body)) {
          const text = guard.push(delta);
          if (text) { controller.enqueue(encode({ t: text })); sent += text.length; }
          if (sent > LIMITS.maxChars) break;
        }
        const rest = guard.flush();
        if (rest) controller.enqueue(encode({ t: rest }));
        if (guard.cardId) controller.enqueue(encode({ action: { type: "offer_card", id: guard.cardId, title: titleOf(guard.cardId) } }));
        controller.enqueue(encode({ done: true }));
      } catch (e) {
        console.error("assistant stream failed:", e && e.message);
        controller.enqueue(encode({ error: "stream" }));
      } finally {
        clearTimeout(deadline);
        connected.controller.abort();
        await free();
        controller.close();
      }
    },
    async cancel() { clearTimeout(deadline); connected.controller.abort(); await free(); },
  });
  return new Response(stream, { status: 200, headers: streamHeaders });
}
