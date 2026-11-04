// The six procedural models of the site: three for projects (Cronos controller, custom board, sensor node) and three for services
// (software, custom electronics, AI agents). Everything is generated: geometry, PBR materials and the small PNG textures.
import { bezier, box, cylinder, disc, lathe, plane, quadUV, roundedBox, sphere, torus, tube } from "./geo.mjs";
import { Raster, rng } from "./png.mjs";
import { makeParts } from "./parts.mjs";

const W = 8, D = 5.6, PPU = 128;                         // board size and texture density (pixels per unit)
const TW = Math.round(W * PPU), TH = Math.round(D * PPU);
const TWO_PI = Math.PI * 2;

/* ---------- shared board layout: used for the 3D parts AND for the silkscreen/trace textures ---------- */
export function boardLayout() {
  const L = { mcu: [-1.5, 0.15], flash: [1.25, -0.8], crystal: [1.3, 0.8], usb: [3.5, -1.2], inductor: [2.6, 0.05] };
  L.headerTop = [-0.2, -2.3];
  L.headerBottom = [-0.2, 2.3];
  L.holes = [[-3.65, -2.45], [3.65, -2.45], [-3.65, 2.45], [3.65, 2.45]];
  L.caps = [[2.55, 1.6], [3.25, 1.6]];
  L.buttons = [[-3.2, 1.7], [-2.45, 1.7]];
  L.leds = [[-3.4, -1.0, "ledGreen"], [-3.4, -0.65, "ledAmber"], [-3.4, -0.3, "ledRed"]];
  L.terminal = [-3.0, -1.85];
  L.resistors = Array.from({ length: 6 }, (_, i) => [-1.7 + i * 0.36, 1.85]);
  L.ceramics = [...Array.from({ length: 5 }, (_, i) => [-2.7 + i * 0.34, -1.4]), [-0.2, 1.05, 1], [0.15, 1.05, 1], [-0.2, -0.95, 1], [0.35, -0.95, 1], [2.1, 1.7, 1]];
  L.testPads = Array.from({ length: 6 }, (_, i) => [0.5 + i * 0.28, 1.15]);
  return L;
}

const px = (x) => ((x + W / 2) / W) * TW;
const pz = (z) => ((z + D / 2) / D) * TH;

function boardTextures(scene, L) {
  const rand = rng(7);
  // solder-mask map: multiplies the theme colour. Traces are slightly darker, copper pour hatching and vias add richness.
  const mask = new Raster(TW, TH, [255, 255, 255, 255]);
  for (let y = -D / 2 + 0.5; y < D / 2 - 0.4; y += 0.075) mask.line(px(-W / 2 + 0.5), pz(y), px(-W / 2 + 1.1), pz(y + 0.075), 1, [244, 244, 244, 255]);
  const trace = (pts, t = 3.2, c = [212, 212, 212, 255]) => { for (let i = 0; i < pts.length - 1; i++) mask.line(px(pts[i][0]), pz(pts[i][1]), px(pts[i + 1][0]), pz(pts[i + 1][1]), t, c); };
  const [mx, mz] = L.mcu;
  for (let i = 0; i < 14; i++) {                              // fan-out from every QFP lead to somewhere plausible
    const off = (i - 6.5) * 0.1, len = 0.35 + rand() * 0.7, drift = (rand() - 0.5) * 0.7;
    trace([[mx + 0.98, mz + off], [mx + 0.98 + len, mz + off], [mx + 0.98 + len + Math.abs(drift), mz + off + drift]]);
    trace([[mx - 0.98, mz + off], [mx - 0.98 - len, mz + off], [mx - 0.98 - len - Math.abs(drift), mz + off - drift]]);
    trace([[mx + off, mz - 0.98], [mx + off, mz - 0.98 - len], [mx + off + drift, mz - 0.98 - len - Math.abs(drift)]]);
    trace([[mx + off, mz + 0.98], [mx + off, mz + 0.98 + len], [mx + off - drift, mz + 0.98 + len + Math.abs(drift)]]);
  }
  for (let i = 0; i < 12; i++) trace([[L.headerTop[0] + (i - 5.5) * 0.254, L.headerTop[1] + 0.2], [L.headerTop[0] + (i - 5.5) * 0.254, L.headerTop[1] + 0.5 + (i % 4) * 0.12], [L.headerTop[0] + (i - 5.5) * 0.254 + (i % 3 - 1) * 0.25, L.headerTop[1] + 0.9 + (i % 5) * 0.08]], 2.6);
  for (let i = 0; i < 4; i++) { const x = L.flash[0] + (i - 1.5) * 0.254; trace([[x, L.flash[1] + 0.5], [x, L.flash[1] + 0.75 + i * 0.05], [L.mcu[0] + 1.1, L.mcu[1] + (i - 1.5) * 0.1 + 0.05]]); }
  trace([[L.usb[0] - 0.5, L.usb[1]], [2.2, L.usb[1]], [2.2, -0.2]], 4.5);
  trace([[L.caps[0][0], 1.2], [L.caps[0][0], 0.3], [L.inductor[0], 0.3]], 5);
  trace([[L.caps[1][0], 1.2], [L.caps[1][0], 0.6], [L.caps[0][0], 0.6]], 5);
  for (let i = 0; i < 90; i++) { const x = (rand() - 0.5) * (W - 1.2), y = (rand() - 0.5) * (D - 1.2); mask.disc(px(x), pz(y), 3.3, [190, 190, 190, 255]); mask.disc(px(x), pz(y), 1.4, [255, 255, 255, 255]); }
  mask.rect(0, 0, mask.w, 2, [255, 255, 255, 255]); mask.rect(0, mask.h - 2, mask.w, 2, [255, 255, 255, 255]); mask.rect(0, 0, 2, mask.h, [255, 255, 255, 255]); mask.rect(mask.w - 2, 0, 2, mask.h, [255, 255, 255, 255]);
  scene.texture("pcbMask", mask, { opaque: true });

  // silkscreen: component outlines, reference designators, pin-1 marks, title. Alpha-masked white.
  const silk = new Raster(TW, TH, [0, 0, 0, 0]);
  const ink = [236, 240, 234, 255], t = 2;
  const outline = (cx, cz, w, d) => silk.frame(px(cx - w / 2), pz(cz - d / 2), w * PPU, d * PPU, t, ink);
  const label = (txt, x, z, s = 2) => silk.text(txt, px(x), pz(z), s, ink);
  outline(L.mcu[0], L.mcu[1], 2.35, 2.35); silk.disc(px(L.mcu[0] - 1.05), pz(L.mcu[1] - 1.05), 4, ink); label("U1", L.mcu[0] - 1.15, L.mcu[1] - 1.45);
  outline(L.flash[0], L.flash[1], 1.5, 1.35); silk.disc(px(L.flash[0] - 0.62), pz(L.flash[1] - 0.55), 3, ink); label("U2", L.flash[0] - 0.7, L.flash[1] - 1.0);
  outline(L.crystal[0], L.crystal[1], 0.95, 0.55); label("Y1", L.crystal[0] - 0.2, L.crystal[1] + 0.4);
  outline(L.usb[0] - 0.1, L.usb[1], 1.35, 1.2); label("J1", L.usb[0] - 0.75, L.usb[1] - 0.95);
  outline(L.headerTop[0], L.headerTop[1], 0.254 * 12 + 0.12, 0.42); label("J2", L.headerTop[0] - 1.6, L.headerTop[1] - 0.45);
  outline(L.headerBottom[0], L.headerBottom[1], 0.254 * 8 + 0.12, 0.42); label("J3", L.headerBottom[0] - 1.1, L.headerBottom[1] + 0.3);
  outline(L.inductor[0], L.inductor[1], 0.75, 0.75); label("L1", L.inductor[0] - 0.2, L.inductor[1] + 0.5);
  L.caps.forEach(([x, z], i) => { silk.ring(px(x), pz(z), 0.42 * PPU, t, ink); label("C" + (i + 1), x - 0.15, z + 0.55); silk.rect(px(x - 0.42), pz(z - 0.02), 0.1 * PPU, 4, ink); });
  L.buttons.forEach(([x, z], i) => { outline(x, z, 0.72, 0.72); label("SW" + (i + 1), x - 0.3, z + 0.5); });
  L.leds.forEach(([x, z], i) => { outline(x, z, 0.34, 0.2); label("D" + (i + 1), x + 0.25, z - 0.06, 2); });
  outline(L.terminal[0], L.terminal[1], 1.15, 0.8); label("T1", L.terminal[0] - 0.2, L.terminal[1] - 0.6);
  L.resistors.forEach(([x, z], i) => { outline(x, z, 0.3, 0.17); if (i % 2 === 0) label("R" + (i + 1), x - 0.12, z + 0.2, 2); });
  L.ceramics.slice(0, 5).forEach(([x, z], i) => { outline(x, z, 0.3, 0.17); if (i % 2 === 1) label("C" + (i + 3), x - 0.12, z - 0.34, 2); });
  label("VITEH CTRL", -1.1, -1.05 + 0.1, 4);
  label("REV 2.1", -1.1, -0.55 + 0.1, 3);
  label("MADE IN UA", 0.3, 2.25 + 0.55, 2);
  L.holes.forEach(([x, z]) => silk.ring(px(x), pz(z), 0.36 * PPU, t, ink));
  scene.texture("pcbSilk", silk);
}

/** The populated board lying on y = 0 with its top at y = 0.16. `detail` < 1 skips the smallest parts for the compact service model. */
export function buildBoard(scene, P, L, { detail = 1 } = {}) {
  boardTextures(scene, L);
  const board = scene.part("board");
  roundedBox(board.geo("accentTex", true), { size: [W, 0.16, D], r: 0.07, n: 2, at: [0, 0.08, 0], uvY: true });
  scene.inst(board);
  const silkPart = scene.part("silk");
  plane(silkPart.geo("silk", true), { w: W, d: D, y: 0.1618, at: [0, 0, 0] });
  scene.inst(silkPart);
  const top = 0.16;
  for (const [x, z] of L.holes) scene.inst(P.hole, { at: [x, top, z] });
  for (const [x, z] of L.testPads) scene.inst(P.pad, { at: [x, top, z] });
  scene.inst(P.qfpBody, { at: [L.mcu[0], top, L.mcu[1]] });
  for (let i = 0; i < 14; i++) {
    const o = (i - 6.5) * 0.1;
    scene.inst(P.qfpLead, { at: [L.mcu[0] + 0.8, top, L.mcu[1] + o] });
    scene.inst(P.qfpLead, { at: [L.mcu[0] - 0.8, top, L.mcu[1] + o], rot: [0, Math.PI, 0] });
    scene.inst(P.qfpLead, { at: [L.mcu[0] + o, top, L.mcu[1] - 0.8], rot: [0, Math.PI / 2, 0] });
    scene.inst(P.qfpLead, { at: [L.mcu[0] + o, top, L.mcu[1] + 0.8], rot: [0, -Math.PI / 2, 0] });
  }
  scene.inst(P.soicBody, { at: [L.flash[0], top, L.flash[1]] });
  for (let i = 0; i < 4; i++) {
    const x = L.flash[0] + (i - 1.5) * 0.254;
    scene.inst(P.soicLead, { at: [x, top, L.flash[1] + 0.45], rot: [0, -Math.PI / 2, 0] });
    scene.inst(P.soicLead, { at: [x, top, L.flash[1] - 0.45], rot: [0, Math.PI / 2, 0] });
  }
  scene.inst(P.crystal, { at: [L.crystal[0], top, L.crystal[1]] });
  scene.inst(P.usb, { at: [L.usb[0], top, L.usb[1]] });
  scene.inst(P.inductor, { at: [L.inductor[0], top, L.inductor[1]] });
  const h12 = P.headerHousing(12), h8 = P.headerHousing(8);
  scene.inst(h12, { at: [L.headerTop[0], top, L.headerTop[1]] });
  scene.inst(h8, { at: [L.headerBottom[0], top, L.headerBottom[1]] });
  for (let i = 0; i < 12; i++) scene.inst(P.headerPin, { at: [L.headerTop[0] + (i - 5.5) * 0.254, top, L.headerTop[1]] });
  for (let i = 0; i < 8; i++) scene.inst(P.headerPin, { at: [L.headerBottom[0] + (i - 3.5) * 0.254, top, L.headerBottom[1]] });
  for (const [x, z] of L.caps) scene.inst(P.electrolytic, { at: [x, top, z] });
  for (const [x, z] of L.buttons) scene.inst(P.button, { at: [x, top, z] });
  for (const [x, z, mat] of L.leds) scene.inst(P.led(mat), { at: [x, top, z] });
  scene.inst(P.terminal(2), { at: [L.terminal[0], top, L.terminal[1]] });
  for (const [x, z] of L.resistors) scene.inst(P.resistor, { at: [x, top, z] });
  for (const [x, z, rot] of L.ceramics) scene.inst(P.capacitor, { at: [x, top, z], rot: [0, rot ? Math.PI / 2 : 0, 0] });
  if (detail >= 1) {
    const r = rng(11);
    for (let i = 0; i < 16; i++) {                              // decoupling parts scattered around the MCU
      const a = (i / 16) * TWO_PI + 0.2, rad = 1.65 + (i % 3) * 0.12;
      scene.inst(i % 2 ? P.resistor : P.capacitor, { at: [L.mcu[0] + Math.cos(a) * rad * 1.15, top, L.mcu[1] + Math.sin(a) * rad], rot: [0, Math.cos(a * 2) > 0 ? 0 : Math.PI / 2, 0] });
    }
    void r;
  }
}

/* ---------- 1. custom board ---------- */
export function customElectronics(scene) {
  const P = makeParts(scene);
  buildBoard(scene, P, boardLayout());
}

/* ---------- 2. sensor node: IP-rated outdoor housing with a cable gland, antenna and LED ring ---------- */
export function sensorNode(scene) {
  const P = makeParts(scene);
  const bracket = scene.part("bracket");
  roundedBox(bracket.geo("steel"), { size: [4.4, 0.22, 2.4], r: 0.09, n: 2, at: [0, 0.11, 0] });
  scene.inst(bracket);
  for (const x of [-1.85, 1.85]) for (const z of [-0.85, 0.85]) scene.inst(P.hole, { at: [x, 0.22, z] });
  const housing = scene.part("housing");
  cylinder(housing.geo("rubber"), { r: 1.52, h: 0.34, bevel: 0.07, seg: 56, at: [0, 0.4, 0] });
  cylinder(housing.geo("accent"), { r: 1.4, h: 1.5, bevel: 0.12, seg: 56, steps: 4, at: [0, 1.32, 0] });
  for (let i = 0; i < 5; i++) torus(housing.geo("accentMetal"), { R: 1.405, t: 0.028, seg: 56, tube: 8, at: [0, 0.85 + i * 0.22, 0] });
  sphere(housing.geo("accent"), { r: 1.4, seg: 56, rings: 20, half: true, scaleY: 0.5, at: [0, 2.07, 0] });
  cylinder(housing.geo("glass"), { r: 0.56, h: 0.07, bevel: 0.015, seg: 40, axis: "z", at: [0, 1.38, 1.4] });
  torus(housing.geo("chrome"), { R: 0.62, t: 0.05, seg: 40, tube: 12, axis: "z", at: [0, 1.38, 1.4] });
  torus(housing.geo("glow"), { R: 0.84, t: 0.032, seg: 48, tube: 8, axis: "z", at: [0, 1.38, 1.36] });
  sphere(housing.geo("ledGreen"), { r: 0.07, seg: 14, rings: 7, half: true, axis: "z", scaleY: 0.6, at: [0.95, 0.72, 1.36] });
  scene.inst(housing);
  const antenna = scene.part("antenna");
  cylinder(antenna.geo("steel"), { r: 0.2, h: 0.26, seg: 6, flat: true, at: [0.75, 2.55, -0.2] });
  cylinder(antenna.geo("rubber"), { r: 0.085, h: 2.1, bevel: 0.04, seg: 20, at: [0.75, 3.6, -0.2] });
  sphere(antenna.geo("rubber"), { r: 0.085, seg: 16, rings: 8, half: true, at: [0.75, 4.65, -0.2] });
  scene.inst(antenna);
  const gland = scene.part("gland");
  cylinder(gland.geo("steel"), { r: 0.34, h: 0.28, seg: 6, flat: true, axis: "x", at: [-1.52, 1.0, 0] });
  cylinder(gland.geo("rubber"), { r: 0.26, h: 0.5, bevel: 0.05, seg: 24, axis: "x", at: [-1.9, 1.0, 0] });
  tube(gland.geo("rubber"), { path: bezier([-2.12, 1.0, 0], [-2.8, 1.0, 0], [-3.0, 0.3, 0.6], [-3.9, 0.17, 1.2], 22), r: 0.13, seg: 14 });
  scene.inst(gland);
}

/* ---------- 4. service: software (laptop with a code editor) ---------- */
function laptopTextures(scene) {
  const s = new Raster(512, 320, [18, 24, 31, 255]);
  const rand = rng(21);
  s.rect(0, 0, 512, 18, [28, 36, 46, 255]);
  ["MAIN.TS", "API.PY", "FORM.JS"].forEach((t, i) => { s.rect(8 + i * 78, 2, 74, 16, i === 0 ? [18, 24, 31, 255] : [34, 44, 56, 255]); s.text(t, 14 + i * 78, 6, 1.4, i === 0 ? [210, 225, 240, 255] : [120, 140, 160, 255]); });
  s.rect(0, 18, 56, 302, [14, 19, 25, 255]);
  for (let i = 0; i < 12; i++) s.rect(10, 34 + i * 18, 24, 4, [60, 76, 92, 255]);
  s.rect(60, 18, 16, 302, [22, 30, 38, 255]);
  const colors = [[140, 156, 255], [76, 201, 173], [240, 166, 90], [210, 225, 240], [240, 120, 130]];
  for (let row = 0; row < 24; row++) {
    const y = 28 + row * 11, indent = [0, 1, 1, 2, 2, 1, 0, 0, 1, 2, 2, 1][row % 12] * 14;
    s.text(String(row + 1), 62, y - 1, 1, [70, 86, 102, 255]);
    let x = 84 + indent;
    for (let k = 0; k < 2 + Math.floor(rand() * 4); k++) { const w = 18 + Math.floor(rand() * 60); s.rect(x, y, w, 5, [...colors[Math.floor(rand() * colors.length)], 255]); x += w + 6; if (x > 420) break; }
  }
  s.rect(76, 28 + 6 * 11 - 2, 360, 11, [40, 60, 90, 90]);
  s.rect(440, 18, 72, 302, [16, 22, 29, 255]); for (let r = 0; r < 40; r++) s.rect(446, 24 + r * 7, 10 + Math.floor(rand() * 50), 2, [70, 96, 120, 255]);
  s.rect(0, 306, 512, 14, [18, 86, 76, 255]); s.text("MAIN  UTF-8  TS", 8, 309, 1, [210, 245, 238, 255]);
  scene.texture("screenLaptop", s, { opaque: true });
}

export function serviceSoftware(scene) {
  laptopTextures(scene);
  const base = scene.part("laptop-base");
  roundedBox(base.geo("alu"), { size: [5.4, 0.24, 3.6], r: 0.12, n: 3, at: [0, 0.12, 0.2] });
  roundedBox(base.geo("graphite"), { size: [4.7, 0.03, 1.95], r: 0.03, n: 1, at: [0, 0.245, -0.2] });
  roundedBox(base.geo("steel"), { size: [1.7, 0.02, 1.0], r: 0.05, n: 2, at: [0, 0.25, 1.45] });
  roundedBox(base.geo("accent"), { size: [1.1, 0.03, 0.06], r: 0.02, n: 1, at: [0, 0.2, 1.98] });          // accent notch on the front edge
  cylinder(base.geo("graphite"), { r: 0.1, h: 4.9, seg: 20, axis: "x", at: [0, 0.26, -1.42] });
  scene.inst(base);
  const key = scene.part("key");
  roundedBox(key.geo("plastic"), { size: [0.31, 0.07, 0.3], r: 0.04, n: 2, at: [0, 0.035, 0] });
  const space = scene.part("space-key");
  roundedBox(space.geo("plastic"), { size: [1.9, 0.07, 0.3], r: 0.04, n: 2, at: [0, 0.035, 0] });
  for (let r = 0; r < 4; r++) for (let c = 0; c < 13; c++) scene.inst(key, { at: [(c - 6) * 0.34, 0.26, -1.02 + r * 0.34] });
  scene.inst(space, { at: [0.4, 0.26, 0.34] });
  for (let c = 0; c < 3; c++) scene.inst(key, { at: [-1.9 + c * 0.34, 0.26, 0.34] });
  const lid = scene.part("laptop-lid");                       // modelled flat around the hinge; the node rotates it open
  roundedBox(lid.geo("alu"), { size: [5.4, 0.16, 3.6], r: 0.1, n: 3, at: [0, 0, 1.85] });
  quadUV(lid.geo("screenLaptop", true), [[-2.5, -0.0865, 0.15], [2.5, -0.0865, 0.15], [2.5, -0.0865, 3.45], [-2.5, -0.0865, 3.45]], [0, -1, 0], [[0, 1], [1, 1], [1, 0], [0, 0]]);
  roundedBox(lid.geo("rubber"), { size: [5.2, 0.012, 3.45], r: 0.02, n: 1, at: [0, -0.078, 1.83] });
  cylinder(lid.geo("accent"), { r: 0.3, h: 0.025, bevel: 0.006, seg: 36, at: [0, 0.088, 1.9] });
  scene.inst(lid, { at: [0, 0.3, -1.42], rot: [-1.83, 0, 0] });
}

/* ---------- 5. service: custom electronics (exploded board + enclosure) ---------- */
export function serviceElectronics(scene) {
  const P = makeParts(scene);
  const L = boardLayout();
  scene.group({ at: [0, 1.05, 0], s: 1 }, () => buildBoard(scene, P, L, { detail: 1 }));
  const tray = scene.part("tray");
  const iw = 10.0, id = 7.2, wall = 0.32, wh = 2.0;
  roundedBox(tray.geo("graphite"), { size: [iw, 0.34, id], r: 0.16, n: 2, at: [0, 0.17, 0] });
  roundedBox(tray.geo("graphite"), { size: [wall, wh, id], r: 0.1, n: 2, at: [-iw / 2 + wall / 2, wh / 2 + 0.17, 0] });
  roundedBox(tray.geo("graphite"), { size: [wall, wh, id], r: 0.1, n: 2, at: [iw / 2 - wall / 2, wh / 2 + 0.17, 0] });
  roundedBox(tray.geo("graphite"), { size: [iw, wh, wall], r: 0.1, n: 2, at: [0, wh / 2 + 0.17, id / 2 - wall / 2] });
  roundedBox(tray.geo("graphite"), { size: [iw, wh, wall], r: 0.1, n: 2, at: [0, wh / 2 + 0.17, -id / 2 + wall / 2] });
  scene.inst(tray);
  const stand = scene.part("standoff");
  cylinder(stand.geo("copper"), { r: 0.2, h: 0.72, seg: 6, flat: true, at: [0, 0.7, 0] });
  for (const [x, z] of L.holes) scene.inst(stand, { at: [x, 0.17, z] });
  for (const [x, z] of L.holes) scene.inst(P.screw, { at: [x, 1.45 + 0.16, z], s: 0.9 });
  const lid = scene.part("lid");
  roundedBox(lid.geo("accent"), { size: [iw, 0.3, id], r: 0.18, n: 3, at: [0, 0, 0] });
  const slot = scene.part("lid-slot");
  roundedBox(slot.geo("rubber"), { size: [1.6, 0.04, 0.12], r: 0.05, n: 1, at: [0, 0, 0] });
  for (let i = 0; i < 7; i++) scene.inst(slot, { at: [1.6, 4.62, -1.8 + i * 0.3], rot: [-0.18, 0.1, 0] });
  const logo = scene.part("lid-logo");
  cylinder(logo.geo("chrome"), { r: 0.55, h: 0.03, bevel: 0.01, seg: 40, at: [0, 0, 0] });
  torus(logo.geo("graphite"), { R: 0.4, t: 0.03, seg: 40, tube: 8, at: [0, 0.02, 0] });
  scene.inst(lid, { at: [0, 4.55, 0], rot: [-0.18, 0.1, 0] });
  scene.inst(logo, { at: [-1.9, 4.75, 0.5], rot: [-0.18, 0.1, 0] });
}

/* ---------- 6. service: AI agents (a core with orbits, satellites and links) ---------- */
const quatBetween = (a, b) => {                              // rotation taking unit vector a to unit vector b
  const c = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  if (d < -0.9999) return [1, 0, 0, 0];
  const q = [c[0], c[1], c[2], 1 + d], l = Math.hypot(...q);
  return q.map((v) => v / l);
};

export function serviceAi(scene) {
  const core = scene.part("core");
  sphere(core.geo("glow"), { r: 0.62, seg: 40, rings: 20 });
  const ring = scene.part("core-ring");
  torus(ring.geo("chrome"), { R: 1.0, t: 0.045, seg: 56, tube: 12 });
  for (const [rx, rz] of [[0, 0], [Math.PI / 2, 0], [0, Math.PI / 2]]) scene.inst(ring, { rot: [rx, 0, rz] });
  scene.inst(core);
  const orbit = scene.part("orbit");
  torus(orbit.geo("steel"), { R: 2.65, t: 0.022, seg: 96, tube: 8 });
  scene.inst(orbit, { rot: [0.0, 0, 0] });
  scene.inst(orbit, { rot: [1.05, 0, 0.35], s: 1 });
  scene.inst(orbit, { rot: [-0.9, 0, -0.6], s: 1 });
  const link = scene.part("link");
  cylinder(link.geo("steel"), { r: 0.035, h: 1, seg: 10, at: [0, 0.5, 0] });
  const mats = ["accent", "indigo", "amber", "glow", "chrome", "accent", "glowIndigo", "amber", "indigo", "accent"];
  const sat = (m, r) => { const p = scene.part(`sat-${m}-${r}`); sphere(p.geo(m), { r, seg: 32, rings: 16 }); return p; };
  const N = 10, pts = [];
  for (let i = 0; i < N; i++) {                              // Fibonacci sphere: evenly spread satellites
    const y = 1 - (i / (N - 1)) * 2, rad = Math.sqrt(1 - y * y), th = i * 2.399963;
    const p = [Math.cos(th) * rad * 2.65, y * 2.2, Math.sin(th) * rad * 2.65];
    pts.push(p);
    scene.inst(sat(mats[i], 0.3 + (i % 3) * 0.07), { at: p });
    const len = Math.hypot(...p), dir = p.map((v) => v / len);
    scene.inst(link, { at: [dir[0] * 0.62, dir[1] * 0.62, dir[2] * 0.62], quat: quatBetween([0, 1, 0], dir), s: [1, len - 1.1, 1] });
    const packet = scene.part("packet"); if (!packet.geos.size) sphere(packet.geo("glow"), { r: 0.075, seg: 12, rings: 6 });
    scene.inst(packet, { at: dir.map((v) => v * (len * (0.38 + (i % 3) * 0.13))) });
  }
  for (let i = 0; i < N; i += 2) {                           // a few satellite-to-satellite links
    const a = pts[i], b = pts[(i + 3) % N];
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], len = Math.hypot(...d), dir = d.map((v) => v / len);
    const thin = scene.part("link-glow"); if (!thin.geos.size) cylinder(thin.geo("glowIndigo"), { r: 0.022, h: 1, seg: 8, at: [0, 0.5, 0] });
    scene.inst(thin, { at: a, quat: quatBetween([0, 1, 0], dir), s: [1, len, 1] });
  }
  const base = scene.part("base");
  cylinder(base.geo("graphite"), { r: 2.5, h: 0.18, bevel: 0.05, seg: 64, at: [0, -2.45, 0] });
  torus(base.geo("glow"), { R: 2.25, t: 0.025, seg: 64, tube: 8, at: [0, -2.35, 0] });
  scene.inst(base);
}

/* ---------- 6. project: IoT module (wireless module with a shielded radio, antenna trace, pads and LEDs) ---------- */
export function iotModule(scene) {
  const P = makeParts(scene);
  const pcb = scene.part("module-pcb");
  roundedBox(pcb.geo("accent"), { size: [4.6, 0.14, 2.8], r: 0.12, n: 2, at: [0, 0.07, 0] });
  roundedBox(pcb.geo("graphite"), { size: [1.5, 0.012, 0.85], r: 0.02, n: 1, at: [1.55, 0.146, 0.0] });          // antenna keep-out
  for (const [x, z] of [[-2.05, -1.15], [2.05, -1.15], [-2.05, 1.15], [2.05, 1.15]]) disc(pcb.geo("gold"), { rOut: 0.1, y: 0.148, seg: 18, at: [x, 0, z] });
  scene.inst(pcb);
  const can = scene.part("shield-can");                                                                       // RF shield: frame, lid and a stamped dimple
  roundedBox(can.geo("steel"), { size: [1.7, 0.3, 1.5], r: 0.05, n: 2, at: [0, 0.29, 0] });
  roundedBox(can.geo("alu"), { size: [1.58, 0.02, 1.38], r: 0.03, n: 1, at: [0, 0.445, 0] });
  disc(can.geo("steel"), { rOut: 0.2, y: 0.458, seg: 28, at: [0, 0, 0] });
  scene.inst(can, { at: [-1.0, 0.14, 0.05] });
  const pad = scene.part("pad");
  roundedBox(pad.geo("gold"), { size: [0.14, 0.02, 0.26], r: 0.02, n: 1, at: [0, 0.01, 0] });
  for (let i = 0; i < 11; i++) for (const z of [-1.24, 1.24]) scene.inst(pad, { at: [-2.0 + i * 0.4, 0.14, z] });
  const bar = scene.part("antenna-bar"), link = scene.part("antenna-link");
  roundedBox(bar.geo("gold"), { size: [0.07, 0.016, 0.62], r: 0.012, n: 1, at: [0, 0.008, 0] });
  roundedBox(link.geo("gold"), { size: [0.3, 0.016, 0.07], r: 0.012, n: 1, at: [0, 0.008, 0] });
  for (let i = 0; i < 5; i++) scene.inst(bar, { at: [0.95 + i * 0.3, 0.147, 0.0 + (i % 2 ? 0.16 : -0.16)] });
  for (let i = 0; i < 4; i++) scene.inst(link, { at: [1.1 + i * 0.3, 0.147, i % 2 ? -0.47 : 0.47] });
  const usb = scene.part("usb-c");
  roundedBox(usb.geo("steel"), { size: [0.85, 0.3, 0.78], r: 0.09, n: 2, at: [0, 0.15, 0] });
  roundedBox(usb.geo("graphite"), { size: [0.06, 0.1, 0.5], r: 0.03, n: 1, at: [-0.4, 0.15, 0] });
  scene.inst(usb, { at: [-2.1, 0.14, 0] });
  scene.inst(P.soicBody, { at: [0.55, 0.14, -0.7] });
  scene.inst(P.led("ledGreen"), { at: [0.45, 0.14, 0.95] });
  scene.inst(P.led("ledAmber"), { at: [0.8, 0.14, 0.95] });
  for (const [x, z] of [[0.25, -1.0], [0.25, -0.45], [0.95, -0.2], [0.55, 0.3]]) scene.inst(P.resistor, { at: [x, 0.14, z], rot: [0, x > 0.5 ? Math.PI / 2 : 0, 0] });
  for (const [x, z] of [[0.15, 0.4], [-0.3, 1.0]]) scene.inst(P.capacitor, { at: [x, 0.14, z] });
}

/* ---------- 7. project: device monitoring panel (a display with trends, tiles and a status bar) ---------- */
function dashboardTextures(scene) {
  const s = new Raster(512, 320, [13, 21, 24, 255]);
  const rand = rng(7);
  s.rect(0, 0, 512, 26, [20, 32, 36, 255]); s.text("DEVICES  ONLINE 24", 12, 8, 1.4, [190, 215, 210, 255]); s.disc(488, 13, 5, [76, 201, 173, 255]);
  [[76, 201, 173], [240, 166, 90], [140, 156, 255]].forEach((c, i) => { const x = 14 + i * 108; s.rect(x, 38, 98, 46, [22, 36, 40, 255]); s.disc(x + 14, 53, 5, [...c, 255]); s.rect(x + 28, 49, 56, 6, [150, 170, 166, 255]); s.rect(x + 12, 68, 74, 8, [...c, 255]); });
  s.rect(338, 38, 160, 46, [22, 36, 40, 255]); s.rect(352, 49, 50, 6, [150, 170, 166, 255]); s.text("OK", 352, 62, 2.4, [76, 201, 173, 255]);
  s.rect(14, 96, 336, 200, [18, 29, 33, 255]); for (let i = 1; i < 5; i++) s.rect(14, 96 + i * 40, 336, 1, [36, 54, 58, 255]);
  let px = 24, py = 240; for (let i = 1; i <= 16; i++) { const x = 24 + i * 20, y = 250 - Math.sin(i * 0.7) * 38 - i * 5 - rand() * 22; s.line(px, py, x, y, 3, [76, 201, 173, 255]); px = x; py = y; }
  s.disc(px, py, 6, [255, 255, 255, 255]);
  s.rect(362, 96, 136, 200, [18, 29, 33, 255]); [90, 140, 70, 170, 120].forEach((h, i) => s.rect(374 + i * 24, 286 - h, 16, h, [i === 3 ? 240 : 140, i === 3 ? 166 : 156, i === 3 ? 90 : 255, 255]));
  s.rect(0, 304, 512, 16, [18, 86, 76, 255]); s.text("MQTT  OTA  ALERTS 0", 10, 308, 1, [210, 245, 238, 255]);
  scene.texture("screenDash", s, { opaque: true });
}

export function deviceMonitor(scene) {
  dashboardTextures(scene);
  const stand = scene.part("stand");
  roundedBox(stand.geo("alu"), { size: [2.6, 0.16, 1.7], r: 0.08, n: 2, at: [0, 0.08, 0.1] });
  roundedBox(stand.geo("graphite"), { size: [0.55, 1.4, 0.3], r: 0.12, n: 2, at: [0, 0.86, -0.25] });
  roundedBox(stand.geo("accent"), { size: [0.9, 0.025, 0.05], r: 0.012, n: 1, at: [0, 0.17, 0.85] });
  scene.inst(stand);
  const panel = scene.part("panel");
  roundedBox(panel.geo("graphite"), { size: [5.8, 3.6, 0.24], r: 0.15, n: 3, at: [0, 0, 0] });
  quadUV(panel.geo("screenDash", true), [[-2.7, -1.69, 0.126], [2.7, -1.69, 0.126], [2.7, 1.69, 0.126], [-2.7, 1.69, 0.126]], [0, 0, 1], [[0, 1], [1, 1], [1, 0], [0, 0]]);
  roundedBox(panel.geo("accent"), { size: [0.5, 0.045, 0.02], r: 0.01, n: 1, at: [0, -1.74, 0.125] });
  scene.inst(panel, { at: [0, 3.0, 0.0], rot: [-0.1, 0, 0] });
  for (const [x, y, m] of [[-3.3, 1.4, "glow"], [3.3, 2.3, "amber"], [3.5, 0.6, "indigo"]]) { const node = scene.part(`node-${m}`); sphere(node.geo(m), { r: 0.22, seg: 24, rings: 12 }); scene.inst(node, { at: [x, y + 0.8, 0.6] }); }
}

/* ---------- 8. project: document AI assistant (a stack of documents read by a glowing assistant core) ---------- */
function paperTextures(scene) {
  const s = new Raster(256, 340, [244, 246, 244, 255]);
  const rand = rng(11);
  s.rect(20, 22, 110, 12, [27, 60, 100, 255]);
  for (let i = 0; i < 17; i++) { const y = 54 + i * 16, w = 140 + Math.floor(rand() * 90); s.rect(20, y, Math.min(w, 216), 5, [110, 124, 130, 255]); }
  s.rect(20, 150, 216, 14, [140, 156, 255, 90]);
  scene.texture("paperDoc", s, { opaque: true });
}

export function agentAssistant(scene) {
  paperTextures(scene);
  const sheet = scene.part("sheet");
  roundedBox(sheet.geo("plasticLight"), { size: [3.1, 0.06, 4.0], r: 0.04, n: 2, at: [0, 0.03, 0] });
  const top = scene.part("sheet-top");
  roundedBox(top.geo("plasticLight"), { size: [3.1, 0.06, 4.0], r: 0.04, n: 2, at: [0, 0.03, 0] });
  quadUV(top.geo("paperDoc", true), [[-1.5, 0.0615, -1.95], [1.5, 0.0615, -1.95], [1.5, 0.0615, 1.95], [-1.5, 0.0615, 1.95]], [0, 1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]]);
  roundedBox(top.geo("accent"), { size: [0.5, 0.012, 0.16], r: 0.01, n: 1, at: [-0.95, 0.07, 1.62] });
  [[0, 0, 0, 0], [0.14, 0.07, 0.05, 0.06], [-0.1, 0.14, -0.04, -0.05]].forEach(([x, y, z, r]) => scene.inst(sheet, { at: [x, y, z], rot: [0, r, 0] }));
  scene.inst(top, { at: [0.05, 0.21, 0.02], rot: [0, 0.04, 0] });
  const core = scene.part("assistant-core");
  sphere(core.geo("glowIndigo"), { r: 0.55, seg: 40, rings: 20 });
  const ring = scene.part("assistant-ring");
  torus(ring.geo("chrome"), { R: 0.88, t: 0.04, seg: 56, tube: 12 });
  scene.inst(core, { at: [1.55, 1.9, -0.2] });
  scene.inst(ring, { at: [1.55, 1.9, -0.2], rot: [0.5, 0, 0.3] });
  scene.inst(ring, { at: [1.55, 1.9, -0.2], rot: [-0.7, 0, -0.5], s: 1.12 });
  const beam = scene.part("beam");
  cylinder(beam.geo("glowIndigo"), { r: 0.03, h: 1, seg: 10, at: [0, 0.5, 0] });
  const sat = (m, r) => { const p = scene.part(`sat-${m}`); sphere(p.geo(m), { r, seg: 28, rings: 14 }); return p; };
  [[-0.9, 1.5, 0.9, "accent", 0.26], [0.3, 2.6, 0.7, "amber", 0.22], [2.5, 1.0, 0.9, "glow", 0.2]].forEach(([x, y, z, m, r]) => scene.inst(sat(m, r), { at: [x, y, z] }));
  const a = [1.55, 1.9, -0.2], b = [0.05, 0.3, 0.02], d = b.map((v, i) => v - a[i]), len = Math.hypot(...d);
  scene.inst(beam, { at: a, quat: quatBetween([0, 1, 0], d.map((v) => v / len)), s: [1, len, 1] });
}

export const MODEL_BUILDERS = {
  "custom-electronics": customElectronics,
  "sensor-node": sensorNode,
  "service-software": serviceSoftware,
  "service-electronics": serviceElectronics,
  "service-ai": serviceAi,
  "iot-module": iotModule,
  "device-monitor": deviceMonitor,
  "agent-assistant": agentAssistant,
};
