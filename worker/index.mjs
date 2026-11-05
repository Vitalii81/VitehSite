// Worker in front of the static site: only /api/* reaches it (assets.run_worker_first), everything else is served as static files.
// POST /api/contact checks the form (JSON, or multipart/form-data when documents are attached) and passes it on two independent ways:
// a letter through Cloudflare Email Routing (send_email binding MAIL) to the verified mailbox, and the queue on the Radxa
// (LEAD_URL + secret LEAD_SECRET). The visitor gets "ok" if at least one worked.
import { EmailMessage } from "cloudflare:email";
import { FILE_LIMITS, LIMITS, buildMime, leadPayload, originAllowed, validate, validateFiles } from "./contact.mjs";
import { handleAssistant } from "./assistant-api.mjs";
import { handleSettings } from "./settings.mjs";
import { FORM_LIMITS, findForm, validateForm } from "./forms.mjs";

const json = (status, body, extra = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra } });

/** Reads the request into {body, files:[{name, bytes}]}; throws a Response-worthy {status, error}. */
async function readRequest(request) {
  const type = (request.headers.get("content-type") || "").toLowerCase();
  const length = Number(request.headers.get("content-length") || 0);
  if (type.startsWith("application/json")) {
    const text = await request.text();
    if (text.length > LIMITS.body) throw { status: 413, error: "too_large" };
    try { return { body: JSON.parse(text), files: [] }; } catch { throw { status: 400, error: "bad_request" }; }
  }
  if (type.startsWith("multipart/form-data")) {
    if (!length) throw { status: 411, error: "length_required" };
    if (length > LIMITS.request) throw { status: 413, error: "too_large" };
    let form;
    try { form = await request.formData(); } catch { throw { status: 400, error: "bad_request" }; }
    const text = (key) => { const v = form.get(key); return typeof v === "string" ? v : ""; };
    const body = {
      name: text("name"), email: text("email"), message: text("message"), lang: text("lang"), hp: text("hp"),
      type: text("type") === "" ? NaN : Number(text("type")), consent: text("consent") === "true", t: Number(text("t")),
    };
    const picked = form.getAll("files").filter((v) => typeof v !== "string");
    if (picked.length > FILE_LIMITS.count) throw { status: 400, error: "too_many_files" };
    const files = [];
    for (const f of picked) {
      if (f.size > FILE_LIMITS.each) throw { status: 400, error: "file_too_large" };
      files.push({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) });
    }
    return { body, files };
  }
  throw { status: 415, error: "type" };
}

/** Forms made in the admin (Radxa). The description is read from the published /forms.json, so the browser cannot change what is accepted.
 *  The ways out are the same as for the contact form (letter + queue); /api/contact above is untouched. */
async function handleForm(request, env, url) {
  if (request.method !== "POST") return json(405, { error: "method" }, { allow: "POST" });
  if (!originAllowed(request.headers.get("origin"))) return json(403, { error: "origin" });
  if (!(request.headers.get("content-type") || "").toLowerCase().startsWith("application/json")) return json(415, { error: "type" });
  const text = await request.text();
  if (text.length > FORM_LIMITS.body) return json(413, { error: "too_large" });
  let body;
  try { body = JSON.parse(text); } catch { return json(400, { error: "bad_request" }); }

  let forms;
  try {
    const published = env.ASSETS ? await env.ASSETS.fetch(new Request(new URL("/forms.json", url))) : await fetch(new URL("/forms.json", url));
    forms = published.ok ? await published.json() : null;
  } catch { forms = null; }
  if (!forms) return json(503, { error: "forms_unavailable" });
  const form = findForm(forms, body && body.form);
  if (!form) return json(404, { error: "unknown_form" });
  const checked = validateForm(form, body);
  if (!checked.ok) return checked.silent ? json(200, { ok: true }) : json(400, { error: checked.error, field: checked.field });

  const leadId = crypto.randomUUID();
  const from = env.CONTACT_FROM, to = env.CONTACT_TO;
  const ways = [["mail", async () => { await env.MAIL.send(new EmailMessage(from, to, buildMime({ from, to, value: checked.value, id: leadId }))); }]];
  if (env.LEAD_URL && env.LEAD_SECRET) {
    ways.push(["queue", async () => {
      const response = await fetch(env.LEAD_URL, { method: "POST", headers: { "x-lead-secret": env.LEAD_SECRET, "content-type": "application/json" },
        body: JSON.stringify(leadPayload(checked.value, leadId)), signal: AbortSignal.timeout(8000) });
      if (!response.ok) throw new Error("queue answered HTTP " + response.status);
    }]);
  }
  const results = await Promise.allSettled(ways.map(([, send]) => send()));
  results.forEach((r, i) => { if (r.status === "rejected") console.error(`form way "${ways[i][0]}" failed:`, r.reason && r.reason.message); });
  if (!results.some((r) => r.status === "fulfilled")) return json(502, { error: "send_failed" });
  return json(200, { ok: true });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/assistant") return handleAssistant(request, env, url);
    if (url.pathname === "/api/settings") return handleSettings(request, env);
    if (url.pathname === "/api/form") return handleForm(request, env, url);
    if (url.pathname !== "/api/contact") return json(404, { error: "not_found" });
    if (request.method !== "POST") return json(405, { error: "method" }, { allow: "POST" });
    if (!originAllowed(request.headers.get("origin"))) return json(403, { error: "origin" });

    let parsed;
    try { parsed = await readRequest(request); } catch (e) { return json(e.status || 400, { error: e.error || "bad_request" }); }

    const checked = validate(parsed.body);
    if (!checked.ok) return checked.silent ? json(200, { ok: true }) : json(400, { error: checked.error });
    const attached = validateFiles(parsed.files);
    if (!attached.ok) return json(400, { error: attached.error });
    const files = attached.files;

    // Two independent ways, so that one failing does not lose the request: a letter (Email Routing -> Gmail) and the queue on the Radxa
    // (-> mail agent on Fedora -> Android app). The mail agent keeps one item per lead.
    const leadId = crypto.randomUUID();
    const from = env.CONTACT_FROM;
    const to = env.CONTACT_TO;
    const ways = [
      ["mail", async () => {
        await env.MAIL.send(new EmailMessage(from, to, buildMime({ from, to, value: checked.value, id: leadId, files })));
      }],
    ];
    if (env.LEAD_URL && env.LEAD_SECRET) {
      ways.push(["queue", async () => {
        const headers = { "x-lead-secret": env.LEAD_SECRET };
        // the documents first, the description last: the queue shows a lead only once all its files are there
        await Promise.all(files.map(async (f, i) => {
          const r = await fetch(`${env.LEAD_URL}/${leadId}/file/${i}`, { method: "PUT", headers: { ...headers, "content-type": "application/octet-stream" }, body: f.bytes, signal: AbortSignal.timeout(25000) });
          if (!r.ok) throw new Error(`queue refused file ${i}: HTTP ${r.status}`);
        }));
        const response = await fetch(env.LEAD_URL, {
          method: "POST",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify(leadPayload(checked.value, leadId, files)),
          signal: AbortSignal.timeout(8000),
        });
        if (!response.ok) throw new Error("queue answered HTTP " + response.status);
      }]);
    }
    const results = await Promise.allSettled(ways.map(([, send]) => send()));
    results.forEach((r, i) => { if (r.status === "rejected") console.error(`contact way "${ways[i][0]}" failed:`, r.reason && r.reason.message); });
    if (!results.some((r) => r.status === "fulfilled")) return json(502, { error: "send_failed" });
    return json(200, { ok: true });
  },
};

export { AssistantGate } from "./assistant-api.mjs";   // Durable Object class (binding ASSIST_GATE)
