// Site assistant widget. Shipped only while the assistant is switched on in the admin draft (it is not part of the factory package).
// One network target: POST /api/assistant on this origin. No third-party requests, no cookies, nothing stored in the browser.
// Voice is opt-in (the visitor presses the speaker): the browser's own speech synthesis reads the answer, nothing is sent to us.
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

  const S = { voice: false, ui: null, lang: FALLBACK, messages: [], busy: false, offered: new Set(), highlighted: null, timer: null, controller: null, built: false, handoffReady: false };
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
  const customFrames = () => {          // the owner's own pictures per mood (built into the page as data-assistant-frames)
    try { const f = JSON.parse(document.documentElement.dataset.assistantFrames || "null"); return f && f.idle ? f : null; } catch { return null; }
  };
  const avatarId = () => {
    const set = window.VITEH_AVATARS;
    const want = document.documentElement.dataset.assistantAvatar;
    if (want === "custom" && customFrames()) return "custom";
    return set && set.items[want] ? want : set && set.order[0];
  };
  const avatars = [];
  /** A custom avatar is a picture: the frame of the current mood (idle when the owner gave none for it). */
  /** The nine states of the full set map to the six basic moods the animations know; a custom pack may carry its own picture for any of them. */
  const MOOD_BASE = { greeting: "wave", goodbye: "wave", happy: "wave", respect: "nod", listening: "nod", thinking: "think", talking: "talk", presenting: "present" };
  /** The nine-state names and the six basic ones are two spellings of the same poses: a pack may use either (own picture first, then the other spelling, then idle). */
  const MOOD_ALT = { talk: "talking", think: "thinking", present: "presenting", wave: "greeting", nod: "respect" };
  const frameOf = (frames, name) => frames[name] || frames[MOOD_BASE[name]] || frames[MOOD_ALT[name]] || frames.idle;
  const showFrame = (node, name) => {
    const frames = customFrames();
    const img = node.querySelector && node.querySelector("img.asst-pose, img");
    if (frames && img) img.src = frameOf(frames, name);
  };
  const avatarNode = (uid) => {
    if (avatarId() === "custom") {
      const box = el("span", { class: "asst-av asst-custom", "aria-hidden": "true" });
      const zoom = el("span", { class: "asst-zoom" });
      box.append(zoom);
      zoom.append(el("img", { class: "asst-pose", src: customFrames().idle, alt: "", decoding: "async" }));
      for (const [name, url] of Object.entries(customFrames())) if (/^viseme_/.test(name)) new Image().src = url;       // no flicker the first time the mouth moves
      const mouth = customFrames().mouth_open;
      if (mouth) {                                          // a pack with an open-mouth picture: it is laid over the face and driven by the voice
        box.dataset.mouth = voiceGender();
        zoom.append(el("img", { class: "asst-mouth", src: mouth, alt: "", decoding: "async" }));
      }
      return box;
    }
    const holder = el("div");
    const markup = window.VITEH_AVATARS.items[avatarId()].svg.replace(/id="([a-z]+)"/g, `id="$1${uid}"`).replace(/url\(#([a-z]+)\)/g, `url(#$1${uid})`);
    holder.innerHTML = AVATAR_WRAP(markup);      // static markup of assistant-avatars.js only (no user or model text)
    return holder.firstChild;
  };
  const makeAvatar = () => {
    if (!window.VITEH_AVATARS && !customFrames()) return el("span");
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
      if (!(want === "custom" ? customFrames() : set && set.items[want]) || want === avatarId()) return;
      document.documentElement.dataset.assistantAvatar = want;
      avatars.forEach((old, i) => { const fresh = avatarNode("a" + (i + 1)); fresh.setAttribute("data-mood", old.getAttribute("data-mood") || "idle"); old.replaceWith(fresh); avatars[i] = fresh; });
    } catch { /* offline or no Worker: keep the built-in look */ }
  };
  let moodTimer = 0;
  /** mood: idle | wave | nod | think | talk | present (or a name of the nine-state set, see MOOD_BASE). A timed mood falls back to idle (or to the sticky one). */
  function mood(name, ms = 0, sticky = "idle") {
    clearTimeout(moodTimer);
    const paint = (m) => { for (const a of avatars) { a.setAttribute("data-mood", MOOD_BASE[m] || m); a.setAttribute("data-state", m); showFrame(a, m); } };
    paint(name);
    if (ms) moodTimer = setTimeout(() => paint(sticky), ms);
  }


  /* ---------- voice: opt-in, the browser's own speech synthesis (nothing leaves the page) ---------- */
  const LANGS = { uk: "uk", en: "en", de: "de" };
  const GENDER = { "consultant-f": "female", "expert-f": "female", engineer: "female", core: "female", "consultant-m": "male", expert: "male", senior: "male" };
  const MALE_NAMES = /\b(male|man|ostap|guy|davis|christopher|eric|roger|steffan|conrad|killian|stefan|hans|markus|jonas|florian|david|mark|daniel|alex|george|ryan|thomas|jorge)\b/i;
  const FEMALE_NAMES = /\b(female|woman|polina|aria|jenny|zira|sonia|michelle|libby|katja|amala|hedda|vicki|petra|anna|marlene|helena|samantha|emma|hazel|susan|yuna|svetlana)\b/i;
  const canSpeak = () => "speechSynthesis" in window && typeof SpeechSynthesisUtterance === "function";
  /** The persona's voice: a custom pack says so in data-assistant-voice, the built-in looks have a fixed one. */
  const voiceGender = () => {
    const id = avatarId();
    if (id === "custom") return document.documentElement.dataset.assistantVoice === "male" ? "male" : "female";
    return GENDER[id] || "female";
  };
  /** The best installed voice for the page language and the persona: matching gender first, then "natural/online" neural voices, then a local one. */
  function pickVoice() {
    const want = LANGS[S.lang] || "en", gender = voiceGender();
    const score = (v) => {
      const name = v.name || "";
      let n = 0;
      if (gender === "male" ? MALE_NAMES.test(name) : FEMALE_NAMES.test(name)) n += 4;
      else if (gender === "male" ? FEMALE_NAMES.test(name) : MALE_NAMES.test(name)) n -= 4;
      if (/natural|neural|online/i.test(name)) n += 3;
      if (v.localService) n += 1;
      if (v.default) n += 0.5;
      return n;
    };
    const list = window.speechSynthesis.getVoices().filter((v) => (v.lang || "").toLowerCase().startsWith(want));
    return list.sort((a, b) => score(b) - score(a))[0] || null;
  }
  /** Sentences of at most ~180 characters: long utterances are cut off by some browsers. */
  function speechChunks(text) {
    const clean = String(text).replace(/https?:\/\/\S+/g, " ").replace(/[*_`#>]+/g, " ").replace(/\s+/g, " ").trim();
    const parts = clean.match(/[^.!?…]+[.!?…]*\s*/g) || [clean];
    const out = [];
    for (const part of parts) {
      let rest = part.trim();
      while (rest.length > 180) { let cut = rest.lastIndexOf(" ", 180); if (cut < 60) cut = 180; out.push(rest.slice(0, cut)); rest = rest.slice(cut).trim(); }
      if (rest) out.push(rest);
    }
    return out;
  }
  let lipTimer = 0;
  const mouthLevel = (level) => { for (const a of avatars) { a.style.setProperty("--m-open", String(level)); } };
  /** While the voice runs the mouth moves. A pack with an open-mouth picture gets it faded in and out over the face at a speech-like rhythm; a pack without
   *  alternates its "talk" picture with the calm one; the drawn avatars animate their mouth with CSS. */
  function lips(on) {
    clearInterval(lipTimer);
    lipTimer = 0;
    mouthLevel(0);
    if (on) {
      const frames = customFrames();
      if (frames && frames.viseme_closed && !reduceMotion()) {                         // whole pictures, one mouth shape each: shown in a speech-like order
        mood("talking");
        const shapes = ["open", "narrow", "wide", "round", "open", "closed", "narrow", "open"].filter((n) => frames["viseme_" + n]);
        let i = 0;
        const show = (n) => { const src = frames["viseme_" + n] || frames.viseme_closed; for (const a of avatars) { const img = a.querySelector("img.asst-pose, img"); if (img) img.src = src; } };
        lipTimer = setInterval(() => show(shapes[(i += 1 + (Math.random() < 0.3 ? 1 : 0)) % shapes.length]), 115);
        show("open");
      } else if (frames && frames.mouth_open) { mood("talking"); for (const av of avatars) showFrame(av, "idle"); if (!reduceMotion()) lipTimer = setInterval(() => mouthLevel(Math.random() < 0.2 ? 0.15 : 0.45 + Math.random() * 0.55), 120); else mouthLevel(0.6); }
      else if (frames && !reduceMotion()) { mood("talking"); let open = false; lipTimer = setInterval(() => { open = !open; for (const a of avatars) showFrame(a, open ? "idle" : "talk"); }, 190); }
      else mood("talk");
    } else mood("idle");
  }
  const speaking = { node: null };
  function stopSpeech() {
    if (canSpeak()) window.speechSynthesis.cancel();
    if (speaking.node) { speaking.node.classList.remove("asst-listening"); speaking.node.setAttribute("aria-pressed", "false"); speaking.node = null; lips(false); }
  }
  function speak(text, trigger) {
    if (!canSpeak()) return;
    stopSpeech();
    const chunks = speechChunks(text);
    if (!chunks.length) return;
    const voice = pickVoice();
    const gender = voiceGender();
    speaking.node = trigger || null;
    if (trigger) { trigger.classList.add("asst-listening"); trigger.setAttribute("aria-pressed", "true"); }
    chunks.forEach((chunk, i) => {
      const u = new SpeechSynthesisUtterance(chunk);
      u.lang = voice ? voice.lang : (LANGS[S.lang] || "en");
      if (voice) u.voice = voice;
      if (!voice || (gender === "male" ? !MALE_NAMES.test(voice.name) : !FEMALE_NAMES.test(voice.name))) u.pitch = gender === "male" ? 0.8 : 1.1;   // no voice of that sex installed: nudge the pitch
      if (i === 0) u.onstart = () => lips(true);
      u.onboundary = () => { if (lipTimer && customFrames() && customFrames().mouth_open) mouthLevel(1); };           // a word starts: the mouth opens fully
      const last = i === chunks.length - 1;
      u.onend = () => { if (last) stopSpeech(); };
      u.onerror = () => { if (last) stopSpeech(); };
      window.speechSynthesis.speak(u);
    });
  }

  /* ---------- DOM ---------- */
  let fab, fabLabel, panel, log, form, input, sendBtn, note, titleEl, closeBtn, handoffBtn, voiceBtn;

  function build() {
    if (S.built) return;
    S.built = true;
    fabLabel = el("span", { class: "asst-fab-label" });
    fab = el("button", { class: "asst-fab", type: "button", "aria-expanded": "false", "aria-controls": "asst-panel", onclick: () => setOpen(panel.hidden) }, makeAvatar(), fabLabel);
    titleEl = el("h2", { class: "asst-title", id: "asst-title" });
    closeBtn = el("button", { class: "asst-close", type: "button", onclick: () => setOpen(false) }, "×");
    voiceBtn = canSpeak() ? el("button", { class: "asst-voice", type: "button", "aria-pressed": "false", onclick: toggleVoice }, "🔊") : null;
    log = el("div", { class: "asst-log", role: "log", "aria-live": "polite", "aria-relevant": "additions text", tabindex: "0" });
    input = el("textarea", { class: "asst-input", rows: "1", maxlength: String(MAX_INPUT), autocomplete: "off", enterkeyhint: "send" });
    sendBtn = el("button", { class: "asst-send", type: "submit" });
    handoffBtn = el("button", { class: "asst-handoff", type: "button", hidden: true, onclick: handoff });
    note = el("p", { class: "asst-note" });
    form = el("form", { class: "asst-form", onsubmit: (e) => { e.preventDefault(); send(); } }, input, sendBtn);
    panel = el("section", { class: "asst-panel", id: "asst-panel", role: "dialog", "aria-modal": "false", "aria-labelledby": "asst-title", hidden: true },
      el("header", { class: "asst-head" }, makeAvatar(), titleEl, voiceBtn, closeBtn), log, handoffBtn, form, note);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); } });
    input.addEventListener("input", () => { if (!S.busy && !speaking.node) mood(input.value ? "listening" : "idle"); input.style.height = "auto"; input.style.height = Math.min(input.scrollHeight, 120) + "px"; });
    panel.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); } });
    window.addEventListener("pagehide", stopSpeech);
    document.body.append(fab, panel);
    mood("idle");
    let nudges = 0;
    const nudge = setInterval(() => { if (!panel.hidden || ++nudges > 3) { if (nudges > 3) clearInterval(nudge); return; } mood("wave", 2200); }, 28000);
    texts();
    addListen(addMessage("assistant", t("greeting"), { greeting: true }));
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
    paintVoice();
    for (const b of log.querySelectorAll(".asst-listen")) b.textContent = t("listen");
    note.textContent = t("note");
    panel.setAttribute("lang", S.lang);
    const first = log.querySelector("[data-greeting]");
    if (first && S.messages.length === 0) first.textContent = t("greeting");
  }

  function paintVoice() {
    if (!voiceBtn) return;
    voiceBtn.setAttribute("aria-pressed", String(S.voice));
    voiceBtn.setAttribute("aria-label", t(S.voice ? "voiceOff" : "voiceOn"));
    voiceBtn.setAttribute("title", t(S.voice ? "voiceOff" : "voiceOn"));
    voiceBtn.textContent = S.voice ? "🔊" : "🔈";
  }
  /** On/off for reading every new answer aloud; it lives only until the page is closed. */
  function toggleVoice() {
    S.voice = !S.voice;
    if (!S.voice) stopSpeech();
    paintVoice();
  }

  function setOpen(open, { focus = true } = {}) {
    panel.hidden = !open;
    fab.setAttribute("aria-expanded", String(open));
    fab.classList.toggle("asst-fab-hidden", open);
    if (open) {
      mood("greeting", 2600);
      clearHighlight();
      if (focus) input.focus();
      log.scrollTop = log.scrollHeight;
    } else {
      stopSpeech();
      if (focus) fab.focus();
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
  /** "Listen again" under a finished assistant message: reads what the bubble says now (the greeting follows the language). */
  function addListen(bubble) {
    if (!canSpeak()) return null;
    const btn = el("button", { class: "asst-listen", type: "button", "aria-pressed": "false" }, t("listen"));
    btn.addEventListener("click", () => { if (speaking.node === btn) stopSpeech(); else speak(bubble.textContent, btn); });
    bubble.after(btn);
    return btn;
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
        const listen = addListen(bubble);
        if (S.voice && listen) speak(answer, listen);
        else if (action) { offerCard(action); mood("presenting", 2600); } else mood("respect", 1100);
        if (action && S.voice) offerCard(action);
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
