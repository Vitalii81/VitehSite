// node --test worker/forms.test.mjs   (also picked up by a plain `node --test`)
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findForm, validateForm, validFormId, FORM_LIMITS } from "./forms.mjs";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const NOW = 1_800_000_000_000;
const LSEP = String.fromCharCode(0x2028);          // written as a code, so no editor can turn it into a real line break

const FORM = {
  title: "Electronics repair", consentRequired: true,
  fields: [
    { key: "name", type: "text", label: "Name", required: true, max: 120 },
    { key: "email", type: "email", label: "Email", required: true, max: 254 },
    { key: "phone", type: "tel", label: "Phone", required: false, max: 40 },
    { key: "topic", type: "select", label: "Topic", required: true, max: 200, options: ["Architecture", "Electronics"] },
    { key: "message", type: "textarea", label: "Message", required: false, max: 50 },
    { key: "backup", type: "checkbox", label: "Data may be lost", required: false, max: 1 },
  ],
};
const good = (over = {}, values = {}) => ({
  form: "repair", consent: true, lang: "de", hp: "", t: NOW - 10_000,
  values: { name: "Ірина Müller", email: "irina@example.de", topic: "1", message: "Line one\nLine two", ...values }, ...over,
});

test("forms: a valid submission becomes the same value shape contact.mjs uses", () => {
  const r = validateForm(FORM, good(), NOW);
  assert.equal(r.ok, true);
  assert.equal(r.value.email, "irina@example.de");
  assert.equal(r.value.name, "Ірина Müller");
  assert.equal(r.value.lang, "de");
  assert.equal(r.value.type, 3);
  assert.match(r.value.message, /^Форма: Electronics repair\n\nName: Ірина Müller\nEmail: irina@example.de\nPhone: -\nTopic: Electronics\nMessage: Line one\nLine two\nData may be lost: no$/);
});

test("forms: required fields, formats and limits are enforced from the PUBLISHED description", () => {
  const bad = (over, values, error) => { const r = validateForm(FORM, good(over, values), NOW); assert.equal(r.ok, false); assert.equal(r.error, error); return r; };
  bad({}, { name: "  " }, "required");
  bad({}, { email: "no-at" }, "email");
  bad({}, { email: "a@b.de, c@d.de" }, "email");
  bad({}, { phone: "call me" }, "tel");
  bad({}, { topic: "" }, "required");
  bad({}, { topic: "5" }, "option");
  bad({}, { topic: "-1" }, "option");
  bad({}, { topic: "Electronics" }, "option");            // options are chosen by index, never by free text
  bad({}, { message: "x".repeat(51) }, "too_long");
  bad({}, { name: 42 }, "field");
  bad({}, { backup: "yes" }, "field");
  bad({ consent: false }, {}, "consent");
  bad({ consent: "true" }, {}, "consent");
  assert.equal(validateForm(FORM, good({}, { email: "" }), NOW).error, "required");
});

test("forms: unknown fields from the browser are ignored, not trusted", () => {
  const r = validateForm(FORM, good({}, { admin: "true", "__proto__": "x", constructor: "y" }), NOW);
  assert.equal(r.ok, true);
  assert.ok(!r.value.message.includes("admin"));
});

test("forms: bots are answered silently (honeypot, too fast) and old forms expire", () => {
  const a = validateForm(FORM, good({ hp: "http://spam" }), NOW);
  assert.deepEqual([a.ok, a.silent], [false, true]);
  const b = validateForm(FORM, good({ t: NOW - 500 }), NOW);
  assert.deepEqual([b.ok, b.silent], [false, true]);
  assert.equal(validateForm(FORM, good({ t: NOW - 4 * 3600_000 }), NOW).error, "expired");
});

test("forms: optional consent and a form without any email field", () => {
  assert.equal(validateForm({ ...FORM, consentRequired: false }, good({ consent: false }), NOW).ok, true);
  const noEmail = { ...FORM, fields: FORM.fields.filter((f) => f.key !== "email") };
  assert.equal(validateForm(noEmail, good(), NOW).error, "email");
});

test("forms: control characters cannot reach the mail headers or break lines of the summary", () => {
  const r = validateForm(FORM, good({}, { name: "Eve\r\nBcc: x@evil.example", message: "a" + LSEP + "b" + String.fromCharCode(0) + "c" }), NOW);
  assert.equal(r.ok, true);
  assert.ok(!/[\r\n\u0000]/.test(r.value.name) && !r.value.name.includes(LSEP));
  assert.ok(!r.value.message.includes(LSEP) && !r.value.message.includes(String.fromCharCode(0)));
  assert.ok(r.value.message.length <= FORM_LIMITS.message);
});

test("forms: findForm only returns own, well-formed entries", () => {
  const forms = { repair: FORM, broken: { fields: "x" } };
  assert.equal(findForm(forms, "repair"), FORM);
  for (const id of ["broken", "missing", "__proto__", "constructor", "toString", "../x", "A", "", null, 5]) assert.equal(findForm(forms, id), null, String(id));
  assert.equal(findForm(null, "repair"), null);
  assert.equal(validFormId("a-b-1"), true);
  assert.equal(validFormId("a b"), false);
});

/* ---- the route in worker/index.mjs, with the Cloudflare-only module replaced by a stub ---- */
register("data:text/javascript," + encodeURIComponent(
  "export async function resolve(s, c, n) { if (s === 'cloudflare:email') return { url: 'data:text/javascript,export class EmailMessage { constructor(f, t, r) { this.from = f; this.to = t; this.raw = r; } }', shortCircuit: true }; return n(s, c); }"), import.meta.url);
const worker = (await import("./index.mjs")).default;

const sent = [], queued = [];
const env = (extra = {}) => ({
  CONTACT_FROM: "site@viteh.org", CONTACT_TO: "owner@viteh.org",
  MAIL: { send: async (m) => { sent.push(m); } },
  ASSETS: { fetch: async () => new Response(JSON.stringify({ repair: FORM })) },
  ...extra,
});
const post = (body, { origin = "https://viteh.org", type = "application/json", path = "/api/form" } = {}) =>
  new Request("https://viteh.org" + path, { method: "POST", headers: { origin, "content-type": type }, body: typeof body === "string" ? body : JSON.stringify(body) });
const fresh = (over = {}, values = {}) => good({ t: Date.now() - 10_000, ...over }, values);

test("route /api/form: a valid submission is mailed with Reply-To, answered ok", async () => {
  sent.length = 0;
  const res = await worker.fetch(post(fresh()), env());
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  assert.equal(sent.length, 1);
  assert.match(sent[0].raw, /Reply-To: <irina@example\.de>/);
  assert.match(sent[0].raw, /X-ViTeh-Form: contact/);
});

test("route /api/form: wrong origin, method, type, size, JSON, unknown form are refused", async () => {
  sent.length = 0;
  assert.equal((await worker.fetch(post(fresh(), { origin: "https://evil.example" }), env())).status, 403);
  assert.equal((await worker.fetch(new Request("https://viteh.org/api/form", { method: "GET" }), env())).status, 405);
  assert.equal((await worker.fetch(post(fresh(), { type: "text/plain" }), env())).status, 415);
  assert.equal((await worker.fetch(post("x".repeat(FORM_LIMITS.body + 1)), env())).status, 413);
  assert.equal((await worker.fetch(post("{ nope"), env())).status, 400);
  assert.equal((await worker.fetch(post(fresh({ form: "ghost" })), env())).status, 404);
  assert.equal((await worker.fetch(post(fresh({ form: "__proto__" })), env())).status, 404);
  assert.equal((await worker.fetch(post(fresh({}, { email: "bad" })), env())).status, 400);
  assert.equal(sent.length, 0);
});

test("route /api/form: bots get 200 and nothing is sent; a missing forms.json is a 503", async () => {
  sent.length = 0;
  assert.equal((await worker.fetch(post(fresh({ hp: "spam" })), env())).status, 200);
  assert.equal(sent.length, 0);
  assert.equal((await worker.fetch(post(fresh()), env({ ASSETS: { fetch: async () => new Response("nope", { status: 404 }) } }))).status, 503);
  assert.equal((await worker.fetch(post(fresh()), env({ ASSETS: { fetch: async () => { throw new Error("down"); } } }))).status, 503);
});

test("route /api/form: queue failure alone does not lose the lead, both failing does", async () => {
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { queued.push([String(url), init]); return new Response("", { status: 500 }); };
  try {
    sent.length = 0; queued.length = 0;
    const withQueue = env({ LEAD_URL: "https://queue.example/lead", LEAD_SECRET: "s3cret" });
    assert.equal((await worker.fetch(post(fresh()), withQueue)).status, 200, "mail worked, queue failed");
    assert.equal(queued.length, 1);
    assert.equal(queued[0][1].headers["x-lead-secret"], "s3cret");
    const failing = env({ LEAD_URL: "https://queue.example/lead", LEAD_SECRET: "s", MAIL: { send: async () => { throw new Error("mail down"); } } });
    assert.equal((await worker.fetch(post(fresh()), failing)).status, 502);
  } finally { globalThis.fetch = origFetch; }
});

test("route /api/contact is unchanged: wrong method/origin, and unknown paths", async () => {
  assert.equal((await worker.fetch(new Request("https://viteh.org/api/contact", { method: "GET" }), env())).status, 405);
  assert.equal((await worker.fetch(post({}, { origin: "https://evil.example", path: "/api/contact" }), env())).status, 403);
  assert.equal((await worker.fetch(new Request("https://viteh.org/api/other", { method: "POST" }), env())).status, 404);
});

test("contract: every form template built by the Radxa admin validates in the Worker", () => {
  const dir = mkdtempSync(join(tmpdir(), "vadmin-contract-"));
  try {
    const py = `
import json, sys
sys.path.insert(0, ${JSON.stringify(join(repo, "radxa-admin/lib"))})
from vadmin import build, core, schema
p = core.Paths(root=${JSON.stringify(join(dir, "root"))}, secret=${JSON.stringify(join(dir, "sec"))}, src=${JSON.stringify(repo)})
p.ensure()
ctx = schema.Context(p)
d = schema.empty_draft()
for t in ("project_request", "repair", "consultation"):
    schema.add_from_template(d, "form", t, ctx)
core.write_json(p.draft, d)
r = build.build(p)
print(json.dumps(json.load(open(p.builds + "/" + r["id"] + "/site/forms.json"))))
`;
    const run = spawnSync("python3", ["-c", py], { encoding: "utf8" });
    if (run.status !== 0) assert.fail(run.stderr);
    const forms = JSON.parse(run.stdout);
    assert.deepEqual(Object.keys(forms).sort(), ["consultation", "project-request", "repair"]);
    for (const [id, form] of Object.entries(forms)) {
      const values = {};
      for (const f of form.fields) values[f.key] = f.type === "email" ? "a@example.de" : f.type === "tel" ? "+49 30 123456" : f.type === "select" ? "0" : f.type === "checkbox" ? true : "text";
      const r = validateForm(form, { form: id, consent: true, lang: "uk", hp: "", t: NOW - 10_000, values }, NOW);
      assert.equal(r.ok, true, `${id}: ${r.error} ${r.field}`);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
