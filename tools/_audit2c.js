/* _audit2c.js — scratch: clean run timeline (coach text vs clock), and a
 * NATURAL trip into the void by dragging to the edge. */
const { chromium, devices } = require('playwright');
const fs = require('fs');
const URL = 'http://127.0.0.1:8099/index.html';
const OUT = '/tmp/claude-0/-home-user-last-one-dead-alive-loda/2e61c66a-0aec-59b9-8c65-9e67c82b7a63/scratchpad/shots2c';
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox']
  });

  // ---------- A: clean first-run timeline ----------
  let ctx = await browser.newContext({ ...devices['iPhone 12'] });
  let page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  await page.click('#btn-play');
  const log = [];
  for (let i = 0; i < 60; i++) {
    const st = await page.evaluate(() => {
      const g = window.__g; const c = document.getElementById('coach');
      return {
        t: g ? +g.t.toFixed(1) : -1, state: g ? g.state : '?',
        alive: g ? g.aliveCount : -1,
        coach: c.classList.contains('show') ? c.innerText.replace(/\n/g, ' / ') : '',
        toast: document.getElementById('toast').classList.contains('show') ? document.getElementById('toast').innerText : '',
        nd: g && g.player ? +g.nd(g.player.x, g.player.y).toFixed(2) : -1
      };
    });
    log.push(JSON.stringify(st));
    if (st.state === 'done') break;
    await page.waitForTimeout(1000);
  }
  fs.writeFileSync(OUT + '/timeline.txt', log.join('\n'));
  await ctx.close();

  // ---------- B: natural void ----------
  ctx = await browser.newContext({ ...devices['iPhone 12'] });
  page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  await page.click('#btn-play');
  await page.waitForTimeout(5500);
  const box = await page.locator('#stage').boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  // drag straight north-east and hold: run out of the ring for real
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 30, cy - 70);
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(250);
    const nd = await page.evaluate(() => window.__g.nd(window.__g.player.x, window.__g.player.y));
    if (nd > 1.02) break;
  }
  await page.screenshot({ path: OUT + '/void-natural-1.png' });
  await page.waitForTimeout(900);
  await page.screenshot({ path: OUT + '/void-natural-2.png' });
  const info = await page.evaluate(() => {
    const g = window.__g;
    return { nd: +g.nd(g.player.x, g.player.y).toFixed(3), flame: +g.player.flame.toFixed(1), t: +g.t.toFixed(1), alive: g.aliveCount };
  });
  fs.writeFileSync(OUT + '/void.txt', JSON.stringify(info));
  await page.mouse.up();
  console.log('void', JSON.stringify(info));
  await ctx.close();

  // ---------- C: consecutive frames at the moment of a death, and finale ----------
  ctx = await browser.newContext({ ...devices['iPhone 12'] });
  page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  await page.click('#btn-play');
  await page.waitForTimeout(5200);
  // burn everyone but the player down slowly so we see the field thin out
  await page.evaluate(() => {
    window.__k = setInterval(() => {
      const g = window.__g; if (!g) return;
      g.player.flame = Math.max(g.player.flame, 50);
      let n = 0;
      for (const s of g.souls) if (!s.isPlayer && s.alive) { if (n++ < 20) s.flame *= 0.80; }
    }, 200);
  });
  for (let i = 0; i < 15; i++) {
    const a = await page.evaluate(() => window.__g.aliveCount);
    if (a <= 4) break;
    await page.waitForTimeout(500);
  }
  await page.screenshot({ path: OUT + '/few-left.png' });
  for (let i = 0; i < 60; i++) {
    const st = await page.evaluate(() => window.__g.state);
    if (st === 'finale') break;
    await page.waitForTimeout(300);
  }
  await page.evaluate(() => clearInterval(window.__k));
  await page.screenshot({ path: OUT + '/finale-1.png' });
  await page.waitForTimeout(500);
  await page.screenshot({ path: OUT + '/finale-2.png' });
  await page.evaluate(() => { window.__g.player.flame = 2; });
  for (let i = 0; i < 100; i++) {
    if (await page.evaluate(() => document.getElementById('results').classList.contains('show'))) break;
    await page.waitForTimeout(150);
  }
  await page.screenshot({ path: OUT + '/reveal-0.png' });
  await page.waitForTimeout(800);
  await page.screenshot({ path: OUT + '/reveal-1.png' });
  await page.waitForTimeout(1300);
  await page.screenshot({ path: OUT + '/reveal-2.png' });
  await page.waitForTimeout(1600);
  await page.screenshot({ path: OUT + '/results-win.png' });
  fs.writeFileSync(OUT + '/win.txt', await page.evaluate(() => JSON.stringify({
    reveal: document.getElementById('res-reveal').innerText,
    strip: document.getElementById('res-strip').innerText,
    stats: document.getElementById('res-stats').innerText,
    share: window.__sharePayload
  }, null, 1)));
  for (let i = 0; i < 30; i++) {
    if (await page.evaluate(() => document.getElementById('naming').classList.contains('show'))) break;
    await page.waitForTimeout(300);
  }
  await page.screenshot({ path: OUT + '/naming.png' });
  await page.fill('#name-input', 'WWWWWWWWWWWW').catch(() => {});
  await page.waitForTimeout(250);
  await page.screenshot({ path: OUT + '/naming-filled.png' });
  await ctx.close();

  // ---------- D: settings incl. high contrast, then play ----------
  ctx = await browser.newContext({ viewport: { width: 320, height: 568 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: devices['iPhone 12'].userAgent });
  page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  await page.click('#btn-settings');
  await page.waitForTimeout(400);
  await page.screenshot({ path: OUT + '/settings-320.png' });
  await page.click('#set-contrast');
  await page.waitForTimeout(250);
  await page.screenshot({ path: OUT + '/settings-320-contrast.png' });
  await page.click('#btn-settings-back');
  await page.waitForTimeout(300);
  await page.click('#btn-play');
  await page.waitForTimeout(11000);
  await page.screenshot({ path: OUT + '/play-highcontrast-320.png' });
  await ctx.close();

  await browser.close();
  console.log('ok -> ' + OUT);
})();
