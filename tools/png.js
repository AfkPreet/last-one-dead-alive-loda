/* png.js — minimal RGBA PNG encoder + software raster surface.
 * Used at build time (Node) to generate PWA icons and the Open Graph card so the
 * repo ships zero binary dependencies. Re-run: node tools/gen-assets.js
 */
'use strict';
const zlib = require('zlib');

function crc32(buf) {
  let c, table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xFF];
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}

/** Encode an RGBA Uint8ClampedArray (w*h*4) as a PNG buffer. */
function encodePNG(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0; // filter: none
    for (let x = 0; x < w * 4; x++) raw[y * (w * 4 + 1) + 1 + x] = rgba[y * w * 4 + x];
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---- Software surface with alpha blending ---------------------------------- */
function Surface(w, h) {
  this.w = w; this.h = h;
  this.d = new Uint8ClampedArray(w * h * 4);
}
Surface.prototype.blend = function (x, y, r, g, b, a) {
  if (a <= 0 || x < 0 || y < 0 || x >= this.w || y >= this.h) return;
  const i = (y * this.w + x) * 4, d = this.d;
  const da = d[i + 3] / 255, sa = a;
  const oa = sa + da * (1 - sa);
  if (oa <= 0) return;
  d[i]     = (r * sa + d[i]     * da * (1 - sa)) / oa;
  d[i + 1] = (g * sa + d[i + 1] * da * (1 - sa)) / oa;
  d[i + 2] = (b * sa + d[i + 2] * da * (1 - sa)) / oa;
  d[i + 3] = oa * 255;
};
Surface.prototype.fill = function (hex) {
  const c = hexToRgb(hex);
  for (let i = 0; i < this.d.length; i += 4) {
    this.d[i] = c[0]; this.d[i + 1] = c[1]; this.d[i + 2] = c[2]; this.d[i + 3] = 255;
  }
};
/** Anti-aliased disc via 3x3 supersampling of coverage. */
Surface.prototype.disc = function (cx, cy, rad, hex, alpha) {
  const c = hexToRgb(hex); alpha = alpha === undefined ? 1 : alpha;
  const x0 = Math.max(0, Math.floor(cx - rad - 1)), x1 = Math.min(this.w - 1, Math.ceil(cx + rad + 1));
  const y0 = Math.max(0, Math.floor(cy - rad - 1)), y1 = Math.min(this.h - 1, Math.ceil(cy + rad + 1));
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    let cov = 0;
    for (let sy = 0; sy < 3; sy++) for (let sx = 0; sx < 3; sx++) {
      const px = x + (sx + 0.5) / 3, py = y + (sy + 0.5) / 3;
      if ((px - cx) ** 2 + (py - cy) ** 2 <= rad * rad) cov++;
    }
    if (cov) this.blend(x, y, c[0], c[1], c[2], alpha * cov / 9);
  }
};
/** Radial glow: alpha falls off as (1-t)^power. */
Surface.prototype.glow = function (cx, cy, rad, hex, alpha, power) {
  const c = hexToRgb(hex); power = power || 2; alpha = alpha === undefined ? 1 : alpha;
  const x0 = Math.max(0, Math.floor(cx - rad)), x1 = Math.min(this.w - 1, Math.ceil(cx + rad));
  const y0 = Math.max(0, Math.floor(cy - rad)), y1 = Math.min(this.h - 1, Math.ceil(cy + rad));
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
    if (d >= rad) continue;
    this.blend(x, y, c[0], c[1], c[2], alpha * Math.pow(1 - d / rad, power));
  }
};
/** Anti-aliased convex/concave polygon by 3x3 supersampled point-in-poly. */
Surface.prototype.poly = function (pts, hex, alpha) {
  const c = hexToRgb(hex); alpha = alpha === undefined ? 1 : alpha;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]);
    minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]);
  }
  const x0 = Math.max(0, Math.floor(minX)), x1 = Math.min(this.w - 1, Math.ceil(maxX));
  const y0 = Math.max(0, Math.floor(minY)), y1 = Math.min(this.h - 1, Math.ceil(maxY));
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    let cov = 0;
    for (let sy = 0; sy < 3; sy++) for (let sx = 0; sx < 3; sx++) {
      if (pointInPoly(x + (sx + 0.5) / 3, y + (sy + 0.5) / 3, pts)) cov++;
    }
    if (cov) this.blend(x, y, c[0], c[1], c[2], alpha * cov / 9);
  }
};
Surface.prototype.rect = function (x, y, w, h, hex, alpha) {
  this.poly([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], hex, alpha);
};
Surface.prototype.ring = function (cx, cy, rad, thick, hex, alpha) {
  const c = hexToRgb(hex); alpha = alpha === undefined ? 1 : alpha;
  const outer = rad + thick / 2, inner = rad - thick / 2;
  const x0 = Math.max(0, Math.floor(cx - outer - 1)), x1 = Math.min(this.w - 1, Math.ceil(cx + outer + 1));
  const y0 = Math.max(0, Math.floor(cy - outer - 1)), y1 = Math.min(this.h - 1, Math.ceil(cy + outer + 1));
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    let cov = 0;
    for (let sy = 0; sy < 3; sy++) for (let sx = 0; sx < 3; sx++) {
      const d = Math.hypot(x + (sx + 0.5) / 3 - cx, y + (sy + 0.5) / 3 - cy);
      if (d <= outer && d >= inner) cov++;
    }
    if (cov) this.blend(x, y, c[0], c[1], c[2], alpha * cov / 9);
  }
};

function pointInPoly(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i][0], yi = pts[i][1], xj = pts[j][0], yj = pts[j][1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function hexToRgb(h) {
  h = h.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

module.exports = { encodePNG, Surface, hexToRgb };
