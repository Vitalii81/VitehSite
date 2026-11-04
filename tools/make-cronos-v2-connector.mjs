// Replaces the round connector of the latest controller model with a rectangular 3 x 4 pin connector in the lower right of the end face.
//   node tools/make-cronos-v2-connector.mjs
// Input : tools/sources/cronos-controller-v2.original.glb (the untouched export from the owner's Blender project, kept as the source).
// Output: assets/models/cronos-controller-v2.glb: the round "core" is dropped from the scene, the "ring" node becomes a rectangular plastic housing (a generated
//         unit box) and the twelve gold pins are re-seated in three rows of four, 3 mm apart, 14 mm right of the centre line and 9 mm above the underside.
//         Deterministic: the same input gives the same bytes.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(root, "tools/sources/cronos-controller-v2.original.glb"));
const jsonLen = src.readUInt32LE(12);
const json = JSON.parse(src.subarray(20, 20 + jsonLen).toString("utf8"));
let bin = Buffer.from(src.subarray(20 + jsonLen + 8, 20 + jsonLen + 8 + src.readUInt32LE(20 + jsonLen)));

const CX = 14, CY = 9, PITCH = 3, FACE_Z = 59, DEPTH = 2.6, W = 16, H = 12, PIN_Z = 60.9;          // millimetres
const node = (name) => json.nodes.find((n) => n.name === name);

/* ---------- a unit box mesh (positions, normals, indices), appended to the binary buffer ---------- */
const P = [], N = [], I = [];
const faces = [[[1, 0, 0], [[.5, -.5, -.5], [.5, .5, -.5], [.5, .5, .5], [.5, -.5, .5]]], [[-1, 0, 0], [[-.5, -.5, .5], [-.5, .5, .5], [-.5, .5, -.5], [-.5, -.5, -.5]]],
  [[0, 1, 0], [[-.5, .5, -.5], [-.5, .5, .5], [.5, .5, .5], [.5, .5, -.5]]], [[0, -1, 0], [[-.5, -.5, .5], [-.5, -.5, -.5], [.5, -.5, -.5], [.5, -.5, .5]]],
  [[0, 0, 1], [[-.5, -.5, .5], [.5, -.5, .5], [.5, .5, .5], [-.5, .5, .5]]], [[0, 0, -1], [[.5, -.5, -.5], [-.5, -.5, -.5], [-.5, .5, -.5], [.5, .5, -.5]]]];
faces.forEach(([n, quad], f) => { quad.forEach((v) => { P.push(...v); N.push(...n); }); I.push(f * 4, f * 4 + 1, f * 4 + 2, f * 4, f * 4 + 2, f * 4 + 3); });
const pad = () => { while (bin.length % 4) bin = Buffer.concat([bin, Buffer.alloc(1)]); };
const add = (bytes, target) => { pad(); const off = bin.length; bin = Buffer.concat([bin, bytes]); json.bufferViews.push({ buffer: 0, byteOffset: off, byteLength: bytes.length, target }); return json.bufferViews.length - 1; };
const f32 = (a) => Buffer.from(new Float32Array(a).buffer), u16 = (a) => Buffer.from(new Uint16Array(a).buffer);
const acc = (bufferView, componentType, count, type, extra = {}) => { json.accessors.push({ bufferView, componentType, count, type, ...extra }); return json.accessors.length - 1; };
const aPos = acc(add(f32(P), 34962), 5126, 24, "VEC3", { min: [-.5, -.5, -.5], max: [.5, .5, .5] });
const aNor = acc(add(f32(N), 34962), 5126, 24, "VEC3");
const aUv = acc(add(f32(new Array(48).fill(0)), 34962), 5126, 24, "VEC2");
const aIdx = acc(add(u16(I), 34963), 5123, 36, "SCALAR");
const ring = node("ring");
const material = json.meshes[ring.mesh].primitives[0].material;                                      // plastic_dark
json.meshes.push({ name: "connector-housing", primitives: [{ attributes: { POSITION: aPos, NORMAL: aNor, TEXCOORD_0: aUv }, indices: aIdx, material }] });

/* ---------- rewire the nodes ---------- */
const scene = json.scenes[0];
scene.nodes = scene.nodes.filter((i) => json.nodes[i].name !== "core");                              // the round body is gone
ring.mesh = json.meshes.length - 1;
delete ring.rotation;
ring.scale = [W / 1000, H / 1000, DEPTH / 1000];
ring.translation = [CX / 1000, CY / 1000, (FACE_Z + DEPTH / 2) / 1000];
ring.name = "connector-housing";
for (let i = 0; i < 12; i++) {                                                                       // three rows of four, in parallel
  const pin = node(`pin${i}`), col = i % 4, row = Math.floor(i / 4);
  pin.translation = [(CX + (col - 1.5) * PITCH) / 1000, (CY + (row - 1) * PITCH) / 1000, PIN_Z / 1000];
}
pad();
json.buffers[0].byteLength = bin.length;

let js = Buffer.from(JSON.stringify(json), "utf8");
while (js.length % 4) js = Buffer.concat([js, Buffer.from(" ")]);
const head = Buffer.alloc(12); head.write("glTF", 0, "ascii"); head.writeUInt32LE(2, 4);
const jh = Buffer.alloc(8); jh.writeUInt32LE(js.length, 0); jh.write("JSON", 4, "ascii");
const bh = Buffer.alloc(8); bh.writeUInt32LE(bin.length, 0); bh.write("BIN\0", 4, "ascii");
const out = Buffer.concat([head, jh, js, bh, bin]); out.writeUInt32LE(out.length, 8);
writeFileSync(join(root, "assets/models/cronos-controller-v2.glb"), out);
console.log(`assets/models/cronos-controller-v2.glb  ${(out.length / 1024).toFixed(1)} KB`);
