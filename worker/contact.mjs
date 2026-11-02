// Pure logic of the contact form endpoint (no Cloudflare APIs here, so it can be tested with `node --test worker/`).

export const LIMITS = { name: 120, email: 254, message: 4000, body: 16384, request: 11 * 1024 * 1024 };
export const FILE_LIMITS = { count: 3, each: 5 * 1024 * 1024, total: 10 * 1024 * 1024, name: 100 };
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

// ---- attachments: the extension decides what is expected, the first bytes must agree with it (a renamed program is refused)
const starts = (bytes, signature) => signature.every((b, i) => bytes[i] === b);
const ascii = (text) => [...text].map((c) => c.charCodeAt(0));
const isZip = (b) => starts(b, [0x50, 0x4b, 0x03, 0x04]);
const isOle = (b) => starts(b, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const isText = (b) => {
  const head = b.subarray(0, 65536);
  if (head.includes(0)) return false;
  try { new TextDecoder("utf-8", { fatal: true }).decode(head, { stream: true }); return true; } catch { return false; }
};
export const FILE_TYPES = {
  pdf: ["application/pdf", (b) => starts(b, ascii("%PDF-"))],
  png: ["image/png", (b) => starts(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
  jpg: ["image/jpeg", (b) => starts(b, [0xff, 0xd8, 0xff])],
  jpeg: ["image/jpeg", (b) => starts(b, [0xff, 0xd8, 0xff])],
  webp: ["image/webp", (b) => starts(b, ascii("RIFF")) && b.length > 12 && starts(b.subarray(8), ascii("WEBP"))],
  doc: ["application/msword", isOle],
  xls: ["application/vnd.ms-excel", isOle],
  docx: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", isZip],
  xlsx: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", isZip],
  odt: ["application/vnd.oasis.opendocument.text", isZip],
  ods: ["application/vnd.oasis.opendocument.spreadsheet", isZip],
  txt: ["text/plain", isText],
  csv: ["text/csv", isText],
};
export const FILE_EXTENSIONS = Object.keys(FILE_TYPES);

/** A name that is safe to show and to store: no path, no control characters, no leading dots, short, the extension kept. */
export function safeFileName(name) {
  let n = oneLine(String(name ?? "").split(/[\\/]/).pop()).replace(/^\.+/, "").replace(/[<>:"|?*]/g, "_");
  if (n.length > FILE_LIMITS.name) {
    const dot = n.lastIndexOf(".");
    const ext = dot > 0 && n.length - dot <= 8 ? n.slice(dot) : "";
    n = n.slice(0, FILE_LIMITS.name - ext.length) + ext;
  }
  return n || "file";
}

/** [{name, bytes}] -> {ok:true, files:[{name, type, bytes}]} or {ok:false, error}. */
export function validateFiles(files) {
  if (!files.length) return { ok: true, files: [] };
  if (files.length > FILE_LIMITS.count) return { ok: false, error: "too_many_files" };
  let total = 0;
  const out = [];
  for (const f of files) {
    const bytes = f.bytes;
    if (!bytes || bytes.length === 0) return { ok: false, error: "empty_file" };
    if (bytes.length > FILE_LIMITS.each) return { ok: false, error: "file_too_large" };
    total += bytes.length;
    const name = safeFileName(f.name);
    const dot = name.lastIndexOf(".");
    const type = dot > 0 ? FILE_TYPES[name.slice(dot + 1).toLowerCase()] : undefined;
    if (!type || !type[1](bytes)) return { ok: false, error: "file_type" };
    out.push({ name, type: type[0], bytes });
  }
  if (total > FILE_LIMITS.total) return { ok: false, error: "files_too_large" };
  return { ok: true, files: out };
}

const kb = (n) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} КБ` : `${(n / 1048576).toFixed(1)} МБ`);

export function subjectOf(v) {
  return `[Заявка з сайту] ${TYPES[v.type]}: ${v.name}`.slice(0, 120);
}

export function bodyOf(v, nowIso, files = []) {
  return [
    "Нова заявка з форми на viteh.org",
    "",
    `Ім'я: ${v.name}`,
    `Email: ${v.email}`,
    `Тип проєкту: ${TYPES[v.type]}`,
    `Мова сторінки: ${v.lang}`,
    `Надіслано: ${nowIso}`,
    ...(files.length ? [`Вкладення (${files.length}): ` + files.map((f) => `${f.name} (${kb(f.bytes.length)})`).join(", ")] : []),
    "",
    "Повідомлення:",
    v.message,
    "",
  ].join("\n");
}

const chunked = (b64) => b64.match(/.{1,76}/g).join("\r\n");
const percent = (name) => [...utf8(name)].map((b) => (/[A-Za-z0-9._-]/.test(String.fromCharCode(b)) ? String.fromCharCode(b) : "%" + b.toString(16).toUpperCase().padStart(2, "0"))).join("");

/** The complete raw message for the Email Routing `send_email` binding. All values were cleaned by validate(), so no line break can sneak into a header.
 *  With [files] the message is multipart/mixed (text first, then each attachment as base64). */
export function buildMime({ from, to, value, id, date = new Date(), files = [] }) {
  const text = bodyOf(value, date.toISOString(), files);
  const textB64 = chunked(base64(utf8(text.replace(/\n/g, "\r\n"))));
  const boundary = "viteh-" + String(id).replace(/[^A-Za-z0-9]/g, "");
  const headers = [
    `From: ViTeh site <${from}>`,
    `To: <${to}>`,
    `Reply-To: <${value.email}>`,
    `Subject: ${encodedWord(subjectOf(value))}`,
    `Date: ${date.toUTCString()}`,
    `Message-ID: <${id}@${from.split("@")[1]}>`,
    "MIME-Version: 1.0",
    "X-ViTeh-Form: contact",
  ];
  if (!files.length) {
    return [...headers, "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64"].join("\r\n") + "\r\n\r\n" + textB64 + "\r\n";
  }
  const parts = [`--${boundary}`, "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "", textB64];
  for (const f of files) {
    parts.push(`--${boundary}`, `Content-Type: ${f.type}`, "Content-Transfer-Encoding: base64",
      /^[A-Za-z0-9._ -]+$/.test(f.name) ? `Content-Disposition: attachment; filename="${f.name}"` : `Content-Disposition: attachment;\r\n filename*=UTF-8''${percent(f.name)}`, "", chunked(base64(f.bytes)));
  }
  parts.push(`--${boundary}--`, "");
  return [...headers, `Content-Type: multipart/mixed; boundary="${boundary}"`].join("\r\n") + "\r\n\r\n" + parts.join("\r\n");
}

/** What the queue on the Radxa stores: the same cleaned values and the same id the letter carries in its Message-ID, so one lead is never two items. */
export function leadPayload(value, id, files = []) {
  const out = { id, name: value.name, email: value.email, type: value.type, message: value.message, lang: value.lang };
  if (files.length) out.files = files.map((f) => ({ name: f.name, size: f.bytes.length, type: f.type }));
  return out;
}

export function originAllowed(origin) {
  return ALLOWED_ORIGINS.includes(origin || "");
}
