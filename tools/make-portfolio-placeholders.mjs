// Generates a clearly marked placeholder image for every slot of the project archive (data/portfolio-images.json).
//   node tools/make-portfolio-placeholders.mjs [--chrome /path/to/chrome]
// Output: tools/portfolio/placeholders/<slug>/<slot>.webp and .jpg (git-ignored, never deployed). They are used by
// `node tools/make-portfolio.mjs --slots` and by the site preview `index.html?slots`. Final images live in assets/portfolio/<slug>/<slot>.webp.
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { launchChrome, sizeFor } from "./lib/headless.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const manifest = JSON.parse(readFileSync(join(root, "data/portfolio-images.json"), "utf8"));
const b = await launchChrome({ chrome: args.includes("--chrome") ? args[args.indexOf("--chrome") + 1] : null });
let n = 0;
for (const m of manifest) {
  const [w, h] = sizeFor(m.ratio);
  const draw = `(() => { const c = document.createElement("canvas"); c.width = ${w}; c.height = ${h}; const x = c.getContext("2d");
    const g = x.createLinearGradient(0, 0, ${w}, ${h}); g.addColorStop(0, "#3a4658"); g.addColorStop(1, "#1f2733"); x.fillStyle = g; x.fillRect(0, 0, ${w}, ${h});
    x.strokeStyle = "#b3261e"; x.lineWidth = 6; x.setLineDash([24, 14]); x.strokeRect(10, 10, ${w - 20}, ${h - 20});
    x.fillStyle = "#fff"; x.textAlign = "center"; x.font = "700 ${Math.round(w / 12)}px sans-serif"; x.fillText("PLACEHOLDER", ${w / 2}, ${h / 2 - 8});
    x.font = "${Math.round(w / 28)}px monospace"; x.fillStyle = "#cbd5e1"; x.fillText(${JSON.stringify(`${m.slug} / ${m.slot}`)}, ${w / 2}, ${h / 2 + w / 16});
    x.fillText(${JSON.stringify(`${w}x${h}  ${m.ratio}`)}, ${w / 2}, ${h / 2 + w / 9});
    return [c.toDataURL("image/webp", 0.8), c.toDataURL("image/jpeg", 0.8)]; })()`;
  const [webp, jpg] = await b.evaluate(draw);
  const dir = join(root, "tools/portfolio/placeholders", m.slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${m.slot}.webp`), Buffer.from(webp.split(",")[1], "base64"));
  writeFileSync(join(dir, `${m.slot}.jpg`), Buffer.from(jpg.split(",")[1], "base64"));
  n++;
}
b.close();
console.log(`${n} placeholders in tools/portfolio/placeholders/`);
