// Reusable electronic components, built once per model and instanced. Sizes are in the model's units (about 1 = 1 cm).
import { box, cylinder, disc, lathe, roundedBox, sphere, torus } from "./geo.mjs";

export function makeParts(scene) {
  const P = {};

  // --- QFP package: rounded body, pin-1 dimple, gull-wing lead (instanced 16 per side) ---
  P.qfpBody = scene.part("qfp-body");
  roundedBox(P.qfpBody.geo("plastic"), { size: [1.6, 0.18, 1.6], r: 0.04, n: 2, at: [0, 0.09, 0] });
  roundedBox(P.qfpBody.geo("graphite"), { size: [1.38, 0.012, 1.38], r: 0.01, n: 1, at: [0, 0.184, 0] });
  disc(P.qfpBody.geo("rubber"), { rOut: 0.07, y: 0.192, seg: 20, at: [-0.5, 0, -0.5] });
  P.qfpLead = scene.part("qfp-lead");
  roundedBox(P.qfpLead.geo("tin"), { size: [0.2, 0.018, 0.05], r: 0.006, n: 1, at: [0.1, 0.009, 0] });
  roundedBox(P.qfpLead.geo("tin"), { size: [0.022, 0.1, 0.05], r: 0.006, n: 1, at: [0.0, 0.07, 0] });

  // --- SOIC / small IC ---
  P.soicBody = scene.part("soic-body");
  roundedBox(P.soicBody.geo("plastic"), { size: [1.0, 0.14, 0.9], r: 0.035, n: 2, at: [0, 0.075, 0] });
  disc(P.soicBody.geo("rubber"), { rOut: 0.045, y: 0.146, seg: 16, at: [-0.34, 0, -0.3] });
  P.soicLead = scene.part("soic-lead");
  roundedBox(P.soicLead.geo("tin"), { size: [0.15, 0.016, 0.07], r: 0.005, n: 1, at: [0.075, 0.008, 0] });
  roundedBox(P.soicLead.geo("tin"), { size: [0.02, 0.07, 0.07], r: 0.005, n: 1, at: [0, 0.05, 0] });

  // --- chip resistor / capacitor (0805-ish) and LED ---
  const chip = (name, bodyMat, colour) => {
    const p = scene.part(name);
    roundedBox(p.geo(bodyMat), { size: [0.2, 0.07, 0.11], r: 0.014, n: 1, at: [0, 0.035, 0] });
    for (const sgn of [-1, 1]) roundedBox(p.geo("tin"), { size: [0.04, 0.074, 0.114], r: 0.016, n: 1, at: [sgn * 0.083, 0.037, 0] });
    return p;
  };
  P.resistor = chip("resistor", "plastic");
  P.capacitor = chip("capacitor", "ceramic");
  P.led = (mat) => {
    const p = scene.part("led-" + mat);
    roundedBox(p.geo("plasticLight"), { size: [0.22, 0.05, 0.12], r: 0.012, n: 1, at: [0, 0.025, 0] });
    sphere(p.geo(mat), { r: 0.045, seg: 14, rings: 7, half: true, at: [0, 0.05, 0], scaleY: 0.7 });
    return p;
  };

  // --- electrolytic capacitor: aluminium can with a dark polarity stripe, vent cross, plastic base ---
  P.electrolytic = scene.part("electrolytic");
  cylinder(P.electrolytic.geo("plastic"), { r: 0.3, h: 0.05, bevel: 0.01, seg: 28, at: [0, 0.025, 0] });
  cylinder(P.electrolytic.geo("alu"), { r: 0.28, h: 0.42, bevel: 0.035, seg: 36, steps: 3, at: [0, 0.26, 0] });
  cylinder(P.electrolytic.geo("graphite"), { r: 0.2815, h: 0.36, bevel: 0.0, seg: 8, at: [0, 0.27, 0], from: -0.75, to: 0.75 });
  for (const a of [0, Math.PI / 2]) roundedBox(P.electrolytic.geo("steel"), { size: [0.2, 0.004, 0.012], r: 0.002, n: 1, at: [0, 0.4705, 0] });
  roundedBox(P.electrolytic.geo("steel"), { size: [0.012, 0.004, 0.2], r: 0.002, n: 1, at: [0, 0.4705, 0] });

  // --- pin header: plastic housing and gold-tipped pins (one pin instanced N times) ---
  P.headerHousing = (n) => {
    const p = scene.part(`header-${n}`);
    roundedBox(p.geo("plastic"), { size: [0.254 * n, 0.25, 0.26], r: 0.02, n: 1, at: [0, 0.125, 0] });
    return p;
  };
  P.headerPin = scene.part("header-pin");
  roundedBox(P.headerPin.geo("gold"), { size: [0.06, 0.5, 0.06], r: 0.008, n: 1, at: [0, 0.25, 0] });
  lathe(P.headerPin.geo("gold"), { profile: [[0.043, 0.5, 0, 1], [0.012, 0.58, 0, 1], [0, 0.58, 0, 1]], seg: 4, flat: true, at: [0, 0, 0] });

  // --- USB micro/C-style receptacle: steel shell with a dark opening and a plastic tongue ---
  P.usb = scene.part("usb");
  roundedBox(P.usb.geo("steel"), { size: [0.95, 0.34, 0.82], r: 0.08, n: 3, at: [0, 0.17, 0] });
  roundedBox(P.usb.geo("rubber"), { size: [0.06, 0.2, 0.64], r: 0.03, n: 1, at: [0.455, 0.17, 0] });
  roundedBox(P.usb.geo("plastic"), { size: [0.2, 0.05, 0.5], r: 0.01, n: 1, at: [0.4, 0.17, 0] });
  for (const z of [-0.36, 0.36]) roundedBox(P.usb.geo("chrome"), { size: [0.5, 0.35, 0.03], r: 0.01, n: 1, at: [-0.1, 0.17, z] });

  // --- SMD crystal ---
  P.crystal = scene.part("crystal");
  roundedBox(P.crystal.geo("tin"), { size: [0.62, 0.17, 0.3], r: 0.05, n: 2, at: [0, 0.085, 0] });
  roundedBox(P.crystal.geo("rubber"), { size: [0.45, 0.004, 0.18], r: 0.01, n: 1, at: [0, 0.172, 0] });

  // --- tactile switch ---
  P.button = scene.part("button");
  roundedBox(P.button.geo("steel"), { size: [0.5, 0.17, 0.5], r: 0.04, n: 2, at: [0, 0.085, 0] });
  cylinder(P.button.geo("plastic"), { r: 0.13, h: 0.12, bevel: 0.025, seg: 20, at: [0, 0.2, 0] });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) roundedBox(P.button.geo("tin"), { size: [0.1, 0.014, 0.08], r: 0.004, n: 1, at: [sx * 0.29, 0.007, sz * 0.15] });

  // --- inductor / ferrite block ---
  P.inductor = scene.part("inductor");
  roundedBox(P.inductor.geo("graphite"), { size: [0.52, 0.3, 0.52], r: 0.06, n: 2, at: [0, 0.15, 0] });
  roundedBox(P.inductor.geo("tin"), { size: [0.08, 0.04, 0.4], r: 0.01, n: 1, at: [0.24, 0.02, 0] });
  roundedBox(P.inductor.geo("tin"), { size: [0.08, 0.04, 0.4], r: 0.01, n: 1, at: [-0.24, 0.02, 0] });

  // --- screw terminal block, n poles ---
  P.terminal = (n) => {
    const p = scene.part(`terminal-${n}`);
    const w = 0.5 * n;
    roundedBox(p.geo("terminal"), { size: [w, 0.56, 0.62], r: 0.05, n: 2, at: [0, 0.28, 0] });
    for (let i = 0; i < n; i++) {
      const x = -w / 2 + 0.25 + i * 0.5;
      cylinder(p.geo("steel"), { r: 0.11, h: 0.05, bevel: 0.012, seg: 18, at: [x, 0.585, -0.08] });
      roundedBox(p.geo("rubber"), { size: [0.026, 0.006, 0.16], r: 0.002, n: 1, at: [x, 0.613, -0.08] });
      roundedBox(p.geo("rubber"), { size: [0.3, 0.2, 0.05], r: 0.02, n: 1, at: [x, 0.2, 0.3] });
    }
    return p;
  };

  // --- mounting hole: gold ring pad with a dark bore, and a plain via/test pad ---
  P.hole = scene.part("hole");
  disc(P.hole.geo("gold"), { rIn: 0.12, rOut: 0.26, y: 0.003, seg: 24 });
  disc(P.hole.geo("rubber"), { rOut: 0.12, y: -0.004, seg: 24 });
  P.pad = scene.part("pad");
  disc(P.pad.geo("gold"), { rOut: 0.05, y: 0.002, seg: 12 });
  P.screw = scene.part("screw");
  cylinder(P.screw.geo("steel"), { r: 0.17, h: 0.07, bevel: 0.02, seg: 20, at: [0, 0.035, 0] });
  roundedBox(P.screw.geo("rubber"), { size: [0.26, 0.012, 0.035], r: 0.004, n: 1, at: [0, 0.07, 0] });
  roundedBox(P.screw.geo("rubber"), { size: [0.035, 0.012, 0.26], r: 0.004, n: 1, at: [0, 0.07, 0] });
  return P;
}
