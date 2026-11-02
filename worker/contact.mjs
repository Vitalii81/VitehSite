// Pure logic of the contact form endpoint (no Cloudflare APIs here, so it can be tested with `node --test worker/`).

export const LIMITS = { name: 120, email: 254, message: 4000, body: 16384 };
export const TYPES = ["Software", "Electronic device", "AI-agent integration", "Other / not sure"];
export const LANGS = ["uk", "en", "de"];
export const MIN_FILL_MS = 3000;            // a human needs a few seconds to fill the form
export const MAX_FILL_MS = 3 * 60 * 60 * 1000;
export const ALLOWED_ORIGINS = ["https://viteh.org", "https://www.viteh.org", "https://viteh-site.vithope.workers.dev"];

const EMAIL = /^[^\s@<>"',;:()\[\]\\]+@[^\s@<>"',;:()\[\]\\]+\.[^\s@<>"',;:()\[\]\\]+$/;
const LS = String.fromCharCode(0x2028, 0x2029);   // line and paragraph separators, written as codes so no editor can turn them into real line breaks
const CONTROL = new RegExp("[\\u0000-\\u001f\\u007f" + LS + "]", "g");

const oneLine = (value) => String(value ?? "").replace(CONTROL, " ").replace(/\s+/g, " ").trim();
const multiLine = (value) => String(value ?? "").replace(/\r\n?/g, "\n").replace(new RegExp("[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f\\u007f" + LS + "]", "g"), "").trim();

/** Checks the submitted JSON. Returns {ok:true, value} or {ok:false, error, silent?}; `silent` = a bot, answer 200 and send nothing. */
export function validate(body, nowMs = Date.now()) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "bad_request" };
  if (oneLine(body.hp) !== "") return { ok: false, error: "bot", silent: true };
  const t = Number(body.t);
  if (!Number.isFinite(t) || nowMs - t < MIN_FILL_MS) return { ok: false, error: "too_fast", silent: true };
  if (nowMs - t > MAX_FILL_MS) return { ok: false, error: "expired" };
  const name = oneLine(body.name);
  const email = oneLine(body.email);
  const message = multiLine(body.message);
  if (!name || name.length > LIMITS.name) return { ok: false, error: "name" };
  if (!email || email.length > LIMITS.email || !EMAIL.test(email)) return { ok: false, error: "email" };
  if (!message || message.length > LIMITS.message) return { ok: false, error: "message" };
  if (body.consent !== true) return { ok: false, error: "consent" };
  const type = Number.isInteger(body.type) && body.type >= 0 && body.type < TYPES.length ? body.type : TYPES.length - 1;
  const lang = LANGS.includes(body.lang) ? body.lang : "en";
  return { ok: true, value: { name, email, message, type, lang } };
}

const utf8 = (text) => new TextEncoder().encode(text);

export function base64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** RFC 2047 encoded word for a header value that may contain non-ASCII text (kept short enough for one header line). */
export function encodedWord(text) {
  const bytes = utf8(text);
  const parts = [];
  // cut on character boundaries, at most 36 bytes per word, so that "Subject: " plus the word stays under 78 columns
  let chunk = "";
  for (const ch of text) {
    if (utf8(chunk + ch).length > 36) { parts.push(chunk); chunk = ""; }
    chunk += ch;
  }
  if (chunk) parts.push(chunk);
  void bytes;
  return parts.map((part) => `=?UTF-8?B?${base64(utf8(part))}?=`).join("\r\n ");
}

export function subjectOf(v) {
  return `[Заявка з сайту] ${TYPES[v.type]}: ${v.name}`.slice(0, 120);
}

export function bodyOf(v, nowIso) {
  return [
    "Нова заявка з форми на viteh.org",
    "",
    `Ім'я: ${v.name}`,
    `Email: ${v.email}`,
    `Тип проєкту: ${TYPES[v.type]}`,
    `Мова сторінки: ${v.lang}`,
    `Надіслано: ${nowIso}`,
    "",
    "Повідомлення:",
    v.message,
    "",
  ].join("\n");
}

/** The complete raw message for the Email Routing `send_email` binding. All values were cleaned by validate(), so no line break can sneak into a header. */
export function buildMime({ from, to, value, id, date = new Date() }) {
  const text = bodyOf(value, date.toISOString());
  const b64 = base64(utf8(text.replace(/\n/g, "\r\n"))).match(/.{1,76}/g).join("\r\n");
  const headers = [
    `From: ViTeh site <${from}>`,
    `To: <${to}>`,
    `Reply-To: <${value.email}>`,
    `Subject: ${encodedWord(subjectOf(value))}`,
    `Date: ${date.toUTCString()}`,
    `Message-ID: <${id}@${from.split("@")[1]}>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "X-ViTeh-Form: contact",
  ];
  return headers.join("\r\n") + "\r\n\r\n" + b64 + "\r\n";
}

export function originAllowed(origin) {
  return ALLOWED_ORIGINS.includes(origin || "");
}
