// Procedural glTF 2.0 (GLB) generator for the 3D gallery. No dependencies:  node tools/make-models.mjs [accent]
// Writes the file named by the "model" field of every product (data/products.json) and service (services.items in data/site.json)
// that has a builder in tools/models/models.mjs. The material named "accent" (and "accentTex") is recoloured by assets/gallery3d.js from the theme.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Scene } from "./models/gltf.mjs";
import { MODEL_BUILDERS } from "./models/models.mjs";

export { MODEL_BUILDERS };
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export const accentFromCss = () => /--accent:\s*(#[0-9a-fA-F]{6})/.exec(readFileSync(join(root, "assets/styles.css"), "utf8"))?.[1] ?? "#1c8a74";

/** draw(scene) fills a Scene; returns the finished GLB bytes. */
export function buildGlb(draw, accent = accentFromCss()) {
  const scene = new Scene(accent);
  draw(scene);
  return scene.toGlb();
}

/** Every {id, model} the generator should write, from products and services. */
export function modelTargets() {
  const products = JSON.parse(readFileSync(join(root, "data/products.json"), "utf8"));
  const site = JSON.parse(readFileSync(join(root, "data/site.json"), "utf8"));
  const out = products.filter((p) => p.model).map((p) => ({ id: p.id, model: p.model }));
  (site.services?.items || []).forEach((s) => { if (s.model) out.push({ id: s.id || s.model.replace(/^assets\/models\/|\.glb$/g, ""), model: s.model }); });
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const accent = process.argv[2] ?? accentFromCss();
  mkdirSync(join(root, "assets/models"), { recursive: true });
  for (const { id, model } of modelTargets()) {
    const name = model.replace(/^assets\/models\/|\.glb$/g, "");
    const draw = MODEL_BUILDERS[id] || MODEL_BUILDERS[name];
    if (!draw) { console.log(`skip ${model}: no procedural builder (use a real GLB)`); continue; }
    const glb = buildGlb(draw, accent);
    writeFileSync(join(root, model), glb);
    console.log(`${model}  ${(glb.length / 1024).toFixed(1)} KB`);
  }
}
