// Tiny raster and PNG encoder (RGBA8) for procedural textures: no dependencies except node:zlib.
import { deflateSync } from "node:zlib";

const FONT = {
  A: [14, 17, 17, 31, 17, 17, 17], B: [30, 17, 17, 30, 17, 17, 30], C: [14, 17, 16, 16, 16, 17, 14], D: [30, 17, 17, 17, 17, 17, 30], E: [31, 16, 16, 30, 16, 16, 31],
  F: [31, 16, 16, 30, 16, 16, 16], G: [14, 17, 16, 23, 17, 17, 15], H: [17, 17, 17, 31, 17, 17, 17], I: [14, 4, 4, 4, 4, 4, 14], J: [7, 2, 2, 2, 2, 18, 12],
  K: [17, 18, 20, 24, 20, 18, 17], L: [16, 16, 16, 16, 16, 16, 31], M: [17, 27, 21, 21, 17, 17, 17], N: [17, 17, 25, 21, 19, 17, 17], O: [14, 17, 17, 17, 17, 17, 14],
  P: [30, 17, 17, 30, 16, 16, 16], Q: [14, 17, 17, 17, 21, 18, 13], R: [30, 17, 17, 30, 20, 18, 17], S: [15, 16, 16, 14, 1, 1, 30], T: [31, 4, 4, 4, 4, 4, 4],
  U: [17, 17, 17, 17, 17, 17, 14], V: [17, 17, 17, 17, 17, 10, 4], W: [17, 17, 17, 21, 21, 21, 10], X: [17, 17, 10, 4, 10, 17, 17], Y: [17, 17, 17, 10, 4, 4, 4], Z: [31, 1, 2, 4, 8, 16, 31],
  0: [14, 17, 19, 21, 25, 17, 14], 1: [4, 12, 4, 4, 4, 4, 14], 2: [14, 17, 1, 2, 4, 8, 31], 3: [31, 2, 4, 2, 1, 17, 14], 4: [2, 6, 10, 18, 31, 2, 2],
  5: [31, 16, 30, 1, 1, 17, 14], 6: [6, 8, 16, 30, 17, 17, 14], 7: [31, 1, 2, 4, 8, 8, 8], 8: [14, 17, 17, 14, 17, 17, 14], 9: [14, 17, 17, 15, 1, 2, 12],
  ".": [0, 0, 0, 0, 0, 12, 12], "-": [0, 0, 0, 31, 0, 0, 0], "+": [0, 4, 4, 31, 4, 4, 0], "/": [1, 1, 2, 4, 8, 16, 16], ":": [0, 12, 12, 0, 12, 12, 0], " ": [0, 0, 0, 0, 0, 0, 0],
  "<": [2, 4, 8, 16, 8, 4, 2], ">": [8, 4, 2, 1, 2, 4, 8], "_": [0, 0, 0, 0, 0, 0, 31],
};

export class Raster {
  constructor(w, h, fill = [0, 0, 0, 0]) {
    this.w = w; this.h = h; this.data = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) this.data.set(fill, i * 4);
  }
  px(x, y, c) {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const o = (y * this.w + x) * 4, a = (c[3] ?? 255) / 255;
    if (a >= 1) { this.data[o] = c[0]; this.data[o + 1] = c[1]; this.data[o + 2] = c[2]; this.data[o + 3] = 255; return; }
    const da = this.data[o + 3] / 255, oa = a + da * (1 - a);
    for (let k = 0; k < 3; k++) this.data[o + k] = Math.round((c[k] * a + this.data[o + k] * da * (1 - a)) / (oa || 1));
    this.data[o + 3] = Math.round(oa * 255);
  }
  rect(x, y, w, h, c) { for (let j = Math.floor(y); j < Math.ceil(y + h); j++) for (let i = Math.floor(x); i < Math.ceil(x + w); i++) this.px(i, j, c); }
  frame(x, y, w, h, t, c) { this.rect(x, y, w, t, c); this.rect(x, y + h - t, w, t, c); this.rect(x, y, t, h, c); this.rect(x + w - t, y, t, h, c); }
  disc(cx, cy, r, c) { for (let j = Math.floor(cy - r); j <= Math.ceil(cy + r); j++) for (let i = Math.floor(cx - r); i <= Math.ceil(cx + r); i++) if ((i - cx) ** 2 + (j - cy) ** 2 <= r * r) this.px(i, j, c); }
  ring(cx, cy, r, t, c) { const r0 = (r - t) ** 2, r1 = r * r; for (let j = Math.floor(cy - r); j <= Math.ceil(cy + r); j++) for (let i = Math.floor(cx - r); i <= Math.ceil(cx + r); i++) { const d = (i - cx) ** 2 + (j - cy) ** 2; if (d <= r1 && d >= r0) this.px(i, j, c); } }
  line(x0, y0, x1, y1, t, c) {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let i = 0; i <= n; i++) { const x = x0 + ((x1 - x0) * i) / n, y = y0 + ((y1 - y0) * i) / n; this.rect(x - t / 2, y - t / 2, t, t, c); }
  }
  /** Bitmap text, `s` = pixel size of one font dot. Returns the drawn width. */
  text(str, x, y, s, c) {
    let cx = x;
    for (const ch of String(str).toUpperCase()) {
      const g = FONT[ch] || FONT[" "];
      for (let row = 0; row < 7; row++) for (let col = 0; col < 5; col++) if (g[row] & (1 << (4 - col))) this.rect(cx + col * s, y + row * s, s, s, c);
      cx += 6 * s;
    }
    return cx - x;
  }
}

const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

/** RGBA8 PNG. `opaque` drops the alpha channel (RGB8) when every pixel is opaque, which is smaller. */
export function encodePng(r, { opaque = false } = {}) {
  const ch = opaque ? 3 : 4;
  const raw = Buffer.alloc((r.w * ch + 1) * r.h);
  for (let y = 0; y < r.h; y++) {
    const row = y * (r.w * ch + 1);
    raw[row] = 1;                                              // filter "Sub": smooth gradients and flat areas compress far better
    for (let x = 0; x < r.w; x++) for (let k = 0; k < ch; k++) {
      const v = r.data[(y * r.w + x) * 4 + k], left = x ? r.data[(y * r.w + x - 1) * 4 + k] : 0;
      raw[row + 1 + x * ch + k] = (v - left) & 255;
    }
  }
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const body = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(body)); return Buffer.concat([len, body, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(r.w, 0); ihdr.writeUInt32BE(r.h, 4); ihdr[8] = 8; ihdr[9] = opaque ? 2 : 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

/** Deterministic pseudo-random numbers (mulberry32), so a regenerated model is byte-identical. */
export const rng = (seed) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
