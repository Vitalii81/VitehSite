"use strict";
// The hover preview of the admin ("what is this widget?"): title, a short explanation and a picture or a live CSS demo.
// One file for both the admin and the on-page editor, no dependencies. The top half is pure logic (tests/preview-tip.test.mjs runs it in node);
// the bottom half builds the pop-up with the DOM and is only reached in a browser. Everything is inserted as text, never as HTML.
(function (root, make) {
  const api = make(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.VPreview = api;
})(typeof self !== "undefined" ? self : this, function (root) {
  const GAP = 10;            // between the item and the pop-up
  const MARGIN = 8;          // minimum distance to the screen edge
  const HOVER_DELAY = 280;   // ms before a hover opens it (a pointer passing by must not flash pop-ups)
  const LONG_PRESS = 480;    // ms of a finger held on an item

  const keyOf = (kind, id) => `${kind}:${id}`;

  /** Words for a key. The title is the item's own name when the caller has one ("My service"), else the manifest's; the explanation is the manifest's,
   *  else the caller's (factory cards have no explanation of their own besides their own text). */
  function describe(manifest, key, fallback = {}) {
    const m = (manifest && Object.prototype.hasOwnProperty.call(manifest, key) && manifest[key]) || {};
    return { title: fallback.title || m.title || "", text: m.text || fallback.text || "", image: m.image || "", demo: m.demo || "" };
  }

  /** Where the pop-up goes. anchor/view are {left, top, right, bottom} / {width, height} in viewport pixels, size is {width, height}.
   *  Order of preference: below, above, right, left; the first side where the whole pop-up fits wins, otherwise the side with the most room.
   *  The result is always clamped to the screen, so on a 390 px phone the pop-up sits below or above its item, never outside the screen. */
  function place(anchor, size, view, { gap = GAP, margin = MARGIN } = {}) {
    const room = { bottom: view.height - anchor.bottom - gap - margin, top: anchor.top - gap - margin, right: view.width - anchor.right - gap - margin, left: anchor.left - gap - margin };
    const fits = { bottom: room.bottom >= size.height, top: room.top >= size.height, right: room.right >= size.width, left: room.left >= size.width };
    const order = ["bottom", "top", "right", "left"];
    const side = order.find((s) => fits[s]) || order.reduce((best, s) => (room[s] > room[best] ? s : best), "bottom");
    let left, top;
    if (side === "bottom") { top = anchor.bottom + gap; left = anchor.left; }
    else if (side === "top") { top = anchor.top - gap - size.height; left = anchor.left; }
    else { top = anchor.top; left = side === "right" ? anchor.right + gap : anchor.left - gap - size.width; }
    const clamp = (v, size_, max) => Math.max(margin, Math.min(v, Math.max(margin, max - size_ - margin)));
    return { side, left: Math.round(clamp(left, size.width, view.width)), top: Math.round(clamp(top, size.height, view.height)) };
  }

  /** Where the pointer of a touch-and-hold counts as "still holding": moving further than this cancels the long press (the user is scrolling). */
  const holdMoved = (dx, dy, slop = 10) => Math.hypot(dx, dy) > slop;

  /** The picture of the other theme lives next to the light one: previews/x.webp (light) and previews/x-dark.webp (dark). */
  const themedImage = (src, dark) => (dark && src ? src.replace(/(-dark)?\.webp$/, "-dark.webp") : src ? src.replace(/-dark\.webp$/, ".webp") : "");

  /** Dark when the page says so (html[data-theme], the site's manual toggle) or, without such a choice, when the system does. */
  function isDark(doc = root.document, mql = root.matchMedia) {
    const chosen = doc && doc.documentElement && doc.documentElement.dataset ? doc.documentElement.dataset.theme : "";
    if (chosen === "dark") return true;
    if (chosen === "light") return false;
    try { return !!(mql && mql.call(root, "(prefers-color-scheme: dark)").matches); } catch { return false; }
  }

  const pure = { keyOf, describe, place, holdMoved, themedImage, isDark, GAP, MARGIN, HOVER_DELAY, LONG_PRESS };
  if (typeof document === "undefined") return pure;

  /* ---------- the pop-up ---------- */
  const MANIFEST_URL = "previews/manifest.json";
  let manifest = null, loading = null;
  const loadManifest = () => loading ||= fetch(MANIFEST_URL, { credentials: "same-origin" }).then((r) => (r.ok ? r.json() : {})).catch(() => ({})).then((m) => (manifest = m));

  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  let tip = null, shown = null, openTimer = null, seq = 0, pinned = false;
  const TIP_ID = "vpv-tip";

  function ensureTip() {
    if (tip) return tip;
    tip = el("div", "vpv-tip");
    tip.id = TIP_ID; tip.setAttribute("role", "tooltip"); tip.hidden = true;
    document.body.append(tip);
    return tip;
  }

  function demo(kind) {                    // live CSS demonstrations for effects that a still picture cannot show
    const box = el("div", `vpv-demo vpv-demo-${kind}`);
    box.setAttribute("aria-hidden", "true");
    if (kind === "float") box.append(el("div", "vpv-d-card vpv-d-float"));
    else for (let i = 0; i < 3; i++) box.append(el("div", "vpv-d-card vpv-d-reveal"));
    return box;
  }

  /** The picture, in the theme's version. A load that fails (a cold or busy server) is retried once with a cache-buster, then tried in the other theme's
   *  version, and only then replaced by a short note, so the pop-up never shows a broken-image icon and keeps its words. */
  function picture(info) {
    const dark = isDark(), tries = [themedImage(info.image, dark), themedImage(info.image, dark) + "?r=1", themedImage(info.image, !dark)];
    const img = Object.assign(el("img", "vpv-img"), { alt: "", width: 480, decoding: "async", loading: "eager" });
    let n = 0;
    img.addEventListener("error", () => {
      n++;
      if (n < tries.length) setTimeout(() => { img.src = tries[n]; }, n === 1 ? 150 : 0);
      else { img.replaceWith(el("div", "vpv-img-missing", "Картинка недоступна")); layout(); }
    });
    img.src = tries[0];
    return img;
  }

  let lastInfo = null;
  function fill(info, key) {
    lastInfo = info;
    const t = ensureTip();
    t.dataset.key = key;
    const media = info.demo ? demo(info.demo) : info.image ? picture(info) : null;
    t.replaceChildren(...[media, el("strong", "vpv-title", info.title), info.text ? el("p", "vpv-text", info.text) : null].filter(Boolean));
    t.hidden = false;
    t.style.visibility = "hidden";
    layout();
    const img = t.querySelector("img");
    if (img && !img.complete) { img.addEventListener("load", layout, { once: true }); img.addEventListener("error", layout, { once: true }); }
  }

  /** Puts the pop-up next to its item; called on open, when the picture arrives and when the page scrolls or resizes (keyboard focus scrolls the page). */
  function layout() {
    if (!shown || !tip || tip.hidden) return;
    const r = shown.getBoundingClientRect();
    const view = { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight };
    if (r.bottom < 0 || r.top > view.height) { hide(); return; }                       // the item scrolled out of sight
    const box = tip.getBoundingClientRect();
    const p = place({ left: r.left, top: r.top, right: r.right, bottom: r.bottom }, { width: box.width, height: box.height }, view);
    tip.style.left = `${p.left}px`; tip.style.top = `${p.top}px`; tip.dataset.side = p.side; tip.style.visibility = "";
  }

  function hide() {
    clearTimeout(openTimer); seq++;
    if (tip) tip.hidden = true;
    if (shown) { shown.removeAttribute("aria-describedby"); shown.dispatchEvent(new CustomEvent("vpv-hide")); }
    shown = null; pinned = false;
  }

  /** Opens the pop-up for `node` (the element the pop-up is anchored to and that gets aria-describedby). */
  async function show(node, keyOrFn, fallback, { pin = false } = {}) {
    clearTimeout(openTimer);
    const key = typeof keyOrFn === "function" ? keyOrFn() : keyOrFn;
    if (shown === node && tip && !tip.hidden && tip.dataset.key === key) { pinned = pinned || pin; return; }
    if (shown && shown !== node) hide();
    const mine = ++seq;
    shown = node; pinned = pin;
    await loadManifest();
    if (mine !== seq || shown !== node) return;               // the pointer already left, or another item took over
    node.setAttribute("aria-describedby", TIP_ID);
    fill(describe(manifest, key, fallback), key);
  }

  /** Makes `node` show the preview of `key` on hover, keyboard focus and a long touch. `fallback` = {title, text} for items the manifest has no words for. */
  function attach(node, key, fallback) {         // `key` may be a function when the item changes its kind (the block type select)
    if (!node || node.dataset.vpv) return node;
    node.dataset.vpv = "1";
    let start = null, held = false;
    node.addEventListener("pointerenter", (e) => { if (e.pointerType === "mouse") { clearTimeout(openTimer); openTimer = setTimeout(() => show(node, key, fallback), HOVER_DELAY); } });
    node.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse" && !pinned && shown === node) hide(); else if (e.pointerType === "mouse") clearTimeout(openTimer); });
    node.addEventListener("focusin", () => show(node, key, fallback));
    node.addEventListener("focusout", (e) => { if (shown === node && !node.contains(e.relatedTarget)) hide(); });
    node.addEventListener("pointerdown", (e) => {
      if (e.pointerType !== "touch") return;
      held = false; start = { x: e.clientX, y: e.clientY };
      clearTimeout(openTimer);
      openTimer = setTimeout(() => { held = true; show(node, key, fallback, { pin: true }); }, LONG_PRESS);
    });
    const cancel = () => { if (!held) clearTimeout(openTimer); };
    node.addEventListener("pointermove", (e) => { if (start && holdMoved(e.clientX - start.x, e.clientY - start.y)) cancel(); });
    node.addEventListener("pointerup", cancel); node.addEventListener("pointercancel", cancel);
    node.addEventListener("contextmenu", (e) => { if (held || e.pointerType === "touch") e.preventDefault(); });   // Android opens a menu on a long press
    node.addEventListener("click", (e) => { if (held) { e.preventDefault(); e.stopPropagation(); held = false; } }, true);   // the release of a long press must not toggle a switch
    return node;
  }

  /** A small "eye" button for touch screens and keyboards: toggles a pinned pop-up. `key` may be a function. */
  function eyeButton(node, key, fallback = {}, label) {
    const b = el("button", "vpv-eye", "👁");
    b.type = "button";
    b.setAttribute("aria-label", `Превʼю: ${label || fallback?.title || key}`);
    b.setAttribute("aria-expanded", "false");
    b.addEventListener("click", (e) => {
      e.preventDefault(); e.stopPropagation();
      if (shown === node && pinned) hide(); else { show(node, key, fallback, { pin: true }); b.setAttribute("aria-expanded", "true"); }
    });
    node.addEventListener("vpv-hide", () => b.setAttribute("aria-expanded", "false"));
    return b;
  }

  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && shown) { hide(); } });                 // the pop-up must be dismissable without moving the pointer (WCAG 1.4.13)
  document.addEventListener("pointerdown", (e) => { if (pinned && shown && !shown.contains(e.target) && !tip.contains(e.target)) hide(); }, true);
  window.addEventListener("scroll", layout, { passive: true, capture: true });
  window.addEventListener("resize", layout);
  // The theme can change while a pop-up is open (the site's toggle, or the system): redraw it with the matching picture.
  const retheme = () => { if (shown && tip && !tip.hidden && lastInfo) fill(lastInfo, tip.dataset.key); };
  try { root.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", retheme); } catch { /* old browsers */ }
  try { new MutationObserver(retheme).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] }); } catch { /* no MutationObserver */ }

  return { ...pure, attach, eyeButton, show, hide, loadManifest, isOpen: () => !!shown && !!tip && !tip.hidden };
});
