/* test.js — headless assertions over the pure logic: determinism, the share
 * encoding, and simulation invariants that must hold for every seed.
 *   node tools/test.js
 */
'use strict';
global.self = global;
global.performance = global.performance || { now: () => Date.now() };
global.location = { search: '', origin: 'https://example.test', pathname: '/g/' };
Object.defineProperty(global, 'navigator', { value: {}, configurable: true, writable: true });
global.document = { createElement: () => ({ getContext: () => ({}) }) };
require('../js/rng.js');
require('../js/juice.js');
require('../js/game.js');
// Platform + Share need a storage shim; they only ever touch it defensively.
const mem = {};
global.localStorage = {
  getItem: k => (k in mem ? mem[k] : null),
  setItem: (k, v) => { mem[k] = String(v); },
};
global.matchMedia = () => ({ matches: false, addEventListener() {} });
global.addEventListener = () => {};
require('../js/platform.js');
require('../js/share.js');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? '  -> ' + extra : '')); }
}
function eq(name, a, b) { ok(name, JSON.stringify(a) === JSON.stringify(b), JSON.stringify(a) + ' !== ' + JSON.stringify(b)); }

function runMatch(seed, opts) {
  const g = new Game(Object.assign({ seed, mode: 'daily', auto: true }, opts || {}));
  g.reduced = true; g.startPlay();
  let guard = 0;
  while (g.state !== 'done' && guard++ < 60 * 300) g.update(1 / 60, null);
  if (g.state !== 'done') g._finish();
  return g;
}

console.log('\nDETERMINISM');
{
  const a = runMatch('LOD-2026-01-01'), b = runMatch('LOD-2026-01-01');
  eq('same seed -> same match length', a.result.matchTime.toFixed(6), b.result.matchTime.toFixed(6));
  eq('same seed -> same standings',
    a.result.standings.map(s => s.name + ':' + s.rank),
    b.result.standings.map(s => s.name + ':' + s.rank));
  const c = runMatch('LOD-2026-01-02');
  ok('different seed -> different match', a.result.matchTime !== c.result.matchTime);
  ok('no Math.random in gameplay source',
    !/Math\.random/.test(require('fs').readFileSync(__dirname + '/../js/game.js', 'utf8')));
}

console.log('\nRANKING INVARIANTS');
{
  for (const seed of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) {
    const g = runMatch('inv-' + seed);
    const ranks = g.souls.map(s => s.rank).sort((x, y) => x - y);
    const expect = Array.from({ length: Game.K.SOULS }, (_, i) => i + 1);
    if (JSON.stringify(ranks) !== JSON.stringify(expect)) {
      ok('ranks are a permutation of 1..12 (seed ' + seed + ')', false, JSON.stringify(ranks));
      continue;
    }
    const byRank = g.souls.slice().sort((x, y) => x.rank - y.rank);
    // rank 1 == died last. Later death must never rank worse.
    let mono = true;
    for (let i = 1; i < byRank.length; i++) if (byRank[i].diedAt > byRank[i - 1].diedAt + 1e-6) mono = false;
    ok('rank 1 died last, ranks ordered by death time (seed ' + seed + ')', mono);
    ok('every soul is dead at the end (seed ' + seed + ')', g.souls.every(s => !s.alive));
  }
}

console.log('\nSIMULATION SANITY');
{
  let minF = Infinity, maxF = -Infinity, escaped = 0;
  for (let i = 0; i < 20; i++) {
    const g = new Game({ seed: 's-' + i, mode: 'sim', auto: true });
    g.reduced = true; g.startPlay();
    let guard = 0;
    while (g.state !== 'done' && guard++ < 60 * 300) {
      g.update(1 / 60, null);
      for (const s of g.souls) {
        if (!s.alive) continue;
        minF = Math.min(minF, s.flame); maxF = Math.max(maxF, s.flame);
        if (!isFinite(s.x) || !isFinite(s.y)) escaped++;
        if (g.nd(s.x, s.y, Game.K.BOUND) > 1.05) escaped++;
      }
    }
  }
  ok('flame stays within [0, FLAME_MAX]', minF >= -1e-6 && maxF <= Game.K.FLAME_MAX + 1e-6, minF + '..' + maxF);
  ok('no soul escapes the world bound or goes non-finite', escaped === 0, 'violations: ' + escaped);
}

console.log('\nLET GO');
{
  const g = new Game({ seed: 'letgo', mode: 'daily' });
  g.startPlay();
  for (let i = 0; i < 120; i++) g.update(1 / 60, { x: 1, y: 0, mag: 1 });
  const before = g.aliveCount;
  ok('letGo() kills the player immediately', g.letGo() && !g.player.alive);
  eq('alive count drops by one', g.aliveCount, before - 1);
  eq('placement is recorded', g.player.rank, before);
  ok('a second letGo is a no-op', g.letGo() === false);
}

console.log('\nBURNLINE ENCODING');
{
  const B = Share.burnline;
  // 3s per cell; last cell is always the skull.
  eq('a 1s run is a single skull', B([[0.5, 50]], 1, false), '💀');
  // Emoji are surrogate pairs, so compare by code point, not by .slice().
  const cells = str => Array.from(str.replace(/\n/g, ''));
  const long = [];
  for (let t = 0; t < 30; t += 0.4) long.push([t, t < 9 ? 90 : (t < 18 ? 50 : 10)]);
  const line = B(long, 30, false);
  const c = cells(line);
  eq('bright start renders as high glyphs', c.slice(0, 3), ['🟨', '🟨', '🟨']);
  ok('mid flame renders as the mid glyph', c.indexOf('🟥') > 0, line);
  ok('dim tail renders as low glyphs', c.indexOf('⬛') > 0, line);
  eq('ends on a skull', c[c.length - 1], '💀');
  eq('wraps at 10 cells per row', B(long, 30, false).split('\n').length, 1);
  const veryLong = [];
  for (let t = 0; t < 60; t += 0.4) veryLong.push([t, 20]);
  eq('a 60s run wraps to two rows', B(veryLong, 60, false).split('\n').length, 2);
  const hc = cells(B(long, 30, true));
  ok('high-contrast mode swaps the mid and high glyphs',
    hc.indexOf('🟥') === -1 && hc.indexOf('🟨') === -1 && hc.indexOf('🟦') >= 0 && hc.indexOf('🟧') >= 0,
    hc.join(''));
}

console.log('\nSHARE TEXT');
{
  const g = runMatch('LOD-2026-03-03');
  const res = g.result;
  const text = Share.buildText(res, 62, { streak: 4 }, false, null);
  const lines = text.split('\n');
  ok('line 1 names the game and the day', /^LAST ONE DEAD · DAY 62$/.test(lines[0]), lines[0]);
  ok('line 2 carries the placement', /#\d+ \/ 12/.test(lines[1]), lines[1]);
  ok('last line is the challenge url', /^https?:\/\//.test(lines[lines.length - 1]), lines[lines.length - 1]);
  ok('url carries the day and the result', /[?&]d=62/.test(text) && /[&]t=\d+/.test(text));
  ok('grid rows contain only blocks and the skull',
    lines.slice(3).filter(l => /^[⬛🟥🟨🟦🟧💀➕]+$/u.test(l)).length >= 1);
  ok('no vulgarity from the repo slug leaks into the share', !/loda/i.test(text));
  const won = Object.assign({}, res, { rank: 1, won: true });
  ok('a win says it died last', /died LAST/.test(Share.buildText(won, 62, {}, false, null)));
  const ghost = Share.buildText(won, 62, {}, false, { name: 'PRT', time: res.time - 10 });
  ok('a challenge run reports the comparison', /outlived PRT/.test(ghost), ghost);
}

console.log('\nCHALLENGE LINKS');
{
  global.location.search = '?d=248&p=3&t=91&n=pr%20t!!';
  const c = Share.parseChallenge();
  eq('day parsed', c.day, 248);
  eq('placement parsed', c.rank, 3);
  eq('time parsed', c.time, 91);
  eq('name is sanitised and upper-cased', c.name, 'PRT');
  global.location.search = '';
  ok('no params -> no challenge', Share.parseChallenge() === null);
  global.location.search = '?utm_source=x';
  ok('unrelated params -> no challenge', Share.parseChallenge() === null);
}

console.log('\nDAILY SEED');
{
  const d1 = new Date(2026, 8, 6, 23, 59), d2 = new Date(2026, 8, 7, 0, 1);
  ok('seed changes at local midnight', RNG.dailySeedString(d1) !== RNG.dailySeedString(d2));
  ok('seed is stable within a day',
    RNG.dailySeedString(new Date(2026, 8, 6, 1)) === RNG.dailySeedString(new Date(2026, 8, 6, 22)));
  ok('day number increments by one', RNG.dayNumber(d2) === RNG.dayNumber(d1) + 1);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
