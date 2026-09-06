/* tune.js — randomised search over the pacing constants against an explicit
 * cost function. Beats hand-tuning because the knobs interact: fuel value,
 * respawn rate, entropy and steal efficiency all push on match length at once.
 *   node tools/tune.js [configs] [matchesPerConfig]
 */
'use strict';
global.self = global;
global.performance = global.performance || { now: () => Date.now() };
require('../js/rng.js'); require('../js/juice.js'); require('../js/game.js');
const K = Game.K;

const N_CFG = parseInt(process.argv[2] || '140', 10);
const N_MATCH = parseInt(process.argv[3] || '60', 10);
const TARGET_LEN = 55;

const SPACE = {
  EMBER_VALUE:     [7, 9, 11, 13],
  EMBER_RESPAWN:   [0.30, 0.40, 0.50, 0.62],
  FUEL_DECAY:      [0.02, 0.035, 0.05, 0.07],
  ENTROPY_PER_SEC: [1 / 220, 1 / 175, 1 / 140, 1 / 110],
  STEAL_KEEP:      [0.5, 0.58, 0.66],
  FLAME_START:     [34, 40, 46],
  DRAIN_BASE:      [0.85, 1.15, 1.45],
  DRAIN_K:         [0.045, 0.055, 0.065],
};
const KEYS = Object.keys(SPACE);

// Deterministic search order so the run is reproducible.
let s = 20260906;
const rnd = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; s |= 0; return Math.abs(s % 100000) / 100000; };

function evaluate() {
  const dur = [], gap = [], last = [], first = [], win = {}, arch = {}, rel = [], peaks = [], abs = [], fuel = [];
  for (let i = 0; i < N_MATCH; i++) {
    const g = new Game({ seed: 't-' + i, mode: 'sim', auto: true });
    g.reduced = true; g.startPlay();
    let guard = 0;
    while (g.state !== 'done' && guard++ < 60 * 300) g.update(1 / 60, null);
    if (g.state !== 'done') g._finish();
    const d = g.souls.map(x => x.diedAt).sort((a, b) => a - b);
    let mx = 0;
    for (let j = 1; j < d.length; j++) mx = Math.max(mx, d[j] - d[j - 1]);
    dur.push(g.result.matchTime); gap.push(mx); first.push(d[0]); last.push(d[11] - d[10]);
    g.souls.forEach(x => peaks.push(x.peak));
    d.forEach(x => abs.push(x));
    // Where each death fell between the first death and the end — flatness here
    // is what "the match keeps happening" actually means.
    const span = Math.max(0.001, d[11] - d[0]);
    d.forEach(x => rel.push((x - d[0]) / span));
    const w = g.souls.find(x => x.rank === 1);
    win[w.arch] = (win[w.arch] || 0) + 1;
    g.souls.forEach(x => { arch[x.arch] = (arch[x.arch] || 0) + 1; });
  }
  const med = a => { const b = a.slice().sort((x, y) => x - y); return b[b.length >> 1]; };
  const bins = new Array(8).fill(0);
  rel.forEach(r => bins[Math.min(7, Math.floor(r * 8))]++);
  const worst = Math.max(...bins) / rel.length;      // share in the busiest eighth
  // Also in absolute time: a 10s window that kills half the field reads as a
  // mass die-off no matter how it normalises.
  const ab = {};
  abs.forEach(x => { const b = Math.floor(x / 10); ab[b] = (ab[b] || 0) + 1; });
  const worstAbs = Math.max(...Object.values(ab)) / abs.length;
  const peak = peaks.slice().sort((a, b) => a - b)[peaks.length >> 1];
  let sk = 0;
  for (const a of Object.keys(arch)) sk += Math.abs((win[a] || 0) / N_MATCH - arch[a] / (N_MATCH * 12));
  const r = { len: med(dur), gap: med(gap), first: med(first), last: med(last), worst, worstAbs, peak, sk, win, bins: bins.map(b => b / rel.length) };
  r.cost = Math.abs(r.len - TARGET_LEN) / 10
         + Math.max(0, r.gap - 12) / 4
         + Math.max(0, r.worst - 0.28) * 7          // no mass die-off in one window
         + Math.max(0, r.worstAbs - 0.30) * 7
         + r.sk * 2.5
         + Math.abs(r.last - 3) * 2
         + Math.max(0, r.first - 18) / 8
         // Souls must actually get bright, or the whole "bright burns out
         // fastest" tension never fires and the palette stays one colour.
         + Math.max(0, 55 - r.peak) / 14;
  return r;
}

const seen = new Set(), out = [];
for (let i = 0; i < N_CFG; i++) {
  const cfg = {};
  KEYS.forEach(k => { cfg[k] = SPACE[k][Math.floor(rnd() * SPACE[k].length)]; });
  const sig = KEYS.map(k => cfg[k]).join(',');
  if (seen.has(sig)) { i--; continue; }
  seen.add(sig);
  KEYS.forEach(k => { K[k] = cfg[k]; });
  const r = evaluate();
  out.push({ cfg, r });
  if ((i + 1) % 20 === 0) process.stderr.write('  ...' + (i + 1) + '/' + N_CFG + '\n');
}
out.sort((a, b) => a.r.cost - b.r.cost);
console.log('TOP 10 of ' + N_CFG + ' configs (' + N_MATCH + ' matches each)\n');
out.slice(0, 10).forEach((x, i) => {
  console.log('#' + (i + 1) + '  cost ' + x.r.cost.toFixed(3) +
    '  len ' + x.r.len.toFixed(1) + 's  maxGap ' + x.r.gap.toFixed(1) + 's  1st ' + x.r.first.toFixed(1) +
    's  final ' + x.r.last.toFixed(2) + 's  busy8 ' + (x.r.worst * 100).toFixed(0) + '% busy10s ' + (x.r.worstAbs * 100).toFixed(0) + '%  peak ' + x.r.peak.toFixed(0) + '  skew ' + x.r.sk.toFixed(3));
  console.log('     ' + KEYS.map(k => k + '=' + (k === 'ENTROPY_PER_SEC' ? '1/' + (1 / x.cfg[k]).toFixed(0) : x.cfg[k])).join(' '));
  console.log('     winners ' + JSON.stringify(x.r.win));
});
const b = out[0];
console.log('\nBEST CONFIG (paste into K):');
KEYS.forEach(k => console.log('  ' + k + ': ' + (k === 'ENTROPY_PER_SEC' ? '1 / ' + (1 / b.cfg[k]).toFixed(0) : b.cfg[k]) + ','));
console.log('\ndeath spread across the match, first death -> end:');
b.r.bins.forEach((v, i) => console.log('  ' + ((i * 12.5) | 0) + '-' + (((i + 1) * 12.5) | 0) + '%  ' + '#'.repeat(Math.round(v * 100)) + ' ' + (v * 100).toFixed(1) + '%'));
