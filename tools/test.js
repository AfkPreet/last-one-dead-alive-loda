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

console.log('\nUNOBSERVED PLACEMENTS ARE FLAGGED');
{
  // Dying early stops the simulation after a few seconds of spectating, so the
  // order of everyone still burning is an estimate. The result has to say so,
  // or the results screen reports a guess as fact.
  const g = new Game({ seed: 'cut', mode: 'daily' });
  g.startPlay();
  for (let i = 0; i < 120; i++) g.update(1 / 60, { x: 1, y: 0, mag: 1 });
  g.letGo();
  ok('letting go early leaves souls burning', g.aliveCount > 0, 'alive=' + g.aliveCount);
  g.skipSpectate();
  ok('the result flags that the match was cut short', g.result.cut === true);
  // The player's OWN placement is observed, not guessed: it is the number of
  // souls still burning at the moment they went out.
  ok('and the player\'s own placement is still exact',
    g.result.outlasted === g.result.rank - 1, JSON.stringify({ r: g.result.rank, o: g.result.outlasted }));

  const full = runMatch('cut');
  ok('a match played to the end is not flagged', full.result.cut === false, String(full.result.cut));
  ok('and does name a soul that died last', !!full.result.standings[0].name);
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
  ok('line 1 names the game and the night', /^LAST ONE DEAD · NIGHT 62$/.test(lines[0]), lines[0]);
  ok('line 2 carries the placement', /#\d+ \/ 12/.test(lines[1]), lines[1]);
  ok('last line is the challenge url', /^https?:\/\//.test(lines[lines.length - 1]), lines[lines.length - 1]);
  ok('url carries the day and the result', /[?&]d=62/.test(text) && /[&]t=\d+/.test(text));
  ok('grid rows contain only blocks and the skull',
    lines.slice(3).filter(l => /^[⬛🟥🟨🟦🟧💀➕]+$/u.test(l)).length >= 1);
  ok('no vulgarity from the repo slug leaks into the share', !/loda/i.test(text));
  const won = Object.assign({}, res, { rank: 1, won: true });
  ok('a win says it died last', /died LAST/.test(Share.buildText(won, 62, {}, false, null)));
  // The share must carry the story as well as the placement, or it is a score
  // with nothing in it for a stranger to ask about.
  ok('a win names who reached the end in your hands',
    /MARA reached the end of the night in my hands\./.test(Share.buildText(won, 62, {}, false, null, 'MARA')));
  // The base run may itself be a win, so state the loss explicitly.
  const lost = Object.assign({}, res, { rank: 7, won: false, outlasted: 6 });
  ok('a loss names who went out in your hands',
    /MARA went out in my hands\./.test(Share.buildText(lost, 62, {}, false, null, 'MARA')));
  ok('with no one to name it still reads',
    /It went out in my hands\./.test(Share.buildText(lost, 62, {}, false, null, null)));
  ok('spilled light is reported when there was any',
    /light spilled/.test(Share.buildText(Object.assign({}, res, { spilt: 31 }), 62, {}, false, null, 'MARA')));
  const ghost = Share.buildText(won, 62, {}, false, { name: 'PRT', time: res.time - 10 });
  ok('a challenge run reports the comparison', /outlived PRT/.test(ghost), ghost);
}

console.log('\nRE-SHARING KEEPS THE ARENA');
{
  // Forwarding somebody's endless challenge must forward the SEED. Emitting
  // "?d=<today>" instead would silently point the next player at a different
  // arena and break the chain.
  const endless = { mode: 'endless', seed: 'E-999-abc', rank: 1, total: 12, time: 44,
                    samples: [[1, 40]], won: true, eaten: 3, stolen: 5, peak: 50 };
  const url = Share.challengeUrl(endless, RNG.dayNumber());
  ok('an endless result re-shares its seed, not a day', /[?&]s=E-999-abc/.test(url) && !/[?&]d=/.test(url), url);
  const head = Share.buildText(endless, RNG.dayNumber(), {}, false, null).split('\n')[0];
  ok('and is labelled by its seed words, not "DAY n"', !/DAY \d/.test(head), head);
  const daily = Object.assign({}, endless, { mode: 'daily', seed: RNG.dailySeedString() });
  const durl = Share.challengeUrl(daily, RNG.dayNumber());
  ok('a daily result still re-shares as a day', /[?&]d=\d+/.test(durl) && !/[?&]s=/.test(durl), durl);
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

console.log('\nCHALLENGE LINKS REPLAY THE SAME ARENA');
{
  // The bug this guards: the daily used a date-string seed while ?d=N rebuilt a
  // different one, so a "play my exact run" link played a different match.
  const day = RNG.dayNumber();
  eq('daily seed == seedForDay(today)', RNG.dailySeedString(), RNG.seedForDay(day));
  const a = runMatch(RNG.dailySeedString());
  const b = runMatch(RNG.seedForDay(day));
  eq('and therefore produce an identical match',
    a.result.standings.map(x => x.name + ':' + x.rank + ':' + x.t.toFixed(3)),
    b.result.standings.map(x => x.name + ':' + x.rank + ':' + x.t.toFixed(3)));
  ok('different days are different arenas',
    RNG.seedForDay(day) !== RNG.seedForDay(day + 1));
}

console.log('\nHOSTILE CHALLENGE PARAMS');
{
  const bad = [
    '?d=%',                       // malformed escape: decodeURIComponent throws
    '?d=NaN&t=NaN&p=NaN',
    '?d=-5&p=-1&t=-99',
    '?d=1e400&t=1e400',
    '?d=999999999999999&p=99999',
    '?n=' + '%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E',
    '?s=' + 'x'.repeat(500),
  ];
  let survived = 0;
  for (const q of bad) {
    global.location.search = q;
    try {
      const c = Share.parseChallenge();
      if (c) {
        if (c.day !== null && !(isFinite(c.day) && c.day > 0)) throw new Error('bad day survived: ' + c.day);
        if (c.time !== null && !(isFinite(c.time) && c.time >= 0)) throw new Error('bad time survived: ' + c.time);
        if (c.rank !== null && !(isFinite(c.rank) && c.rank > 0)) throw new Error('bad rank survived: ' + c.rank);
        if (c.name && /[^A-Z0-9_]/.test(c.name)) throw new Error('unsanitised name: ' + c.name);
        if (c.seed && c.seed.length > 64) throw new Error('unbounded seed');
      }
      survived++;
    } catch (e) {
      ok('handles ' + q, false, e.message);
    }
  }
  ok('every hostile query string is parsed safely', survived === bad.length, survived + '/' + bad.length);
  global.location.search = '';
}

console.log('\nSTREAKS');
{
  const today = RNG.dayNumber();
  const res = { mode: 'daily', won: true, rank: 1 };
  mem['lod.progress'] = JSON.stringify({ lastDay: today - 1, streak: 3, best: 3, wins: 0, plays: 0, bestRank: 99 });
  eq('playing today continues the streak', Share.recordDaily(today, res).streak, 4);
  eq('playing again the same day does not double it', Share.recordDaily(today, res).streak, 4);
  eq("a challenge for someone else's day does not touch it",
    Share.recordDaily(today - 40, res).streak, 4);
  eq('an endless run does not touch it',
    Share.recordDaily(today, { mode: 'endless', won: true, rank: 1 }).streak, 4);
  // A ?s= challenge is someone's endless arena played today: both the mode and
  // the day guard have to hold, or a stranger's seed pollutes the daily record.
  const before = Share.loadProgress().plays;
  eq('a seed challenge played today does not touch the daily record',
    Share.recordDaily(today, { mode: 'endless', seed: 'E-999-abc', won: true, rank: 1 }).plays, before);
  mem['lod.progress'] = JSON.stringify({ lastDay: today - 9, streak: 7, best: 7, wins: 0, plays: 0, bestRank: 99 });
  eq('a missed day resets the streak to 1', Share.recordDaily(today, res).streak, 1);
}

console.log('\nDAILY SEED');
{
  const d1 = new Date(2026, 8, 6, 23, 59), d2 = new Date(2026, 8, 7, 0, 1);
  ok('seed changes at local midnight', RNG.dailySeedString(d1) !== RNG.dailySeedString(d2));
  ok('seed is stable within a day',
    RNG.dailySeedString(new Date(2026, 8, 6, 1)) === RNG.dailySeedString(new Date(2026, 8, 6, 22)));
  ok('day number increments by one', RNG.dayNumber(d2) === RNG.dayNumber(d1) + 1);
}

console.log('\nROLE READOUT');
{
  // What the HUD tallies say has to be exactly what the arena draws rings for.
  const g = new Game({ seed: 'roles', mode: 'endless' });
  g.reduced = true; g.startPlay();
  const p = g.player;
  function manual() {
    let prey = 0, threat = 0;
    for (const s of g.souls) {
      if (!s.alive || s.isPlayer) continue;
      const d = s.flame - p.flame;
      if (d > Game.K.STEAL_MIN_DIFF) prey++;
      else if (d < -Game.K.STEAL_MIN_DIFF) threat++;
    }
    return prey + '/' + threat;
  }
  let agreed = true, sawBoth = false;
  for (const f of [8, 24, 40, 55, 70, 92]) {
    p.flame = f;
    const rc = g.roleCounts();
    if (rc.prey + '/' + rc.threat !== manual()) agreed = false;
    if (rc.prey > 0 && rc.threat > 0) sawBoth = true;
  }
  ok('roleCounts matches the drawing rule at every brightness', agreed);
  ok('both roles occur in one field', sawBoth);
  p.flame = 100;
  ok('brightest lamp -> nothing to take, everything hunts you',
    g.roleCounts().prey === 0 && g.roleCounts().threat > 0);
  p.flame = 0.5;
  ok('dimmest lamp -> nothing hunts you, everything is food',
    g.roleCounts().threat === 0 && g.roleCounts().prey > 0);
  p.flame = 50;
  ok('the tick is the brightest rival, never the player',
    Math.abs(g.roleCounts().top - Math.max(...g.souls.filter(s => !s.isPlayer && s.alive).map(s => s.flame))) < 1e-9);
  p.alive = false;
  var dead = g.roleCounts();
  ok('a lamp that is out has no roles',
    dead.prey === 0 && dead.threat === 0 && dead.top === 0 && dead.marks.length === 0);
}

console.log('\nBURNS OUT IN');
{
  /* The HUD's headline number is a promise: "you have N seconds". It is not
   * flame / burn-rate -- drain is proportional to flame, so the rate falls as
   * you dim and the naive quotient was 51% pessimistic. This holds the closed
   * form honest against the simulation it is predicting. */
  let worst = 0, rows = [];
  for (const [t0, f0] of [[0, 100], [0, 40], [0, 12], [20, 55], [40, 8], [80, 15], [100, 45]]) {
    const g = new Game({ seed: 'life', mode: 'daily' });
    g.startPlay();
    g.noSpawn = true;
    g.souls.forEach(s => { if (!s.isPlayer) s.alive = false; });
    const keep = g.souls[1];
    g.t = t0; g.aliveCount = 2; g._soloRate = 0;
    const p = g.player;
    p.flame = f0; p.x = 50; p.y = g.worldH / 2;
    const predicted = g.playerSecondsLeft(), start = g.t;
    let n = 0;
    while (p.flame > 0.001 && n++ < 60 * 900) {
      // A partner pinned to the player's own flame sits inside the dead zone,
      // so contact can never transfer anything, and it never goes out, so the
      // finale's last flare never tops the player back up. What is left is
      // pure drain -- which is exactly what the estimate models.
      keep.alive = true; keep.flame = Math.max(1, p.flame); keep.x = 50; keep.y = g.worldH / 2;
      p.x = 50; p.y = g.worldH / 2; g.embers.length = 0;
      g.update(1 / 60, { x: 0, y: 0, mag: 0 });
    }
    const actual = g.t - start, err = Math.abs(predicted - actual) / actual;
    worst = Math.max(worst, err);
    rows.push('t' + t0 + '/f' + f0 + ' ' + predicted.toFixed(1) + 'v' + actual.toFixed(1));
  }
  ok('seconds-left is within 3% of the real time to burn out', worst < 0.03,
    (worst * 100).toFixed(1) + '%  ' + rows.join('  '));

  // Eating must always buy time, or the readout would punish the one action the
  // game spends its whole tutorial teaching.
  const K = Game.K, ent = 1 + 30 * K.ENTROPY_PER_SEC;
  const life = f => f / ((K.DRAIN_BASE + K.DRAIN_K * f) * ent);
  let mono = true;
  for (let f = 1; f <= 100; f++) if (life(f) <= life(f - 1)) mono = false;
  ok('a brighter lamp always outlives a dimmer one', mono);
  // ...but by less and less, which is the whole economy.
  ok('and each mouthful buys less than the last',
    (life(19) - life(10)) > (life(59) - life(50)) * 2,
    [10, 50, 90].map(f => '+9@' + f + '=' + (life(f + 9) - life(f)).toFixed(2) + 's').join(' '));
}

console.log('\nTUTORIAL ARENA');
{
  // The lesson has to be survivable while a first-timer reads it: nothing
  // spawns, nothing closes in, and the player cannot be driven out.
  const o = { seed: 'tutorial', mode: 'endless', souls: 3, holdRing: true, noSpawn: true, floor: 12 };
  const g = new Game(o);
  g.reduced = true;
  eq('three lamps, not twelve', g.souls.length, 3);
  eq('the field starts empty of fuel', g.embers.length, 0);
  const r0 = g._ringRadius();
  g.startPlay();
  let minFlame = 99, killed = 0;
  g.on = null;
  for (let i = 0; i < 60 * 120; i++) {
    g.update(1 / 60, null);
    minFlame = Math.min(minFlame, g.player.flame);
    for (const e of g.events) if (e.type === 'playerDied') killed++;
    g.events.length = 0;
  }
  ok('the light never closes during the lesson', Math.abs(g._ringRadius() - r0) < 1e-9);
  ok('no fuel ever appears', g.embers.length === 0);
  ok('the player cannot fall through the floor', minFlame >= 12 - 1e-6, minFlame);
  ok('the player cannot go out during the lesson', killed === 0 && g.player.alive);
  ok('no NO FUEL LEFT alarm two minutes in', g.fuelGone === false);

  // Fuel placed by hand is real fuel.
  const g2 = new Game(o); g2.reduced = true; g2.startPlay();
  g2.placeEmber(50, g2.worldH / 2, 0);
  eq('placeEmber puts one ember down', g2.embers.length, 1);
  g2.player.x = 50; g2.player.y = g2.worldH / 2;
  for (let i = 0; i < 12; i++) g2.update(1 / 60, null);
  ok('and it can be eaten', g2.player.eaten >= 1);

  // Frozen props: staged, not simulated.
  const g3 = new Game(o); g3.reduced = true; g3.startPlay();
  const prop = g3.souls[1];
  prop.frozen = true; prop.x = 50; prop.y = -80; prop.flame = 50;
  for (let i = 0; i < 60 * 60; i++) g3.update(1 / 60, null);
  eq('a frozen prop does not burn', prop.flame, 50);
  ok('a frozen prop does not drift', prop.x === 50 && prop.y === -80);
  ok('and it is still standing after a minute in the void', prop.alive);
}

console.log('\nTHE LESSON, PLAYED');
{
  // The whole lesson, driven by a compliant player. The point of this test is
  // the success/failure copy: a beat whose `after` fires on timeout tells a
  // motionless player "YOU TORE ITS FLAME OUT", and that one lie teaches them
  // that the text on screen is decoration.
  require('../js/tutorial.js');
  const g = new Game(Tutorial.options());
  g.reduced = true; g.startPlay();
  const tut = new Tutorial.Tutorial(g);
  const p = g.player;
  const input = { x: 0, y: 0, mag: 0 };
  const steer = (tx, ty) => {
    const dx = tx - p.x, dy = ty - p.y, d = Math.hypot(dx, dy) || 1;
    input.x = dx / d; input.y = dy / d; input.mag = 1;
  };
  const lines = [];
  let last = '', t = 0, minFlame = 99, died = 0;
  for (let i = 0; i < 60 * 180 && !tut.finished; i++) {
    const b = tut.beats[tut.i], id = b ? b.id : '';
    if (id === 'move') steer(50 + Math.sin(t * 3) * 18, g.worldH / 2 + Math.cos(t * 3) * 18);
    else if (id === 'eat') { const e = g.embers[0]; if (e) { e.arm = 0; steer(e.x, e.y); } else input.mag = 0; }
    else if (id === 'prey') steer(g.souls[1].x, g.souls[1].y);
    else input.mag = 0;
    g.update(1 / 60, input);
    for (const e of g.events) if (e.type === 'playerDied') died++;
    g.events.length = 0;
    tut.update(1 / 60);
    minFlame = Math.min(minFlame, p.flame);
    t += 1 / 60;
    if (tut.line !== last) { last = tut.line; lines.push(tut.line); }
  }
  const strip = h => h.replace(/<[^>]+>/g, '');
  const shown = lines.map(strip);
  const fails = tut.beats.map(b => (typeof b.fail === 'string' ? strip(b.fail) : null)).filter(Boolean);

  ok('the lesson finishes', tut.finished, t.toFixed(1) + 's');
  ok('and inside a minute', t < 60, t.toFixed(1) + 's');
  ok('every beat is reached', tut.i >= tut.total, tut.i + '/' + tut.total);
  ok('a player who does the thing is never shown a failure line',
    !shown.some(l => fails.includes(l)), shown.filter(l => fails.includes(l)).join(' | '));
  ok('the player cannot go out during the lesson', died === 0 && p.alive);
  ok('and never falls through the floor', minFlame >= 12 - 1e-6, minFlame);
  ok('the fuel beat quotes the real ember value',
    shown.some(l => l.indexOf('+' + Game.K.EMBER_VALUE + ' FLAME') === 0), shown.join(' | '));
  ok('the steal beat quotes what the player actually kept',
    shown.some(l => /^YOU TOOK \d+\./.test(l)), shown.join(' | '));
  ok('the threat beat quotes what was actually taken',
    shown.some(l => /IT JUST TOOK \d+/.test(l)), shown.join(' | '));
  // The lesson names shapes, not hues, so it stays true if the palette moves
  // and it works for a player who cannot tell amber from crimson.
  ok('no beat names a colour',
    !lines.some(l => /AMBER|CRIMSON|CYAN|TEAL|VIOLET|GREEN|BLUE|RED\b/i.test(strip(l))),
    lines.map(strip).join(' | '));
  ok('props stay on the board, so the lamp count is honest',
    g.souls.every(s => !s.offBoard));

  // A player who does NOTHING must still get through, and must be told the
  // truth at every step.
  const g2 = new Game(Tutorial.options());
  g2.reduced = true; g2.startPlay();
  const t2 = new Tutorial.Tutorial(g2);
  const idle = { x: 0, y: 0, mag: 0 };
  let t2s = 0, seen2 = [], last2 = '';
  for (let i = 0; i < 60 * 240 && !t2.finished; i++) {
    g2.update(1 / 60, idle); g2.events.length = 0; t2.update(1 / 60); t2s += 1 / 60;
    if (t2.line !== last2) { last2 = t2.line; seen2.push(strip(t2.line)); }
  }
  ok('a player who does nothing still reaches the end', t2.finished, t2s.toFixed(1) + 's');
  // Only the two beats the player has to ACT in. The threat beat happens TO a
  // passive player on purpose -- the lesson walks the lamp in -- so "IT JUST
  // TOOK 21" is a true report there, not a claim about something they did.
  ok('and is never credited with something they did not do',
    !seen2.some(l => /^YOU TOOK|^\+\d+ FLAME/.test(l)), seen2.join(' | '));
  ok('the beats they skipped tell them what is still true',
    seen2.some(l => /THE FUEL IS STILL THERE/.test(l)) &&
    seen2.some(l => /IT IS BRIGHTER THAN YOU/.test(l)), seen2.join(' | '));
  ok('they are still burning at the end', g2.player.alive);
}

console.log('\nOFFLINE CACHE');
{
  // The service worker is cache-first for static assets, so a script that ships
  // in index.html but is missing from ASSETS is a file that does not exist
  // offline -- and the game is a blank screen with a console error.
  const fs = require('fs');
  const html = fs.readFileSync(__dirname + '/../index.html', 'utf8');
  const sw = fs.readFileSync(__dirname + '/../sw.js', 'utf8');
  const inHtml = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]);
  const listed = (sw.match(/var ASSETS = \[([\s\S]*?)\]/) || ['', ''])[1];
  const missing = inHtml.filter(f => listed.indexOf("'./" + f + "'") < 0);
  ok('every script in index.html is precached by the service worker',
    missing.length === 0, missing.join(', '));
  ok('the stylesheet is precached too', listed.indexOf("'./css/style.css'") >= 0);
  ok('the cache name has been bumped past v1', !/CACHE = 'last-one-dead-v1'/.test(sw));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
