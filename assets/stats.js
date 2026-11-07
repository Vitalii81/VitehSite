// Visit statistics without cookies or identifiers (see worker/stats.mjs): one beacon when the page opens and one for each stretch the page was visible.
// Sent to the site's own /api/hit only; skipped when the browser asks not to be tracked and outside the public site (admin preview, local files).
(() => {
  const nav = navigator;
  if (nav.doNotTrack === "1" || nav.globalPrivacyControl || !/^(www\.)?viteh\.org$/.test(location.hostname) || !nav.sendBeacon) return;
  const path = location.pathname.replace(/index\.html$/, "").replace(/^\/portfolio$/, "/portfolio/") || "/";
  const send = (data) => { try { nav.sendBeacon("/api/hit", new Blob([JSON.stringify({ p: path, l: document.documentElement.lang || "", w: innerWidth, ...data })], { type: "text/plain" })); } catch {} };
  send({ k: "view", r: document.referrer });
  let since = document.visibilityState === "visible" ? performance.now() : 0;
  const stop = () => { if (since) { send({ k: "leave", t: Math.round((performance.now() - since) / 1000) }); since = 0; } };
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") stop(); else since = performance.now(); });
  addEventListener("pagehide", stop);
})();
