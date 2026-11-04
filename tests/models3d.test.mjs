// Deep checks of the procedural models: valid glTF structure, finite geometry, budgets, determinism, textures, and the posters/env files.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MODEL_BUILDERS, buildGlb, modelTargets } from "../tools/make-models.mjs";
import { posterUrl, isAccent, BASE_ATTRS } from "../assets/viewer-settings.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const BUDGET = 600 * 1024;

function parse(glb) {
  const view = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
  const jsonLen = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + jsonLen)));
  const binAt = 20 + jsonLen;
  const bin = glb.subarray(binAt + 8, binAt + 8 + view.getUint32(binAt, true));
  return { json, bin };
}

const pngSize = (bytes) => { const b = Buffer.from(bytes); assert.equal(b.subarray(0, 8).toString("hex"), "89504e470d0a1a0a"); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };

// Models exported from the owner's Blender projects: committed as-is, not produced by tools/make-models.mjs.
const IMPORTED = ["cronos-controller-v1", "cronos-controller-v2"];

test("every model target has a builder or is a listed imported model, and the builders cover products and services", () => {
  const targets = modelTargets();
  assert.ok(targets.length >= 7);
  for (const { id, model } of targets) {
    const name = model.replace(/^assets\/models\/|\.glb$/g, "");
    assert.ok(MODEL_BUILDERS[id] || MODEL_BUILDERS[name] || IMPORTED.includes(name), `${id} has no builder`);
  }
  for (const name of ["service-software", "service-electronics", "service-ai"]) assert.ok(MODEL_BUILDERS[name], name);
});

for (const [name, draw] of Object.entries(MODEL_BUILDERS)) {
  test(`model ${name}: valid structure, finite and in-range geometry, unit normals, budget`, () => {
    const glb = buildGlb(draw, "#1c8a74");
    assert.ok(glb.length < BUDGET, `${(glb.length / 1024).toFixed(0)} KB over budget`);
    const { json, bin } = parse(glb);
    assert.equal(json.asset.version, "2.0");
    assert.equal(json.buffers[0].byteLength, bin.length);
    for (const bv of json.bufferViews) assert.ok(bv.byteOffset + bv.byteLength <= bin.length, "bufferView inside the buffer");
    let triangles = 0;
    for (const mesh of json.meshes) for (const prim of mesh.primitives) {
      const pos = json.accessors[prim.attributes.POSITION], nor = json.accessors[prim.attributes.NORMAL], idx = json.accessors[prim.indices];
      assert.equal(pos.count, nor.count);
      const f32 = (acc) => { const bv = json.bufferViews[acc.bufferView]; return new Float32Array(bin.buffer.slice(bin.byteOffset + bv.byteOffset, bin.byteOffset + bv.byteOffset + bv.byteLength)); };
      const P = f32(pos), N = f32(nor);
      const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < pos.count; i++) {
        for (let k = 0; k < 3; k++) { assert.ok(Number.isFinite(P[3 * i + k]) && Number.isFinite(N[3 * i + k]), "finite"); lo[k] = Math.min(lo[k], P[3 * i + k]); hi[k] = Math.max(hi[k], P[3 * i + k]); }
        assert.ok(Math.abs(Math.hypot(N[3 * i], N[3 * i + 1], N[3 * i + 2]) - 1) < 1e-3, "unit normal");
      }
      assert.deepEqual(pos.min.map((v) => +v.toFixed(4)), lo.map((v) => +v.toFixed(4)), "POSITION.min");
      assert.deepEqual(pos.max.map((v) => +v.toFixed(4)), hi.map((v) => +v.toFixed(4)), "POSITION.max");
      const ibv = json.bufferViews[idx.bufferView];
      const I = new Uint16Array(bin.buffer.slice(bin.byteOffset + ibv.byteOffset, bin.byteOffset + ibv.byteOffset + ibv.byteLength));
      assert.ok(I.every((v) => v < pos.count), "indices in range");
      assert.equal(idx.count % 3, 0);
      triangles += idx.count / 3;
      if (prim.attributes.TEXCOORD_0 !== undefined) assert.equal(json.accessors[prim.attributes.TEXCOORD_0].count, pos.count, "UV count");
      assert.ok(prim.material >= 0 && prim.material < json.materials.length);
    }
    assert.ok(triangles > 400, `${name}: only ${triangles} triangles, too plain`);
    assert.ok(json.materials.some((m) => isAccent(m.name)), "recolourable accent material");
    const root_ = json.nodes[0];
    assert.equal(root_.children.length, json.nodes.length - 1);
    for (const node of json.nodes.slice(1)) assert.ok(node.mesh === undefined || node.mesh < json.meshes.length);
    assert.ok(json.nodes.length > json.meshes.length, "instancing: more nodes than meshes");
    for (const t of json.textures || []) { const img = json.images[t.source]; const bv = json.bufferViews[img.bufferView]; assert.equal(img.mimeType, "image/png"); const [w, h] = pngSize(bin.subarray(bv.byteOffset, bv.byteOffset + bv.byteLength)); assert.ok(w <= 1024 && h <= 1024 && w >= 64); }
  });
}

for (const name of IMPORTED) {
  test(`imported model ${name}: valid GLB, unit-scaled nodes, normals, UVs, small, no external references`, () => {
    const glb = readFileSync(join(root, `assets/models/${name}.glb`));
    assert.ok(glb.length < 300 * 1024, "weight budget");
    const { json, bin } = parse(new Uint8Array(glb));
    assert.equal(json.asset.version, "2.0");
    assert.equal(json.buffers[0].byteLength, bin.length);
    assert.ok(json.meshes.length >= 5 && json.materials.length >= 4);
    for (const m of json.meshes) for (const prim of m.primitives) {
      assert.ok(prim.attributes.NORMAL !== undefined && prim.attributes.TEXCOORD_0 !== undefined, "normals and UVs");
      assert.ok(prim.material >= 0 && prim.material < json.materials.length);
      const pos = json.accessors[prim.attributes.POSITION];
      assert.ok(pos.min.every(Number.isFinite) && pos.max.every(Number.isFinite), "finite bounds");
    }
    for (const n of json.nodes) if (n.scale) assert.ok(n.scale.every((v) => Math.abs(Math.abs(v) - 0.001) < 1e-6), "millimetres to metres");
    for (const x of [...(json.buffers || []), ...(json.images || [])]) assert.ok(!x.uri || x.uri.startsWith("data:"), "no external file references");
    for (const x of json.extensionsUsed || []) assert.ok(["EXT_texture_webp"].includes(x), `extension ${x} not in the allow-list`);
  });
}

test("models are deterministic: the same code always writes byte-identical files", () => {
  for (const name of ["custom-electronics", "service-ai"]) {
    const a = buildGlb(MODEL_BUILDERS[name], "#1c8a74"), b = buildGlb(MODEL_BUILDERS[name], "#1c8a74");
    assert.ok(Buffer.from(a).equals(Buffer.from(b)), name);
  }
});

test("the committed models match the generator output", () => {
  for (const { id, model } of modelTargets()) {
    const name = model.replace(/^assets\/models\/|\.glb$/g, "");
    const draw = MODEL_BUILDERS[id] || MODEL_BUILDERS[name];
    if (!draw) continue;
    const committed = readFileSync(join(root, model));
    const accent = /--accent:\s*(#[0-9a-fA-F]{6})/.exec(readFileSync(join(root, "assets/styles.css"), "utf8"))[1];
    assert.ok(Buffer.from(buildGlb(draw, accent)).equals(committed), `${model} is stale: run node tools/make-models.mjs`);
  }
});

test("accent colour is a material factor, so the theme can recolour it (no baked colour in textures)", () => {
  const a = parse(buildGlb(MODEL_BUILDERS["custom-electronics"], "#1c8a74")).json, b = parse(buildGlb(MODEL_BUILDERS["custom-electronics"], "#4cc9ad")).json;
  const factor = (j) => j.materials.find((m) => m.name === "accentTex").pbrMetallicRoughness.baseColorFactor.join();
  assert.notEqual(factor(a), factor(b));
});

test("posters exist for every model that names one, in both themes, small and WebP", () => {
  for (const item of [...JSON.parse(readFileSync(join(root, "data/products.json"), "utf8")), ...JSON.parse(readFileSync(join(root, "data/site.json"), "utf8")).services.items]) {
    if (!item.model) continue;
    assert.ok(item.poster, `${item.model} has no poster`);
    for (const dark of [false, true]) {
      const url = posterUrl(item.poster, dark);
      assert.ok(url && existsSync(join(root, url)), `missing ${url}`);
      const bytes = readFileSync(join(root, url));
      assert.equal(bytes.subarray(0, 4).toString(), "RIFF"); assert.equal(bytes.subarray(8, 12).toString(), "WEBP");
      assert.ok(bytes.length < 60 * 1024, `${url} is ${bytes.length} bytes`);
    }
  }
});

test("posterUrl accepts only assets/posters/<name> bases", () => {
  assert.equal(posterUrl("assets/posters/x-y", true), "assets/posters/x-y-dark.webp");
  assert.equal(posterUrl("assets/posters/x", false), "assets/posters/x-light.webp");
  for (const bad of ["https://evil/x", "assets/posters/../x", "/assets/posters/x", "assets/other/x", "", null, undefined]) assert.equal(posterUrl(bad, false), null, String(bad));
});

test("studio environment map: a valid Radiance HDR of reasonable size, with licence/origin noted", () => {
  const bytes = readFileSync(join(root, "assets/env/studio.hdr"));
  assert.ok(bytes.subarray(0, 10).toString("latin1").startsWith("#?RADIANCE"));
  assert.ok(bytes.length < 120 * 1024);
  assert.match(readFileSync(join(root, "assets/vendor/README.md"), "utf8"), /studio\.hdr/);
  assert.ok(statSync(join(root, "assets/env")).isDirectory());
});

test("viewer settings keep the camera inside sane limits and never reference a third-party host", () => {
  assert.ok(!JSON.stringify(BASE_ATTRS).includes("http"));
  assert.match(BASE_ATTRS["max-camera-orbit"], /98deg/);
  assert.equal(BASE_ATTRS["tone-mapping"], "neutral");
});

test("PNG textures inside models decode (zlib stream is valid)", () => {
  const { json, bin } = parse(buildGlb(MODEL_BUILDERS["custom-electronics"], "#1c8a74"));
  for (const img of json.images) {
    const bv = json.bufferViews[img.bufferView], png = Buffer.from(bin.subarray(bv.byteOffset, bv.byteOffset + bv.byteLength));
    let off = 8; const idat = [];
    while (off < png.length) { const len = png.readUInt32BE(off), type = png.subarray(off + 4, off + 8).toString(); if (type === "IDAT") idat.push(png.subarray(off + 8, off + 8 + len)); off += 12 + len; }
    const raw = inflateSync(Buffer.concat(idat));
    const [w, h] = [png.readUInt32BE(16), png.readUInt32BE(20)], channels = png[25] === 6 ? 4 : 3;
    assert.equal(raw.length, (w * channels + 1) * h);
  }
});
