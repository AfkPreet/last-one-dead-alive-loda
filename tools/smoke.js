/* smoke.js — drive the real page in a real browser: iPhone-sized viewport,
 * touch input, a full match played by fake thumb drags. Fails loudly on any
 * console error or page exception.
 */
const { chromium, devices } = require('playwright');
const OUT = process.env.OUT || '/tmp/shots';
const URL = process.env.URL || 'http://127.0.0.1:8099/index.html';
require('fs').mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });
  const ctx = await browser.newContext({
    ...devices['iPhone 12'],
    hasTouch: true, isMobile: true,
    permissions: [],
  });
  const page = await ctx.newPage();
  const errors = [], logs = [];
  page.on('console', m => { logs.push(m.type() + ': ' + m.text()); if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message + '\n' + (e.stack || '')));
  page.on('requestfailed', r => errors.push('REQFAIL: ' + r.url() + ' ' + (r.failure() || {}).errorText));

  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  await page.screenshot({ path: OUT + '/01-menu.png' });

  // How-to screen
  await page.click('#btn-how'); await page.waitForTimeout(400);
  await page.screenshot({ path: OUT + '/02-howto.png' });
  await page.click('#btn-how-back'); await page.waitForTimeout(250);

  // Play
  await page.click('#btn-play');
  await page.waitForTimeout(1200);
  await page.screenshot({ path: OUT + '/03-countdown.png' });
  await page.waitForTimeout(2600);
  await page.screenshot({ path: OUT + '/04-play-early.png' });

  // Fake thumb: drag around the arena chasing whatever is nearest.
  const box = await page.locator('#stage').boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await page.touchscreen.tap(cx, cy);

  async function steer(seconds) {
    const t0 = Date.now();
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    while (Date.now() - t0 < seconds * 1000) {
      // Steer toward the nearest ember, read straight out of the live game state.
      const aim = await page.evaluate(() => {
        const g = window.__g; if (!g || !g.player || !g.player.alive) return null;
        let best = null, bd = 1e9;
        for (const e of g.embers) { const d = Math.hypot(e.x - g.player.x, e.y - g.player.y); if (d < bd) { bd = d; best = e; } }
        if (!best) { // no fuel: go for the brightest soul
          for (const s of g.souls) { if (!s.alive || s.isPlayer) continue; if (s.flame > g.player.flame + 8) { const d = Math.hypot(s.x - g.player.x, s.y - g.player.y); if (d < bd) { bd = d; best = s; } } }
        }
        if (!best) return { dx: 50 - g.player.x, dy: g.worldH / 2 - g.player.y };
        return { dx: best.x - g.player.x, dy: best.y - g.player.y };
      });
      if (!aim) break;
      const m = Math.hypot(aim.dx, aim.dy) || 1;
      await page.mouse.move(cx + (aim.dx / m) * 44, cy + (aim.dy / m) * 44);
      await page.waitForTimeout(60);
    }
    await page.mouse.up();
  }

  await steer(14);
  await page.screenshot({ path: OUT + '/05-play-mid.png' });
  const mid = await page.evaluate(() => {
    const g = window.__g;
    return { t: +g.t.toFixed(1), alive: g.aliveCount, flame: +g.player.flame.toFixed(1), state: g.state, fx: g.fx.n, embers: g.embers.length };
  });
  console.log('mid-match:', JSON.stringify(mid));

  await steer(28);
  await page.screenshot({ path: OUT + '/06-play-late.png' });

  // Wait out the rest of the match / spectate, tapping to skip if offered.
  for (let i = 0; i < 60; i++) {
    const st = await page.evaluate(() => ({ s: window.__g ? window.__g.state : 'x', res: !!document.getElementById('results').classList.contains('show') }));
    if (st.res) break;
    if (st.s === 'spectate') await page.touchscreen.tap(cx, cy);
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(2800);
  await page.screenshot({ path: OUT + '/07-results.png' });

  const res = await page.evaluate(() => ({
    reveal: document.getElementById('res-reveal').innerText,
    strip: document.getElementById('res-strip').innerText,
    stats: document.getElementById('res-stats').innerText.replace(/\n/g, ' | '),
    share: window.__sharePayload || null
  }));
  console.log('--- RESULTS ---');
  console.log(res.reveal);
  console.log('strip:\n' + res.strip);
  console.log('stats:', res.stats);
  console.log('--- SHARE PAYLOAD ---\n' + (res.share || '(not exposed)'));

  await browser.close();
  if (errors.length) {
    console.log('\n!!! ERRORS (' + errors.length + ') !!!');
    errors.slice(0, 12).forEach(e => console.log('  ' + e));
    process.exit(1);
  }
  console.log('\nno console errors. logs:', logs.length);
})();
