// Photographs the factory site into the small WebP previews the admin shows when the owner hovers a list item. A development tool: nothing here ships to visitors.
//   node tools/make-admin-previews.mjs [--chrome /path/to/chrome] [key ...]      e.g.  section:faq  block:cta
// Needs a Chrome/Chromium binary and python3 (the block samples are rendered by the admin's own renderer, tools/admin-preview-sample.py).
// Output: radxa-admin/web/previews/<kind>-<id>.webp, 480 px wide, each kept under ~40 KB. The texts live in radxa-admin/web/previews/manifest.json (hand-written);
// this script only creates the pictures that manifest points at, and fails when one of them cannot be photographed.
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(root, "radxa-admin/web/previews");
const args = process.argv.slice(2);
const chromeArg = args.includes("--chrome") ? args[args.indexOf("--chrome") + 1] : null;
const only = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--chrome");
const CANDIDATES = [chromeArg, process.env.CHROME, "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/opt/pw-browsers/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].filter(Boolean);
const chrome = CANDIDATES.find((p) => existsSync(p) && statSync(p).isFile());
if (!chrome) { console.error("No Chrome/Chromium found. Pass --chrome /path or set CHROME."); process.exit(1); }

const WIDTH = 480, MAX_KB = 40, VIEW = 1280;
const samples = new Map();            // sample page per variant, rendered on demand
const sampleHtml = (variant) => { if (!samples.has(variant)) samples.set(variant, execFileSync("python3", ["-I", join(root, "tools/admin-preview-sample.py"), ...(variant ? [variant] : [])], { encoding: "utf8", maxBuffer: 1 << 26 })); return samples.get(variant); };

// What to photograph for every key: a CSS selector on the factory page ("home") or on the sample page with one block of each type ("sample").
const SHOTS = {};
for (const id of ["hero", "trust", "services", "ai", "process", "work", "stack", "pricing", "faq", "contact"]) SHOTS[`section:${id}`] = { page: "home", sel: id === "hero" ? "section.hero" : id === "trust" ? "section.trust" : `section#${id}`, height: 0.7 };
for (let i = 0; i < 12; i++) SHOTS[`service:s${i}`] = { page: "home", sel: `#serviceGrid .card[data-s="${i}"]`, pad: 8 };
for (const id of ["cronos-controller", "cronos-controller-v1", "iot-module", "custom-electronics", "agent-assistant", "device-monitor", "sensor-node"]) SHOTS[`project:${id}`] = { page: "home", sel: `#productGrid .product-card[data-id="${id}"]`, pad: 8 };
for (const t of ["hero", "services", "projects", "gallery3d", "agents", "steps", "stack", "pricing", "faq", "form", "text_image", "gallery", "cta"]) SHOTS[`block:${t}`] = { page: ["projects", "gallery3d"].includes(t) ? `sample:${t}` : "sample", sel: `#pv-${t}`, height: 0.7 };
SHOTS["block:divider"] = { page: "sample", sel: "hr.divider", pad: 70 };
SHOTS["widget:gallery3d"] = { page: "home", sel: "#productGrid", height: 0.55 };
SHOTS["widget:portfolioLink"] = { page: "home", sel: "#work .portfolio-link", pad: 40 };

const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".glb": "model/gltf-binary", ".hdr": "application/octet-stream", ".png": "image/png", ".webp": "image/webp", ".css": "text/css", ".svg": "image/svg+xml" };
const server = createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/__sample.html") { res.writeHead(200, { "content-type": "text/html" }); res.end(sampleHtml(url.searchParams.get("b") || "")); return; }
  const path = normalize(join(root, decodeURIComponent(url.pathname)));
  if (!path.startsWith(root) || !existsSync(path) || !statSync(path).isFile()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": MIME[extname(path)] || "application/octet-stream" }); res.end(readFileSync(path));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

const profile = mkdtempSync(join(tmpdir(), "viteh-previews-"));
const proc = spawn(chrome, ["--headless=new", "--remote-debugging-port=0", "--no-sandbox", "--disable-extensions", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--hide-scrollbars", `--user-data-dir=${profile}`, "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
const wsUrl = await new Promise((resolve, reject) => {
  let buf = ""; const t = setTimeout(() => reject(new Error("Chrome did not start")), 20000);
  proc.stderr.on("data", (d) => { buf += d; const m = /DevTools listening on (ws:\/\/\S+)/.exec(buf); if (m) { clearTimeout(t); resolve(m[1]); } });
  proc.on("exit", () => reject(new Error("Chrome exited early")));
});
const ws = new WebSocket(wsUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let id = 0; const waiting = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && waiting.has(m.id)) { const { res, rej } = waiting.get(m.id); waiting.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); } };
const send = (method, params = {}, sessionId) => new Promise((res, rej) => { const i = ++id; waiting.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params, sessionId })); });
const { targetId } = await send("Target.createTarget", { url: "about:blank" });
const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
const page = (method, params) => send(method, params, sessionId);
const evaluate = async (expression) => (await page("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result.value;
await page("Emulation.setDeviceMetricsOverride", { width: VIEW, height: 900, deviceScaleFactor: 1, mobile: false });
await page("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });

// Animations and scroll reveals are switched off so every photo shows the finished state.
const FREEZE = ".topbar,.to-top,[class*=back-to]{display:none!important}*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}.reveal{opacity:1!important;transform:none!important}";
async function open(kind) {
  const [which, variant] = kind.split(":");
  await page("Page.navigate", { url: `${base}/${which === "home" ? "index.html" : "__sample.html" + (variant ? "?b=" + variant : "")}` });
  for (let i = 0; i < 80; i++) {                                  // the cards are drawn by app.js after data/*.json is fetched
    const ready = await evaluate(`document.readyState === "complete" && !!document.querySelector("#serviceGrid .card") && !!document.querySelector("#productGrid .product-card")`);
    if (ready) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  await evaluate(`(() => { const s = document.createElement("style"); s.textContent = ${JSON.stringify(FREEZE)}; document.head.append(s); return document.fonts.ready.then(() => true); })()`);
  await new Promise((r) => setTimeout(r, 400));                   // posters and illustrations
}

mkdirSync(OUT, { recursive: true });
let failed = 0, current = null;
for (const [key, shot] of Object.entries(SHOTS)) {
  if (only.length && !only.includes(key)) continue;
  if (current !== shot.page) { await open(shot.page); current = shot.page; }
  const rect = await evaluate(`(() => { const n = document.querySelector(${JSON.stringify(shot.sel)}); if (!n) return null; n.scrollIntoView({ block: "center" }); const r = n.getBoundingClientRect(); return { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height }; })()`);
  if (!rect || rect.w < 4 || rect.h < 1) { console.error(`FAILED ${key}: nothing found for ${shot.sel}`); failed++; continue; }
  const pad = shot.pad || 0;
  const w = rect.w + pad * 2, x = Math.max(0, rect.x - pad);
  const h = shot.height ? Math.min(rect.h, w * shot.height) : rect.h + pad * 2;     // very tall sections: the top part only, the 480 px picture stays compact
  const clip = { x, y: Math.max(0, rect.y - pad), width: w, height: h, scale: WIDTH / w };
  const [kind, name] = key.split(":");
  const file = join(OUT, `${kind}-${name}.webp`);
  let quality = 78, size = Infinity;
  for (; quality >= 40 && size > MAX_KB * 1024; quality -= 10) {
    const shotData = await page("Page.captureScreenshot", { format: "webp", quality, clip, captureBeyondViewport: true });
    writeFileSync(file, Buffer.from(shotData.data, "base64")); size = statSync(file).size;
  }
  if (size > MAX_KB * 1024) { console.error(`FAILED ${key}: ${(size / 1024).toFixed(1)} KB is over ${MAX_KB} KB`); failed++; continue; }
  console.log(`${file.slice(root.length + 1)}  ${(size / 1024).toFixed(1)} KB`);
}
ws.close(); proc.kill(); server.close(); try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* Chrome may still be flushing its profile */ }
process.exit(failed ? 1 : 0);
