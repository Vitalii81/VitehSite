// Site assistant widget. Shipped only while the assistant is switched on in the admin draft (it is not part of the factory package).
// One network target: POST /api/assistant on this origin. No third-party requests, no cookies, nothing stored in the browser.
// Text from the model is inserted with textContent only. The model never sends markup or free-form actions: the only action is
// {type:"offer_card", id}, and the id is checked against a strict pattern and against the cards that really exist on the page.
(() => {
  "use strict";
  const ENDPOINT = "/api/assistant";
  const MAX_INPUT = 600;
  const SHOW_MS = 4500;
  const CARD_ID = /^(?:service:\d{1,2}|project:[a-z0-9][a-z0-9-]{0,31}|portfolio)$/;
  const FALLBACK = "en";

  const reduceMotion = () => window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const el = (tag, attrs = {}, ...kids) => {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat()) if (kid != null) node.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return node;
  };

  const S = { ui: null, lang: FALLBACK, messages: [], busy: false, offered: new Set(), highlighted: null, timer: null, controller: null, built: false, handoffReady: false };
  const t = (key) => {
    const v = S.ui && S.ui[key];
    return (v && (v[S.lang] || v[FALLBACK] || Object.values(v)[0])) || "";
  };

  /* ---------- locating the cards on the page ---------- */
  /** Returns the element for a card id, or null when that card is not on the page (switched off, filtered out, not rendered). */
  function findCard(id) {
    if (!CARD_ID.test(id)) return null;
    if (id === "portfolio") return document.querySelector(".portfolio-link a, a[href$='portfolio/']");
    const [kind, key] = id.split(":");
    if (kind === "service") return document.querySelector(`#serviceGrid [data-s="${key}"]`);
    return document.querySelector(`#productGrid [data-id="${(window.CSS && CSS.escape) ? CSS.escape(key) : key}"]`);
  }

  function clearHighlight() {
    clearTimeout(S.timer);
    if (S.highlighted) S.highlighted.classList.remove("asst-highlight");
    S.highlighted = null;
  }

  function showCard(id) {
    const target = findCard(id);
    if (!target) return false;
    clearHighlight();
    setOpen(false, { focus: false });
    target.scrollIntoView({ behavior: reduceMotion() ? "auto" : "smooth", block: "center" });
    target.classList.add("asst-highlight");
    S.highlighted = target;
    S.timer = setTimeout(() => { clearHighlight(); addMessage("assistant", t("shown")); fab.focus({ preventScroll: true }); }, SHOW_MS);
    return true;
  }

  /* ---------- avatar: a polite animated helper (wave, nod, think, talk, open-palm "present") ---------- */
  const AVATAR_WRAP = (inner) => '<svg class="asst-av" viewBox="0 0 120 120" aria-hidden="true" focusable="false">' + inner + "</svg>";
  const avatarId = () => {
    const set = window.VITEH_AVATARS;
    const want = document.documentElement.dataset.assistantAvatar;
    return set && set.items[want] ? want : set && set.order[0];
  };
  const avatars = [];
  const avatarNode = (uid) => {
    const holder = el("div");
    const markup = window.VITEH_AVATARS.items[avatarId()].svg.replace(/id="([a-z]+)"/g, `id="$1${uid}"`).replace(/url\(#([a-z]+)\)/g, `url(#$1${uid})`);
    holder.innerHTML = AVATAR_WRAP(markup);      // static markup of assistant-avatars.js only (no user or model text)
    return holder.firstChild;
  };
  const makeAvatar = () => {
    if (!window.VITEH_AVATARS) return el("span");
    const node = avatarNode("a" + (avatars.length + 1));          // ids (gradients) must be unique per copy: a hidden SVG does not render another one's gradients
    avatars.push(node);
    return node;
  };
  /** The owner can change the look in the admin without a new publication: /api/settings holds it, the page's own value is the fallback. */
  const applyLiveAvatar = async () => {
    try {
      const r = await fetch("/api/settings", { headers: { accept: "application/json" } });
      if (!r.ok) return;
      const want = (await r.json()).assistantAvatar;
      const set = window.VITEH_AVATARS;
      if (!set || !set.items[want] || want === avatarId()) return;
      document.documentElement.dataset.assistantAvatar = want;
      avatars.forEach((old, i) => { const fresh = avatarNode("a" + (i + 1)); fresh.setAttribute("data-mood", old.getAttribute("data-mood") || "idle"); old.replaceWith(fresh); avatars[i] = fresh; });
    } catch { /* offline or no Worker: keep the built-in look */ }
  };
  let moodTimer = 0;
  /** mood: idle | wave | nod | think | talk | present. A timed mood falls back to idle (or to the sticky one). */
  function mood(name, ms = 0, sticky = "idle") {
    clearTimeout(moodTimer);
    for (const a of avatars) a.setAttribute("data-mood", name);
    if (ms) moodTimer = setTimeout(() => { for (const a of avatars) a.setAttribute("data-mood", sticky); }, ms);
  }

  /* ---------- DOM ---------- */
  let fab, fabLabel, panel, log, form, input, sendBtn, note, titleEl, closeBtn, handoffBtn;

  function build() {
    if (S.built) return;
    S.built = true;
    fabLabel = el("span", { class: "asst-fab-label" });
    fab = el("button", { class: "asst-fab", type: "button", "aria-expanded": "false", "aria-controls": "asst-panel", onclick: () => setOpen(panel.hidden) }, makeAvatar(), fabLabel);
    titleEl = el("h2", { class: "asst-title", id: "asst-title" });
    closeBtn = el("button", { class: "asst-close", type: "button", onclick: () => setOpen(false) }, "×");
    log = el("div", { class: "asst-log", role: "log", "aria-live": "polite", "aria-relevant": "additions text", tabindex: "0" });
    input = el("textarea", { class: "asst-input", rows: "1", maxlength: String(MAX_INPUT), autocomplete: "off", enterkeyhint: "send" });
    sendBtn = el("button", { class: "asst-send", type: "submit" });
    handoffBtn = el("button", { class: "asst-handoff", type: "button", hidden: true, onclick: handoff });
    note = el("p", { class: "asst-note" });
    form = el("form", { class: "asst-form", onsubmit: (e) => { e.preventDefault(); send(); } }, input, sendBtn);
    panel = el("section", { class: "asst-panel", id: "asst-panel", role: "dialog", "aria-modal": "false", "aria-labelledby": "asst-title", hidden: true },
      el("header", { class: "asst-head" }, makeAvatar(), titleEl, closeBtn), log, handoffBtn, form, note);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); } });
    input.addEventListener("input", () => { input.style.height = "auto"; input.style.height = Math.min(input.scrollHeight, 120) + "px"; });
    panel.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); } });
    document.body.append(fab, panel);
    mood("idle");
    let nudges = 0;
    const nudge = setInterval(() => { if (!panel.hidden || ++nudges > 3) { if (nudges > 3) clearInterval(nudge); return; } mood("wave", 2200); }, 28000);
    texts();
    addMessage("assistant", t("greeting"), { greeting: true });
  }

  function texts() {
    fabLabel.textContent = t("open");
    fab.setAttribute("aria-label", t("title"));
    titleEl.textContent = t("title");
    closeBtn.setAttribute("aria-label", t("close"));
    input.setAttribute("placeholder", t("placeholder"));
    input.setAttribute("aria-label", t("placeholder"));
    sendBtn.textContent = t("send");
    handoffBtn.textContent = t("handoff");
    note.textContent = t("note");
    panel.setAttribute("lang", S.lang);
    const first = log.querySelector("[data-greeting]");
    if (first && S.messages.length === 0) first.textContent = t("greeting");
  }

  function setOpen(open, { focus = true } = {}) {
    panel.hidden = !open;
    fab.setAttribute("aria-expanded", String(open));
    fab.classList.toggle("asst-fab-hidden", open);
    if (open) {
      mood("wave", 2600);
      clearHighlight();
      if (focus) input.focus();
      log.scrollTop = log.scrollHeight;
    } else if (focus) {
      fab.focus();
    }
  }

  function addMessage(role, text, { greeting = false } = {}) {
    const node = el("div", { class: `asst-msg asst-${role}` });
    if (greeting) node.setAttribute("data-greeting", "");
    node.textContent = text;
    log.append(node);
    log.scrollTop = log.scrollHeight;
    return node;
  }

  /* ---------- talking to the backend ---------- */
  function fail(status, code) {
    if (status === 429 || code === "rate") return t("rate");
    if (status === 413 || code === "too_long") return t("tooLong");
    if (code === "busy") return t("busy");
    if (code === "no_backend" || code === "disabled") return t("unavailable");
    return t("error");
  }

  /** Reads the NDJSON stream; calls onText(text) for every piece, returns {action, ok}. */
  async function readStream(response, onText) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = "";
    let action = null;
    let ok = false;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = pending.indexOf("\n")) !== -1) {
        const line = pending.slice(0, nl).trim();
        pending = pending.slice(nl + 1);
        if (!line) continue;
        let event;
        try { event = JSON.parse(line); } catch { continue; }
        if (typeof event.t === "string") onText(event.t);
        else if (event.action && event.action.type === "offer_card" && typeof event.action.id === "string") action = event.action;
        else if (event.done) ok = true;
        else if (event.error) ok = false;
      }
    }
    return { action, ok };
  }

  async function ask(mode, messages, onText) {
    S.controller = new AbortController();
    const response = await fetch(ENDPOINT, {
      method: "POST", headers: { "content-type": "application/json" }, signal: S.controller.signal,
      body: JSON.stringify({ lang: S.lang, mode, messages: messages.slice(-12) }),
    });
    if (!response.ok) {
      const code = (await response.json().catch(() => ({}))).error;
      throw Object.assign(new Error(code || "http"), { status: response.status, code });
    }
    return readStream(response, onText);
  }

  async function send() {
    const text = input.value.trim();
    if (!text || S.busy) return;
    S.busy = true;
    sendBtn.disabled = true;
    input.value = "";
    input.style.height = "auto";
    addMessage("user", text);
    S.messages.push({ role: "user", content: text });
    const bubble = addMessage("assistant", t("thinking"));
    bubble.classList.add("asst-pending");
    mood("think");
    let answer = "";
    try {
      const { action } = await ask("chat", S.messages, (piece) => {
        answer += piece;
        if (avatars[0] && avatars[0].getAttribute("data-mood") !== "talk") mood("talk");
        bubble.classList.remove("asst-pending");
        bubble.textContent = answer.replace(/^\s+/, "");
        log.scrollTop = log.scrollHeight;
      });
      answer = answer.trim();
      if (!answer) { bubble.remove(); addMessage("assistant", t("error")); S.messages.pop(); }
      else {
        S.messages.push({ role: "assistant", content: answer });
        bubble.classList.remove("asst-pending");
        S.handoffReady = true;
        handoffBtn.hidden = false;
        if (action) { offerCard(action); mood("present", 2600); } else mood("nod", 1100);
      }
    } catch (e) {
      mood("idle");
      bubble.classList.remove("asst-pending");
      bubble.textContent = e.name === "AbortError" ? "" : fail(e.status, e.code);
      if (!bubble.textContent) bubble.remove();
      if (!answer) S.messages.pop();                       // the failed question is not resent as history
      if (e.status === 503 || e.code === "no_backend" || e.code === "disabled") contactOffer();
    } finally {
      S.busy = false;
      sendBtn.disabled = false;
      S.controller = null;
      if (!panel.hidden) input.focus();
    }
  }

  /* ---------- cards: ask first, show only after "yes" ---------- */
  function offerCard(action) {
    const id = action.id;
    if (!CARD_ID.test(id) || S.offered.has(id) || !findCard(id)) return;       // invented or not on this page: dropped silently
    S.offered.add(id);
    const title = typeof action.title === "string" ? action.title.slice(0, 80) : "";
    const row = el("div", { class: "asst-msg asst-assistant asst-offer", role: "group", "aria-label": t("askShow").replace("%s", title) });
    row.append(el("p", {}, t("askShow").replace("%s", title)));
    const yes = el("button", { class: "asst-yes", type: "button", onclick: () => {
      row.querySelectorAll("button").forEach((b) => { b.disabled = true; });
      if (!showCard(id)) addMessage("assistant", t("error"));
    } }, t("showYes"));
    const no = el("button", { class: "asst-no", type: "button", onclick: () => {
      row.querySelectorAll("button").forEach((b) => { b.disabled = true; });
      addMessage("assistant", t("declined"));
      input.focus();
    } }, t("showNo"));
    row.append(el("div", { class: "asst-actions" }, yes, no));
    log.append(row);
    log.scrollTop = log.scrollHeight;
  }

  function contactOffer() {
    const link = el("button", { class: "asst-yes", type: "button", onclick: () => toContact("") }, t("handoff"));
    const row = el("div", { class: "asst-msg asst-assistant" }, el("div", { class: "asst-actions" }, link));
    log.append(row);
    log.scrollTop = log.scrollHeight;
  }

  /* ---------- hand-off to the contact form ---------- */
  function toContact(brief) {
    const field = document.querySelector("#f-msg");
    const section = document.querySelector("#contact");
    if (field && brief) {
      field.value = field.value.trim() ? `${field.value.trim()}\n\n${brief}` : brief;
      field.dispatchEvent(new Event("input", { bubbles: true }));
    }
    setOpen(false, { focus: false });
    (section || field)?.scrollIntoView({ behavior: reduceMotion() ? "auto" : "smooth", block: "start" });
    if (field) field.focus({ preventScroll: true });
    if (brief) addMessage("assistant", t("handoffDone"));
  }

  async function handoff() {
    if (S.busy) return;
    S.busy = true;
    handoffBtn.disabled = true;
    let brief = "";
    try {
      await ask("brief", S.messages, (piece) => { brief += piece; });
    } catch { /* fall back to the visitor's own words below */ }
    brief = brief.trim();
    if (!brief) brief = S.messages.filter((m) => m.role === "user").map((m) => m.content).join("\n").slice(0, MAX_INPUT * 2);
    S.busy = false;
    handoffBtn.disabled = false;
    toContact(brief);
  }

  /* ---------- start ---------- */
  function start(detail) {
    const ui = detail && detail.site && detail.site.ui && detail.site.ui.assistant;
    if (!ui || document.documentElement.dataset.page !== "home") return;
    S.ui = ui;
    S.lang = (detail.lang || document.documentElement.lang || FALLBACK);
    if (!S.built) { build(); applyLiveAvatar(); } else texts();
  }
  document.addEventListener("viteh:render", (e) => start(e.detail));
  if (window.vitehRender) start(window.vitehRender);
})();
