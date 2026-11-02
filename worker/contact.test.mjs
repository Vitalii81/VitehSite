import test from "node:test";
import assert from "node:assert/strict";
import { validate, buildMime, subjectOf, encodedWord, originAllowed, leadPayload, validateFiles, safeFileName, FILE_LIMITS, TYPES, LIMITS } from "./contact.mjs";

const NOW = 1_800_000_000_000;
const good = (over = {}) => ({ name: "Ірина Müller", email: "irina@example.de", type: 2, message: "Потрібен AI-агент для пошти.", consent: true, lang: "uk", hp: "", t: NOW - 10_000, ...over });

test("accepts a normal request", () => {
  const r = validate(good(), NOW);
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, { name: "Ірина Müller", email: "irina@example.de", message: "Потрібен AI-агент для пошти.", type: 2, lang: "uk" });
});

test("rejects missing or bad fields with a reason", () => {
  assert.equal(validate(null, NOW).error, "bad_request");
  assert.equal(validate([], NOW).error, "bad_request");
  assert.equal(validate(good({ name: "  " }), NOW).error, "name");
  assert.equal(validate(good({ name: "x".repeat(LIMITS.name + 1) }), NOW).error, "name");
  for (const email of ["", "no-at", "a@b", "a b@c.de", "a@b.de, c@d.de", "<a@b.de>", 'a"@b.de']) assert.equal(validate(good({ email }), NOW).error, "email", email);
  assert.equal(validate(good({ message: "" }), NOW).error, "message");
  assert.equal(validate(good({ message: "x".repeat(LIMITS.message + 1) }), NOW).error, "message");
  assert.equal(validate(good({ consent: "yes" }), NOW).error, "consent");
  assert.equal(validate(good({ consent: false }), NOW).error, "consent");
});

test("bots are answered silently: honeypot filled, or form sent too fast", () => {
  const a = validate(good({ hp: "http://spam" }), NOW);
  assert.deepEqual([a.ok, a.silent], [false, true]);
  const b = validate(good({ t: NOW - 500 }), NOW);
  assert.deepEqual([b.ok, b.silent], [false, true]);
  assert.equal(validate(good({ t: undefined }), NOW).silent, true);
  assert.equal(validate(good({ t: NOW - 4 * 3600_000 }), NOW).error, "expired");
});

test("unknown type and language fall back, never throw", () => {
  const r = validate(good({ type: 99, lang: "xx" }), NOW).value;
  assert.equal(r.type, TYPES.length - 1);
  assert.equal(r.lang, "en");
  assert.equal(validate(good({ type: "1" }), NOW).value.type, TYPES.length - 1);
});

test("control characters cannot break out of a header", () => {
  const r = validate(good({ name: "Eve\r\nBcc: evil@x.com", email: "a@b.de" }), NOW);
  assert.equal(r.ok, true);
  assert.ok(!/[\r\n]/.test(r.value.name));
  const mime = buildMime({ from: "site@viteh.org", to: "info.viteh@gmail.com", value: r.value, id: "abc", date: new Date(NOW) });
  const head = mime.split("\r\n\r\n")[0];
  assert.ok(!/^Bcc:/mi.test(head));
  assert.ok(!/\n\s*Bcc:/i.test(head.replace(/=\?UTF-8\?B\?[^?]*\?=/g, "")));
  assert.equal(validate(good({ email: "a@b.de\r\nBcc: x@y.de" }), NOW).error, "email");
});

test("message keeps its line breaks and loses control characters", () => {
  const r = validate(good({ message: "Рядок 1\r\nРядок 2\u0000\u0007" }), NOW);
  assert.equal(r.value.message, "Рядок 1\nРядок 2");
});

test("builds a MIME message with encoded subject, reply-to and base64 body", () => {
  const v = validate(good(), NOW).value;
  const mime = buildMime({ from: "site@viteh.org", to: "info.viteh@gmail.com", value: v, id: "id1", date: new Date(NOW) });
  const [head, body] = mime.split("\r\n\r\n");
  assert.match(head, /^From: ViTeh site <site@viteh.org>/m);
  assert.match(head, /^To: <info.viteh@gmail.com>/m);
  assert.match(head, /^Reply-To: <irina@example.de>/m);
  assert.match(head, /^Message-ID: <id1@viteh.org>/m);
  assert.match(head, /^Content-Transfer-Encoding: base64/m);
  assert.ok(/^[\x20-\x7e\r\n]*$/.test(head), "header must be pure ASCII");
  for (const line of head.split("\r\n")) assert.ok(line.length <= 78, line);
  const text = Buffer.from(body.replace(/\r\n/g, ""), "base64").toString("utf8");
  assert.match(text, /Ім'я: Ірина Müller/);
  assert.match(text, /Тип проєкту: AI-agent integration/);
  assert.match(text, /Потрібен AI-агент для пошти\./);
});

test("encoded words decode back and stay on short lines", () => {
  const text = "[Заявка з сайту] Software: Ірина Müller ".repeat(3);
  const enc = encodedWord(text);
  for (const line of enc.split("\r\n")) assert.ok(line.trim().length <= 76);
  const decoded = enc.split("\r\n").map((l) => Buffer.from(l.trim().slice(10, -2), "base64").toString("utf8")).join("");
  assert.equal(decoded, text);
  assert.ok(subjectOf({ type: 0, name: "n".repeat(300) }).length <= 120);
});

test("only the site's own origins may post", () => {
  assert.equal(originAllowed("https://viteh.org"), true);
  assert.equal(originAllowed("https://www.viteh.org"), true);
  assert.equal(originAllowed("https://evil.example"), false);
  assert.equal(originAllowed(null), false);
  assert.equal(originAllowed("http://viteh.org"), false);
});

test("the queue entry and the letter share one id, so the mail agent keeps one item", () => {
  const v = validate(good(), NOW).value;
  const id = "0b9e6c1a-2d3f-4a5b-8c7d-1e2f3a4b5c6d";
  assert.deepEqual(leadPayload(v, id), { id, name: v.name, email: v.email, type: 2, message: v.message, lang: "uk" });
  const mime = buildMime({ from: "site@viteh.org", to: "info.viteh@gmail.com", value: v, id, date: new Date(NOW) });
  assert.match(mime, new RegExp(`^Message-ID: <${id}@viteh.org>`, "m"));
});

const bytes = (...parts) => Uint8Array.from(parts.flat());
const PDF = bytes([...Buffer.from("%PDF-1.7\n%test\n")]);
const PNG = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const ZIP = bytes([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]);

test("files: accepted types must match their first bytes", () => {
  const r = validateFiles([{ name: "договір.pdf", bytes: PDF }, { name: "scan.PNG", bytes: PNG }, { name: "tabelle.xlsx", bytes: ZIP }, { name: "notes.txt", bytes: Uint8Array.from(Buffer.from("Привіт, світе\n")) }]
    .slice(0, 3));
  assert.equal(r.ok, true);
  assert.deepEqual(r.files.map((f) => f.type), ["application/pdf", "image/png", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"]);
});

test("files: a renamed program, a wrong extension and unknown types are refused", () => {
  const exe = bytes([0x4d, 0x5a, 0x90, 0, 3, 0]);
  for (const f of [{ name: "invoice.pdf", bytes: exe }, { name: "photo.png", bytes: PDF }, { name: "run.exe", bytes: exe }, { name: "archive.zip", bytes: ZIP },
                   { name: "noextension", bytes: PDF }, { name: "script.js", bytes: Uint8Array.from(Buffer.from("alert(1)")) }, { name: "bin.txt", bytes: bytes([65, 0, 66]) }]) {
    assert.deepEqual(validateFiles([f]), { ok: false, error: "file_type" }, f.name);
  }
  assert.equal(validateFiles([{ name: "a.pdf", bytes: new Uint8Array(0) }]).error, "empty_file");
});

test("files: count and size limits", () => {
  const one = { name: "a.pdf", bytes: PDF };
  assert.equal(validateFiles([one, one, one, one]).error, "too_many_files");
  const big = new Uint8Array(FILE_LIMITS.each + 1); big.set(PDF);
  assert.equal(validateFiles([{ name: "big.pdf", bytes: big }]).error, "file_too_large");
  const four = new Uint8Array(FILE_LIMITS.each); four.set(PDF);
  assert.equal(validateFiles([{ name: "1.pdf", bytes: four }, { name: "2.pdf", bytes: four }]).ok, true);       // exactly the total
  assert.equal(validateFiles([{ name: "1.pdf", bytes: four }, { name: "2.pdf", bytes: four }, one]).error, "files_too_large");
  assert.deepEqual(validateFiles([]), { ok: true, files: [] });
});

test("file names are cleaned", () => {
  assert.equal(safeFileName("../../etc/passwd"), "passwd");
  assert.equal(safeFileName("C:\\Users\\x\\Звіт 2026.pdf"), "Звіт 2026.pdf");
  assert.equal(safeFileName(".hidden.txt"), "hidden.txt");
  assert.equal(safeFileName("a\r\nBcc: x.pdf"), "a Bcc_ x.pdf");
  assert.equal(safeFileName(""), "file");
  const long = safeFileName("x".repeat(300) + ".pdf");
  assert.ok(long.length <= FILE_LIMITS.name && long.endsWith(".pdf"));
});

test("a message with attachments is multipart/mixed with the text first", () => {
  const v = validate(good(), NOW).value;
  const files = validateFiles([{ name: "Технічне завдання №1.pdf", bytes: PDF }, { name: "scan.png", bytes: PNG }]).files;
  const mime = buildMime({ from: "site@viteh.org", to: "info.viteh@gmail.com", value: v, id: "0b9e6c1a-2d3f-4a5b-8c7d-1e2f3a4b5c6d", date: new Date(NOW), files });
  const [head, rest] = [mime.slice(0, mime.indexOf("\r\n\r\n")), mime.slice(mime.indexOf("\r\n\r\n") + 4)];
  assert.match(head, /^Content-Type: multipart\/mixed; boundary="viteh-0b9e6c1a2d3f4a5b8c7d1e2f3a4b5c6d"/m);
  assert.ok(/^[\x20-\x7e\r\n]*$/.test(mime.replace(/[^\x00-\x7f]/g, "")), "ascii only after cleaning");
  assert.equal((rest.match(/^--viteh-/gm) || []).length, 4);                                        // text, 2 files, closing line
  assert.ok(rest.includes("filename*=UTF-8''" + encodeURIComponent("Технічне завдання №1.pdf")));
  assert.match(rest, /Content-Type: application\/pdf/);
  assert.match(rest, /Content-Disposition: attachment; filename="scan\.png"/);                            // plain ASCII names stay plain
  const text = Buffer.from(rest.split("\r\n\r\n")[1].split("\r\n--")[0].replace(/\r\n/g, ""), "base64").toString("utf8");
  assert.match(text, /Вкладення \(2\): Технічне завдання №1\.pdf \(1 КБ\), scan\.png \(1 КБ\)/);
});

test("the queue entry lists the files without their content", () => {
  const v = validate(good(), NOW).value;
  const files = validateFiles([{ name: "a.pdf", bytes: PDF }]).files;
  const p = leadPayload(v, "id", files);
  assert.deepEqual(p.files, [{ name: "a.pdf", size: PDF.length, type: "application/pdf" }]);
  assert.equal("files" in leadPayload(v, "id"), false);
});
