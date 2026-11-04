// Look of every <model-viewer> on the site (gallery cards, dialog, and tools/make-posters.mjs share it, so posters match the live scene).
// Studio lighting from a small generated HDR (assets/env/studio.hdr), neutral tone mapping (keeps LEDs and the accent colour saturated).

export const STUDIO_ENV = new URL("./env/studio.hdr", import.meta.url).href;

/** Attributes that never change between card and dialog. */
export const BASE_ATTRS = {
  "shadow-intensity": "1",
  "shadow-softness": "1",
  "tone-mapping": "neutral",
  exposure: "1.4",
  "interaction-prompt": "none",
  "field-of-view": "30deg",
  "camera-orbit": "30deg 70deg 94%",
  "min-camera-orbit": "auto 8deg 45%",       // no looking from below the floor, no zoom inside the model
  "max-camera-orbit": "auto 98deg 170%",     // and no zooming out until the model is a dot
  "interpolation-decay": "90",
};

/** Optional per-model start orbit ("30deg 65deg 130%"): only this strict shape is accepted, anything else falls back to the default. */
export const orbitFor = (item) => (/^-?\d{1,3}deg \d{1,3}deg \d{2,3}%$/.test(item?.orbit || "") ? item.orbit : null);

export function applyViewerSettings(el, { full = false, calm = false, orbit = null } = {}) {
  el.setAttribute("environment-image", STUDIO_ENV);
  for (const [k, v] of Object.entries(BASE_ATTRS)) el.setAttribute(k, v);
  if (orbit) el.setAttribute("camera-orbit", orbit);
  el.toggleAttribute("camera-controls", full);
  el.toggleAttribute("disable-zoom", !full);
  el.toggleAttribute("auto-rotate", !calm);
  el.setAttribute("touch-action", full ? "none" : "pan-y");
}

/** Materials whose colour follows the theme: "accent", "accentMetal", "accentTex" (see tools/models/gltf.mjs). */
export const isAccent = (name) => /^accent/.test(name || "");

/** Poster for the current theme: the JSON stores "assets/posters/<name>", files are <name>-light.webp / <name>-dark.webp. */
export const posterUrl = (base, dark) => (/^assets\/posters\/[\w-]+$/.test(base || "") ? `${base}-${dark ? "dark" : "light"}.webp` : null);
