// Run with: node --test   (from the repository root; also picks up worker/contact.test.mjs)
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { modelFor, pickActive, canAutoLoad, label } from "../assets/gallery3d.js";
import { buildGlb, MODEL_BUILDERS } from "../tools/make-models.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("modelFor accepts only same-origin GLB files under assets/models/", () => {
  assert.equal(modelFor({ model: "assets/models/pcb.glb" }), "assets/models/pcb.glb");
  assert.equal(modelFor({ model: "assets/models/my-model_1.v2.glb" }), "assets/models/my-model_1.v2.glb");
  for (const bad of ["https://evil.example/x.glb", "//evil.example/x.glb", "/assets/models/x.glb", "assets/models/../../x.glb",
    "assets/models/x.gltf", "assets/other/x.glb", "javascript:alert(1)", "", null, undefined, 42]) {
    assert.equal(modelFor({ model: bad }), null, String(bad));
  }
  assert.equal(modelFor(undefined), null);
  assert.equal(modelFor({}), null);
});

test("pickActive: nothing is active while no card is visible enough", () => {
  assert.equal(pickActive([]), null);
  assert.equal(pickActive([{ id: "a", ratio: 0.3, order: 0 }, { id: "b", ratio: 0, order: 1 }]), null);
});

test("pickActive: the most visible card wins, ties go to the earlier card", () => {
  const items = [{ id: "a", ratio: 0.6, order: 0 }, { id: "b", ratio: 0.9, order: 1 }, { id: "c", ratio: 0.9, order: 2 }];
  assert.equal(pickActive(items), "b");
  assert.equal(pickActive([{ id: "x", ratio: 1, order: 5 }, { id: "y", ratio: 1, order: 2 }]), "y");
});

test("pickActive returns at most one id (a single live scene)", () => {
  const items = Array.from({ length: 6 }, (_, i) => ({ id: `p${i}`, ratio: 1, order: i }));
  assert.equal(typeof pickActive(items), "string");
});

test("pickActive: hover or focus preference beats visibility, but only for a visible card", () => {
  const items = [{ id: "a", ratio: 1, order: 0 }, { id: "b", ratio: 0.3, order: 1 }, { id: "c", ratio: 0.05, order: 2 }];
  assert.equal(pickActive(items, { prefer: "b" }), "b");
  assert.equal(pickActive(items, { prefer: "c" }), "a");        // scrolled out: preference ignored
  assert.equal(pickActive(items, { prefer: "missing" }), "a");
});

test("pickActive: hysteresis keeps the current card unless another is clearly more visible", () => {
  const items = [{ id: "a", ratio: 0.7, order: 0 }, { id: "b", ratio: 0.85, order: 1 }];
  assert.equal(pickActive(items, { current: "a" }), "a");       // 0.15 < margin 0.2
  assert.equal(pickActive([{ id: "a", ratio: 0.6, order: 0 }, { id: "b", ratio: 1, order: 1 }], { current: "a" }), "b");
  assert.equal(pickActive([{ id: "a", ratio: 0.2, order: 0 }, { id: "b", ratio: 0.7, order: 1 }], { current: "a" }), "b");   // current left the view
});

test("canAutoLoad: lazy loading is skipped without WebGL, with Data Saver or on 2G", () => {
  assert.equal(canAutoLoad(), true);
  assert.equal(canAutoLoad({ webgl: false }), false);
  assert.equal(canAutoLoad({ saveData: true }), false);
  assert.equal(canAutoLoad({ effectiveType: "2g" }), false);
  assert.equal(canAutoLoad({ effectiveType: "slow-2g" }), false);
  assert.equal(canAutoLoad({ effectiveType: "3g" }), true);
  assert.equal(canAutoLoad({ effectiveType: "4g" }), true);
});

test("label: picks the current language and falls back to English", () => {
  const ui = { gallery3d: { open: { uk: "Крутити в 3D", en: "View in 3D", de: "In 3D ansehen" }, only: { en: "Only English" } } };
  assert.equal(label(ui, "open", "uk"), "Крутити в 3D");
  assert.equal(label(ui, "open", "de"), "In 3D ansehen");
  assert.equal(label(ui, "open", "fr"), "View in 3D");
  assert.equal(label(ui, "only", "de"), "Only English");
  assert.equal(label(ui, "missing", "de"), "");
  assert.equal(label(null, "open", "de"), "");
});

test("site.json has every gallery label in uk, en and de", () => {
  const ui = JSON.parse(readFileSync(join(root, "data/site.json"), "utf8")).ui;
  for (const key of ["badge", "open", "close", "hint", "loading", "unavailable"]) {
    for (const lang of ["uk", "en", "de"]) assert.ok(label(ui, key, lang).length > 0, `${key}.${lang}`);
  }
});

test("products.json: every model path is accepted by modelFor and the file exists below 300 KB", () => {
  const products = JSON.parse(readFileSync(join(root, "data/products.json"), "utf8"));
  const withModel = products.filter((p) => p.model);
  assert.ok(withModel.length >= 3);
  for (const p of withModel) {
    assert.equal(modelFor(p), p.model, p.id);
    assert.ok(statSync(join(root, p.model)).size < 300 * 1024, `${p.id} is larger than 300 KB`);
  }
});

test("generated GLB files are valid glTF 2.0 containers with a recolourable accent material", () => {
  for (const [id, draw] of Object.entries(MODEL_BUILDERS)) {
    const glb = buildGlb(draw, "#1c8a74");
    const view = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
    assert.equal(view.getUint32(0, true), 0x46546c67, "magic glTF");
    assert.equal(view.getUint32(4, true), 2, "version");
    assert.equal(view.getUint32(8, true), glb.length, "declared length");
    const jsonLen = view.getUint32(12, true);
    assert.equal(view.getUint32(16, true), 0x4e4f534a, "JSON chunk");
    const json = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + jsonLen)));
    assert.equal(json.asset.version, "2.0");
    assert.ok(json.materials.some((m) => m.name === "accent"), `${id}: accent material`);
    const binAt = 20 + jsonLen;
    assert.equal(view.getUint32(binAt + 4, true), 0x004e4942, "BIN chunk");
    assert.equal(json.buffers[0].byteLength, view.getUint32(binAt, true), "buffer length");
    for (const a of json.accessors) {
      const bv = json.bufferViews[a.bufferView];
      assert.ok(bv.byteOffset % 4 === 0 && bv.byteOffset + bv.byteLength <= json.buffers[0].byteLength, "bufferView inside buffer");
    }
    assert.ok(glb.length < 300 * 1024, `${id} < 300 KB`);
  }
});
