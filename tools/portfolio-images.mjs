// Puts the owner's finished pictures into the project archive with one command.
//   node tools/portfolio-images.mjs <folder> [--chrome /path] [--dry-run]
// A picture is matched to a slot by (1) <folder>/<slug>/<slot>.<jpg|png|webp>, (2) <folder>/<slug>-<slot>.<ext>, (3) the file name of the slot's
// "source_hint" in data/portfolio-images.json (searched anywhere under <folder>). Each match is centre-cropped when its proportions are within 15 % of
// the slot ratio (otherwise it is rejected: crop it yourself), scaled to at most 1200 px wide and compressed to WebP (+ JPEG fallback) of at most 200 KB.
// The files go to assets/portfolio/<slug>/<slot>.webp and .jpg and the manifest entry becomes "final".
// Privacy is the owner's final check: crop photos to the device, no names, addresses, IP/MAC, passwords or contracts, test data only in Windows screenshots.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { launchChrome, sizeFor } from "./lib/headless.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const dry = args.includes("--dry-run");
const chromeArg = args.includes("--chrome") ? args[args.indexOf("--chrome") + 1] : null;
const folder = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--chrome");
if (!folder || !existsSync(folder) || !statSync(folder).isDirectory()) { console.error("usage: node tools/portfolio-images.mjs <folder with pictures> [--dry-run]"); process.exit(2); }
const EXT = [".jpg", ".jpeg", ".png", ".webp"];
const MAX_BYTES = 200 * 1024, TOLERANCE = 0.15;

const walk = (d, out = []) => { for (const n of readdirSync(d)) { const p = join(d, n); statSync(p).isDirectory() ? walk(p, out) : EXT.includes(extname(n).toLowerCase()) && out.push(p); } return out; };
const files = walk(folder);
const manifestPath = join(root, "data/portfolio-images.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const find = (m) => {
  const stem = (p) => basename(p, extname(p)).toLowerCase();
  const rel = (p) => p.slice(folder.length).replace(/^[\\/]/, "").replace(/\\/g, "/").toLowerCase();
  const hint = m.source_hint?.includes("/") ? basename(m.source_hint).toLowerCase() : "";
  return files.find((p) => rel(p).replace(extname(p), "") === `${m.slug}/${m.slot}`) || files.find((p) => stem(p) === `${m.slug}-${m.slot}`)
    || (hint && EXT.some((e) => hint.endsWith(e)) ? files.find((p) => basename(p).toLowerCase() === hint) : null);
};

const b = await launchChrome({ chrome: chromeArg });
let done = 0, rejected = 0; const missing = [];
for (const m of manifest) {
  const src = find(m);
  if (!src) { if (m.status !== "final") missing.push(`${m.slug}/${m.slot}`); continue; }
  const [rw, rh] = sizeFor(m.ratio, 1000), want = rw / rh;
  const mime = { ".png": "image/png", ".webp": "image/webp" }[extname(src).toLowerCase()] || "image/jpeg";
  const url = `data:${mime};base64,${readFileSync(src).toString("base64")}`;
  const r = await b.evaluate(`(async () => {
    const img = new Image(); img.src = ${JSON.stringify(url)}; await img.decode();
    const have = img.naturalWidth / img.naturalHeight, want = ${want};
    if (Math.abs(have - want) / want > ${TOLERANCE}) return { error: "proportions " + have.toFixed(2) + " vs " + want.toFixed(2) };
    let sw = img.naturalWidth, sh = img.naturalHeight, sx = 0, sy = 0;
    if (have > want) { sw = sh * want; sx = (img.naturalWidth - sw) / 2; } else { sh = sw / want; sy = (img.naturalHeight - sh) / 2; }
    let w = Math.min(1200, Math.round(sw)); const enc = async (type, q) => { const h = Math.round(w / want); const c = document.createElement("canvas"); c.width = w; c.height = h;
      c.getContext("2d").drawImage(img, sx, sy, sw, sh, 0, 0, w, h); return c.toDataURL(type, q); };
    const size = (u) => Math.floor((u.length - u.indexOf(",") - 1) * 0.75);
    let out = {}; for (const [k, type] of [["webp", "image/webp"], ["jpg", "image/jpeg"]]) {
      let q = 0.86, w0 = w, u = await enc(type, q);
      while (size(u) > ${MAX_BYTES} && (q > 0.4 || w > 480)) { if (q > 0.4) q -= 0.08; else w = Math.round(w * 0.85); u = await enc(type, q); }
      out[k] = u; out[k + "Size"] = size(u); w = w0; }
    return out; })()`);
  if (r.error || r.webpSize > MAX_BYTES || r.jpgSize > MAX_BYTES) { console.error(`REJECTED ${m.slug}/${m.slot} (${basename(src)}): ${r.error || "still over 200 KB"}`); rejected++; continue; }
  console.log(`${dry ? "would write" : "wrote"} assets/portfolio/${m.slug}/${m.slot}.webp  ${(r.webpSize / 1024).toFixed(0)} KB  (${basename(src)})`);
  if (!dry) {
    const dir = join(root, "assets/portfolio", m.slug); mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${m.slot}.webp`), Buffer.from(r.webp.split(",")[1], "base64"));
    writeFileSync(join(dir, `${m.slot}.jpg`), Buffer.from(r.jpg.split(",")[1], "base64"));
    m.status = "final";
  }
  done++;
}
b.close();
if (!dry && done) writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
console.log(`${done} slot(s) ${dry ? "matched" : "set to final"}, ${rejected} rejected, ${missing.length} still waiting${missing.length ? ": " + missing.join(", ") : ""}`);
console.log("Check privacy before publishing: crop to the device, no names/addresses/IP/MAC/passwords/contracts, test data only.");
process.exit(rejected ? 1 : 0);
