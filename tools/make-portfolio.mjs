// Builds the engineering portfolio PDF (A4) with a local headless Chrome. A development tool: only its output (assets/portfolio/*.pdf) ships.
//   node tools/make-portfolio.mjs [--chrome /path/to/chrome] [--slots] [--no-renders]
//   --slots       draws still-missing project pictures as red PLACEHOLDER boxes (run tools/make-portfolio-placeholders.mjs first); never for the published PDF
//   --final       fails when any project picture slot is still a placeholder
//   --no-renders  keep assets/portfolio/img/cronos-v*.jpg as they are instead of re-rendering them from the GLB files
// Needs Chrome/Chromium (software WebGL is fine). No npm packages: it speaks the DevTools protocol over node's built-in WebSocket.
// Inputs: data/portfolio-page.json (page content, shared with the web page portfolio/index.html), assets/portfolio/img/*.jpg (photos and screenshots already approved for publication), data/site.json (service names, so PDF and site agree),
//         assets/models/cronos-controller-v1.glb / -v2.glb (rendered through tools/poster.html, the same scene as the site).
// Output: assets/portfolio/Vitalii_Krutikov_Engineering_Portfolio_2026.pdf; tools/portfolio/portfolio.html is a build by-product (git-ignored).
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const chromeArg = flag("--chrome") ? args[args.indexOf("--chrome") + 1] : null;
const OUT = "assets/portfolio/Vitalii_Krutikov_Engineering_Portfolio_2026.pdf";
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/* ---------------- content (English; only facts from the owner's PDF v3, the skills file and the site) ---------------- */
const site = JSON.parse(readFileSync(join(root, "data/site.json"), "utf8"));
const services = site.services.items.map((s) => ({ title: s.title.en, text: s.text.en, points: s.points.map((p) => p.en) }));
const contactEmail = site.contact.details.find((d) => d.label.en === "Email")?.value?.en ?? site.contact.details[0]?.value ?? "info@viteh.org";

/* Page content lives in data/portfolio-page.json (shared with the web page /portfolio/); services and the project archive are generated from data/site.json and data/portfolio.json. */
const pages = [];
const page = (kicker, title, lead, body, cls = "") => pages.push({ kicker, title, lead, body, cls });
const content = JSON.parse(readFileSync(join(root, "data/portfolio-page.json"), "utf8")).pages;

/* Projects 2022-2025: texts from data/portfolio.json, pictures from data/portfolio-images.json. A "final" slot is shown; a "placeholder" slot is left out of
   the public PDF, shown with a red PLACEHOLDER marker with --slots, and makes --final fail (so a PDF with missing pictures cannot be released unnoticed). */
const archive = JSON.parse(readFileSync(join(root, "data/portfolio.json"), "utf8")).projects;
const slotManifest = JSON.parse(readFileSync(join(root, "data/portfolio-images.json"), "utf8"));
const cats = Object.fromEntries(site.work.archive.categories.map((c) => [c.id, c.label.en]));
const pendingSlots = [];
const archiveCard = (p) => {
  const shots = (p.slots || []).map((slot) => slotManifest.find((m) => m.slug === p.slug && m.slot === slot)).filter(Boolean).flatMap((m) => {
    if (m.status === "final") return [`<figure style="flex:${(m.ratio.split(":")[0] / m.ratio.split(":")[1]).toFixed(2)} 1 0"><img src="/${m.file}" alt="${esc(m.alt.en)}"></figure>`];
    pendingSlots.push(`${m.slug}/${m.slot}`);
    return flag("--slots") ? [`<figure style="flex:${(m.ratio.split(":")[0] / m.ratio.split(":")[1]).toFixed(2)} 1 0" class="ph"><img src="/tools/portfolio/placeholders/${m.slug}/${m.slot}.webp" alt=""><figcaption>PLACEHOLDER</figcaption></figure>`] : [];
  }).slice(0, 3);
  return `<div class="card arch"><p class="skills">${esc(cats[p.category] || p.category)}${p.years ? " · " + esc(p.years) : ""}</p><h4>${esc(p.title.en)}</h4>${shots.length ? `<div class="shots n${shots.length}">${shots.join("")}</div>` : ""}<p>${esc(p.summary.en)}</p><p class="skills">${esc(p.tags.join(" · "))}</p></div>`;
};
for (const p of content) {
  if (p.type === "html") page(p.kicker, p.title, p.lead, p.html);
  else if (p.type === "services") page(p.kicker, p.title, p.lead, `<div class="svc">${services.map((s) => `<div class="card"><h4>${esc(s.title)}</h4><p>${esc(s.text)}</p><p class="skills">${esc(s.points.join(" · "))}</p></div>`).join("")}</div><p class="note">${esc(p.note)}</p>`);
  else if (p.type === "archive") for (let i = 0; i < archive.length; i += 4) page(p.kicker, i ? `${p.title}, continued` : p.title, i ? "More boards, firmware and programs from the project archive." : site.work.archive.lead.en,
    `<div class="svc arch-grid">${archive.slice(i, i + 4).map(archiveCard).join("")}</div>${i + 4 >= archive.length ? `<p class="note">${esc(p.note)}</p>` : ""}`);
}
if (flag("--final") && pendingSlots.length) { console.error(`--final: ${pendingSlots.length} image slot(s) are still placeholders: ${pendingSlots.join(", ")}`); process.exit(1); }


/* ---------------- HTML ---------------- */
const total = pages.length + 1;
const css = `
@page { size: A4; margin: 0; }
:root { --bg:#0b1424; --panel:#12203a; --ink:#e9eef7; --muted:#a6b4cb; --acc:#4fd1e8; }
* { box-sizing: border-box; }
html, body { margin: 0; background: var(--bg); color: var(--ink); font: 9.6pt/1.45 Inter, "DejaVu Sans", Arial, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.page { width: 210mm; height: 297mm; padding: 16mm 15mm 14mm; position: relative; overflow: hidden; break-after: page; border-top: 1.2mm solid var(--acc); display: flex; flex-direction: column; }
.page:last-child { break-after: auto; }
.top { display: flex; justify-content: space-between; font-size: 7.5pt; letter-spacing: .12em; color: var(--muted); margin-bottom: 9mm; }
.top b { color: var(--ink); }
.kicker { color: var(--acc); font-size: 8pt; letter-spacing: .14em; margin: 0 0 2mm; }
h1 { font-size: 22pt; line-height: 1.15; margin: 0 0 2mm; }
.lead { color: var(--muted); font-size: 10pt; margin: 0 0 6mm; max-width: 165mm; }
h3 { color: var(--acc); font-size: 8.5pt; letter-spacing: .12em; margin: 5mm 0 2mm; }
h4 { color: var(--acc); font-size: 8.5pt; letter-spacing: .08em; margin: 3mm 0 1mm; }
p { margin: 0 0 2.2mm; }
.muted, figcaption, .note { color: var(--muted); }
.note { font-size: 8.5pt; margin-top: 4mm; }
.body { flex: 1; min-height: 0; }
.foot { display: flex; justify-content: space-between; font-size: 7.5pt; letter-spacing: .1em; color: var(--muted); border-top: .2mm solid #26385c; padding-top: 3mm; }
figure { margin: 0 0 3mm; } figure img { width: 100%; display: block; border-radius: 1.5mm; background: #fff; }
figure.wide img { max-height: 92mm; object-fit: contain; background: #0e1a30; }
figcaption { font-size: 8pt; margin-top: 1.2mm; }
.card { background: var(--panel); border-radius: 2mm; padding: 4mm 5mm; margin-bottom: 3.5mm; break-inside: avoid; }
.card.hi { border-left: 1mm solid var(--acc); }
.card h4 { margin-top: 0; } .skills { color: var(--muted); font-size: 8pt; letter-spacing: .04em; margin: 1.5mm 0 0; }
.cols .card { margin-bottom: 3mm; }
.svc .card { margin-bottom: 2.4mm; padding: 2.6mm 3.6mm; font-size: 8.2pt; line-height: 1.38; } .svc .card h4 { margin-bottom: .6mm; } .svc .card p { margin-bottom: 1mm; } .svc .skills { font-size: 7.4pt; }
.svc { display: grid; grid-template-columns: 1fr 1fr; gap: 0 4mm; }
.arch-grid { align-items: start; } .arch .shots { display: flex; gap: 1.5mm; margin: 1.5mm 0 2mm; height: 26mm; } .arch figure { margin: 0; position: relative; min-width: 0; overflow: hidden; border-radius: 1mm; } .arch figure img { width: 100%; height: 100%; object-fit: cover; max-height: none; border-radius: 0; background: #0e1a30; }
.ph figcaption { position: absolute; left: 0; right: 0; bottom: 0; background: #b3261e; color: #fff; font: 700 6pt monospace; letter-spacing: .1em; padding: .4mm 1mm; margin: 0; }
.two { display: grid; grid-template-columns: 1fr 1.1fr; gap: 8mm; align-items: start; } .two img { max-height: 190mm; object-fit: contain; }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 4mm; align-items: start; } .grid2 img { max-height: 80mm; object-fit: contain; background: #0e1a30; }
.webrow { display: grid; grid-template-columns: 3fr 1fr 1fr; gap: 3mm; align-items: start; margin-bottom: 2mm; }
.stack figure.wide img { max-height: 70mm; }
.caps { display: grid; grid-template-columns: 38mm 1fr; gap: 3mm 4mm; margin: 0; } .caps dt { color: var(--acc); font-size: 8.5pt; letter-spacing: .08em; } .caps dd { margin: 0; }
.roles { padding-left: 5mm; margin: 0; } .focus b { color: var(--acc); margin-right: 3mm; }
.cover { padding: 0; display: grid; grid-template-columns: 105mm 1fr; border-top: 1.2mm solid var(--acc); }
.cover .l { padding: 18mm 14mm; display: flex; flex-direction: column; } .cover .l .sp { flex: 1; }
.cover h1 { font-size: 30pt; letter-spacing: .02em; margin: 16mm 0 8mm; }
.cover img { width: 100%; height: 100%; object-fit: cover; }
.cover .tags { color: var(--acc); font-size: 8pt; letter-spacing: .12em; line-height: 1.9; }
`;
const cover = `<section class="page cover"><div class="l"><p class="kicker">ENGINEERING<br>PORTFOLIO / 2026</p>
  <h1>VITALII<br>KRUTIKOV</h1><p>Embedded Systems Engineer<br>Hardware &amp; PCB Designer<br>Software Developer</p><div class="sp"></div>
  <p class="muted">From circuit design and firmware to production-oriented prototypes, desktop tools, websites, Android apps and connected systems.</p>
  <p class="tags">STM32 · ESP32 · C/C++ · C#<br>LINUX · PCB · IoT · AI</p><p class="muted" style="font-size:8pt">SELECTED WORK · VISIBLE PART OF WORK SINCE 2014</p></div>
  <img src="/assets/portfolio/img/hero-unit.jpg" alt="Touchscreen control unit"></section>`;
const body = pages.map((p, i) => `<section class="page ${p.cls}"><div class="top"><b>VITALII KRUTIKOV</b><span>ENGINEERING PORTFOLIO</span></div>
  <p class="kicker">${p.kicker}</p><h1>${esc(p.title)}</h1><p class="lead">${esc(p.lead)}</p><div class="body">${p.body}</div>
  <div class="foot"><span>EMBEDDED / HARDWARE / SOFTWARE</span><span>${String(i + 2).padStart(2, "0")} / ${String(total).padStart(2, "0")}</span></div></section>`).join("\n");
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Vitalii Krutikov, Engineering Portfolio 2026</title><style>${css}</style></head><body>${cover}${body}</body></html>`;

/* ---------------- Chrome ---------------- */
const CANDIDATES = [chromeArg, process.env.CHROME, "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/opt/pw-browsers/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].filter(Boolean);
const chrome = CANDIDATES.find((p) => existsSync(p));
if (!chrome) { console.error("No Chrome/Chromium found. Pass --chrome /path or set CHROME."); process.exit(1); }
const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".glb": "model/gltf-binary", ".hdr": "application/octet-stream", ".png": "image/png", ".jpg": "image/jpeg", ".css": "text/css", ".svg": "image/svg+xml" };
const server = createServer((req, res) => {
  const path = normalize(join(root, decodeURIComponent(new URL(req.url, "http://x").pathname)));
  if (!path.startsWith(root) || !existsSync(path) || !statSync(path).isFile()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": MIME[extname(path)] || "application/octet-stream" }); res.end(readFileSync(path));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
const profile = mkdtempSync(join(tmpdir(), "viteh-portfolio-"));
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
const cdp = (method, params) => send(method, params, sessionId);

let failed = 0;
if (!flag("--no-renders")) {
  // Renders of the real GLB files through the same scene as the site posters, at 1200x800 (not 720x480).
  await cdp("Emulation.setDeviceMetricsOverride", { width: 720, height: 480, deviceScaleFactor: 1.667, mobile: false });
  const products = JSON.parse(readFileSync(join(root, "data/products.json"), "utf8"));
  for (const [file, pid] of [["cronos-v1", "cronos-controller-v1"], ["cronos-v2", "cronos-controller"]]) {
    const p = products.find((x) => x.id === pid);
    await cdp("Page.navigate", { url: `${base}/tools/poster.html?src=${encodeURIComponent("/" + p.model)}&theme=dark${p.orbit ? "&orbit=" + encodeURIComponent(p.orbit) : ""}` });
    let state = null;
    for (let i = 0; i < 120 && !state; i++) {
      await new Promise((r) => setTimeout(r, 500));
      state = (await cdp("Runtime.evaluate", { expression: "window.__posterError ? 'E:' + window.__posterError : window.__posterReady ? 'ok' : ''", returnByValue: true })).result.value || null;
    }
    if (state !== "ok") { console.error(`FAILED render ${file}: ${state || "timeout"}`); failed++; continue; }
    const shot = await cdp("Page.captureScreenshot", { format: "jpeg", quality: 88, clip: { x: 0, y: 0, width: 720, height: 480, scale: 1.667 } });
    writeFileSync(join(root, `assets/portfolio/img/${file}.jpg`), Buffer.from(shot.data, "base64"));
    console.log(`assets/portfolio/img/${file}.jpg`);
  }
}

writeFileSync(join(root, "tools/portfolio/portfolio.html"), html);
await cdp("Emulation.clearDeviceMetricsOverride");
await cdp("Page.navigate", { url: `${base}/tools/portfolio/portfolio.html` });
await new Promise((r) => setTimeout(r, 2500));
const pdf = await cdp("Page.printToPDF", { preferCSSPageSize: true, printBackground: true, displayHeaderFooter: false });
mkdirSync(join(root, "assets/portfolio"), { recursive: true });
writeFileSync(join(root, OUT), Buffer.from(pdf.data, "base64"));
console.log(`${OUT}  ${(statSync(join(root, OUT)).size / 1024).toFixed(0)} KB, ${total} pages${flag("--slots") ? " (with mock-up slots)" : ""}`);
ws.close(); proc.kill(); server.close();
try { rmSync(profile, { recursive: true, force: true }); } catch {}
process.exit(failed ? 1 : 0);
