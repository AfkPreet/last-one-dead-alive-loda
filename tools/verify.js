/* verify.js — browser-level verification of the paths the smoke test doesn't
 * reach on its own: the win reveal, LET GO, challenge links, desktop layout,
 * settings persistence, clipboard sharing and frame pacing.
 *   node tools/verify.js
 */
const { chromium, devices } = require('playwright');
const OUT = process.env.OUT || '/tmp/shots';
const BASE = process.env.URL || 'http://127.0.0.1:8099/';
require('fs').mkdirSync(OUT, { recursive: true });

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x ? '  -> ' + x : '')); } };

const LAUNCH = {
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
};

async function newPage(browser, opts) {
  const ctx = await browser.newContext(Object.assign({}, opts));
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE.replace(/\/$/, '') });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('console', m => { if (m.type() === 'error') page.errors.push(m.text()); });
  page.on('pageerror', e => page.errors.push('PAGEERROR: ' + e.message));
  return page;
}

/** Play until the results screen appears, optionally forcing the outcome. */
async function playTo(page, force) {
  await page.click('#btn-play');
  await page.waitForFunction(() => window.__g && window.__g.state === 'play', null, { timeout: 15000 });
  const box = await page.locator('#stage').boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  if (force === 'win') {
    // Starve every bot; the player is left as the last soul burning.
    await page.evaluate(() => {
      window.__forceWin = setInterval(() => {
        const g = window.__g;
        if (!g || g.state === 'done') return;
        // Starve the bots, but stop propping the player up the moment they are
        // alone — otherwise the finale can never resolve.
        if (g.aliveCount > 1) {
          for (const s of g.souls) if (!s.isPlayer && s.alive) s.flame = 0.05;
          g.player.flame = Math.max(g.player.flame, 60);
        }
      }, 60);
    });
  }
  return { cx, cy };
}

(async () => {
  const browser = await chromium.launch(LAUNCH);

  /* ---------- 1. the win reveal ---------- */
  console.log('\nWIN REVEAL');
  {
    const page = await newPage(browser, Object.assign({}, devices['iPhone 12'], { hasTouch: true, isMobile: true }));
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await playTo(page, 'win');
    await page.waitForSelector('#results.show', { timeout: 30000 });
    await page.waitForTimeout(600);
    await page.screenshot({ path: OUT + '/10-win-reveal-early.png' });
    const early = await page.evaluate(() => ({
      reveal: document.getElementById('res-reveal').innerText,
      settled: document.getElementById('results').classList.contains('settled')
    }));
    ok('reveal opens on "YOU DIED LAST."', /YOU DIED LAST/.test(early.reveal), early.reveal);
    ok('arena still visible behind the punchline (panel not settled yet)', !early.settled);

    await page.waitForTimeout(3200);
    const late = await page.evaluate(() => ({
      reveal: document.getElementById('res-reveal').innerText,
      settled: document.getElementById('results').classList.contains('settled'),
      strip: document.getElementById('res-strip').innerText,
      share: window.__sharePayload,
      won: window.__g.result.won, rank: window.__g.result.rank
    }));
    await page.screenshot({ path: OUT + '/11-win-reveal-full.png' });
    ok('second line delivers the identity', /last one alive/i.test(late.reveal), late.reveal);
    ok('a match played to the end is not flagged as cut',
      (await page.evaluate(() => window.__g.result.cut)) === false);
    ok('third line states the equation', /LAST ONE DEAD = LAST ONE ALIVE/.test(late.reveal));
    ok('panel settles after the reveal', late.settled);
    ok('result is a win at rank 1', late.won && late.rank === 1, JSON.stringify(late));
    ok('share text claims the win', /died LAST/.test(late.share || ''), late.share);
    ok('burnline present', (late.strip || '').length > 0);
    ok('no console errors', page.errors.length === 0, page.errors[0]);
    await page.context().close();
  }

  /* ---------- 2. LET GO ---------- */
  console.log('\nLET GO');
  {
    const page = await newPage(browser, Object.assign({}, devices['iPhone 12'], { hasTouch: true, isMobile: true }));
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await playTo(page);
    await page.waitForTimeout(1500);
    const aliveBefore = await page.evaluate(() => window.__g.aliveCount);
    // A brush of the corner must NOT end the run: hold-to-arm is 600ms.
    const lg = await page.locator('#btn-letgo').boundingBox();
    await page.mouse.move(lg.x + lg.width / 2, lg.y + lg.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(200);
    await page.mouse.up();
    await page.waitForTimeout(200);
    const afterTap = await page.evaluate(() => window.__g.player.alive);
    ok('a short press does NOT let go', afterTap);
    // Now hold it properly.
    await page.mouse.down();
    await page.waitForTimeout(900);
    await page.mouse.up();
    await page.waitForTimeout(300);
    const st = await page.evaluate(() => ({ alive: window.__g.player.alive, used: window.__g.letGoUsed, count: window.__g.aliveCount }));
    ok('LET GO kills the player at once', !st.alive && st.used);
    ok('one fewer soul burning', st.count === aliveBefore - 1);
    await page.waitForSelector('#results.show', { timeout: 30000 });
    await page.waitForTimeout(2600);
    const r = await page.evaluate(() => document.getElementById('res-reveal').innerText);
    await page.screenshot({ path: OUT + '/12-letgo.png' });
    ok('results name the choice', /YOU LET GO/.test(r), r);
    ok('and still state the rule', /LAST LAMP/.test(r) || /DIE LAST/.test(r), r);
    // Letting go early cuts the simulation short, so the game does not know who
    // died last and must not say. It still has to give the player a real result.
    const cut = await page.evaluate(() => window.__g.result.cut);
    ok('the cut-short match is flagged as such', cut === true, String(cut));
    ok('and the results do NOT claim who died last', !/died last/i.test(r), r);
    ok('a deadpan sign-off is still shown', r.trim().split('\n').length >= 3, r);
    ok('no console errors', page.errors.length === 0, page.errors[0]);
    await page.context().close();
  }

  /* ---------- 3. challenge link ---------- */
  console.log('\nCHALLENGE LINK');
  {
    const page = await newPage(browser, Object.assign({}, devices['iPhone 12'], { hasTouch: true, isMobile: true }));
    await page.goto(BASE + '?d=200&p=2&t=30&n=PRT', { waitUntil: 'networkidle' });
    await page.waitForTimeout(700);
    const menu = await page.evaluate(() => ({
      seed: document.getElementById('menu-seed').textContent,
      toast: document.getElementById('toast').textContent
    }));
    ok('menu announces the challenge', /CHALLENGE FROM PRT/.test(menu.seed), menu.seed);
    ok('toast names the challenger', /PRT/.test(menu.toast), menu.toast);
    await playTo(page);
    const named = await page.evaluate(() => window.__g.souls.filter(s => s.name === 'PRT').length);
    ok('exactly one soul carries the challenger name', named === 1, 'found ' + named);
    // The invariant that matters: a ?d=N link must play the SAME arena as day
    // N's daily, or every shared score is meaningless.
    const seedCheck = await page.evaluate(() => ({
      used: window.__g.seedStr,
      expected: window.RNG.seedForDay(200),
      todayDaily: window.RNG.dailySeedString(),
      todayViaDay: window.RNG.seedForDay(window.RNG.dayNumber())
    }));
    ok('a ?d=N link plays exactly day N\'s arena',
      seedCheck.used === seedCheck.expected, JSON.stringify(seedCheck));
    ok('the daily seed and the day-number seed are the same derivation',
      seedCheck.todayDaily === seedCheck.todayViaDay, JSON.stringify(seedCheck));
    // Outliving the challenger's recorded time must be announced.
    await page.evaluate(() => { window.__g.t = 31; });
    await page.waitForTimeout(400);
    const t2 = await page.evaluate(() => document.getElementById('toast').textContent);
    ok('outliving the challenger is announced', /OUTLIVED PRT/.test(t2), t2);
    ok('no console errors', page.errors.length === 0, page.errors[0]);
    await page.context().close();
  }

  /* ---------- 4. desktop layout + keyboard ---------- */
  console.log('\nDESKTOP');
  {
    const page = await newPage(browser, { viewport: { width: 1440, height: 900 } });
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForTimeout(600);
    const layout = await page.evaluate(() => {
      const f = document.getElementById('frame').getBoundingClientRect();
      return { w: f.width, h: f.height, scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth };
    });
    ok('frame stays a portrait strip on a wide screen', layout.w < layout.h, JSON.stringify(layout));
    ok('page never scrolls horizontally', layout.scrollW <= layout.innerW + 1, JSON.stringify(layout));
    await page.screenshot({ path: OUT + '/13-desktop.png' });
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.__g && window.__g.state === 'play', null, { timeout: 15000 });
    await page.keyboard.down('d');
    await page.waitForTimeout(500);
    const moved = await page.evaluate(() => window.__g.player.vx);
    await page.keyboard.up('d');
    ok('keyboard moves the player', moved > 1, 'vx=' + moved);
    ok('no console errors', page.errors.length === 0, page.errors[0]);
    await page.context().close();
  }

  /* ---------- 5. share falls back to the clipboard ---------- */
  console.log('\nSHARE FALLBACK');
  {
    const page = await newPage(browser, Object.assign({}, devices['iPhone 12'], { hasTouch: true, isMobile: true }));
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.evaluate(() => { try { delete navigator.share; } catch (e) {} });
    await playTo(page, 'win');
    await page.waitForSelector('#results.show', { timeout: 30000 });
    await page.waitForTimeout(3400);
    await page.click('#btn-share');
    await page.waitForTimeout(700);
    const clip = await page.evaluate(() => navigator.clipboard.readText().catch(() => ''));
    const toast = await page.evaluate(() => document.getElementById('toast').textContent);
    ok('clipboard receives the full share text', /LAST ONE DEAD/.test(clip) && /💀|🔥/.test(clip), JSON.stringify(clip).slice(0, 120));
    ok('user is told it copied', /COPIED/.test(toast), toast);
    ok('no console errors', page.errors.length === 0, page.errors[0]);
    await page.context().close();
  }

  /* ---------- 6. settings persist ---------- */
  console.log('\nSETTINGS');
  {
    const ctx = await browser.newContext(Object.assign({}, devices['iPhone 12'], { hasTouch: true, isMobile: true }));
    const page = await ctx.newPage();
    page.errors = [];
    page.on('pageerror', e => page.errors.push(e.message));
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.click('#btn-settings');
    await page.waitForTimeout(200);
    await page.click('#set-sound + .sw, label:has(#set-sound)');
    await page.click('#set-contrast + .sw, label:has(#set-contrast)');
    await page.click('#btn-settings-back');
    await page.waitForTimeout(200);
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    const persisted = await page.evaluate(() => ({
      sound: document.getElementById('set-sound').checked,
      contrast: document.getElementById('set-contrast').checked,
      stored: localStorage.getItem('lod.sound')
    }));
    ok('sound toggle persists across reload', persisted.sound === false, JSON.stringify(persisted));
    ok('contrast toggle persists across reload', persisted.contrast === true, JSON.stringify(persisted));
    await ctx.close();
  }

  /* ---------- 6a. the renderer leaves the canvas as it found it ---------- */
  console.log('\nCANVAS STATE');
  {
    const page = await newPage(browser, Object.assign({}, devices['iPhone 12'], { hasTouch: true, isMobile: true }));
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await playTo(page);
    await page.waitForTimeout(2500);          // let embers, particles and text all exist
    const r = await page.evaluate(() => {
      const ctx = document.getElementById('stage').getContext('2d');
      const realSave = ctx.save.bind(ctx), realRestore = ctx.restore.bind(ctx);
      let depth = 0, min = 0, saves = 0;
      ctx.save = function () { depth++; saves++; realSave(); };
      ctx.restore = function () { depth--; if (depth < min) min = depth; realRestore(); };
      const scene = { embers: window.__g.embers.length, particles: window.__g.fx.n, text: window.__g.txt.n };
      window.__r.draw(window.__g, null, performance.now() / 1000);
      const out = { depth, min, saves, scene,
        alpha: ctx.globalAlpha, composite: ctx.globalCompositeOperation };
      ctx.save = realSave; ctx.restore = realRestore;
      return out;
    });
    ok('the scene under test actually has embers to draw', r.scene.embers > 0, JSON.stringify(r.scene));
    ok('draw() ends with the state stack where it started', r.depth === 0, JSON.stringify(r));
    // A stray restore() can net out to zero while still popping a caller's
    // state mid-frame, which is how the ember transform bug hid: it only showed
    // once more than one ember was on screen.
    ok('and never pops below its own baseline', r.min === 0, JSON.stringify(r));
    ok('globalAlpha is left at 1', r.alpha === 1, String(r.alpha));
    ok('composite mode is left at source-over', r.composite === 'source-over', r.composite);
    ok('no console errors', page.errors.length === 0, page.errors[0]);
    await page.context().close();
  }

  /* ---------- 6a-2. a live player is never invisible ---------- */
  console.log('\nOFF-SCREEN PLAYER');
  {
    const page = await newPage(browser, Object.assign({}, devices['iPhone 12'], { hasTouch: true, isMobile: true }));
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await playTo(page);
    await page.waitForTimeout(1200);
    const r = await page.evaluate(() => {
      const g = window.__g, R = window.__r;
      const draw = () => R.draw(g, null, performance.now() / 1000);
      const out = {};
      // Centre of the arena: no marker wanted.
      g.player.x = 50; g.player.y = g.worldH / 2;
      draw(); out.centred = R.marker;
      // Deep in the void at maximum zoom — the case the camera cannot show.
      g.ringR = 9.5; R.zoom = 2.15;
      g.player.x = 96; g.player.y = g.worldH / 2;
      draw();
      out.far = R.marker;
      out.canvas = { w: R.s.w, h: R.s.h };
      out.projected = { x: R.toScreenX(g.player.x), y: R.toScreenY(g.player.y) };
      // Dead players get no marker.
      g.player.alive = false; draw(); out.dead = R.marker;
      return out;
    });
    ok('no marker while the player is on screen', r.centred === null, JSON.stringify(r.centred));
    ok('the player really would be off-canvas out there',
      r.projected.x > r.canvas.w || r.projected.x < 0, JSON.stringify(r.projected));
    ok('an off-screen player gets an edge marker', !!r.far, JSON.stringify(r));
    ok('and the marker is inside the canvas',
      r.far && r.far.x >= 0 && r.far.x <= r.canvas.w && r.far.y >= 0 && r.far.y <= r.canvas.h,
      JSON.stringify(r.far) + ' canvas ' + JSON.stringify(r.canvas));
    ok('a dead player gets no marker', r.dead === null, JSON.stringify(r.dead));
    ok('no console errors', page.errors.length === 0, page.errors[0]);
    await page.context().close();
  }

  /* ---------- 6b. multi-touch handoff ---------- */
  console.log('\nMULTI-TOUCH');
  {
    const page = await newPage(browser, Object.assign({}, devices['iPhone 12'], { hasTouch: true, isMobile: true }));
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await playTo(page);
    // Real touch events through CDP, not synthetic PointerEvents: only real
    // ones get proper pointer-capture semantics, and capture is exactly what
    // this handoff has to survive.
    const cdp = await page.context().newCDPSession(page);
    const box = await page.locator('#stage').boundingBox();
    const P = (x, y, id) => ({ x: box.x + x, y: box.y + y, id });
    const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
    const snap = () => page.evaluate(() => ({
      touching: window.__i.touching, mag: +window.__i.mag.toFixed(3),
      originX: Math.round(window.__i.originX), spare: window.__i._spare.length
    }));

    await touch('touchStart', [P(100, 400, 1)]);
    await touch('touchMove', [P(150, 400, 1)]);
    const a = await snap();
    ok('the first finger steers', a.touching && a.mag > 0, JSON.stringify(a));

    await touch('touchStart', [P(150, 400, 1), P(260, 520, 2)]);
    const b2 = await snap();
    ok('a second finger does not steal the stick', b2.originX < 200 && b2.spare === 1, JSON.stringify(b2));

    // CDP touchEnd takes the point being RELEASED, not the ones that remain.
    await touch('touchEnd', [P(150, 400, 1)]);       // finger 1 lifts, 2 remains
    const c = await snap();
    ok('lifting the first hands the stick to the second', c.touching, JSON.stringify(c));
    ok('and re-anchors where that finger actually is', Math.abs(c.originX - 260) < 40, JSON.stringify(c));

    await touch('touchMove', [P(320, 520, 2)]);
    const d = await snap();
    ok('the second finger then steers', d.mag > 0, JSON.stringify(d));

    // And the simulation must actually respond. Every other test here drives
    // the game with the mouse, which is exactly how a completely dead
    // touch joystick once got through this suite.
    const before = await page.evaluate(() => ({ x: window.__g.player.x, y: window.__g.player.y }));
    for (let i = 0; i < 12; i++) {
      await touch('touchMove', [P(320 + (i % 2 ? 4 : -4), 520, 2)]);
      await page.waitForTimeout(50);
    }
    const after = await page.evaluate(() => ({
      x: window.__g.player.x, y: window.__g.player.y,
      v: Math.hypot(window.__g.player.vx, window.__g.player.vy)
    }));
    ok('touch input actually moves the player',
      after.v > 1 && Math.hypot(after.x - before.x, after.y - before.y) > 1,
      JSON.stringify({ before, after }));

    await touch('touchEnd', [P(320, 520, 2)]);
    const e2 = await snap();
    ok('lifting the last finger releases everything', !e2.touching && e2.mag === 0, JSON.stringify(e2));
    ok('no console errors', page.errors.length === 0, page.errors[0]);
    await page.context().close();
  }

  /* ---------- 7. the menu is alive again after a match ---------- */
  console.log('\nMENU PREVIEW');
  {
    const page = await newPage(browser, Object.assign({}, devices['iPhone 12'], { hasTouch: true, isMobile: true }));
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForTimeout(900);
    const boot = await page.evaluate(() => new Promise(r => {
      const a = document.getElementById('stage').toDataURL().length;
      setTimeout(() => r({ a, b: document.getElementById('stage').toDataURL().length }), 700);
    }));
    ok('title screen renders a live arena', boot.a !== boot.b, JSON.stringify(boot));
    await playTo(page, 'win');
    await page.waitForSelector('#results.show', { timeout: 30000 });
    await page.waitForTimeout(3400);
    await page.click('#btn-menu');
    await page.waitForTimeout(700);
    const back = await page.evaluate(() => new Promise(r => {
      const a = document.getElementById('stage').toDataURL().length;
      setTimeout(() => r({ a, b: document.getElementById('stage').toDataURL().length }), 700);
    }));
    ok('menu is live again after a match, not a frozen dead arena', back.a !== back.b, JSON.stringify(back));
    await page.waitForTimeout(2500);   // past when the naming prompt would fire
    const stillMenu = await page.evaluate(() => document.getElementById('menu').classList.contains('show'));
    ok('no late prompt ambushes the menu', stillMenu, 'a screen took over after navigating away');
    ok('no console errors', page.errors.length === 0, page.errors[0]);
    await page.context().close();
  }

  /* ---------- 8. frame pacing ---------- */
  console.log('\nFRAME PACING');
  {
    const page = await newPage(browser, Object.assign({}, devices['iPhone 12'], { hasTouch: true, isMobile: true }));
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await playTo(page);
    await page.evaluate(() => {
      window.__frames = [];
      let last = performance.now();
      // Sample late, after the quality ladder has had time to settle.
      setTimeout(() => (function tick() {
        const n = performance.now();
        window.__frames.push(n - last); last = n;
        if (window.__frames.length < 300) requestAnimationFrame(tick);
      })(), 9000);
    });
    await page.waitForTimeout(13000);
    const q = await page.evaluate(() => ({
      quality: window.__r.s.quality,
      backing: window.__r.s.canvas.width + 'x' + window.__r.s.canvas.height,
      draw: (function () { const t = performance.now();
        for (let i = 0; i < 30; i++) window.__r.draw(window.__g, null, performance.now() / 1000);
        return (performance.now() - t) / 30; })()
    }));
    console.log('    adaptive quality settled at ' + q.quality + ' (' + q.backing + '), draw ' + q.draw.toFixed(1) + 'ms');
    // Under swiftshader the renderer genuinely cannot hold 60fps at full res, so
    // the ladder must engage. On real hardware it stays at 1.
    ok('adaptive resolution engages when the GPU cannot keep up', q.quality < 1, 'quality=' + q.quality);
    ok('and it stops stepping down once draw is affordable', q.draw < 16, q.draw.toFixed(1) + 'ms');
    const f = await page.evaluate(() => window.__frames.slice(5));
    const sorted = f.slice().sort((a, b) => a - b);
    const p50 = sorted[sorted.length >> 1], p95 = sorted[Math.floor(sorted.length * 0.95)];
    console.log('    median frame ' + p50.toFixed(1) + 'ms, p95 ' + p95.toFixed(1) + 'ms (software GL)');
    ok('frames are produced steadily', f.length > 100 && p50 < 60, 'p50=' + p50.toFixed(1));
    ok('no console errors during play', page.errors.length === 0, page.errors[0]);
    await page.context().close();
  }

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
