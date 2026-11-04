// Scene -> GLB. Parts are written once and placed many times as glTF nodes (instancing), which keeps detailed boards small.
import { encodePng } from "./png.mjs";
import { Part } from "./geo.mjs";

const pad4 = (n) => (n + 3) & ~3;
const hexToLinear = (hex) => {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
};
const rgb = (hex) => hexToLinear(hex);

/** PBR material library. Names are a contract: "accent" is recoloured by assets/gallery3d.js from the theme. */
export const materialDefs = (accent) => ({
  accent: { pbrMetallicRoughness: { baseColorFactor: [...rgb(accent), 1], metallicFactor: 0.0, roughnessFactor: 0.36 } },
  accentMetal: { pbrMetallicRoughness: { baseColorFactor: [...rgb(accent), 1], metallicFactor: 0.55, roughnessFactor: 0.32 } },
  plastic: { pbrMetallicRoughness: { baseColorFactor: [...rgb("#1a1f1d"), 1], metallicFactor: 0.0, roughnessFactor: 0.52 } },
  plasticLight: { pbrMetallicRoughness: { baseColorFactor: [...rgb("#dfe5e1"), 1], metallicFactor: 0.0, roughnessFactor: 0.6 } },
  graphite: { pbrMetallicRoughness: { baseColorFactor: [...rgb("#2a3330"), 1], metallicFactor: 0.0, roughnessFactor: 0.62 } },
  rubber: { pbrMetallicRoughness: { baseColorFactor: [...rgb("#101412"), 1], metallicFactor: 0.0, roughnessFactor: 0.85 } },
  chrome: { pbrMetallicRoughness: { baseColorFactor: [...rgb("#d7dad9"), 1], metallicFactor: 1.0, roughnessFactor: 0.22 } },
  steel: { pbrMetallicRoughness: { baseColorFactor: [...rgb("#a9afad"), 1], metallicFactor: 1.0, roughnessFactor: 0.42 } },
  tin: { pbrMetallicRoughness: { baseColorFactor: [...rgb("#bfc4c2"), 1], metallicFactor: 1.0, roughnessFactor: 0.34 } },
  gold: { pbrMetallicRoughness: { baseColorFactor: [...rgb("#e0b24a"), 1], metallicFactor: 1.0, roughnessFactor: 0.30 } },
  copper: { pbrMetallicRoughness: { baseColorFactor: [...rgb("#c27a4a"), 1], metallicFactor: 1.0, roughnessFactor: 0.38 } },
  alu: { pbrMetallicRoughness: { baseColorFactor: [...rgb("#c9cdcc"), 1], metallicFactor: 1.0, roughnessFactor: 0.5 } },
  ceramic: { pbrMetallicRoughness: { baseColorFactor: [...rgb("#9b7f55"), 1], metallicFactor: 0.0, roughnessFactor: 0.55 } },
  warm: { pbrMetallicRoughness: { baseColorFactor: [...rgb("#c7782f"), 1], metallicFactor: 0.0, roughnessFactor: 0.45 } },
  terminal: { pbrMetallicRoughness: { baseColorFactor: [...rgb("#2f6a52"), 1], metallicFactor: 0.0, roughnessFactor: 0.5 } },
  glass: { pbrMetallicRoughness: { baseColorFactor: [...rgb("#06100e"), 1], metallicFactor: 0.0, roughnessFactor: 0.08 } },
  ledGreen: { pbrMetallicRoughness: { baseColorFactor: [...rgb("#37c96e"), 1], metallicFactor: 0, roughnessFactor: 0.3 }, emissiveFactor: [0.15, 0.95, 0.4] },
  ledAmber: { pbrMetallicRoughness: { baseColorFactor: [...rgb("#f0a030"), 1], metallicFactor: 0, roughnessFactor: 0.3 }, emissiveFactor: [1, 0.55, 0.08] },
  ledRed: { pbrMetallicRoughness: { baseColorFactor: [...rgb("#e04a3a"), 1], metallicFactor: 0, roughnessFactor: 0.3 }, emissiveFactor: [1, 0.12, 0.08] },
  glow: { pbrMetallicRoughness: { baseColorFactor: [...rgb("#7ee0c6"), 1], metallicFactor: 0, roughnessFactor: 0.4 }, emissiveFactor: [0.12, 0.55, 0.46] },
  glowIndigo: { pbrMetallicRoughness: { baseColorFactor: [...rgb("#8c9cff"), 1], metallicFactor: 0, roughnessFactor: 0.4 }, emissiveFactor: [0.45, 0.52, 1] },
  indigo: { pbrMetallicRoughness: { baseColorFactor: [...rgb("#5b6fe0"), 1], metallicFactor: 0.2, roughnessFactor: 0.3 } },
  amber: { pbrMetallicRoughness: { baseColorFactor: [...rgb("#f0a65a"), 1], metallicFactor: 0.2, roughnessFactor: 0.35 } },
  // textured materials (see Scene.texture): the texture name is given in `tex`
  accentTex: { tex: "pcbMask", pbrMetallicRoughness: { baseColorFactor: [...rgb(accent), 1], metallicFactor: 0.0, roughnessFactor: 0.30 } },
  silk: { tex: "pcbSilk", alphaMode: "MASK", alphaCutoff: 0.5, doubleSided: false, pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 0.7 } },
  screenCronos: { tex: "screenCronos", emissiveTex: true, emissiveFactor: [1, 1, 1], pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 0.2 } },
  screenLaptop: { tex: "screenLaptop", emissiveTex: true, emissiveFactor: [1, 1, 1], pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 0.2 } },
  screenToyota: { tex: "screenToyota", emissiveTex: true, emissiveFactor: [1, 1, 1], pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 0.18 } },
  wireYellow: { pbrMetallicRoughness: { baseColorFactor: [...rgb("#e6c229"), 1], metallicFactor: 0, roughnessFactor: 0.55 } },
  wireGreen: { pbrMetallicRoughness: { baseColorFactor: [...rgb("#2f9e4f"), 1], metallicFactor: 0, roughnessFactor: 0.55 } },
  wireRed: { pbrMetallicRoughness: { baseColorFactor: [...rgb("#c9382c"), 1], metallicFactor: 0, roughnessFactor: 0.55 } },
  labelCronos: { tex: "labelCronos", pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 0.6 } },
});

const quatFromEuler = ([rx, ry, rz]) => {                    // applied as Y, then X, then Z (all small, human-chosen angles)
  const c = (a) => Math.cos(a / 2), s = (a) => Math.sin(a / 2);
  const qx = [s(rx), 0, 0, c(rx)], qy = [0, s(ry), 0, c(ry)], qz = [0, 0, s(rz), c(rz)];
  const mul = (a, b) => [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
  return mul(mul(qz, qx), qy);
};

export class Scene {
  constructor(accent) { this.accent = accent; this.parts = []; this.nodes = []; this.textures = new Map(); this.defs = materialDefs(accent); this.groups = []; }
  /** Runs fn with every instance placed inside a translated / Y-rotated / scaled frame (boards reused inside enclosures). */
  group({ at = [0, 0, 0], ry = 0, s = 1 }, fn) { this.groups.push({ at, ry, s }); try { fn(); } finally { this.groups.pop(); } }
  part(name) { const p = new Part(name); this.parts.push(p); return p; }
  texture(name, raster, opts = {}) { this.textures.set(name, { png: encodePng(raster, opts), ...opts }); }
  /** Places a part. rot = [rx, ry, rz] radians, s = uniform scale or [sx, sy, sz]. */
  inst(part, { at = [0, 0, 0], rot = [0, 0, 0], s = 1, quat = null } = {}) {
    let pos = at, ry = rot[1], scale = Array.isArray(s) ? s : [s, s, s];
    for (let i = this.groups.length - 1; i >= 0; i--) {              // innermost frame first
      const g = this.groups[i], c = Math.cos(g.ry), sn = Math.sin(g.ry);
      pos = [g.at[0] + g.s * (pos[0] * c + pos[2] * sn), g.at[1] + g.s * pos[1], g.at[2] + g.s * (-pos[0] * sn + pos[2] * c)];
      ry += g.ry; scale = scale.map((v) => v * g.s);
      if (quat) throw new Error("quaternion instances cannot live inside a rotated group");
    }
    this.nodes.push({ part, at: pos, rot: [rot[0], ry, rot[2]], s: scale, quat });
    return this;
  }

  toGlb() {
    const used = this.parts.filter((p) => this.nodes.some((n) => n.part === p) && [...p.geos.values()].some((g) => g.idx.length));
    const matNames = [...new Set(used.flatMap((p) => [...p.geos.values()].filter((g) => g.idx.length).map((g) => g.material)))];
    for (const m of matNames) if (!this.defs[m]) throw new Error(`unknown material ${m}`);
    const chunks = [], bufferViews = [], accessors = [];
    let offset = 0;
    const push = (bytes, target) => {
      const padded = new Uint8Array(pad4(bytes.length)); padded.set(bytes);
      chunks.push(padded);
      bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, ...(target ? { target } : {}) });
      offset += padded.length;
      return bufferViews.length - 1;
    };
    const f32 = (arr) => new Uint8Array(new Float32Array(arr).buffer);

    const textureNames = [...new Set(matNames.map((m) => this.defs[m].tex).filter(Boolean))];
    const images = [], textures = [], samplers = [{ magFilter: 9729, minFilter: 9987, wrapS: 33071, wrapT: 33071 }];
    for (const t of textureNames) {
      const entry = this.textures.get(t);
      if (!entry) throw new Error(`missing texture ${t}`);
      images.push({ bufferView: push(new Uint8Array(entry.png)), mimeType: "image/png", name: t });
      textures.push({ source: images.length - 1, sampler: 0, name: t });
    }

    const meshes = used.map((part) => {
      const primitives = [];
      for (const g of part.geos.values()) {
        if (!g.idx.length) continue;
        if (g.pos.length / 3 > 65535) throw new Error(`part ${part.name}: more than 65535 vertices in one primitive`);
        const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
        for (let i = 0; i < g.pos.length; i += 3) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], g.pos[i + k]); max[k] = Math.max(max[k], g.pos[i + k]); }
        const attributes = {};
        accessors.push({ bufferView: push(f32(g.pos), 34962), componentType: 5126, count: g.pos.length / 3, type: "VEC3", min, max }); attributes.POSITION = accessors.length - 1;
        accessors.push({ bufferView: push(f32(g.nor), 34962), componentType: 5126, count: g.nor.length / 3, type: "VEC3" }); attributes.NORMAL = accessors.length - 1;
        if (g.uv) { accessors.push({ bufferView: push(f32(g.tex), 34962), componentType: 5126, count: g.tex.length / 2, type: "VEC2" }); attributes.TEXCOORD_0 = accessors.length - 1; }
        accessors.push({ bufferView: push(new Uint8Array(new Uint16Array(g.idx).buffer), 34963), componentType: 5123, count: g.idx.length, type: "SCALAR" });
        primitives.push({ attributes, indices: accessors.length - 1, material: matNames.indexOf(g.material) });
      }
      return { name: part.name, primitives };
    });

    const materials = matNames.map((name) => {
      const d = this.defs[name];
      const m = { name, pbrMetallicRoughness: { ...d.pbrMetallicRoughness } };
      if (d.tex) m.pbrMetallicRoughness.baseColorTexture = { index: textureNames.indexOf(d.tex) };
      if (d.emissiveFactor) m.emissiveFactor = d.emissiveFactor;
      if (d.emissiveTex) m.emissiveTexture = { index: textureNames.indexOf(d.tex) };
      if (d.alphaMode) { m.alphaMode = d.alphaMode; m.alphaCutoff = d.alphaCutoff; }
      return m;
    });

    const nodes = [{ name: "model", children: this.nodes.map((_, i) => i + 1) }];
    for (const n of this.nodes) {
      const node = { mesh: used.indexOf(n.part), name: n.part.name };
      if (n.at.some((v) => v)) node.translation = n.at.map((v) => +v.toFixed(5));
      if (n.quat) node.rotation = n.quat.map((v) => +v.toFixed(6));
      else if (n.rot.some((v) => v)) node.rotation = quatFromEuler(n.rot).map((v) => +v.toFixed(6));
      if (n.s.some((v) => v !== 1)) node.scale = n.s;
      if (node.mesh >= 0) nodes.push(node); else nodes.push({ name: n.part.name });
    }
    const json = {
      asset: { version: "2.0", generator: "viteh tools/make-models.mjs" },
      scene: 0, scenes: [{ nodes: [0] }], nodes, meshes, materials,
      ...(images.length ? { images, textures, samplers } : {}),
      buffers: [{ byteLength: offset }], bufferViews, accessors,
    };
    const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
    const jsonPadded = new Uint8Array(pad4(jsonBytes.length)).fill(0x20); jsonPadded.set(jsonBytes);
    const bin = new Uint8Array(offset); let at = 0;
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
}
