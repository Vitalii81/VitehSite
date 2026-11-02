import test from "node:test";
import assert from "node:assert/strict";
import { validate, buildMime, subjectOf, encodedWord, originAllowed, TYPES, LIMITS } from "./contact.mjs";

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
