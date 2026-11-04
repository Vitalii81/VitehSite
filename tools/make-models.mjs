// Procedural glTF 2.0 (GLB) generator for the 3D gallery. No dependencies:  node tools/make-models.mjs
// Writes assets/models/<product-id>.glb for products that have a "model" field in data/products.json.
// Material "accent" is recoloured at runtime from the theme (--accent), so the default colour here only matters as a fallback.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/* ---------- colour helpers ---------- */
const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const hexToLinear = (hex) => {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => srgbToLinear(v / 255));
};
const accentFromCss = () => {
  const css = readFileSync(join(root, "assets/styles.css"), "utf8");
  return /--accent:\s*(#[0-9a-fA-F]{6})/.exec(css)?.[1] ?? "#1c8a74";
};

/* ---------- geometry builder: triangles grouped per material ---------- */
class Mesh {
  constructor() { this.groups = new Map(); }
  group(material) {
    if (!this.groups.has(material)) this.groups.set(material, { pos: [], nor: [], idx: [] });
    return this.groups.get(material);
  }
  /** Adds a quad (4 vertices, counter-clockwise seen from the normal side). */
  quad(material, a, b, c, d, n) {
    const g = this.group(material);
    const base = g.pos.length / 3;
    for (const p of [a, b, c, d]) { g.pos.push(...p); g.nor.push(...n); }
    g.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  box(material, [cx, cy, cz], [sx, sy, sz]) {
    const x = sx / 2, y = sy / 2, z = sz / 2;
    const P = (i, j, k) => [cx + i * x, cy + j * y, cz + k * z];
    this.quad(material, P(-1, -1, 1), P(1, -1, 1), P(1, 1, 1), P(-1, 1, 1), [0, 0, 1]);
    this.quad(material, P(1, -1, -1), P(-1, -1, -1), P(-1, 1, -1), P(1, 1, -1), [0, 0, -1]);
    this.quad(material, P(1, -1, 1), P(1, -1, -1), P(1, 1, -1), P(1, 1, 1), [1, 0, 0]);
    this.quad(material, P(-1, -1, -1), P(-1, -1, 1), P(-1, 1, 1), P(-1, 1, -1), [-1, 0, 0]);
    this.quad(material, P(-1, 1, 1), P(1, 1, 1), P(1, 1, -1), P(-1, 1, -1), [0, 1, 0]);
    this.quad(material, P(-1, -1, -1), P(1, -1, -1), P(1, -1, 1), P(-1, -1, 1), [0, -1, 0]);
  }
  /** Cylinder around the given axis ("x" | "y" | "z"); c = centre, caps are flat, side normals are smooth. */
  cylinder(material, c, r, h, axis = "y", seg = 28) {
    const rot = { y: (v) => v, z: ([x, y, z]) => [x, -z, y], x: ([x, y, z]) => [y, -x, z] }[axis];
    const put = (v) => { const [x, y, z] = rot(v); return [c[0] + x, c[1] + y, c[2] + z]; };
    const dir = (v) => rot(v);
    const g = this.group(material);
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      const [x0, z0, x1, z1] = [Math.cos(a0), Math.sin(a0), Math.cos(a1), Math.sin(a1)];
      const base = g.pos.length / 3;
      const verts = [[r * x0, -h / 2, r * z0, x0, 0, z0], [r * x1, -h / 2, r * z1, x1, 0, z1], [r * x1, h / 2, r * z1, x1, 0, z1], [r * x0, h / 2, r * z0, x0, 0, z0]];
      for (const v of verts) { g.pos.push(...put(v)); g.nor.push(...dir([v[3], v[4], v[5]])); }
      g.idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
      for (const [sign, ny] of [[1, 1], [-1, -1]]) {
        const cb = g.pos.length / 3;
        for (const v of [[0, sign * h / 2, 0], [r * x0, sign * h / 2, r * z0], [r * x1, sign * h / 2, r * z1]]) { g.pos.push(...put(v)); g.nor.push(...dir([0, ny, 0])); }
        if (sign > 0) g.idx.push(cb, cb + 2, cb + 1); else g.idx.push(cb, cb + 1, cb + 2);
      }
    }
  }
  /** Upper hemisphere (dome) or full sphere. */
  sphere(material, c, r, { half = false, seg = 24, rings = 12 } = {}) {
    const g = this.group(material);
    const maxPhi = half ? Math.PI / 2 : Math.PI;
    for (let j = 0; j < rings; j++) {
      for (let i = 0; i < seg; i++) {
        const base = g.pos.length / 3;
        for (const [dj, di] of [[0, 0], [0, 1], [1, 1], [1, 0]]) {
          const phi = ((j + dj) / rings) * maxPhi, th = ((i + di) / seg) * Math.PI * 2;
          const n = [Math.cos(th) * Math.sin(phi), Math.cos(phi), Math.sin(th) * Math.sin(phi)];
          g.pos.push(c[0] + r * n[0], c[1] + r * n[1], c[2] + r * n[2]); g.nor.push(...n);
        }
        g.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
    }
  }
}

/* ---------- materials (names are part of the contract with assets/gallery3d.js) ---------- */
const materials = (accent) => ({
  accent: { name: "accent", pbrMetallicRoughness: { baseColorFactor: [...hexToLinear(accent), 1], metallicFactor: 0.15, roughnessFactor: 0.5 } },
  dark: { name: "dark", pbrMetallicRoughness: { baseColorFactor: [0.018, 0.026, 0.024, 1], metallicFactor: 0.2, roughnessFactor: 0.55 } },
  graphite: { name: "graphite", pbrMetallicRoughness: { baseColorFactor: [0.045, 0.06, 0.056, 1], metallicFactor: 0.1, roughnessFactor: 0.6 } },
  metal: { name: "metal", pbrMetallicRoughness: { baseColorFactor: [0.72, 0.74, 0.73, 1], metallicFactor: 1, roughnessFactor: 0.32 } },
  light: { name: "light", pbrMetallicRoughness: { baseColorFactor: [0.72, 0.75, 0.73, 1], metallicFactor: 0, roughnessFactor: 0.7 } },
  warm: { name: "warm", pbrMetallicRoughness: { baseColorFactor: [0.7, 0.28, 0.06, 1], metallicFactor: 0.1, roughnessFactor: 0.45 } },
  screen: { name: "screen", pbrMetallicRoughness: { baseColorFactor: [0.01, 0.03, 0.03, 1], metallicFactor: 0, roughnessFactor: 0.25 }, emissiveFactor: [0.05, 0.4, 0.33] },
  ledGreen: { name: "ledGreen", pbrMetallicRoughness: { baseColorFactor: [0.05, 0.4, 0.2, 1], metallicFactor: 0, roughnessFactor: 0.4 }, emissiveFactor: [0.1, 0.9, 0.35] },
  ledAmber: { name: "ledAmber", pbrMetallicRoughness: { baseColorFactor: [0.5, 0.3, 0.05, 1], metallicFactor: 0, roughnessFactor: 0.4 }, emissiveFactor: [0.95, 0.55, 0.08] },
});

/* ---------- the three models ---------- */
const pcb = (m) => {
  m.box("accent", [0, 0, 0], [8, 0.16, 5.6]);
  for (const [x, z] of [[-3.6, -2.4], [3.6, -2.4], [-3.6, 2.4], [3.6, 2.4]]) m.cylinder("dark", [x, 0.085, z], 0.17, 0.02);
  // main MCU with pins on all four sides
  m.box("dark", [-1.5, 0.2, 0.1], [1.7, 0.24, 1.7]);
  for (let i = 0; i < 8; i++) {
    const o = -0.75 + i * 0.215;
    m.box("metal", [-1.5 + o, 0.1, 0.1 - 1.0], [0.12, 0.05, 0.3]); m.box("metal", [-1.5 + o, 0.1, 0.1 + 1.0], [0.12, 0.05, 0.3]);
    m.box("metal", [-1.5 - 1.0, 0.1, 0.1 + o], [0.3, 0.05, 0.12]); m.box("metal", [-1.5 + 1.0, 0.1, 0.1 + o], [0.3, 0.05, 0.12]);
  }
  m.box("dark", [1.3, 0.16, -0.7], [1.2, 0.16, 0.8]);
  m.box("metal", [1.3, 0.14, 1.0], [0.9, 0.14, 0.5]);                       // crystal
  m.box("metal", [3.3, 0.36, -1.2], [1.5, 0.56, 1.2]);                      // USB connector
  m.box("dark", [3.3, 0.36, -1.2], [1.1, 0.3, 0.9]);
  m.box("graphite", [-0.2, 0.2, -2.3], [3.4, 0.26, 0.28]);                  // header
  for (let i = 0; i < 12; i++) m.box("metal", [-1.75 + i * 0.27, 0.45, -2.3], [0.08, 0.5, 0.08]);
  m.cylinder("warm", [2.6, 0.38, 1.6], 0.24, 0.5); m.cylinder("warm", [3.2, 0.38, 1.6], 0.24, 0.5);
  m.cylinder("light", [-3.0, 0.3, 1.8], 0.2, 0.34);
  for (let i = 0; i < 6; i++) m.box("dark", [-0.2 + i * 0.4, 0.14, 1.9], [0.3, 0.08, 0.16]);
  for (const [cx, cz, sx, sz] of [[-1.5, -1.4, 0.05, 1.0], [0.2, -0.9, 3.4, 0.05], [1.3, 0.2, 0.05, 1.8], [-0.5, 1.2, 2.2, 0.05], [2.3, -1.2, 1.5, 0.05]]) m.box("light", [cx, 0.09, cz], [sx, 0.01, sz]);
};

const controller = (m) => {
  m.box("graphite", [0, 0, -0.35], [7.2, 5.6, 3.5]);                        // body
  m.box("accent", [0, 0, 1.45], [6.8, 5.2, 0.16]);                          // front plate
  m.box("screen", [-1.4, 1.2, 1.56], [3.2, 1.6, 0.06]);                     // display
  m.box("dark", [-1.4, 1.2, 1.52], [3.4, 1.8, 0.04]);
  for (const [i, mat] of ["ledGreen", "ledAmber", "ledGreen"].entries()) m.cylinder(mat, [1.1 + i * 0.5, 1.9, 1.56], 0.13, 0.08, "z");
  for (let i = 0; i < 4; i++) m.cylinder("light", [-2.4 + i * 1.0, -0.3, 1.58], 0.28, 0.12, "z");
  m.box("light", [0, -1.5, 1.54], [5.2, 0.9, 0.04]);                         // label
  m.box("dark", [0, -1.5, 1.57], [4.8, 0.08, 0.02]); m.box("dark", [0, -1.3, 1.57], [3.4, 0.08, 0.02]);
  for (let i = 0; i < 5; i++) {
    const x = -2.8 + i * 1.4;
    m.box("light", [x, 3.1, -0.2], [1.0, 0.7, 1.7]); m.cylinder("metal", [x, 3.1, 0.7], 0.2, 0.12, "z");
    m.box("light", [x, -3.1, -0.2], [1.0, 0.7, 1.7]); m.cylinder("metal", [x, -3.1, 0.7], 0.2, 0.12, "z");
  }
  m.box("metal", [0, -2.5, -2.2], [3.0, 0.5, 0.2]);                          // DIN clip
};

const sensor = (m) => {
  m.box("graphite", [0, -1.15, 0], [3.6, 0.2, 1.8]);                        // bracket
  for (const x of [-1.4, 1.4]) m.cylinder("metal", [x, -1.03, 0], 0.16, 0.12);
  m.cylinder("dark", [0, -0.6, 0], 1.45, 0.7);
  m.cylinder("accent", [0, 0.5, 0], 1.3, 1.5);
  m.sphere("accent", [0, 1.25, 0], 1.3, { half: true });
  m.cylinder("metal", [0, -0.12, 0], 1.38, 0.12);                           // ring
  m.cylinder("dark", [0, 0.55, 1.28], 0.52, 0.12, "z"); m.cylinder("screen", [0, 0.55, 1.35], 0.34, 0.05, "z");
  m.cylinder("ledGreen", [0.85, -0.2, 1.32], 0.08, 0.06, "z");
  m.cylinder("dark", [1.2, 1.2, 0], 0.09, 2.4); m.sphere("warm", [1.2, 2.45, 0], 0.14, { seg: 12, rings: 8 });
  m.cylinder("dark", [-1.55, -0.6, 0], 0.2, 0.5, "x");                       // cable gland
};

const BUILDERS = { "cronos-controller": controller, "custom-electronics": pcb, "sensor-node": sensor };

/* ---------- GLB writer ---------- */
const pad4 = (n) => (n + 3) & ~3;

export function buildGlb(draw, accent) {
  const mesh = new Mesh();
  draw(mesh);
  const defs = materials(accent);
  const names = [...mesh.groups.keys()];
  const chunks = [];
  const bufferViews = [], accessors = [], primitives = [];
  let offset = 0;
  const push = (typed, target) => {
    const bytes = new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength);
    const padded = new Uint8Array(pad4(bytes.length));
    padded.set(bytes);
    chunks.push(padded);
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, target });
    offset += padded.length;
    return bufferViews.length - 1;
  };
  for (const name of names) {
    const g = mesh.groups.get(name);
    const pos = new Float32Array(g.pos), nor = new Float32Array(g.nor), idx = new Uint16Array(g.idx);
    if (g.pos.length / 3 > 65535) throw new Error(`Too many vertices for ${name}`);
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], pos[i + k]); max[k] = Math.max(max[k], pos[i + k]); }
    accessors.push({ bufferView: push(pos, 34962), componentType: 5126, count: pos.length / 3, type: "VEC3", min, max });
    accessors.push({ bufferView: push(nor, 34962), componentType: 5126, count: nor.length / 3, type: "VEC3" });
    accessors.push({ bufferView: push(idx, 34963), componentType: 5123, count: idx.length, type: "SCALAR" });
    primitives.push({ attributes: { POSITION: accessors.length - 3, NORMAL: accessors.length - 2 }, indices: accessors.length - 1, material: names.indexOf(name) });
  }
  const json = {
    asset: { version: "2.0", generator: "viteh tools/make-models.mjs" },
    scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name: "model" }],
    meshes: [{ primitives }],
    materials: names.map((n) => defs[n]),
    buffers: [{ byteLength: offset }], bufferViews, accessors,
  };
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonPadded = new Uint8Array(pad4(jsonBytes.length)).fill(0x20);
  jsonPadded.set(jsonBytes);
  const bin = new Uint8Array(offset);
  let at = 0;
  for (const c of chunks) { bin.set(c, at); at += c.length; }
  const total = 12 + 8 + jsonPadded.length + 8 + bin.length;
  const out = new DataView(new ArrayBuffer(total));
  out.setUint32(0, 0x46546c67, true); out.setUint32(4, 2, true); out.setUint32(8, total, true);
  out.setUint32(12, jsonPadded.length, true); out.setUint32(16, 0x4e4f534a, true);
  new Uint8Array(out.buffer).set(jsonPadded, 20);
  const binAt = 20 + jsonPadded.length;
  out.setUint32(binAt, bin.length, true); out.setUint32(binAt + 4, 0x004e4942, true);
  new Uint8Array(out.buffer).set(bin, binAt + 8);
  return new Uint8Array(out.buffer);
}

export const MODEL_BUILDERS = BUILDERS;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const accent = process.argv[2] ?? accentFromCss();
  const products = JSON.parse(readFileSync(join(root, "data/products.json"), "utf8"));
  mkdirSync(join(root, "assets/models"), { recursive: true });
  for (const product of products.filter((p) => p.model)) {
    const draw = BUILDERS[product.id];
    if (!draw) { console.log(`skip ${product.id}: no procedural builder (use a real GLB)`); continue; }
    const file = join(root, product.model);
    const glb = buildGlb(draw, accent);
    writeFileSync(file, glb);
    console.log(`${product.model}  ${(glb.length / 1024).toFixed(1)} KB`);
  }
}
