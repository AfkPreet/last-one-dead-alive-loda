/* sim.js — headless balance harness. Runs the arena with every soul on AI and
 * reports pacing so tuning changes can be judged by numbers, not vibes.
 *   node tools/sim.js [matches]
 */
'use strict';
global.self = global;
global.performance = global.performance || { now: () => Date.now() };
require('../js/rng.js');
require('../js/juice.js');
require('../js/game.js');

const N = parseInt(process.argv[2] || '200', 10);
const DT = 1 / 60;
const K = Game.K;

function run(seed) {
  const g = new Game({ seed, mode: 'sim', worldH: 178, auto: true });
  g.reduced = true;                       // no trail particles: pure sim cost
  g.startPlay();
  let guard = 0;
  while (g.state !== 'done' && guard < 60 * 400) {
    g.update(DT, null);
    guard++;
  }
  if (g.state !== 'done') g._finish();
  return g;
}

const stats = { dur: [], deaths: [], gaps: [], eaten: [], peak: [], arch: {}, winnerArch: {}, firstDeath: [], lastGap: [] };
for (let i = 0; i < N; i++) {
  const g = run('sim-' + i);
  const st = g.souls.slice().sort((a, b) => a.diedAt - b.diedAt);
  stats.dur.push(g.result.matchTime);
  stats.firstDeath.push(st[0].diedAt);
  st.forEach(s => stats.deaths.push(s.diedAt));
  const last2 = st.slice(-2);
  stats.lastGap.push(last2[1].diedAt - last2[0].diedAt);
  for (const s of g.souls) {
    stats.eaten.push(s.eaten);
    stats.peak.push(s.peak);
    stats.arch[s.arch] = (stats.arch[s.arch] || 0) + 1;
  }
  const winner = g.souls.find(s => s.rank === 1);
  stats.winnerArch[winner.arch] = (stats.winnerArch[winner.arch] || 0) + 1;
}

const q = (a, p) => { const b = a.slice().sort((x, y) => x - y); return b[Math.floor(p * (b.length - 1))]; };
const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
const f = n => n.toFixed(1);

console.log(`=== ${N} matches, 12 souls, all AI ===`);
console.log(`match length     min ${f(q(stats.dur,0))}s  p25 ${f(q(stats.dur,.25))}s  median ${f(q(stats.dur,.5))}s  p75 ${f(q(stats.dur,.75))}s  max ${f(q(stats.dur,1))}s`);
console.log(`first death at   median ${f(q(stats.firstDeath,.5))}s   (min ${f(q(stats.firstDeath,0))}s)`);
console.log(`final 2 gap      median ${f(q(stats.lastGap,.5))}s  p90 ${f(q(stats.lastGap,.9))}s   photo-finish(<6s) ${(stats.lastGap.filter(x=>x<6).length/N*100).toFixed(0)}%`);
console.log(`embers eaten     mean ${f(mean(stats.eaten))}  max ${Math.max(...stats.eaten)}`);
console.log(`peak flame       mean ${f(mean(stats.peak))}  p90 ${f(q(stats.peak,.9))}`);

console.log('\ndeath timeline (share of all deaths per 10s bucket):');
const buckets = {};
stats.deaths.forEach(d => { const b = Math.floor(d / 10) * 10; buckets[b] = (buckets[b] || 0) + 1; });
Object.keys(buckets).map(Number).sort((a, b) => a - b).forEach(b => {
  const pct = buckets[b] / stats.deaths.length * 100;
  console.log(`  ${String(b).padStart(3)}-${String(b + 10).padStart(3)}s ${'#'.repeat(Math.round(pct))} ${pct.toFixed(1)}%`);
});

console.log('\nwins by archetype (fair AI => should be spread, not one dominant):');
const total = Object.values(stats.winnerArch).reduce((a, b) => a + b, 0);
Object.keys(stats.arch).sort().forEach(a => {
  const w = stats.winnerArch[a] || 0;
  const played = stats.arch[a] / 12;
  console.log(`  ${a.padEnd(8)} wins ${String(w).padStart(4)}  (${(w / total * 100).toFixed(1)}% of wins, ${(stats.arch[a] / (N * 12) * 100).toFixed(1)}% of field) winrate ${(w / (stats.arch[a] / 12) * 100 / (100/12) ).toFixed(2)}x`);
});
