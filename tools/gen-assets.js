/* gen-assets.js — generates every PNG the site ships (PWA icons, apple-touch
 * icon, Open Graph card) from code, so there are no binary assets in the repo
 * and the palette lives in exactly one place.
 *   node tools/gen-assets.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { Surface, encodePNG } = require('./png.js');
const F = require('./font.js');

const C = {
  void: '#07060d', field: '#1a1030', ring: '#7b2ff7',
  ember: '#ff2d55', emberIn: '#ffd0dc',
  hot: '#fff3b0', amber: '#ff9f1c', violet: '#7b2ff7', cold: '#4361ee',
  cyan: '#00f5d4', text: '#f2eefc', dim: '#9a90b8'
};

/** The spiky "ember": the thing that looks like a hazard and is actually food. */
function star(surf, cx, cy, r, rot, hex) {
  const pts = [];
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 + rot;
    const rad = i % 2 === 0 ? r * 1.5 : r * 0.62;
    pts.push([cx + Math.cos(a) * rad, cy + Math.sin(a) * rad]);
  }
  surf.poly(pts, hex);
}

function soul(surf, cx, cy, r, flame01) {
  const col = flame01 > 0.8 ? C.hot : flame01 > 0.6 ? C.amber : flame01 > 0.38 ? C.ember : flame01 > 0.18 ? C.violet : C.cold;
  surf.glow(cx, cy, r * (3.2 + flame01 * 3.5), col, 0.5 + flame01 * 0.35, 2.2);
  surf.disc(cx, cy, r, col);
  surf.disc(cx - r * 0.16, cy - r * 0.18, r * (0.3 + flame01 * 0.28), '#ffffff', 0.45 + flame01 * 0.45);
  return col;
}

/* ---- icon ------------------------------------------------------------------
 * One soul, alone, inside a closing ring. Reads at 48px as "a light about to
 * go out", which is the game. */
function makeIcon(size, safe) {
  const s = new Surface(size, size);
  s.fill(C.void);
  const cx = size / 2, cy = size / 2;
  const k = safe ? 0.74 : 1;                 // maskable icons get a safe zone

  s.glow(cx, cy, size * 0.48 * k, C.field, 0.95, 1.5);
  s.ring(cx, cy, size * 0.355 * k, Math.max(1.5, size * 0.016), C.ring, 0.85);
  s.ring(cx, cy, size * 0.355 * k, Math.max(3, size * 0.055), C.ring, 0.16);

  const er = size * 0.036 * k;
  star(s, cx + size * 0.235 * k, cy - size * 0.185 * k, er, 0.3, C.ember);
  star(s, cx - size * 0.245 * k, cy + size * 0.165 * k, er, 1.1, C.ember);
  s.glow(cx + size * 0.235 * k, cy - size * 0.185 * k, er * 4, C.ember, 0.5, 2);
  s.glow(cx - size * 0.245 * k, cy + size * 0.165 * k, er * 4, C.ember, 0.5, 2);

  soul(s, cx, cy, size * 0.105 * k, 0.95);
  return s;
}

/* ---- Open Graph card -------------------------------------------------------
 * Social crawlers do not run JavaScript, so this is one static 1200x630 for
 * every link. It has to sell the paradox in a single glance. */
function makeOG() {
  const W = 1200, H = 630;
  const s = new Surface(W, H);
  s.fill(C.void);

  // Faint dust so the black isn't dead flat.
  let seed = 987654321;
  const rnd = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; seed |= 0; return Math.abs(seed % 10000) / 10000; };
  for (let i = 0; i < 220; i++) s.disc(rnd() * W, rnd() * H, rnd() * 1.4 + 0.4, C.dim, rnd() * 0.28 + 0.05);

  const cx = W * 0.735, cy = H * 0.5, ringR = 218;
  s.glow(cx, cy, ringR * 1.15, C.field, 1, 1.4);
  s.ring(cx, cy, ringR, 3, C.ring, 0.75);
  s.ring(cx, cy, ringR, 22, C.ring, 0.12);

  // A match mid-collapse: a few dim survivors, one doomed bright one, and fuel.
  const souls = [
    [0.10, -0.42, 12, 0.12], [-0.46, 0.20, 12, 0.22], [0.44, 0.34, 13, 0.30],
    [-0.16, 0.50, 12, 0.16], [0.55, -0.22, 12, 0.10], [-0.30, -0.30, 20, 0.96]
  ];
  for (const [dx, dy, r, f] of souls) soul(s, cx + dx * ringR, cy + dy * ringR, r, f);
  for (const [dx, dy, rot] of [[0.62, 0.05, 0.4], [-0.05, -0.66, 1.2], [0.20, 0.72, 2.0]]) {
    const ex = cx + dx * ringR, ey = cy + dy * ringR;
    s.glow(ex, ey, 42, C.ember, 0.55, 2);
    star(s, ex, ey, 11, rot, C.ember);
    s.disc(ex, ey, 5, C.emberIn);
  }
  // The cyan "you" marker, dim and still burning.
  const px = cx - 0.30 * ringR, py = cy + 0.62 * ringR;
  soul(s, px, py, 13, 0.2);
  s.ring(px, py, 20, 2.5, C.cyan, 0.95);

  const lx = 78;
  // Glyphs are 7 rows tall, so a line at y with scale k occupies y .. y+7k.
  // Laid out explicitly to keep DEAD (7*22 = 154px tall) clear of the subtitle.
  F.draw(s, 'LAST ONE', lx, 130, 9, C.dim, { spacing: 2 });      // 130..193
  F.draw(s, 'DEAD', lx, 205, 22, C.text, { spacing: 2 });         // 205..359
  F.draw(s, 'THE VIGIL', lx, 380, 4.6, C.cyan, { spacing: 5 });   // 380..412
  s.rect(lx, 440, 372, 3, C.ember, 0.85);
  F.draw(s, 'THE OIL IN YOURS', lx, 466, 4.4, C.dim, { spacing: 1 });
  F.draw(s, 'IS NOT YOURS.', lx, 502, 4.4, C.dim, { spacing: 1 });
  F.draw(s, 'GET IT TO THE END', lx, 546, 4.8, C.hot, { spacing: 1 });
  F.draw(s, 'OF THE NIGHT.', lx, 586, 4.8, C.hot, { spacing: 1 });  // ..620
  return s;
}

const out = path.join(__dirname, '..', 'icons');
fs.mkdirSync(out, { recursive: true });

const jobs = [
  ['icon-192.png', makeIcon(192, false)],
  ['icon-512.png', makeIcon(512, false)],
  ['maskable-512.png', makeIcon(512, true)],
  ['apple-touch-icon.png', makeIcon(180, false)],
  ['og.png', makeOG()]
];
for (const [name, surf] of jobs) {
  const buf = encodePNG(surf.w, surf.h, surf.d);
  fs.writeFileSync(path.join(out, name), buf);
  console.log(name.padEnd(22), surf.w + 'x' + surf.h, (buf.length / 1024).toFixed(1) + ' KB');
}
