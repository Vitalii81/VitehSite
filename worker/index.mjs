// Worker in front of the static site: only /api/* reaches it (assets.run_worker_first), everything else is served as static files.
// POST /api/contact checks the form and mails it through Cloudflare Email Routing (send_email binding MAIL) to the verified mailbox.
import { EmailMessage } from "cloudflare:email";
import { LIMITS, buildMime, originAllowed, validate } from "./contact.mjs";

const json = (status, body, extra = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra } });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== "/api/contact") return json(404, { error: "not_found" });
    if (request.method !== "POST") return json(405, { error: "method" }, { allow: "POST" });
    if (!originAllowed(request.headers.get("origin"))) return json(403, { error: "origin" });
    if (!(request.headers.get("content-type") || "").toLowerCase().startsWith("application/json")) return json(415, { error: "type" });

    const text = await request.text();
    if (text.length > LIMITS.body) return json(413, { error: "too_large" });
    let body;
    try { body = JSON.parse(text); } catch { return json(400, { error: "bad_request" }); }

    const checked = validate(body);
    if (!checked.ok) return checked.silent ? json(200, { ok: true }) : json(400, { error: checked.error });

    const from = env.CONTACT_FROM;
    const to = env.CONTACT_TO;
    try {
      const raw = buildMime({ from, to, value: checked.value, id: crypto.randomUUID() });
      await env.MAIL.send(new EmailMessage(from, to, raw));
    } catch (error) {
      console.error("contact mail failed:", error && error.message);
      return json(502, { error: "send_failed" });
    }
    return json(200, { ok: true });
  },
};
