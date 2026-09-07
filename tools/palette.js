/* palette.js — pick a flame ramp that a player can actually read.
 * Scores candidate ramps on: separation from the fuel colour, separation from
 * the player marker, and whether the ramp stays ordered under protanopia and
 * deuteranopia. Run: node tools/palette.js
 */
'use strict';
global.self = global;
require('../js/juice.js');

const srgb = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
const hex2rgb = h => { h = h.replace('#', ''); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)); };
const rgb2hex = c => '#' + c.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');

function lab(hex) {
  const [R, G, B] = hex2rgb(hex).map(srgb);
  let X = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047;
  let Y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
  let Z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
  const t = v => v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116;
  [X, Y, Z] = [t(X), t(Y), t(Z)];
  return [116 * Y - 16, 500 * (X - Y), 200 * (Y - Z)];
}
const dE = (a, b) => { const A = lab(a), B = lab(b); return Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]); };

/* Brettel-style dichromat simulation in linear RGB via LMS. */
function simulate(hex, type) {
  const [R, G, B] = hex2rgb(hex).map(srgb);
  const L = 0.31399 * R + 0.63951 * G + 0.04650 * B;
  const M = 0.15537 * R + 0.75789 * G + 0.08670 * B;
  const S = 0.01775 * R + 0.10944 * G + 0.87259 * B;
  let l = L, m = M, s = S;
  if (type === 'protan') l = 1.05118294 * M - 0.05116099 * S;
  if (type === 'deutan') m = 0.9513092 * L + 0.04866992 * S;
  const r = 5.47221206 * l - 4.6419601 * m + 0.16963708 * s;
  const g = -1.1252419 * l + 2.29317094 * m - 0.1678952 * s;
  const b = 0.02980165 * l - 0.19318073 * m + 1.16364789 * s;
  const back = v => { v = Math.max(0, Math.min(1, v)); return 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055); };
  return rgb2hex([back(r), back(g), back(b)]);
}

const EMBER_CANDIDATES = ['#ff2d55', '#ff5a1f', '#ffc300'];
const YOU = '#00f5d4';

const RAMPS = {
  current: [[0,'#2b3a8f'],[0.10,'#4361ee'],[0.24,'#7b2ff7'],[0.40,'#c026d3'],[0.55,'#ff2d55'],[0.72,'#ff9f1c'],[0.88,'#ffe066'],[1,'#fff8e0']],
  cool:    [[0,'#26317a'],[0.14,'#3f5bd6'],[0.34,'#7b3ff5'],[0.56,'#a838f2'],[0.76,'#d84ae8'],[0.90,'#f7a6f2'],[1,'#ffffff']],
  iceblue: [[0,'#1d2a63'],[0.16,'#2f6bd8'],[0.36,'#3fa9e0'],[0.58,'#7fd4e8'],[0.78,'#bfeaf2'],[1,'#ffffff']],
  violet:  [[0,'#221a52'],[0.15,'#4433c4'],[0.35,'#7a3ff0'],[0.58,'#b56af7'],[0.80,'#e0a8fb'],[1,'#ffffff']],
};

function scoreRamp(name, stops, ember) {
  const cols = [];
  for (let v = 0; v <= 100; v += 5) cols.push(Juice.rampHex(stops, v / 100, 20));
  let minEmber = 1e9, minYou = 1e9, minStep = 1e9, minEmberCB = 1e9;
  for (let i = 0; i < cols.length; i++) {
    minEmber = Math.min(minEmber, dE(cols[i], ember));
    minYou = Math.min(minYou, dE(cols[i], YOU));
    for (const t of ['protan', 'deutan']) {
      minEmberCB = Math.min(minEmberCB, dE(simulate(cols[i], t), simulate(ember, t)));
    }
    // Ordered scale: two souls 20 flame apart must be tellable.
    if (i >= 4) minStep = Math.min(minStep, dE(cols[i], cols[i - 4]));
  }
  return { name, ember, minEmber, minEmberCB, minYou, minStep };
}

console.log('ramp      fuel      vs fuel   vs fuel(CB)   vs YOU    20-flame step');
const rows = [];
for (const [name, stops] of Object.entries(RAMPS)) {
  for (const ember of EMBER_CANDIDATES) {
    const r = scoreRamp(name, stops, ember);
    rows.push(r);
    const flag = r.minEmber < 25 ? '  *** FUEL COLLIDES ***' : (r.minEmberCB < 20 ? '  (collides for colourblind)' : '');
    console.log(name.padEnd(9), ember, r.minEmber.toFixed(1).padStart(8), r.minEmberCB.toFixed(1).padStart(12),
                r.minYou.toFixed(1).padStart(9), r.minStep.toFixed(1).padStart(14), flag);
  }
}
const best = rows.filter(r => r.minEmber >= 30 && r.minEmberCB >= 25 && r.minYou >= 30 && r.minStep >= 12)
                 .sort((a, b) => (b.minEmber + b.minEmberCB + b.minStep) - (a.minEmber + a.minEmberCB + a.minStep));
console.log('\npassing (fuel>=30, fuel-CB>=25, you>=30, readable step>=12):');
best.slice(0, 4).forEach(r => console.log('  ' + r.name + ' + ' + r.ember +
  '  fuel ' + r.minEmber.toFixed(0) + ' / cb ' + r.minEmberCB.toFixed(0) + ' / step ' + r.minStep.toFixed(0)));
if (!best.length) console.log('  none — loosen a constraint or add a candidate');
