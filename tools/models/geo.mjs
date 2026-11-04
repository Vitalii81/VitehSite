// Geometry primitives for the procedural GLB generator. No dependencies. Units are arbitrary (about 1 = 1 cm).
// A Part is a reusable mesh (one Geo per material); a Scene places Parts as instanced glTF nodes (see gltf.mjs).

const EPS = 1e-9;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

export class Geo {
  constructor(material, uv = false) { this.material = material; this.uv = uv; this.pos = []; this.nor = []; this.tex = []; this.idx = []; }
  vert(p, n, t) {
    this.pos.push(p[0], p[1], p[2]); this.nor.push(n[0], n[1], n[2]);
    if (this.uv) this.tex.push(t ? t[0] : 0, t ? t[1] : 0);
    return this.pos.length / 3 - 1;
  }
  /** Adds a triangle, flipping its winding when it disagrees with the vertex normals (keeps every primitive simple to write). */
  tri(a, b, c) {
    const P = (i) => [this.pos[3 * i], this.pos[3 * i + 1], this.pos[3 * i + 2]];
    const N = (i) => [this.nor[3 * i], this.nor[3 * i + 1], this.nor[3 * i + 2]];
    const face = cross(sub(P(b), P(a)), sub(P(c), P(a)));
    const avg = [N(a)[0] + N(b)[0] + N(c)[0], N(a)[1] + N(b)[1] + N(c)[1], N(a)[2] + N(b)[2] + N(c)[2]];
    if (Math.hypot(face[0], face[1], face[2]) < EPS) return;                       // degenerate
    if (dot(face, avg) >= 0) this.idx.push(a, b, c); else this.idx.push(a, c, b);
  }
  quad(a, b, c, d) { this.tri(a, b, c); this.tri(a, c, d); }
}

export class Part {
  constructor(name) { this.name = name; this.geos = new Map(); }
  geo(material, uv = false) {
    const key = material + (uv ? "+uv" : "");
    if (!this.geos.has(key)) this.geos.set(key, new Geo(material, uv));
    return this.geos.get(key);
  }
}

/* ---------- rounded box: flat faces, rounded edges and corners with exact smooth normals ---------- */
export function roundedBox(geo, { size, r = 0, n = 2, at = [0, 0, 0], uvY = false, uvZ = false }) {
  const half = size.map((s) => s / 2);
  r = Math.min(r, ...half);
  const inner = half.map((h) => h - r);
  const samples = (a) => {
    const set = new Set([-half[a], half[a], -inner[a], inner[a]]);
    if (r > EPS && n > 0) for (let k = 1; k < n; k++) { set.add(-half[a] + (r * k) / n); set.add(inner[a] + (r * k) / n); }
    return [...set].sort((x, y) => x - y).filter((v, i, arr) => i === 0 || Math.abs(v - arr[i - 1]) > 1e-7);
  };
  const L = [0, 1, 2].map(samples);
  const point = (p) => {
    const q = p.map((v, i) => clamp(v, -inner[i], inner[i]));
    const d = sub(p, q);
    const len = Math.hypot(d[0], d[1], d[2]);
    const nrm = len > EPS ? [d[0] / len, d[1] / len, d[2] / len] : [0, 1, 0];
    return { pos: [q[0] + nrm[0] * r + at[0], q[1] + nrm[1] * r + at[1], q[2] + nrm[2] * r + at[2]], nrm };
  };
  for (let a = 0; a < 3; a++) {
    for (const s of [-1, 1]) {
      const b = (a + 1) % 3, c = (a + 2) % 3;
      const rows = L[b].length, cols = L[c].length;
      const ids = [];
      for (let i = 0; i < rows; i++) {
        for (let j = 0; j < cols; j++) {
          const p = [0, 0, 0]; p[a] = s * half[a]; p[b] = L[b][i]; p[c] = L[c][j];
          const v = point(p);
          // uvY: planar projection from above (north = image top); uvZ: from the front (+z), image top = +y
          const uv = uvY ? [(v.pos[0] - at[0] + half[0]) / size[0], (v.pos[2] - at[2] + half[2]) / size[2]]
            : uvZ ? [(v.pos[0] - at[0] + half[0]) / size[0], 1 - (v.pos[1] - at[1] + half[1]) / size[1]] : null;
          ids.push(geo.vert(v.pos, v.nrm, uv));
        }
      }
      for (let i = 0; i < rows - 1; i++) for (let j = 0; j < cols - 1; j++) geo.quad(ids[i * cols + j], ids[(i + 1) * cols + j], ids[(i + 1) * cols + j + 1], ids[i * cols + j + 1]);
    }
  }
}

/** Plain flat-shaded box (24 vertices): for pins and slots where roundness would be wasted. */
export function box(geo, { size, at = [0, 0, 0] }) { roundedBox(geo, { size, r: 0, at }); }

/* ---------- lathe: a profile [[radius, y, normalRadius, normalY], ...] revolved around an axis ---------- */
export function lathe(geo, { profile, seg = 24, at = [0, 0, 0], axis = "y", flat = false, uvMap = null, from = 0, to = Math.PI * 2 }) {
  const place = (r, y, a) => {                       // local (radius, y, angle) -> world, according to the axis
    const x = r * Math.cos(a), z = r * Math.sin(a);
    return axis === "y" ? [x, y, z] : axis === "x" ? [y, x, z] : [x, z, y];
  };
  const nplace = (nr, ny, a) => norm(place(nr, ny, a));
  const rings = profile.length;
  const ids = [];
  for (let i = 0; i < rings; i++) {
    const [r, y, nr, ny] = profile[i];
    const row = [];
    for (let k = 0; k <= seg; k++) {
      const a = from + ((to - from) * k) / seg;
      const mid = flat ? from + ((to - from) * (k + 0.5)) / seg : a;
      const p = place(r, y, a);
      row.push(geo.vert([p[0] + at[0], p[1] + at[1], p[2] + at[2]], nplace(nr, ny, mid), uvMap ? uvMap(k / seg, i / (rings - 1), r, y) : null));
    }
    ids.push(row);
  }
  for (let i = 0; i < rings - 1; i++) {
    if (Math.abs(profile[i][0] - profile[i + 1][0]) < EPS && Math.abs(profile[i][1] - profile[i + 1][1]) < EPS) continue;
    for (let k = 0; k < seg; k++) geo.quad(ids[i][k], ids[i + 1][k], ids[i + 1][k + 1], ids[i][k + 1]);
  }
}

const arc = (cx, cy, r, a0, a1, steps) => Array.from({ length: steps + 1 }, (_, i) => {
  const a = a0 + ((a1 - a0) * i) / steps;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a), Math.cos(a), Math.sin(a)];
});

/** Cylinder profile with optional rounded edges (bevel radius b): flat caps, smooth side. */
export function cylProfile(r, h, b = 0, steps = 3) {
  const y0 = -h / 2, y1 = h / 2;
  if (b <= 0) return [[0, y0, 0, -1], [r, y0, 0, -1], [r, y0, 1, 0], [r, y1, 1, 0], [r, y1, 0, 1], [0, y1, 0, 1]];
  const lower = arc(r - b, y0 + b, b, -Math.PI / 2, 0, steps).map(([x, y, nx, ny]) => [x, y, nx, ny]);
  const upper = arc(r - b, y1 - b, b, 0, Math.PI / 2, steps).map(([x, y, nx, ny]) => [x, y, nx, ny]);
  return [[0, y0, 0, -1], ...lower, ...upper, [0, y1, 0, 1]];
}

export const cylinder = (geo, { r, h, bevel = 0, seg = 28, at = [0, 0, 0], axis = "y", flat = false, steps = 3, from, to }) =>
  lathe(geo, { profile: cylProfile(r, h, bevel, steps), seg, at, axis, flat, from, to });

/** Sphere or dome (half = true: upper hemisphere). */
export function sphere(geo, { r, seg = 28, rings = 14, half = false, at = [0, 0, 0], axis = "y", scaleY = 1 }) {
  const max = half ? Math.PI / 2 : Math.PI;
  const profile = Array.from({ length: rings + 1 }, (_, i) => {
    const t = (i / rings) * max;
    return [r * Math.sin(t), r * Math.cos(t) * scaleY, Math.sin(t), Math.cos(t) / scaleY];
  });
  if (half) profile.push([0, 0, 0, -1]);
  lathe(geo, { profile, seg, at, axis });
}

/** Torus lying flat (axis y): major radius R, tube radius t. */
export function torus(geo, { R, t, seg = 40, tube = 14, at = [0, 0, 0], axis = "y" }) {
  const profile = Array.from({ length: tube + 1 }, (_, i) => {
    const a = (i / tube) * Math.PI * 2;
    return [R + t * Math.cos(a), t * Math.sin(a), Math.cos(a), Math.sin(a)];
  });
  lathe(geo, { profile, seg, at, axis });
}

/** Flat ring or disc facing up (+y), optionally with a UV map. */
export function disc(geo, { rIn = 0, rOut, y = 0, seg = 28, at = [0, 0, 0], down = false }) {
  const ny = down ? -1 : 1;
  lathe(geo, { profile: [[rIn, y, 0, ny], [rOut, y, 0, ny]], seg, at });
}

/** Up-facing rectangle grid with UVs (for texture planes). */
export function plane(geo, { w, d, y = 0, at = [0, 0, 0], flipV = false }) {
  const a = geo.vert([at[0] - w / 2, y + at[1], at[2] - d / 2], [0, 1, 0], [0, 0]);
  const b = geo.vert([at[0] + w / 2, y + at[1], at[2] - d / 2], [0, 1, 0], [1, 0]);
  const c = geo.vert([at[0] + w / 2, y + at[1], at[2] + d / 2], [0, 1, 0], [1, 1]);
  const e = geo.vert([at[0] - w / 2, y + at[1], at[2] + d / 2], [0, 1, 0], [0, 1]);
  geo.quad(a, b, c, e);
}

/** Round tube swept along a polyline (parallel-transport frames, smooth normals, flat end caps). */
export function tube(geo, { path, r, seg = 12 }) {
  const dirs = path.map((p, i) => norm(sub(path[Math.min(i + 1, path.length - 1)], path[Math.max(i - 1, 0)])));
  let up = Math.abs(dirs[0][1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const rings = [];
  for (let i = 0; i < path.length; i++) {
    const d = dirs[i];
    const side = norm(cross(d, up));
    up = norm(cross(side, d));
    const ring = [];
    for (let k = 0; k <= seg; k++) {
      const a = (k / seg) * Math.PI * 2;
      const n = [side[0] * Math.cos(a) + up[0] * Math.sin(a), side[1] * Math.cos(a) + up[1] * Math.sin(a), side[2] * Math.cos(a) + up[2] * Math.sin(a)];
      ring.push(geo.vert([path[i][0] + n[0] * r, path[i][1] + n[1] * r, path[i][2] + n[2] * r], n));
    }
    rings.push(ring);
  }
  for (let i = 0; i < rings.length - 1; i++) for (let k = 0; k < seg; k++) geo.quad(rings[i][k], rings[i + 1][k], rings[i + 1][k + 1], rings[i][k + 1]);
  for (const [i, sgn] of [[0, -1], [path.length - 1, 1]]) {
    const n = dirs[i].map((v) => v * sgn);
    const c = geo.vert(path[i], n);
    const ids = rings[i].map((_, k) => { const p = rings[i][k]; return geo.vert([geo.pos[3 * p], geo.pos[3 * p + 1], geo.pos[3 * p + 2]], n); });
    for (let k = 0; k < seg; k++) geo.tri(c, ids[k], ids[k + 1]);
  }
}

/** Cubic Bezier sampled into a polyline. */
export function bezier(p0, p1, p2, p3, steps = 18) {
  return Array.from({ length: steps + 1 }, (_, i) => {
    const t = i / steps, u = 1 - t;
    return [0, 1, 2].map((k) => u * u * u * p0[k] + 3 * u * u * t * p1[k] + 3 * u * t * t * p2[k] + t * t * t * p3[k]);
  });
}

/** One quad from four corners (counter-clockwise seen from the normal side) with explicit UVs. */
export function quadUV(geo, corners, normal, uvs) {
  const ids = corners.map((c, i) => geo.vert(c, normal, uvs[i]));
  geo.quad(ids[0], ids[1], ids[2], ids[3]);
}
