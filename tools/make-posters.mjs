// Renders poster images of the 3D models (light and dark theme) with a local headless Chrome. A development tool: nothing here ships to visitors.
//   node tools/make-posters.mjs [--chrome /path/to/chrome] [only-model-name ...]
// Needs a Chrome/Chromium binary (software WebGL via SwiftShader is fine). No npm packages: it speaks the DevTools protocol over node's built-in WebSocket.
// Output: assets/posters/<model>-light.webp and -dark.webp (720x480). The poster base names live in the "poster" field of data/*.json.
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const chromeArg = args.includes("--chrome") ? args[args.indexOf("--chrome") + 1] : null;
const only = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--chrome");
const CANDIDATES = [chromeArg, process.env.CHROME, "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/opt/pw-browsers/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].filter(Boolean);
const chrome = CANDIDATES.find((p) => existsSync(p));
if (!chrome) { console.error("No Chrome/Chromium found. Pass --chrome /path or set CHROME."); process.exit(1); }

const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".glb": "model/gltf-binary", ".hdr": "application/octet-stream", ".png": "image/png", ".css": "text/css", ".svg": "image/svg+xml" };
const server = createServer((req, res) => {
  const path = normalize(join(root, decodeURIComponent(new URL(req.url, "http://x").pathname)));
  if (!path.startsWith(root) || !existsSync(path) || !statSync(path).isFile()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": MIME[extname(path)] || "application/octet-stream" }); res.end(readFileSync(path));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

const profile = mkdtempSync(join(tmpdir(), "viteh-posters-"));
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
await page("Emulation.setDeviceMetricsOverride", { width: 720, height: 480, deviceScaleFactor: 1, mobile: false });

const targets = [];
const products = JSON.parse(readFileSync(join(root, "data/products.json"), "utf8"));
const site = JSON.parse(readFileSync(join(root, "data/site.json"), "utf8"));
for (const item of [...products, ...(site.services?.items || [])]) if (item.model && item.poster) targets.push({ model: item.model, poster: item.poster, orbit: /^-?\d{1,3}deg \d{1,3}deg \d{2,3}%$/.test(item.orbit || "") ? item.orbit : "" });
mkdirSync(join(root, "assets/posters"), { recursive: true });

let failed = 0;
for (const { model, poster, orbit } of targets) {
  const name = poster.split("/").pop();
  if (only.length && !only.includes(name)) continue;
  for (const theme of ["light", "dark"]) {
    await page("Page.navigate", { url: `${base}/tools/poster.html?src=${encodeURIComponent("/" + model)}&theme=${theme}${orbit ? "&orbit=" + encodeURIComponent(orbit) : ""}` });
    let state = null;
    for (let i = 0; i < 120 && !state; i++) {                      // up to ~60 s: software WebGL is slow
      await new Promise((r) => setTimeout(r, 500));
      const r = await page("Runtime.evaluate", { expression: "window.__posterError ? 'E:' + window.__posterError : window.__posterReady ? 'ok' : ''", returnByValue: true });
      state = r.result.value || null;
    }
    if (state !== "ok") { console.error(`FAILED ${name}-${theme}: ${state || "timeout"}`); failed++; continue; }
    const shot = await page("Page.captureScreenshot", { format: "webp", quality: 80, clip: { x: 0, y: 0, width: 720, height: 480, scale: 1 } });
    const file = join(root, `assets/posters/${name}-${theme}.webp`);
    writeFileSync(file, Buffer.from(shot.data, "base64"));
    console.log(`assets/posters/${name}-${theme}.webp  ${(statSync(file).size / 1024).toFixed(1)} KB`);
  }
}
ws.close(); proc.kill(); server.close(); rmSync(profile, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
