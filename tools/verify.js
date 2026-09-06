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
    await page.click('#btn-letgo');
    await page.waitForTimeout(300);
    const st = await page.evaluate(() => ({ alive: window.__g.player.alive, used: window.__g.letGoUsed, count: window.__g.aliveCount }));
    ok('LET GO kills the player at once', !st.alive && st.used);
    ok('one fewer soul burning', st.count === aliveBefore - 1);
    await page.waitForSelector('#results.show', { timeout: 30000 });
    await page.waitForTimeout(2600);
    const r = await page.evaluate(() => document.getElementById('res-reveal').innerText);
    await page.screenshot({ path: OUT + '/12-letgo.png' });
    ok('results name the choice', /YOU LET GO/.test(r), r);
    ok('and still state the rule', /DIE LAST/.test(r), r);
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
    const seedUsed = await page.evaluate(() => window.__g.seedStr);
    ok('the challenge arena uses the challenger day-seed', seedUsed === 'LOD-DAY-200', seedUsed);
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

  /* ---------- 7. frame pacing ---------- */
  console.log('\nFRAME PACING');
  {
    const page = await newPage(browser, Object.assign({}, devices['iPhone 12'], { hasTouch: true, isMobile: true }));
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await playTo(page);
    await page.evaluate(() => {
      window.__frames = [];
      let last = performance.now();
      (function tick() {
        const n = performance.now();
        window.__frames.push(n - last); last = n;
        if (window.__frames.length < 400) requestAnimationFrame(tick);
      })();
    });
    await page.waitForTimeout(8000);
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
