// 3D gallery: progressive enhancement of the product cards rendered by app.js.
// Cards whose product has a "model" field get a "3D" button; the flat SVG stays the poster.
// The <model-viewer> library (assets/vendor/) is imported lazily, and ONE shared viewer element
// moves between the most visible card and the dialog, so at most one WebGL scene exists at a time.

const MIN_RATIO = 0.55;     // a card must be this visible to host the live scene
const KEEP_MARGIN = 0.2;    // hysteresis: keep the current card unless another is clearly more visible
const MODEL_RE = /^assets\/models\/[\w.-]+\.glb$/;

/** Only same-origin files below assets/models/ are accepted, never arbitrary URLs from JSON. */
export const modelFor = (product) => (MODEL_RE.test(product?.model || "") ? product.model : null);

/** Chooses the card that should host the live scene. items: [{ id, ratio, order }]. */
export function pickActive(items, { prefer = null, current = null } = {}) {
  if (prefer && items.some((i) => i.id === prefer && i.ratio >= 0.2)) return prefer;
  const seen = items.filter((i) => i.ratio >= MIN_RATIO).sort((a, b) => b.ratio - a.ratio || a.order - b.order);
  const keep = seen.find((i) => i.id === current);
  return keep && seen[0].ratio - keep.ratio < KEEP_MARGIN ? keep.id : seen[0]?.id ?? null;
}

/** Whether the library may be fetched without an explicit click (WebGL present, no data saver, not 2G). */
export const canAutoLoad = ({ webgl = true, saveData = false, effectiveType = "4g" } = {}) =>
  webgl && !saveData && !/(^|-)2g$/.test(effectiveType);

/** UI text for the current language with English fallback; keys live in site.json under ui.gallery3d. */
export const label = (ui, key, lang) => ui?.gallery3d?.[key]?.[lang] ?? ui?.gallery3d?.[key]?.en ?? "";

/* ---------------- browser part ---------------- */
const el = (tag, cls, text) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text) node.textContent = text;
  return node;
};

function boot() {
  const cards = new Map();            // id -> { id, card, media, product, order, ratio }
  let ui = null, lang = "en", prefer = null, active = null;
  let viewer = null, dlg = null, stage = null, status = null, title = null, hint = null, closeBtn = null;
  let libPromise = null, libReady = false, failed = false;
  const conn = navigator.connection || {};
  const webgl = (() => { try { const c = document.createElement("canvas"); return !!(c.getContext("webgl2") || c.getContext("webgl")); } catch { return false; } })();
  const auto = () => canAutoLoad({ webgl, saveData: conn.saveData, effectiveType: conn.effectiveType });
  const calm = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  const t = (key) => label(ui, key, lang);
  const text = (value) => (value && (value[lang] ?? value.en)) || "";

  const loadLib = () => (libPromise ??= import("./vendor/model-viewer.min.js").then((m) => {
    // Point every decoder to local files so the library never contacts a third-party host.
    const E = m.ModelViewerElement, at = (p) => new URL(`./vendor/${p}`, import.meta.url).href;
    E.dracoDecoderLocation = at("draco/"); E.ktx2TranscoderLocation = at("ktx2/"); E.meshoptDecoderLocation = at("meshopt_decoder.js");
    libReady = true;
  }).catch((error) => { failed = true; cards.forEach((c) => c.media.querySelector(".g3d-open")?.remove()); throw error; }));

  /** Gives the "accent" material the current theme colour. */
  const recolor = () => {
    const color = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
    if (!viewer?.model || !color) return;
    for (const m of viewer.model.materials) if (m.name === "accent") m.pbrMetallicRoughness.setBaseColorFactor(color);
  };

  const makeViewer = () => {
    const v = document.createElement("model-viewer");
    v.className = "g3d-live";
    v.setAttribute("environment-image", "neutral");
    v.setAttribute("shadow-intensity", "0.7");
    v.setAttribute("interaction-prompt", "none");
    v.setAttribute("field-of-view", "30deg");           // narrower than the default: less perspective distortion
    v.setAttribute("camera-orbit", "28deg 72deg auto");
    v.addEventListener("load", () => { recolor(); v.classList.add("ready"); if (status) status.textContent = ""; });
    v.addEventListener("error", () => { v.remove(); v.classList.remove("ready"); if (status) status.textContent = t("unavailable"); });
    return v;
  };

  /** card mode: silent auto-rotating preview; dialog mode: full camera controls. */
  const show = (host, product, full) => {
    viewer ??= makeViewer();
    viewer.classList.remove("ready");
    viewer.toggleAttribute("camera-controls", full);
    viewer.toggleAttribute("disable-zoom", !full);
    viewer.toggleAttribute("auto-rotate", !calm());
    viewer.setAttribute("touch-action", full ? "none" : "pan-y");
    viewer.setAttribute("alt", text(product.title));
    if (viewer.getAttribute("src") !== product.model) viewer.setAttribute("src", product.model); else viewer.classList.add("ready");
    host.append(viewer);
  };

  const apply = () => {
    if (dlg?.open || failed) return;
    const items = [...cards.values()].map(({ id, ratio, order }) => ({ id, ratio, order }));
    const next = auto() ? pickActive(items, { prefer, current: active }) : null;
    if (next && !libReady) { loadLib().then(apply, () => {}); return; }
    if (next === active) return;
    active = next;
    if (!next) { viewer?.remove(); return; }
    show(cards.get(next).media, cards.get(next).product, false);
  };

  const buildDialog = () => {
    dlg = el("dialog", "g3d-dialog");
    const head = el("div", "g3d-head");
    title = el("h3"); title.id = "g3dTitle";
    closeBtn = el("button", "g3d-close", "×"); closeBtn.type = "button";
    closeBtn.addEventListener("click", () => dlg.close());
    head.append(title, closeBtn);
    stage = el("div", "g3d-stage");
    status = el("p", "g3d-status"); status.setAttribute("role", "status");
    hint = el("p", "g3d-hint"); hint.id = "g3dHint";
    dlg.append(head, stage, status, hint);
    dlg.setAttribute("aria-labelledby", "g3dTitle"); dlg.setAttribute("aria-describedby", "g3dHint");
    dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });   // backdrop click
    dlg.addEventListener("close", () => { viewer?.remove(); active = null; stage.replaceChildren(); apply(); });
    document.body.append(dlg);
  };

  const open = async (id) => {
    const { product } = cards.get(id);
    if (!dlg) buildDialog();
    title.textContent = text(product.title);
    hint.textContent = t("hint");
    closeBtn.setAttribute("aria-label", t("close"));
    status.textContent = t("loading");
    const poster = el("img", "g3d-poster"); poster.src = product.image; poster.alt = "";
    stage.replaceChildren(poster);
    viewer?.remove(); active = null;
    dlg.showModal();
    try { await loadLib(); } catch { status.textContent = t("unavailable"); return; }
    if (dlg.open) show(stage, product, true);
  };

  const io = "IntersectionObserver" in window ? new IntersectionObserver((entries) => {
    for (const e of entries) for (const c of cards.values()) if (c.media === e.target) c.ratio = e.isIntersecting ? e.intersectionRatio : 0;
    apply();
  }, { threshold: [0, 0.2, 0.4, 0.55, 0.7, 0.85, 1] }) : null;

  const enhance = (detail) => {
    ({ ui, lang } = detail);
    io?.disconnect(); cards.clear(); active = null; prefer = null;
    if (!dlg?.open) viewer?.remove();
    if (!webgl) return;                                   // no WebGL: the flat poster stays, no 3D buttons
    const byId = new Map(detail.products.map((p) => [p.id, p]));
    document.querySelectorAll("#productGrid .product-card[data-id]").forEach((card, order) => {
      const product = byId.get(card.dataset.id);
      if (!modelFor(product)) return;
      const img = card.querySelector("img");
      const media = el("div", "g3d-media");
      img.replaceWith(media); media.append(img);
      const button = el("button", "g3d-open"); button.type = "button";
      button.setAttribute("aria-label", `${text(product.title)} — ${t("open")}`);
      button.append(el("span", "g3d-badge", "3D"), el("span", "g3d-cap", t("open")));
      button.addEventListener("click", () => open(product.id));
      media.append(button);
      const entry = { id: product.id, card, media, product, order, ratio: 0 };
      cards.set(product.id, entry);
      card.addEventListener("pointerenter", () => { prefer = product.id; apply(); });
      card.addEventListener("focusin", () => { prefer = product.id; apply(); });
      for (const type of ["pointerleave", "focusout"]) card.addEventListener(type, () => { if (prefer === product.id) { prefer = null; apply(); } });
      io?.observe(media);
    });
  };

  document.addEventListener("viteh:products", (event) => enhance(event.detail));
  if (window.vitehGalleryData) enhance(window.vitehGalleryData);     // app.js rendered before this module ran
  new MutationObserver(recolor).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", recolor);
}

if (typeof document !== "undefined") boot();
