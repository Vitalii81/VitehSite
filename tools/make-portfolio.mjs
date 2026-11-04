// Builds the engineering portfolio PDF (A4) with a local headless Chrome. A development tool: only its output (assets/portfolio/*.pdf) ships.
//   node tools/make-portfolio.mjs [--chrome /path/to/chrome] [--slots] [--no-renders]
//   --slots       draws still-missing project pictures as red PLACEHOLDER boxes (run tools/make-portfolio-placeholders.mjs first); never for the published PDF
//   --final       fails when any project picture slot is still a placeholder
//   --no-renders  keep tools/portfolio/img/cronos-v*.jpg as they are instead of re-rendering them from the GLB files
// Needs Chrome/Chromium (software WebGL is fine). No npm packages: it speaks the DevTools protocol over node's built-in WebSocket.
// Inputs: tools/portfolio/img/*.jpg (photos and screenshots already approved for publication), data/site.json (service names, so PDF and site agree),
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

const fig = (img, cap, cls = "") => `<figure class="${cls}"><img src="img/${img}.jpg" alt="${esc(cap)}"><figcaption>${esc(cap)}</figcaption></figure>`;
const card = (title, text, skills) => `<div class="card"><h4>${esc(title)}</h4><p>${esc(text)}</p>${skills ? `<p class="skills">SKILLS · ${esc(skills)}</p>` : ""}</div>`;
const cards = (list) => list.map((c) => card(...c)).join("");

const pages = [];
const page = (kicker, title, lead, body, cls = "") => pages.push({ kicker, title, lead, body, cls });

page("01 / PROFILE", "Engineering, end to end",
  "Product development across embedded electronics, desktop software, web, Android, automation, networking and prototyping.",
  `<div class="card hi"><h4>PROFESSIONAL PROFILE</h4>
   <p>Engineer and developer working since 2014 (12+ years), spanning embedded systems, PCB design, automation and PC software. Work includes sensor products, industrial controllers, telemetry devices, motor-control electronics and engineering utilities. Recent work adds websites and Android applications for private AI systems.</p>
   <p class="muted">Experience: IT engineer at Adventx and Tesla-service, plus freelance projects.</p></div>
   <h3>CORE CAPABILITIES</h3>
   <dl class="caps">
   <dt>01 EMBEDDED</dt><dd>STM32 (F0–F7, G0/G3/G4), ESP32, AVR; C/C++; peripherals, drivers and integration.</dd>
   <dt>02 ELECTRONICS</dt><dd>Schematics, multilayer PCBs, prototyping, design reviews and enclosure CAD.</dd>
   <dt>03 CONNECTIVITY</dt><dd>CAN, Modbus RTU, RS-485, UART, USB, SPI, I²C, Ethernet, TCP/UDP, BLE and GSM.</dd>
   <dt>04 SOFTWARE</dt><dd>Desktop apps: C# (WinForms, WPF), Qt/C++, GTK, Swift; Python, Bash, diagnostics and automation.</dd>
   <dt>05 WEB &amp; MOBILE</dt><dd>Fast static websites, web interfaces and admin panels (HTML/CSS/JS, Cloudflare); Android apps in Kotlin and Jetpack Compose.</dd>
   <dt>06 DELIVERY</dt><dd>Device configuration, troubleshooting, testing tools, technical documentation and visual instructions.</dd></dl>`);

page("02 / FEATURED PROTOTYPE", "Touchscreen control unit", "Recent physical prototype photographed in November 2026.",
  `<div class="two"><div><h3>CUSTOM DEVICE</h3>
   <p>A compact, enclosed control system with an integrated color touchscreen, large numerical readouts, preset selection, start control and run statistics.</p>
   <p>The photographed interface displays time, speed, preset navigation and status. The enclosure appears custom-made; its internal circuitry and firmware specifications are not established by the available photograph.</p>
   <p class="focus"><b>DESIGN FOCUS</b> Human-machine interface · Enclosure integration · Device-level controls</p></div>
   ${fig("touch-unit", "Touchscreen control unit, prototype photo")}</div>`);

page("02A / 3D MODELS", "Controller in 3D", "Two generations of the touchscreen control unit as web-ready 3D models (GLB), exported from the original Blender project; the renders below come from those GLB files.",
  `<div class="stack">${fig("cronos-v1", "First version: small display, buttons, black cover", "wide")}${fig("cronos-v2", "Latest version: large touchscreen, no buttons, ViTeh mark, round connector", "wide")}</div>
   <div class="cols">${cards([
     ["MODELS FOR THE WEB", "Lightweight GLB models (about 150 KB each) with PBR materials, the screen texture taken from a photo of the real unit; they plug into the interactive 3D product gallery on viteh.org.", "Blender / glTF / WebGL"],
     ["FROM CAD TO PRODUCT PAGE", "The path from the enclosure design and PCB project (KiCad, Blender) to an interactive model that visitors can rotate, without third-party viewers or tracking.", "enclosure CAD / 3D pipeline / web"]])}</div>`);

page("03 / INDUSTRIAL CONTROL", "Sensors & automation", "Selected projects documented with original product and system images.",
  `<div class="grid2">
   <div>${fig("greenhouse", "Greenhouse screen controller")}<h4>GREENHOUSE CONTROLLER</h4><p>Controller for opening and closing greenhouse screens, with a local display and associated control electronics. The original project archive includes connection illustrations and a video guide.</p></div>
   <div>${fig("dmm-t2", "DMM-T2 sensor module")}<h4>DMM-T2 SENSOR MODULE</h4><p>Temperature and humidity data acquisition modules with Modbus RTU communication, including variants for thermocouple inputs and different mechanical layouts.</p></div>
   ${fig("temp-display", "Multi-channel temperature display")}${fig("temp-eth", "Ethernet-connected temperature monitor")}</div>`);

page("04 / ELECTRONICS & PCB", "Custom hardware platforms", "Original board imagery from previous hardware development projects.",
  `${fig("tryboard", "TryBrd / multi-layer stepper-control PCB", "wide")}
   <h4>MULTI-LAYER MOTION CONTROL</h4><p>Designed a four-layer controller board for TMC5130A stepper motor drivers as part of a customer 3D-printing project; also developed basic motor-control firmware. Additional expansion-board work addressed multi-motor systems.</p>
   <h4>OTHER BOARD WORK</h4><p>I/O electronics, charging-station modules, GSM monitoring, and current ESP32-S3 gateway / Ethernet / RS-485 / CAN PCB work.</p>
   <div class="grid2">${fig("io-board", "Custom I/O expansion board")}${fig("chbrg-board", "CHBRG charging-station device board")}</div>`);

page("05 / CONNECTED DEVICES", "Telemetry & remote monitoring", "Field electronics designed to collect information, report status and integrate with operator systems.",
  `${fig("gsm-logger", "GSM event and sensor logger hardware", "wide")}
   <h4>GSM SENSOR LOGGER</h4><p>Four sensor inputs, two relay outputs and backup power. The logger recorded sensor values and issued SMS alerts when configured thresholds were exceeded. It also uploaded data to a server for charting and remote configuration, with SMS-based commands.</p>
   <div class="card hi"><h4>ADDITIONAL CONNECTED PRODUCTS</h4>
   <p><b>Broadcast watchdog:</b> GSM-based radio-audio monitoring with loss-of-broadcast alerts and remote audio listening.</p>
   <p><b>Event logger:</b> PIR event timestamps collected to a PC utility, tabular viewer and CSV export; enclosure produced with 3D printing.</p></div>`);

page("06 / SOFTWARE ENGINEERING", "Tools that support hardware", "Desktop control applications, diagnostic utilities and cross-platform engineering workflows.",
  `${fig("modbus-tool", "Modbus RTU diagnostic and register-monitoring utility", "wide")}
   <h4>DESKTOP TOOLS</h4><p>C# software for sensor configuration and control, serial-port communication, Modbus analysis, CAN packet inspection and device diagnostics. Includes custom user interfaces for engineering and service tasks.</p>
   <div class="grid2">${fig("can-tool", "CAN analysis / packet utility")}${fig("dmm-config", "DMM configuration application")}</div>`);

page("06A / WEB DEVELOPMENT", "Websites & web interfaces", "Fast, private, multilingual sites, with the tools to run them.",
  `${fig("site-cards", "viteh.org: product cards with a 3D view (UA / EN / DE, light and dark theme)", "wide")}
   <div class="cols">${cards([
     ["STATIC SITES, NO TRACKERS", "Static, no-build sites without third-party requests (no CDN, fonts or analytics), built to be GDPR-friendly, with legal pages for Germany and light/dark themes.", "web design / performance / privacy"],
     ["CONTACT FORMS & INTEGRATIONS", "Contact form with attachments served by a Cloudflare Worker and Email Routing, with spam protection and origin checks; hooks for mail and chat assistants.", "Cloudflare Workers / forms / integrations"],
     ["3D PRODUCT GALLERY", "Interactive 3D models of hardware products (GLB exported from Blender), loaded lazily, one scene at a time, with a flat-image fallback.", "3D on the web / Blender / accessibility"],
     ["PRIVATE ADMIN & TEMPLATES", "A private admin for the site: switch sections on or off, edit texts in three languages, build pages from templates, preview, then publish.", "admin tooling / content workflow"]])}</div>`);

page("06B / ANDROID APPLICATIONS", "Android client for private AI systems", "Native Android application for the user's own servers and devices.",
  `<div class="cols">${cards([
     ["CHAT & VOICE AGENT", "Kotlin and Jetpack Compose app with a chat tab and a voice-agent tab: speech recognition, spoken replies, headset button controls and foreground services.", "Kotlin / Compose / audio pipelines"],
     ["INTERPRETER & LECTURE MODE", "Live translation and lecture capture with speech segmentation and voice detection, running against local speech and language models.", "speech processing / streaming / UX"],
     ["FILES, MAIL & AGENT BOARD", "Files tab with previews, a mail tab with summaries and push-style notifications, and a board for agent tasks.", "app architecture / notifications / protocols"],
     ["PRIVATE-NETWORK OPERATIONS", "Routing over a private tailnet with fallbacks, automatic silent updates, on-device logs that can be uploaded for diagnostics, and a scripted release process.", "networking / delivery / maintenance"]])}</div>
   <div class="grid2">${fig("ai-chat", "Chat")}${fig("ai-translate", "Live translation")}</div>`);

page("06C / AI CLIENT IN USE", "Private AI client: web and Android", "The same private AI system reached from a browser and from a native tablet app (screens with test data; private texts blurred).",
  `<div class="grid2">${fig("ai-mail", "Mail agent (test messages)")}${fig("ai-service", "Service status")}</div>
   <div class="webrow">${fig("ai-web-desktop", "Web: project page, light theme", "w")}${fig("ai-web-phone-dark", "Web on a phone, dark theme", "ph")}${fig("ai-web-phone-light", "Web on a phone, light theme", "ph")}</div>`);

page("07 / SERVICES", "What I offer", "The same service names as on viteh.org, each backed by the work shown in this portfolio.",
  `<div class="svc">${services.map((s) => `<div class="card"><h4>${esc(s.title)}</h4><p>${esc(s.text)}</p><p class="skills">${esc(s.points.join(" · "))}</p></div>`).join("")}</div>
   <p class="note">Desktop and cross-platform apps (C# WinForms/WPF, Qt, GTK, Swift): earlier projects on these platforms were not preserved and are not shown as case studies. They are offered as custom development together with AI agents; current examples are the Android client, a Rust/Slint application, web tools and a voice assistant.</p>`);

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
for (let i = 0; i < archive.length; i += 4) page(`07A / PROJECTS 2022–2025`, i ? "Projects 2022–2025, continued" : "Projects 2022–2025", i ? "More boards, firmware and programs from the project archive." : site.work.archive.lead.en,
  `<div class="svc arch-grid">${archive.slice(i, i + 4).map(archiveCard).join("")}</div>${i + 4 >= archive.length ? '<p class="note">Roles, customers and results are available on request.</p>' : ""}`);
if (flag("--final") && pendingSlots.length) { console.error(`--final: ${pendingSlots.length} image slot(s) are still placeholders: ${pendingSlots.join(", ")}`); process.exit(1); }

page("08 / EMBEDDED R&D", "Embedded Systems & HMI", "Research, experiments and prototypes are part of my applied engineering expertise, not just future product ideas.",
  `<div class="cols">${cards([
     ["ESP32-S3 / LVGL GRAPHICAL INTERFACES", "Implementation and evaluation of LVGL 9.x touchscreen user interfaces; display bring-up using CO5300, SH8601, NV3041A and ST7789 controllers; SPI/QSPI display integration, FT3168 touch and PSRAM constraints.", "UI architecture / display drivers / HMI debugging"],
     ["POWER MANAGEMENT & WIRELESS CONTROL", "ESP32-C6 + ESP-NOW servo-control experiments with wake, transmission and sleep cycles. Evaluated deep-sleep and light-sleep behavior, power consumption, PWM control and responsiveness.", "low-power design / telemetry / measurement"],
     ["MCU PLATFORMS & BOARD BRING-UP", "Experience exploring STM32 and ESP32 alongside RISC-V and Linux-capable boards including Milk-V Duo, LicheeRV Nano and RK3506-based hardware. Evaluated peripheral capabilities and development workflows.", "platform evaluation / firmware integration"],
     ["EDGE HARDWARE & PCB ARCHITECTURE", "Design investigation of connected microcontroller boards with CAN, RS-485, Ethernet, digital I/O and sensor interfaces; experience considering board layout, interoperability and physical integration.", "schematics / interface selection / prototyping"]])}</div>`);

page("09 / SYSTEMS R&D", "Linux, Networks & Diagnostics", "Hands-on system integration, debugging, protocol analysis and real-device experimentation.",
  `<div class="cols">${cards([
     ["LINUX / OPENWRT NETWORKING", "Configured and investigated OpenWrt gateways, virtualized routers, IPv4 routing, LAN bridges, Tailscale subnet routing, Cloudflare Tunnel and remote management workflows.", "networking / firewall logic / remote access"],
     ["SINGLE-BOARD COMPUTERS & SERVICES", "Raspberry Pi and embedded Linux platform investigations: storage and boot planning, SSH, services, Docker-based workflows and device-oriented Linux automation.", "Linux administration / Bash / systems integration"],
     ["AUTOMOTIVE CAN BUS & DIAGNOSTICS", "Practical Toyota Prius hybrid-battery repair and diagnostic work with CANable V2, Python-CAN, ECU request/response traffic, battery-block voltage and regeneration/load measurements.", "CAN / diagnostics / data interpretation / hardware repair"],
     ["DESKTOP & DEVICE INTEGRATION", "Experience solving hardware/software integration problems across Linux and Windows, including device interfaces, remote desktop, printing services, USB, serial tools and firmware processes.", "troubleshooting / integration / automation"]])}</div>`);

page("10 / COMPUTE R&D", "Local AI & GPU Engineering", "Applied investigations that developed demonstrable technical knowledge in model deployment and heterogeneous computing.",
  `<div class="cols">${cards([
     ["LOCAL LLM DEPLOYMENT", "Hands-on operation and testing of coding and general-purpose local models, including GGUF quantized deployments. Compared model quality, quantization, memory footprint and latency trade-offs.", "inference deployment / benchmarking / evaluation"],
     ["AMD ROCm / MEMORY MANAGEMENT", "Troubleshot ROCm model-loading behavior on an AMD unified-memory system, including mmap versus mlock loading, memory limits and model residency. Documented successful tool-call tests in personal experiments.", "ROCm / runtime debugging / memory profiling"],
     ["MULTI-GPU / EXPERT PLACEMENT", "Explored NVIDIA and AMD compute configurations, GPU VRAM limits, CPU/GPU offload, MoE active-expert placement, partitioning and the potential impact on inference throughput.", "hardware-aware optimization / performance analysis"],
     ["AI-ASSISTED ENGINEERING WORKFLOWS", "Experimented with local coding assistants, tool-calling reliability, scripting, Git-based workflows and repeatable technical checks for embedded and software development.", "developer tooling / validation / agent workflows"]])}</div>`);

page("11 / COLLABORATION", "Building real systems.",
  "I work across the boundary of hardware and software: from embedded interfaces, sensing and communication to PC utilities, websites, Android applications, troubleshooting tools and physical product prototypes.",
  `<h3>RELEVANT ROLES</h3><ul class="roles"><li>Embedded Systems Engineer / Firmware Developer</li><li>Electronics &amp; PCB Designer / IoT &amp; Automation Developer</li><li>Hardware–Software Integration Engineer</li><li>Web &amp; Android Application Developer</li></ul>
   <h3>TECHNOLOGY</h3><p>C · C++ · C# (WinForms, WPF) · Qt · GTK · Swift · Python · Bash · Kotlin · Jetpack Compose · Rust / Slint · HTML/CSS/JS · Cloudflare · STM32 · ESP32 · Linux · KiCad · Altium · Modbus · CAN · LVGL</p>
   <h3>CONTACT</h3><p>${esc(contactEmail)} · viteh.org</p>
   <p class="note">This portfolio documents the visible part of the work done since 2014; there were more projects, including internal and tooling work that is not shown. It was first compiled in 2023 from project archives and original photographs, and updated in 2026 with recent work. Historical products, current prototypes and ongoing R&amp;D are identified separately. Images are from the supplied project archive unless otherwise noted.</p>`);

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
  <img src="img/hero-unit.jpg" alt="Touchscreen control unit"></section>`;
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
    writeFileSync(join(root, `tools/portfolio/img/${file}.jpg`), Buffer.from(shot.data, "base64"));
    console.log(`tools/portfolio/img/${file}.jpg`);
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
