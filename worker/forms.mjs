// Pure logic of POST /api/form: forms built in the admin on the Radxa. A submission is checked against the PUBLISHED description
// (forms.json, shipped with the site), never against anything the browser says about itself. No Cloudflare APIs here, so `node --test` covers it.
// The result is shaped like contact.mjs `validate()` output, so the same mail/queue code (buildMime, leadPayload) can be reused unchanged.
import { LANGS, MAX_FILL_MS, MIN_FILL_MS, TYPES } from "./contact.mjs";

export const FORM_LIMITS = { body: 16384, message: 3900 };
const FORM_ID = /^[a-z0-9][a-z0-9-]{0,31}$/;
const EMAIL = /^[^\s@<>"',;:()\[\]\\]+@[^\s@<>"',;:()\[\]\\]+\.[^\s@<>"',;:()\[\]\\]+$/;
const TEL = /^[+0-9 ()-]{5,40}$/;
const LS = String.fromCharCode(0x2028, 0x2029);
const CONTROL = new RegExp("[\\u0000-\\u001f\\u007f" + LS + "]", "g");
const oneLine = (v) => String(v ?? "").replace(CONTROL, " ").replace(/\s+/g, " ").trim();
const multiLine = (v) => String(v ?? "").replace(/\r\n?/g, "\n").replace(new RegExp("[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f\\u007f" + LS + "]", "g"), "").trim();

export const validFormId = (id) => typeof id === "string" && FORM_ID.test(id);

/** `forms` is the parsed forms.json; returns the description or null (also null for anything inherited like "__proto__"). */
export function findForm(forms, id) {
  if (!forms || typeof forms !== "object" || !validFormId(id) || !Object.prototype.hasOwnProperty.call(forms, id)) return null;
  const form = forms[id];
  return form && Array.isArray(form.fields) ? form : null;
}

/** Returns {ok:true, value:{name,email,message,type,lang}} or {ok:false, error, silent?, field?}. */
export function validateForm(form, body, nowMs = Date.now()) {
  if (!form || !body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "bad_request" };
  if (oneLine(body.hp) !== "") return { ok: false, error: "bot", silent: true };
  const t = Number(body.t);
  if (!Number.isFinite(t) || nowMs - t < MIN_FILL_MS) return { ok: false, error: "too_fast", silent: true };
  if (nowMs - t > MAX_FILL_MS) return { ok: false, error: "expired" };
  if (form.consentRequired && body.consent !== true) return { ok: false, error: "consent" };
  const values = body.values && typeof body.values === "object" && !Array.isArray(body.values) ? body.values : {};

  const lines = [];
  let name = "", email = "";
  for (const field of form.fields) {
    const raw = Object.prototype.hasOwnProperty.call(values, field.key) ? values[field.key] : undefined;
    const fail = (error) => ({ ok: false, error, field: field.key });
    let shown = "";
    if (field.type === "checkbox") {
      if (raw !== undefined && typeof raw !== "boolean") return fail("field");
      if (field.required && raw !== true) return fail("required");
      shown = raw === true ? "yes" : "no";
    } else if (field.type === "select") {
      const options = Array.isArray(field.options) ? field.options : [];
      const text = raw === undefined || raw === null ? "" : String(raw);
      if (text === "") { if (field.required) return fail("required"); shown = "-"; }
      else {
        const i = /^\d{1,3}$/.test(text) ? Number(text) : -1;
        if (i < 0 || i >= options.length) return fail("option");
        shown = oneLine(options[i]);
      }
    } else {
      if (raw !== undefined && typeof raw !== "string") return fail("field");
      const text = field.type === "textarea" ? multiLine(raw) : oneLine(raw);
      const max = Math.min(Math.max(Number(field.max) || 200, 1), 2000);
      if (text === "") { if (field.required) return fail("required"); shown = "-"; }
      else {
        if (text.length > max) return fail("too_long");
        if (field.type === "email" && (text.length > 254 || !EMAIL.test(text))) return fail("email");
        if (field.type === "tel" && !TEL.test(text)) return fail("tel");
        shown = text;
        if (field.type === "email" && !email) email = text;
        if (field.key === "name" && !name) name = text;
      }
    }
    lines.push(`${oneLine(field.label)}: ${shown}`);
  }
  if (!email) return { ok: false, error: "email", field: "email" };
  const message = [`Форма: ${oneLine(form.title)}`, "", ...lines].join("\n").slice(0, FORM_LIMITS.message);
  return { ok: true, value: { name: (name || email).slice(0, 120), email, message, type: TYPES.length - 1, lang: LANGS.includes(body.lang) ? body.lang : "en" } };
}
