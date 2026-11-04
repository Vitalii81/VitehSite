// Lights up the display of the first controller model (assets/models/cronos-controller-v1.glb): three 4-digit seven-segment indicators.
//   node tools/make-cronos-v1-display.mjs
// Input : tools/sources/cronos-controller-v1.original.glb (the untouched export from the owner's Blender project, kept as the source).
// Output: assets/models/cronos-controller-v1.glb = the same model plus a generated PNG texture on the "screen" material (base colour + emissive),
//         and proper UVs for the display face (the original UVs of the glass meshes are degenerate). Deterministic: the same input gives the same bytes.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Raster, encodePng } from "./models/png.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(root, "tools/sources/cronos-controller-v1.original.glb"));
const jsonLen = src.readUInt32LE(12);
const json = JSON.parse(src.subarray(20, 20 + jsonLen).toString("utf8"));
const binStart = 20 + jsonLen + 8;
let bin = Buffer.from(src.subarray(binStart, binStart + src.readUInt32LE(20 + jsonLen)));

/* ---------- texture: dark blue panel, ghost "8888" segments, lit digits ---------- */
const W = 516, H = 716;                                           // display face is 51.6 x 71.5 mm (portrait): u runs across the device, v along it
const r = new Raster(W, H, [4, 10, 22, 255]);
const SEG = { a: [1, 0, 0], b: [2, 0, 1], c: [2, 1, 1], d: [1, 2, 0], e: [0, 1, 1], f: [0, 0, 1], g: [1, 1, 0] };   // [col, row, vertical?] on a 3x3 grid
const DIGITS = { 0: "abcdef", 1: "bc", 2: "abdeg", 3: "abcdg", 4: "bcfg", 5: "acdfg", 6: "acdefg", 7: "abc", 8: "abcdefg", 9: "abcdfg" };
function digit(ch, x, y, w, h, on, off, glow) {
  const t = Math.round(w * 0.16), lit = DIGITS[ch] ?? "";
  const rect = (name) => { const [c, rw, v] = SEG[name]; return v ? [x + (c === 2 ? w - t : 0), y + (rw === 0 ? t * 0.6 : h / 2 + t * 0.2), t, h / 2 - t * 0.8] : [x + t * 0.8, y + (rw === 0 ? 0 : rw === 1 ? h / 2 - t / 2 : h - t), w - t * 1.6, t]; };
  for (const name of Object.keys(SEG)) {
    const [rx, ry, rw, rh] = rect(name), isOn = lit.includes(name);
    if (isOn) for (let k = 3; k >= 1; k--) r.rect(rx - k * 3, ry - k * 3, rw + k * 6, rh + k * 6, [...glow, 26]);   // soft halo
    r.rect(rx, ry, rw, rh, isOn ? on : off);
  }
}
const rows = [["0410", [120, 235, 255]], ["0500", [120, 235, 255]], ["0000", [255, 190, 90]]];
const dw = 96, dh = 150, gap = 20, rowH = 210, left = (W - (4 * dw + 3 * gap)) / 2;
rows.forEach(([text, color], i) => {
  const y = 36 + i * rowH + 18;
  r.rect(left - 18, y - 12, 4 * dw + 3 * gap + 36, dh + 24, [8, 20, 40, 255]);
  [...text].forEach((ch, k) => { const x = left + k * (dw + gap); digit(8, x, y, dw, dh, [10, 28, 50, 255], [10, 28, 50, 255], color); digit(ch, x, y, dw, dh, [...color, 255], [10, 28, 50, 255], color); });
  r.disc(left + 4 * dw + 3 * gap + 6, y + dh - 6, 5, [...color, 255]);                                      // decimal point of the last digit
});
r.rect(0, 0, 3, 3, [4, 10, 22, 255]);                                                                         // texel (0,0): the dark fill used by every non-display vertex
const png = encodePng(r, { opaque: true });

/* ---------- UVs: the flat top of each display glass slab gets a planar map, everything else samples the dark texel ---------- */
const accessor = (i) => json.accessors[i];
const view = (a) => { const bv = json.bufferViews[a.bufferView]; return (bv.byteOffset || 0) + (a.byteOffset || 0); };
let faces = 0;
json.meshes.forEach((mesh) => mesh.primitives.forEach((p) => {
  if (json.materials[p.material].name !== "screen") return;
  const pos = accessor(p.attributes.POSITION), uv = accessor(p.attributes.TEXCOORD_0);
  const po = view(pos), uo = view(uv);
  const x0 = pos.min[0], x1 = pos.max[0], z0 = pos.min[2], z1 = pos.max[2], face = pos.min[1] + 0.05;                  // the node is rotated 180 degrees about X, so the face the viewer sees is the low-y one
  for (let i = 0; i < pos.count; i++) {
    const x = bin.readFloatLE(po + i * 12), y = bin.readFloatLE(po + i * 12 + 4), z = bin.readFloatLE(po + i * 12 + 8);
    const isFace = y <= face;                                                                                    // the flat viewer-facing side of each glass slab (the outer one is what the eye sees)
    const u = isFace ? 1 - (x - x0) / (x1 - x0) : 0.001, v = isFace ? 1 - (z - z0) / (z1 - z0) : 0.001;                 // flip u/v here if the digits ever come out mirrored
    bin.writeFloatLE(Math.min(Math.max(u, 0.002), 0.998), uo + i * 8); bin.writeFloatLE(Math.min(Math.max(v, 0.002), 0.998), uo + i * 8 + 4);
    if (isFace) faces++;
  }
}));

/* ---------- append the PNG, wire the material ---------- */
while (bin.length % 4) bin = Buffer.concat([bin, Buffer.alloc(1)]);
const offset = bin.length;
bin = Buffer.concat([bin, png]);
while (bin.length % 4) bin = Buffer.concat([bin, Buffer.alloc(1)]);
json.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: png.length });
json.images = [...(json.images || []), { bufferView: json.bufferViews.length - 1, mimeType: "image/png", name: "display-v1" }];
json.samplers = [{ magFilter: 9729, minFilter: 9987, wrapS: 33071, wrapT: 33071 }];
json.textures = [...(json.textures || []), { source: json.images.length - 1, sampler: 0 }];
const tex = { index: json.textures.length - 1 };
const mat = json.materials.find((m) => m.name === "screen");
mat.pbrMetallicRoughness = { baseColorFactor: [1, 1, 1, 1], baseColorTexture: tex, metallicFactor: 0, roughnessFactor: 0.12 };
mat.emissiveTexture = tex; mat.emissiveFactor = [1, 1, 1];
json.buffers[0].byteLength = bin.length;

let js = Buffer.from(JSON.stringify(json), "utf8");
while (js.length % 4) js = Buffer.concat([js, Buffer.from(" ")]);
const head = Buffer.alloc(12); head.write("glTF", 0, "ascii"); head.writeUInt32LE(2, 4);
const jh = Buffer.alloc(8); jh.writeUInt32LE(js.length, 0); jh.write("JSON", 4, "ascii");
const bh = Buffer.alloc(8); bh.writeUInt32LE(bin.length, 0); bh.write("BIN\0", 4, "ascii");
const out = Buffer.concat([head, jh, js, bh, bin]); out.writeUInt32LE(out.length, 8);
writeFileSync(join(root, "assets/models/cronos-controller-v1.glb"), out);
console.log(`assets/models/cronos-controller-v1.glb  ${(out.length / 1024).toFixed(1)} KB, texture ${(png.length / 1024).toFixed(1)} KB, ${faces} display-face vertices`);
