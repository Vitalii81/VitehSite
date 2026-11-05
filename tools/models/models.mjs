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
  // Exploded view: the lid hovers parallel to the tray, centred over it, brushed aluminium, the themable accent only in the logo.
  const lidY = 3.7;
  const lid = scene.part("lid");
  roundedBox(lid.geo("alu"), { size: [iw, 0.3, id], r: 0.18, n: 3, at: [0, 0, 0] });
  scene.inst(lid, { at: [0, lidY, 0] });
  const slot = scene.part("lid-slot");
  roundedBox(slot.geo("rubber"), { size: [1.6, 0.04, 0.12], r: 0.05, n: 1, at: [0, 0, 0] });
  for (let i = 0; i < 7; i++) scene.inst(slot, { at: [2.4, lidY + 0.16, -1.2 + i * 0.3] });
  const logo = scene.part("lid-logo");
  cylinder(logo.geo("accent"), { r: 0.55, h: 0.03, bevel: 0.01, seg: 40, at: [0, 0, 0] });
  torus(logo.geo("graphite"), { R: 0.4, t: 0.03, seg: 40, tube: 8, at: [0, 0.02, 0] });
  scene.inst(logo, { at: [-2.4, lidY + 0.16, 0] });
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
  // One calm composition: a glowing core with two rings, six nodes on a single orbit, one straight link per node, a base plate.
  const core = scene.part("core");
  sphere(core.geo("glow"), { r: 0.72, seg: 40, rings: 20 });
  scene.inst(core);
  const ring = scene.part("core-ring");
  torus(ring.geo("chrome"), { R: 1.12, t: 0.045, seg: 56, tube: 12 });
  scene.inst(ring, { rot: [0.0, 0, 0] });
  scene.inst(ring, { rot: [Math.PI / 2, 0, 0.0], s: 1.0 });
  const orbit = scene.part("orbit");
  torus(orbit.geo("steel"), { R: 2.5, t: 0.026, seg: 96, tube: 8 });
  scene.inst(orbit);
  const link = scene.part("link");
  cylinder(link.geo("steel"), { r: 0.04, h: 1, seg: 10, at: [0, 0.5, 0] });
  const mats = ["accent", "indigo", "amber", "glow", "accent", "indigo"];
  const sat = (m) => { const p = scene.part(`sat-${m}`); sphere(p.geo(m), { r: 0.36, seg: 32, rings: 16 }); return p; };
  for (let i = 0; i < 6; i++) {
    const th = (i * Math.PI) / 3 + 0.3, p = [Math.cos(th) * 2.5, 0, Math.sin(th) * 2.5];
    scene.inst(sat(mats[i]), { at: p });
    const dir = [Math.cos(th), 0, Math.sin(th)], from = 1.12, len = 2.5 - from - 0.36;
    scene.inst(link, { at: dir.map((v) => v * from), quat: quatBetween([0, 1, 0], dir), s: [1, len, 1] });
  }
  const base = scene.part("base");
  cylinder(base.geo("graphite"), { r: 3.1, h: 0.18, bevel: 0.05, seg: 64, at: [0, -0.9, 0] });
  torus(base.geo("glow"), { R: 2.85, t: 0.025, seg: 64, tube: 8, at: [0, -0.8, 0] });
  scene.inst(base);
}

/* ---------- 6. project: IoT module (a development board: carrier PCB, radio module with a PCB antenna, headers, USB-C, buttons, LEDs) ---------- */
function iotScreen(scene) {                                                                                   // 1.3" TFT shown on the IoT module: node name, temperature, link state and a trend
  const s = new Raster(160, 128, [10, 18, 24, 255]);
  s.rect(0, 0, 160, 16, [18, 34, 40, 255]); s.text("IOT-NODE 07", 6, 5, 1, [190, 215, 210, 255]); s.disc(148, 8, 3, [76, 201, 173, 255]);
  s.text("23.4", 10, 28, 4, [76, 201, 173, 255]); s.text("C", 112, 30, 2, [150, 170, 166, 255]);
  s.text("HUM 48%", 10, 68, 1.4, [240, 166, 90, 255]);
  const heights = [14, 20, 17, 26, 22, 30, 25, 34, 28, 31, 36, 29];
  heights.forEach((h, i) => s.rect(10 + i * 12, 116 - h, 8, h, i === heights.length - 1 ? [76, 201, 173, 255] : [34, 70, 70, 255]));
  scene.texture("screenIot", s, { opaque: true });
}

export function iotModule(scene) {
  iotScreen(scene);
  const P = makeParts(scene);
  const pcb = scene.part("carrier-pcb");                                                                      // carrier board, x from -2.4 to 2.4
  roundedBox(pcb.geo("pcbDeep"), { size: [4.8, 0.14, 2.7], r: 0.12, n: 2, at: [0, 0.07, 0] });
  for (const [x, z] of [[-2.15, -1.12], [-2.15, 1.12], [2.15, -1.12], [2.15, 1.12]]) { disc(pcb.geo("gold"), { rOut: 0.1, y: 0.146, seg: 18, at: [x, 0, z] }); }
  scene.inst(pcb);
  const hdr = scene.part("header"), pin = scene.part("header-pin");                                           // two rows of pin headers along the long edges
  roundedBox(hdr.geo("plastic"), { size: [3.3, 0.26, 0.26], r: 0.02, n: 1, at: [0, 0.13, 0] });
  cylinder(pin.geo("gold"), { r: 0.035, h: 0.34, seg: 8, at: [0, 0.17, 0] });
  for (const z of [-1.1, 1.1]) {
    scene.inst(hdr, { at: [-0.45, 0.14, z] });
    for (let i = 0; i < 13; i++) scene.inst(pin, { at: [-1.95 + i * 0.25, 0.4, z] });
  }
  const mod = scene.part("radio-module");                                                                     // module PCB, shield can and the meander antenna that overhangs the board
  roundedBox(mod.geo("graphite"), { size: [2.6, 0.08, 1.9], r: 0.04, n: 1, at: [0, 0.04, 0] });
  roundedBox(mod.geo("steel"), { size: [1.65, 0.26, 1.9], r: 0.03, n: 2, at: [-0.47, 0.21, 0] });
  roundedBox(mod.geo("alu"), { size: [1.55, 0.02, 1.8], r: 0.02, n: 1, at: [-0.47, 0.345, 0] });
  const bar = scene.part("antenna-bar"), link = scene.part("antenna-link");
  roundedBox(bar.geo("gold"), { size: [0.06, 0.012, 1.1], r: 0.01, n: 1, at: [0, 0.006, 0] });
  roundedBox(link.geo("gold"), { size: [0.24, 0.012, 0.06], r: 0.01, n: 1, at: [0, 0.006, 0] });
  scene.inst(mod, { at: [1.15, 0.14, 0] });
  for (let i = 0; i < 4; i++) scene.inst(bar, { at: [1.15 + 0.85 + i * 0.12 * 2 - 0.04, 0.234, 0.0] , s: [1, 1, 0.82] });
  for (let i = 0; i < 3; i++) scene.inst(link, { at: [1.15 + 0.85 + 0.12 + i * 0.24 - 0.04, 0.234, i % 2 ? -0.5 : 0.5] });
  const usb = scene.part("usb-c");                                                                            // receptacle sits on the board; only the shell lip overhangs the edge
  roundedBox(usb.geo("steel"), { size: [0.85, 0.3, 0.8], r: 0.09, n: 2, at: [0, 0.15, 0] });
  roundedBox(usb.geo("graphite"), { size: [0.05, 0.1, 0.5], r: 0.025, n: 1, at: [-0.4, 0.15, 0] });
  scene.inst(usb, { at: [-2.325, 0.14, 0] });
  const btn = scene.part("button");
  roundedBox(btn.geo("graphite"), { size: [0.34, 0.1, 0.34], r: 0.03, n: 1, at: [0, 0.05, 0] });
  cylinder(btn.geo("chrome"), { r: 0.09, h: 0.07, bevel: 0.015, seg: 20, at: [0, 0.135, 0] });
  for (const z of [-0.6, 0.6]) scene.inst(btn, { at: [-2.1, 0.14, z] });
  // built-in display: a TFT module on its own small PCB between the pin-header rows, left of the radio shield
  const dsp = scene.part("display-module");
  roundedBox(dsp.geo("graphite"), { size: [1.4, 0.07, 1.45], r: 0.04, n: 1, at: [0, 0.035, 0] });
  roundedBox(dsp.geo("rubber"), { size: [1.3, 0.05, 1.35], r: 0.03, n: 1, at: [0, 0.095, 0] });
  quadUV(dsp.geo("screenIot", true), [[-0.5, 0.123, 0.4], [0.5, 0.123, 0.4], [0.5, 0.123, -0.4], [-0.5, 0.123, -0.4]], [0, 1, 0], [[0, 1], [1, 1], [1, 0], [0, 0]]);
  roundedBox(dsp.geo("accent"), { size: [1.0, 0.012, 0.05], r: 0.012, n: 1, at: [0, 0.12, 0.54] });                // themed accent bar under the screen
  for (const x of [-0.6, 0.6]) cylinder(dsp.geo("gold"), { r: 0.045, h: 0.03, seg: 14, at: [x, 0.085, 0.6] });
  scene.inst(dsp, { at: [-1.15, 0.14, 0.0] });
  scene.inst(P.led("ledGreen"), { at: [-0.32, 0.14, -0.78] });
  scene.inst(P.led("ledAmber"), { at: [-0.32, 0.14, 0.78] });
  for (const z of [-0.45, 0.45]) scene.inst(P.resistor, { at: [-0.32, 0.14, z], rot: [0, 1.57, 0] });
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

/* ---------- 6. project: Toyota Prius HV-battery monitor (5-inch touch display on a foot, CAN wires at the back) ---------- */
function toyotaTextures(scene) {
  const W = 320, H = 460, s = new Raster(W, H, [10, 36, 60, 255]);
  const white = [236, 244, 250, 255], dim = [150, 190, 220, 255], yellow = [232, 232, 96, 255], blue = [34, 110, 220, 255];
  s.rect(0, 0, W, 4, [20, 60, 96, 255]);
  s.text("PRIUS HV BATTERY", 12, 16, 2.1, white);
  s.rect(228, 8, 80, 30, blue); s.rect(228, 8, 80, 3, [90, 160, 255, 255]); s.text("MENU", 241, 17, 2.2, white);
  s.text("CAN WAITING, 0 FRAMES", 12, 50, 1.4, yellow);
  s.text("I 0.0A  DV 0.000  A0/0", 12, 70, 1.4, white);
  s.text("P 0.0KW  T 0/0/0C", 12, 88, 1.4, white);
  s.frame(214, 56, 98, 54, 2, white); s.text("000", 226, 66, 5.6, white);
  for (let i = 0; i < 14; i++) {
    const col = i < 7 ? 0 : 1, row = i % 7, x = 12 + col * 154, y = 126 + row * 29;
    s.text(`M${String(i + 1).padStart(2, "0")}/--.-/--MR/00`, x, y, 1.5, white);
    s.rect(x, y + 13, 140, 2, [90, 130, 160, 255]);
  }
  s.rect(8, 330, 304, 14, [16, 50, 80, 255]); s.text("GRD -4.4  ROL -98.5  STR --DEG", 14, 333, 1.6, white);
  s.frame(8, 348, 150, 62, 2, [230, 200, 90, 255]); s.text("AX --", 16, 354, 2.6, white); s.text("AY --", 16, 376, 2.6, white);
  s.frame(164, 348, 148, 62, 2, [100, 190, 140, 255]); s.text("FUEL --.-L", 172, 352, 1.9, white); s.text("AVG --.-", 172, 370, 1.9, white); s.text("ODO ----", 172, 388, 1.9, white);
  ["PREV", "NEXT", "SCAN", "REC", "PLAY"].forEach((t, i) => { const x = 8 + i * 61; s.rect(x, 418, 56, 26, blue); s.rect(x, 418, 56, 3, [110, 170, 255, 255]); s.text(t, x + 28 - t.length * 6, 426, 2, white); });
  s.text("LOGGER: SD MOUNT FAILED", 40, 448, 1.4, yellow);
  scene.texture("screenToyota", s, { opaque: true });
}

export function toyotaDisplay(scene) {
  toyotaTextures(scene);
  const bw = 7.4, bh = 10.9, bd = 1.15, y0 = 1.2;                 // body width / height / depth and the height of its centre above the foot
  const body = scene.part("display-body");
  roundedBox(body.geo("plastic"), { size: [bw, bh, bd], r: 0.5, n: 4, at: [0, 0, 0] });
  roundedBox(body.geo("graphite"), { size: [bw - 0.5, bh - 0.5, 0.05], r: 0.4, n: 2, at: [0, 0, -bd / 2 - 0.004] });          // rear panel
  roundedBox(body.geo("glass"), { size: [bw - 0.5, bh - 0.5, 0.06], r: 0.32, n: 3, at: [0, 0, bd / 2 - 0.02] });               // cover glass over the bezel
  roundedBox(body.geo("rubber"), { size: [6.3, 9.3, 0.02], r: 0.12, n: 2, at: [0, 0.05, bd / 2 + 0.012] });                      // black edge of the panel
  quadUV(body.geo("screenToyota", true), [[-2.95, -4.15, bd / 2 + 0.026], [2.95, -4.15, bd / 2 + 0.026], [2.95, 4.55, bd / 2 + 0.026], [-2.95, 4.55, bd / 2 + 0.026]], [0, 0, 1], [[0, 1], [1, 1], [1, 0], [0, 0]]);
  for (const [x, y] of [[-3.0, 4.75], [3.0, 4.75], [-3.0, -4.75], [3.0, -4.75]]) cylinder(body.geo("steel"), { r: 0.16, h: 0.06, bevel: 0.015, seg: 18, axis: "z", at: [x, y, -bd / 2 - 0.05] });
  for (const y of [1.2, -0.1]) roundedBox(body.geo("graphite"), { size: [0.08, 0.9, 0.5], r: 0.03, n: 1, at: [bw / 2 + 0.02, y, 0.05] });   // side keys
  scene.inst(body, { at: [0, y0 + bh / 2, 0] });

  const foot = scene.part("display-foot");                            // weighted base plate, neck and an accent strip
  roundedBox(foot.geo("alu"), { size: [bw + 1.2, 0.6, 3.6], r: 0.25, n: 3, at: [0, 0.3, 0.1] });
  roundedBox(foot.geo("accent"), { size: [bw + 1.0, 0.05, 0.14], r: 0.02, n: 1, at: [0, 0.605, 1.65] });
  roundedBox(foot.geo("graphite"), { size: [2.4, 0.9, 0.9], r: 0.18, n: 2, at: [0, 0.95, -0.3] });
  roundedBox(foot.geo("rubber"), { size: [bw + 0.8, 0.05, 3.2], r: 0.06, n: 1, at: [0, 0.02, 0.1] });
  scene.inst(foot);

  const wire = (name, mat, x, bend) => {                              // three CAN / power leads from the lower rear edge
    const w = scene.part(name);
    const z0 = -bd / 2 - 0.08, yTop = y0 + 0.9;
    tube(w.geo(mat), { path: bezier([x, yTop, z0], [x, yTop - 0.2, z0 - 1.6], [x + bend, 0.7, z0 - 2.4], [x + bend * 1.8, 0.3, z0 - 3.9], 22), r: 0.07, seg: 10 });
    return w;
  };
  scene.inst(wire("wire-yellow", "wireYellow", -1.0, -1.6));
  scene.inst(wire("wire-green", "wireGreen", 0.0, 0.2));
  scene.inst(wire("wire-red", "wireRed", 1.0, 1.6));
  const grommet = scene.part("grommet");
  roundedBox(grommet.geo("rubber"), { size: [3.2, 0.5, 0.3], r: 0.12, n: 2, at: [0, y0 + 0.9, -bd / 2 - 0.05] });
  scene.inst(grommet);
}

/* ---------- 9. project: LVGL smartwatch (square rounded case, glass over a home-menu screen, crown, strap loop on a dock) ---------- */
function watchTextures(scene) {
  const W = 288, H = 352, s = new Raster(W, H, [0, 0, 0, 255]);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x += 4) {            // diagonal violet-to-blue wallpaper in the spirit of the real firmware
    const t = (x / W) * 0.55 + (y / H) * 0.45, band = Math.sin(t * 9) * 0.5 + 0.5;
    s.rect(x, y, 4, 1, [Math.round(40 + 120 * (1 - t) * band), Math.round(18 + 30 * band), Math.round(110 + 110 * t), 255]);
  }
  const green = [92, 232, 120, 255], yellow = [236, 236, 96, 255], orange = [250, 170, 70, 255], white = [244, 246, 250, 255], blue = [60, 130, 240, 255];
  s.text("BAT 60 DCHG 00:38", 22, 12, 2, green);
  s.text("01:41:28", 24, 40, 5, yellow);
  s.rect(40, 92, 208, 30, [40, 20, 20, 190]); s.text("2026-05-14", 54, 98, 3, orange);
  const tile = (col, row) => { const x = 22 + col * 88, y = 148 + row * 92; s.rect(x, y, 80, 80, [28, 36, 120, 255]); s.frame(x, y, 80, 80, 3, blue); return [x, y]; };
  let [x, y] = tile(0, 0);                                                 // volume
  s.rect(x + 14, y + 30, 14, 20, blue); s.line(x + 28, y + 30, x + 46, y + 18, 5, blue); s.line(x + 28, y + 50, x + 46, y + 62, 5, blue); s.rect(x + 40, y + 20, 8, 40, blue); s.ring(x + 54, y + 40, 14, 3, white);
  [x, y] = tile(1, 0);                                                     // lock
  s.ring(x + 40, y + 28, 15, 5, white); s.rect(x + 14, y + 38, 52, 32, green); s.disc(x + 40, y + 52, 5, [20, 50, 40, 255]);
  [x, y] = tile(2, 0);                                                     // calendar
  s.rect(x + 12, y + 14, 56, 54, white); s.rect(x + 12, y + 14, 56, 14, [230, 70, 60, 255]);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) s.rect(x + 18 + i * 17, y + 34 + j * 11, 11, 6, [60, 70, 140, 255]);
  [x, y] = tile(0, 1);                                                     // workout
  s.rect(x + 14, y + 26, 10, 28, green); s.rect(x + 56, y + 26, 10, 28, green); s.rect(x + 24, y + 38, 32, 5, white); s.rect(x + 8, y + 32, 6, 16, green); s.rect(x + 66, y + 32, 6, 16, green);
  [x, y] = tile(1, 1);                                                     // chat / network
  s.ring(x + 36, y + 42, 22, 3, blue); s.rect(x + 14, y + 42, 44, 3, blue); s.rect(x + 34, y + 20, 3, 44, blue); s.rect(x + 40, y + 12, 32, 22, [236, 190, 70, 255]); s.disc(x + 50, y + 23, 3, [60, 50, 30, 255]); s.disc(x + 58, y + 23, 3, [60, 50, 30, 255]);
  [x, y] = tile(2, 1);                                                     // settings gear
  for (let a = 0; a < 8; a++) s.disc(x + 40 + Math.cos(a * Math.PI / 4) * 22, y + 40 + Math.sin(a * Math.PI / 4) * 22, 7, [190, 200, 235, 255]);
  s.disc(x + 40, y + 40, 20, white); s.disc(x + 40, y + 40, 9, [28, 36, 120, 255]);
  scene.texture("screenWatch", s, { opaque: true });
}

export function smartwatch(scene) {
  watchTextures(scene);
  const bw = 4.2, bh = 5.0, bd = 1.0, y0 = 3.55, tilt = -0.1;           // case width / height / depth, height of its centre, backward lean
  const watch = scene.part("watch-case");
  roundedBox(watch.geo("graphite"), { size: [bw, bh, bd], r: 0.8, n: 5, at: [0, 0, 0] });
  roundedBox(watch.geo("plastic"), { size: [bw - 0.14, bh - 0.14, 0.1], r: 0.74, n: 4, at: [0, 0, bd / 2 - 0.02] });                // bezel step
  roundedBox(watch.geo("glass"), { size: [bw - 0.3, bh - 0.3, 0.1], r: 0.66, n: 5, at: [0, 0, bd / 2 + 0.02] });                      // domed cover glass
  roundedBox(watch.geo("rubber"), { size: [bw - 0.55, bh - 0.55, 0.02], r: 0.5, n: 3, at: [0, 0, bd / 2 + 0.078] });                   // black border of the panel
  quadUV(watch.geo("screenWatch", true), [[-1.67, -2.05, bd / 2 + 0.092], [1.67, -2.05, bd / 2 + 0.092], [1.67, 2.05, bd / 2 + 0.092], [-1.67, 2.05, bd / 2 + 0.092]], [0, 0, 1], [[0, 1], [1, 1], [1, 0], [0, 0]]);
  cylinder(watch.geo("graphite"), { r: 0.78, h: 0.1, bevel: 0.03, seg: 36, axis: "z", at: [0, 0, -bd / 2 - 0.04] });                    // sensor window on the back
  torus(watch.geo("steel"), { R: 0.62, t: 0.03, seg: 36, tube: 8, axis: "z", at: [0, 0, -bd / 2 - 0.09] });
  cylinder(watch.geo("accent"), { r: 0.24, h: 0.42, bevel: 0.05, seg: 24, axis: "x", at: [bw / 2 + 0.16, 0.85, 0] });                    // crown (recoloured by the theme)
  cylinder(watch.geo("steel"), { r: 0.15, h: 0.12, seg: 20, axis: "x", at: [bw / 2 + 0.02, 0.85, 0] });
  roundedBox(watch.geo("graphite"), { size: [0.18, 0.9, 0.34], r: 0.07, n: 2, at: [bw / 2 + 0.04, -0.5, 0] });                          // side key
  for (const sy of [-1, 1]) roundedBox(watch.geo("alu"), { size: [bw - 1.0, 0.14, 0.34], r: 0.05, n: 1, at: [0, sy * (bh / 2 + 0.02), -0.1] });   // strap lugs
  scene.inst(watch, { at: [0, y0, 0.2], rot: [tilt, 0, 0] });

  // strap: a chain of curved segments that runs from the lugs round the back, so the watch stands in its own loop
  const strapW = 3.3, th = 0.16;
  const seg = (name, mat, len) => { const p = scene.part(name); roundedBox(p.geo(mat), { size: [strapW, len, th], r: 0.05, n: 1 }); return p; };
  const chain = (pts, name, mat) => {
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1], dy = b[1] - a[1], dz = b[2] - a[2], len = Math.hypot(dy, dz);
      scene.inst(seg(`${name}-${i}`, mat, len * 1.04), { at: [0, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], rot: [Math.atan2(dz, dy), 0, 0] });
    }
  };
  const c = Math.cos(tilt), sn = Math.sin(tilt);
  const lug = (sy) => [y0 + sy * (bh / 2 + 0.05) * c, 0.2 + sy * (bh / 2 + 0.05) * sn - 0.06];         // [y, z] of a lug in world space
  const [yt, zt] = lug(1), [yb, zb] = lug(-1);
  chain(bezier([0, yt, zt], [0, yt + 1.4, zt - 0.2], [0, yt + 1.5, zt - 2.0], [0, yt - 0.9, zt - 2.9], 7), "strap-top", "rubber");
  chain(bezier([0, yb, zb], [0, yb - 0.5, zb - 0.1], [0, 0.7, zb - 1.4], [0, 1.1, zb - 2.7], 7), "strap-bottom", "graphite");
  const buckle = scene.part("buckle");
  roundedBox(buckle.geo("steel"), { size: [strapW + 0.12, 0.34, 0.26], r: 0.07, n: 2 });
  scene.inst(buckle, { at: [0, yt - 0.9, zt - 2.9], rot: [0.9, 0, 0] });
  const keeper = scene.part("keeper");
  roundedBox(keeper.geo("accent"), { size: [strapW + 0.1, 0.22, th + 0.08], r: 0.05, n: 2 });
  scene.inst(keeper, { at: [0, yt + 0.85, zt - 0.35], rot: [-0.5, 0, 0] });

  const dock = scene.part("dock");                                      // charging dock the watch leans on
  roundedBox(dock.geo("alu"), { size: [5.4, 0.3, 3.8], r: 0.14, n: 2, at: [0, 0.15, -0.7] });
  roundedBox(dock.geo("accent"), { size: [4.6, 0.04, 0.12], r: 0.02, n: 1, at: [0, 0.31, 0.95] });
  roundedBox(dock.geo("rubber"), { size: [5.1, 0.04, 3.5], r: 0.05, n: 1, at: [0, 0.01, -0.7] });
  roundedBox(dock.geo("graphite"), { size: [2.2, 1.0, 0.7], r: 0.2, n: 3, at: [0, 0.75, -0.55] });
  scene.inst(dock);
}

/* ---------- 10. service: Android apps (a phone leaning on a stand, chat / voice / files UI on the screen, floating UI tokens) ---------- */
function phoneTextures(scene) {
  const W = 270, H = 580, s = new Raster(W, H, [12, 20, 26, 255]);
  const teal = [76, 201, 173, 255], tealDim = [28, 74, 70, 255], white = [226, 238, 236, 255], dim = [110, 136, 140, 255], card = [22, 34, 42, 255], amber = [240, 166, 90, 255];
  s.text("9:41", 16, 12, 2, white); s.disc(W - 22, 17, 4, white); s.rect(W - 46, 13, 14, 8, dim);
  s.disc(W / 2, 20, 7, [4, 8, 10, 255]);                                   // punch-hole camera
  s.rect(0, 44, W, 40, [18, 30, 36, 255]); s.disc(30, 64, 12, teal); s.text("A", 25, 59, 2, [10, 30, 28, 255]);
  s.text("ASSISTANT", 52, 52, 2.2, white); s.text("ONLINE", 52, 70, 1.4, teal);
  const bubble = (x, y, w, h, c, lines) => { s.rect(x, y, w, h, c); s.rect(x + 4, y - 2, w - 8, h + 4, c); lines.forEach((l, i) => s.rect(x + 12, y + 12 + i * 14, l, 6, c === teal ? [8, 40, 36, 255] : white)); };
  bubble(70, 104, 176, 44, tealDim, [120, 90]);                             // incoming and outgoing messages
  bubble(22, 162, 150, 30, card, [100]);
  bubble(86, 206, 160, 44, tealDim, [110, 70]);
  s.rect(22, 268, 120, 14, card); s.rect(30, 272, 60, 6, dim);
  s.rect(22, 300, W - 44, 60, card);                                         // voice message with a waveform
  s.disc(48, 330, 15, teal); s.rect(44, 322, 4, 16, [8, 40, 36, 255]); s.rect(50, 322, 4, 16, [8, 40, 36, 255]);
  for (let i = 0; i < 22; i++) { const h = 6 + Math.abs(Math.sin(i * 1.3) * 22) + (i % 3) * 3; s.rect(76 + i * 7, 330 - h / 2, 4, h, i < 13 ? teal : dim); }
  s.text("0:24", W - 62, 308, 1.4, dim);
  [["PDF", teal], ["XLS", amber], ["IMG", [140, 156, 255, 255]]].forEach(([t, c], i) => {   // file attachments
    const x = 22 + i * 76; s.rect(x, 380, 68, 78, card); s.rect(x, 380, 68, 4, c); s.rect(x + 22, 396, 24, 30, c); s.rect(x + 36, 396, 10, 10, card); s.text(t, x + 14, 436, 1.8, white); s.rect(x + 12, 456 - 8, 44, 3, dim);
  });
  s.rect(14, 490, W - 28, 40, card); s.text("MESSAGE", 28, 505, 1.6, dim);        // composer: attach, text, mic
  s.disc(W - 38, 510, 14, teal); s.rect(W - 41, 501, 6, 12, [8, 40, 36, 255]); s.ring(W - 38, 510, 8, 2, [8, 40, 36, 255]);
  s.rect(W / 2 - 40, 558, 80, 4, dim);                                       // gesture bar
  scene.texture("screenPhone", s, { opaque: true });
}

export function serviceAndroid(scene) {
  phoneTextures(scene);
  const pw = 3.5, ph = 7.3, pd = 0.42, tilt = -0.2;
  const phone = scene.part("phone");
  roundedBox(phone.geo("alu"), { size: [pw, ph, pd], r: 0.46, n: 5 });                                   // frame
  roundedBox(phone.geo("graphite"), { size: [pw - 0.1, ph - 0.1, 0.05], r: 0.4, n: 4, at: [0, 0, -pd / 2 - 0.004] });  // back panel
  roundedBox(phone.geo("rubber"), { size: [pw - 0.2, ph - 0.2, 0.03], r: 0.36, n: 4, at: [0, 0, pd / 2 - 0.01] });   // screen border
  quadUV(phone.geo("screenPhone", true), [[-1.59, -3.33, pd / 2 + 0.008], [1.59, -3.33, pd / 2 + 0.008], [1.59, 3.33, pd / 2 + 0.008], [-1.59, 3.33, pd / 2 + 0.008]], [0, 0, 1], [[0, 1], [1, 1], [1, 0], [0, 0]]);
  roundedBox(phone.geo("accent"), { size: [2.0, 1.1, 0.06], r: 0.3, n: 3, at: [-0.5, 2.7, -pd / 2 - 0.04] });  // camera island on the back (recoloured by the theme)
  for (const [x, y] of [[-0.95, 2.95], [-0.95, 2.45], [-0.15, 2.7]]) { cylinder(phone.geo("graphite"), { r: 0.2, h: 0.08, bevel: 0.02, seg: 20, axis: "z", at: [x, y, -pd / 2 - 0.09] }); cylinder(phone.geo("glass"), { r: 0.12, h: 0.1, bevel: 0.02, seg: 16, axis: "z", at: [x, y, -pd / 2 - 0.1] }); }
  roundedBox(phone.geo("accentMetal"), { size: [0.07, 1.0, 0.2], r: 0.03, n: 2, at: [pw / 2 + 0.02, 1.2, 0] });   // power key
  roundedBox(phone.geo("alu"), { size: [0.07, 1.6, 0.2], r: 0.03, n: 2, at: [pw / 2 + 0.02, -0.3, 0] });         // volume rocker
  scene.inst(phone, { at: [0, 4.25, 0.2], rot: [tilt, -0.28, 0] });

  const stand = scene.part("phone-stand");                                                                  // weighted dock with a back rest
  roundedBox(stand.geo("alu"), { size: [4.6, 0.3, 3.0], r: 0.14, n: 3, at: [0, 0.15, 0.2] });
  roundedBox(stand.geo("rubber"), { size: [4.3, 0.04, 2.7], r: 0.05, n: 1, at: [0, 0.01, 0.2] });
  roundedBox(stand.geo("accent"), { size: [3.2, 0.04, 0.1], r: 0.02, n: 1, at: [0, 0.31, 1.45] });
  roundedBox(stand.geo("graphite"), { size: [2.4, 0.5, 0.5], r: 0.16, n: 3, at: [0, 0.5, 0.75] });         // lip the phone rests on
  roundedBox(stand.geo("graphite"), { size: [1.1, 2.0, 0.4], r: 0.14, n: 3, at: [0.2, 1.1, -0.65], });
  scene.inst(stand, { rot: [0, -0.28, 0] });

  // floating UI tokens around the phone: a chat bubble, a voice capsule and a file sheet
  const bubble = scene.part("token-bubble");
  roundedBox(bubble.geo("accent"), { size: [1.7, 0.95, 0.22], r: 0.3, n: 4 });
  roundedBox(bubble.geo("accent"), { size: [0.4, 0.4, 0.22], r: 0.06, n: 1, at: [-0.5, -0.6, 0] });
  for (const [w, y] of [[1.1, 0.14], [0.7, -0.14]]) roundedBox(bubble.geo("plasticLight"), { size: [w, 0.1, 0.05], r: 0.04, n: 2, at: [-(1.1 - w) / 2 * 0.5 - 0.05, y, 0.12] });
  scene.inst(bubble, { at: [-3.1, 6.5, 0.9], rot: [0, 0.35, -0.12] });
  const mic = scene.part("token-mic");
  roundedBox(mic.geo("accentMetal"), { size: [0.72, 1.3, 0.5], r: 0.34, n: 5, at: [0, 0.2, 0] });
  torus(mic.geo("steel"), { R: 0.62, t: 0.04, seg: 28, tube: 8, axis: "z", at: [0, 0.15, 0] });
  cylinder(mic.geo("steel"), { r: 0.04, h: 0.55, seg: 8, at: [0, -0.7, 0] });
  roundedBox(mic.geo("steel"), { size: [0.6, 0.06, 0.3], r: 0.03, n: 1, at: [0, -1.0, 0] });
  scene.inst(mic, { at: [3.2, 3.1, 0.7], rot: [0, -0.4, 0.1] });
  const file = scene.part("token-file");
  roundedBox(file.geo("plasticLight"), { size: [1.3, 1.7, 0.1], r: 0.1, n: 2 });
  roundedBox(file.geo("accent"), { size: [1.3, 0.3, 0.12], r: 0.05, n: 1, at: [0, 0.7, 0] });
  for (let i = 0; i < 4; i++) roundedBox(file.geo("graphite"), { size: [0.85 - (i % 2) * 0.3, 0.07, 0.12], r: 0.03, n: 1, at: [-0.15 - (i % 2) * -0.15, 0.2 - i * 0.3, 0] });
  scene.inst(file, { at: [2.9, 6.3, 1.1], rot: [0, -0.4, 0.18] });
}

/* ---------- 11. service: website creation (a monitor with a landing page, keyboard and mouse) ---------- */
function webTextures(scene) {
  const W = 616, H = 368, s = new Raster(W, H, [246, 249, 248, 255]);
  const teal = [28, 138, 116, 255], dark = [28, 42, 40, 255], mid = [150, 168, 164, 255], soft = [222, 234, 230, 255], white = [255, 255, 255, 255], indigo = [92, 111, 224, 255], amber = [240, 166, 90, 255];
  s.rect(0, 0, W, 30, [226, 232, 230, 255]);                                 // browser chrome: dots, address bar
  [[14, [236, 106, 94, 255]], [32, [244, 190, 80, 255]], [50, [98, 198, 110, 255]]].forEach(([x, c]) => s.disc(x, 15, 5, c));
  s.rect(80, 6, 380, 19, white); s.text("VITEH.ORG", 92, 10, 1.6, dark); s.disc(470, 15, 4, teal);
  s.rect(0, 30, W, 36, white);                                               // site header: logo, menu, button
  s.disc(26, 48, 9, teal); s.text("VITEH", 42, 42, 2, dark);
  ["SERVICES", "WORK", "PRICE"].forEach((t, i) => s.text(t, 250 + i * 80, 43, 1.5, mid));
  s.rect(520, 38, 78, 20, teal); s.text("CONTACT", 530, 44, 1.4, white);
  s.rect(0, 66, W, 138, soft);                                               // hero: headline, copy, buttons, illustration
  s.text("WEBSITES THAT", 28, 84, 3.4, dark); s.text("WORK FOR YOU", 28, 112, 3.4, teal);
  s.rect(28, 148, 230, 6, mid); s.rect(28, 160, 180, 6, mid);
  s.rect(28, 176, 92, 22, teal); s.text("START", 44, 183, 1.8, white); s.frame(130, 176, 92, 22, 2, teal); s.text("PRICES", 144, 183, 1.8, teal);
  s.rect(360, 80, 220, 110, white); s.frame(360, 80, 220, 110, 2, mid);
  s.rect(374, 94, 90, 12, teal); s.rect(374, 114, 130, 6, mid); s.rect(374, 126, 100, 6, mid);
  for (let i = 0; i < 6; i++) s.rect(380 + i * 30, 176 - (14 + (i * 7) % 28), 20, 14 + (i * 7) % 28, i === 5 ? amber : indigo);
  s.disc(534, 108, 20, teal); s.disc(534, 108, 11, white);
  [[teal, "FAST"], [indigo, "SAFE"], [amber, "CLEAR"]].forEach(([c, t], i) => {   // three feature cards
    const x = 28 + i * 190; s.rect(x, 224, 172, 92, white); s.frame(x, 224, 172, 92, 2, soft); s.rect(x, 224, 172, 5, c);
    s.disc(x + 26, 256, 12, c); s.text(t, x + 48, 250, 2.2, dark); s.rect(x + 16, 280, 130, 5, mid); s.rect(x + 16, 292, 98, 5, mid);
  });
  s.rect(0, 336, W, 32, dark); s.text("2026 VITEH  CONTACT  PRIVACY", 28, 348, 1.4, mid);
  scene.texture("screenWeb", s, { opaque: true });
}

export function serviceWeb(scene) {
  webTextures(scene);
  const mw = 8.6, mh = 5.5, md = 0.42, y0 = 4.0;                           // monitor width / height / depth and the height of its centre
  const mon = scene.part("monitor");
  roundedBox(mon.geo("graphite"), { size: [mw, mh, md], r: 0.24, n: 4 });
  roundedBox(mon.geo("plastic"), { size: [mw - 0.12, mh - 0.12, 0.05], r: 0.2, n: 3, at: [0, 0, md / 2 - 0.008] });
  roundedBox(mon.geo("rubber"), { size: [mw - 0.36, mh - 0.36, 0.02], r: 0.12, n: 2, at: [0, 0.02, md / 2 + 0.02] });
  quadUV(mon.geo("screenWeb", true), [[-3.98, -2.38, md / 2 + 0.032], [3.98, -2.38, md / 2 + 0.032], [3.98, 2.38, md / 2 + 0.032], [-3.98, 2.38, md / 2 + 0.032]], [0, 0, 1], [[0, 1], [1, 1], [1, 0], [0, 0]]);
  roundedBox(mon.geo("accent"), { size: [0.5, 0.05, 0.03], r: 0.02, n: 1, at: [0, -mh / 2 + 0.17, md / 2 + 0.03] });     // accent logo mark on the chin
  roundedBox(mon.geo("graphite"), { size: [mw - 1.4, mh - 1.0, 0.1], r: 0.2, n: 2, at: [0, 0.05, -md / 2 - 0.04] });   // rear bulge
  roundedBox(mon.geo("graphite"), { size: [1.5, 0.9, 0.5], r: 0.16, n: 2, at: [0, -1.3, -md / 2 - 0.2] });            // stand hinge
  scene.inst(mon, { at: [0, y0, 0], rot: [-0.05, 0, 0] });
  const stand = scene.part("monitor-stand");
  roundedBox(stand.geo("alu"), { size: [1.0, 2.1, 0.32], r: 0.12, n: 3, at: [0, 1.15, -0.62] });
  cylinder(stand.geo("alu"), { r: 1.9, h: 0.22, bevel: 0.07, seg: 56, at: [0, 0.11, -0.4] });
  cylinder(stand.geo("accent"), { r: 1.88, h: 0.02, seg: 56, at: [0, 0.23, -0.4] });
  cylinder(stand.geo("graphite"), { r: 1.6, h: 0.02, seg: 56, at: [0, 0.24, -0.4] });
  scene.inst(stand);
  const kb = scene.part("keyboard");                                         // compact keyboard with instanced keys, and a mouse
  roundedBox(kb.geo("alu"), { size: [5.2, 0.22, 1.7], r: 0.1, n: 2, at: [-0.6, 0.11, 0] });
  const key = scene.part("kb-key");
  roundedBox(key.geo("plastic"), { size: [0.3, 0.08, 0.3], r: 0.04, n: 2, at: [0, 0.04, 0] });
  const space = scene.part("kb-space");
  roundedBox(space.geo("plastic"), { size: [1.8, 0.08, 0.3], r: 0.04, n: 2, at: [0, 0.04, 0] });
  scene.inst(kb, { at: [0, 0, 2.5], rot: [0, 0.05, 0] });
  for (let r = 0; r < 4; r++) for (let c = 0; c < 13; c++) scene.group({ at: [0, 0, 2.5], ry: 0.05 }, () => scene.inst(key, { at: [-0.6 + (c - 6) * 0.37, 0.22, -0.55 + r * 0.36] }));
  scene.group({ at: [0, 0, 2.5], ry: 0.05 }, () => scene.inst(space, { at: [-0.6, 0.22, 0.88] }));
  const mouse = scene.part("mouse");
  roundedBox(mouse.geo("accent"), { size: [0.8, 0.28, 1.3], r: 0.3, n: 4, at: [0, 0.14, 0] });
  roundedBox(mouse.geo("graphite"), { size: [0.06, 0.04, 0.5], r: 0.02, n: 1, at: [0, 0.3, -0.3] });
  cylinder(mouse.geo("steel"), { r: 0.1, h: 0.22, bevel: 0.02, seg: 14, axis: "z", at: [0, 0.3, -0.35] });
  scene.inst(mouse, { at: [3.6, 0, 2.5], rot: [0, -0.15, 0] });
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
  "toyota-hv-display": toyotaDisplay,
  "lvgl-smartwatch": smartwatch,
  "service-android": serviceAndroid,
  "service-web": serviceWeb,
};
