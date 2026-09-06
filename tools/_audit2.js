/* _audit2.js — scratch visual audit (reviewer #2). Drives the live build and
 * screenshots every state at several viewports. Not part of the build.
 *
 *   node tools/_audit2.js
 */
const { chromium, devices } = require('playwright');
const fs = require('fs');

const URL = process.env.URL || 'http://127.0.0.1:8099/index.html';
const OUT = process.env.OUT || '/tmp/claude-0/-home-user-last-one-dead-alive-loda/2e61c66a-0aec-59b9-8c65-9e67c82b7a63/scratchpad/shots2';
fs.mkdirSync(OUT, { recursive: true });

const VIEWS = [
  { tag: 'ip12', ctx: { ...devices['iPhone 12'] } },
  { tag: 'se320', ctx: { viewport: { width: 320, height: 568 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
      userAgent: devices['iPhone 12'].userAgent } },
  { tag: 'tall', ctx: { viewport: { width: 360, height: 950 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
      userAgent: devices['iPhone 12'].userAgent } },
  { tag: 'land', ctx: { viewport: { width: 780, height: 360 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
      userAgent: devices['iPhone 12'].userAgent } },
  { tag: 'ipad', ctx: { viewport: { width: 834, height: 1112 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
      userAgent: devices['iPad (gen 7)'] ? devices['iPad (gen 7)'].userAgent : devices['iPhone 12'].userAgent } },
  { tag: 'desk', ctx: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 } }
];

const errors = [];

async function snap(page, tag, name) {
  const p = `${OUT}/${tag}-${name}.png`;
  await page.screenshot({ path: p });
  return p;
}

async function steer(page, cx, cy, seconds) {
  const t0 = Date.now();
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  while (Date.now() - t0 < seconds * 1000) {
    const aim = await page.evaluate(() => {
      const g = window.__g; if (!g || !g.player || !g.player.alive) return null;
      let best = null, bd = 1e9;
      for (const e of g.embers) { const d = Math.hypot(e.x - g.player.x, e.y - g.player.y); if (d < bd) { bd = d; best = e; } }
      if (!best) for (const s of g.souls) { if (!s.alive || s.isPlayer) continue; if (s.flame > g.player.flame + 6) { const d = Math.hypot(s.x - g.player.x, s.y - g.player.y); if (d < bd) { bd = d; best = s; } } }
      if (!best) return { dx: 0, dy: 0 };
      return { dx: best.x - g.player.x, dy: best.y - g.player.y };
    });
    if (!aim) break;
    const m = Math.hypot(aim.dx, aim.dy) || 1;
    await page.mouse.move(cx + (aim.dx / m) * 46, cy + (aim.dy / m) * 46);
    await page.waitForTimeout(60);
  }
  await page.mouse.up();
}

async function newPage(browser, view, storage) {
  const ctx = await browser.newContext({ ...view.ctx, ...(storage ? { storageState: storage } : {}) });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(view.tag + ' PAGEERROR ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(view.tag + ' CONSOLE ' + m.text()); });
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  return { ctx, page };
}

(async () => {
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox']
  });
  const shots = [];

  for (const view of VIEWS) {
    const tag = view.tag;
    // ---------- STATIC SCREENS (fresh storage: first-time player) ----------
    let { ctx, page } = await newPage(browser, view);
    shots.push(await snap(page, tag, '01-title'));

    await page.click('#btn-how'); await page.waitForTimeout(450);
    shots.push(await snap(page, tag, '02-howto-top'));
    await page.evaluate(() => { const s = document.querySelector('#how .scroll'); if (s) s.scrollTop = s.scrollHeight; });
    await page.waitForTimeout(300);
    shots.push(await snap(page, tag, '03-howto-bottom'));
    await page.click('#btn-how-back'); await page.waitForTimeout(300);

    await page.click('#btn-settings'); await page.waitForTimeout(400);
    shots.push(await snap(page, tag, '04-settings'));
    await page.click('#btn-settings-back'); await page.waitForTimeout(300);

    // ---------- COUNTDOWN + MATCH ----------
    await page.click('#btn-play');
    await page.waitForTimeout(500);
    shots.push(await snap(page, tag, '05-countdown-a'));
    await page.waitForTimeout(2000);
    shots.push(await snap(page, tag, '06-countdown-b'));
    await page.waitForTimeout(2200);
    shots.push(await snap(page, tag, '07-countdown-c'));

    const box = await page.locator('#stage').boundingBox();
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2;

    await page.waitForTimeout(600);
    shots.push(await snap(page, tag, '08-early'));
    await steer(page, cx, cy, 6);
    shots.push(await snap(page, tag, '09-early-fuel'));
    await steer(page, cx, cy, 10);
    shots.push(await snap(page, tag, '10-mid'));

    // consecutive frames for animation/feel
    shots.push(await snap(page, tag, '10b-mid-f1'));
    await page.waitForTimeout(120);
    shots.push(await snap(page, tag, '10c-mid-f2'));

    // Ring closing hard: jump the clock forward by forcing ring radius small.
    await page.evaluate(() => { const g = window.__g; g.t = Math.max(g.t, 30); });
    await steer(page, cx, cy, 4);
    shots.push(await snap(page, tag, '11-ring-closing'));

    // THE VOID: shove the player far outside the ring and hold.
    await page.evaluate(() => {
      const g = window.__g;
      g.player.flame = Math.max(g.player.flame, 55);
      g.player.x = g.worldW * 0.5 + g.ringR * 1.35;
      g.player.y = g.worldH * 0.5;
    });
    await page.waitForTimeout(700);
    shots.push(await snap(page, tag, '12-void'));
    await page.waitForTimeout(600);
    shots.push(await snap(page, tag, '12b-void'));

    await ctx.close();

    // ---------- SPECTATE + LOSS ----------
    ({ ctx, page } = await newPage(browser, view));
    await page.click('#btn-play');
    await page.waitForTimeout(4600);
    await page.evaluate(() => {
      const g = window.__g;
      for (const s of g.souls) if (!s.isPlayer) s.flame = 70;
    });
    await page.waitForTimeout(2000);
    // kill the player -> spectate
    await page.evaluate(() => { const g = window.__g; g.player.flame = 0.2; });
    await page.waitForTimeout(2500);
    shots.push(await snap(page, tag, '13-spectate'));
    await page.waitForTimeout(1500);
    shots.push(await snap(page, tag, '13b-spectate'));
    // let it resolve into loss results
    await page.evaluate(() => {
      const g = window.__g;
      for (const s of g.souls) if (!s.isPlayer && s.alive) s.flame = 1.2;
    });
    for (let i = 0; i < 90; i++) {
      const done = await page.evaluate(() => document.getElementById('results').classList.contains('show'));
      if (done) break;
      await page.waitForTimeout(400);
    }
    await page.waitForTimeout(3800);
    shots.push(await snap(page, tag, '14-results-loss'));
    await page.evaluate(() => { const s = document.querySelector('#results .stack'); if (s) s.scrollTop = s.scrollHeight; });
    await page.waitForTimeout(300);
    shots.push(await snap(page, tag, '14b-results-loss-scrolled'));
    const lossTxt = await page.evaluate(() => ({
      reveal: document.getElementById('res-reveal').innerText,
      strip: document.getElementById('res-strip').innerText,
      stats: document.getElementById('res-stats').innerText
    }));
    fs.writeFileSync(`${OUT}/${tag}-loss.txt`, JSON.stringify(lossTxt, null, 1));
    await ctx.close();

    // ---------- WIN + REVEAL + NAMING ----------
    ({ ctx, page } = await newPage(browser, view));
    await page.click('#btn-play');
    await page.waitForTimeout(4600);
    await page.evaluate(() => {
      const g = window.__g;
      g.player.flame = 92;
      for (const s of g.souls) if (!s.isPlayer) s.flame = 0.8;
    });
    // finale: player last burning
    for (let i = 0; i < 40; i++) {
      const st = await page.evaluate(() => window.__g.state);
      if (st === 'finale') break;
      await page.waitForTimeout(250);
    }
    shots.push(await snap(page, tag, '15-finale'));
    await page.evaluate(() => { const g = window.__g; g.player.flame = 6; });
    for (let i = 0; i < 120; i++) {
      const done = await page.evaluate(() => document.getElementById('results').classList.contains('show'));
      if (done) break;
      await page.waitForTimeout(300);
    }
    await page.waitForTimeout(900);
    shots.push(await snap(page, tag, '16-reveal-early'));
    await page.waitForTimeout(2600);
    shots.push(await snap(page, tag, '17-results-win'));
    const winTxt = await page.evaluate(() => ({
      reveal: document.getElementById('res-reveal').innerText,
      strip: document.getElementById('res-strip').innerText,
      stats: document.getElementById('res-stats').innerText,
      share: window.__sharePayload || null
    }));
    fs.writeFileSync(`${OUT}/${tag}-win.txt`, JSON.stringify(winTxt, null, 1));
    await page.waitForTimeout(2500);
    const naming = await page.evaluate(() => document.getElementById('naming').classList.contains('show'));
    if (naming) {
      shots.push(await snap(page, tag, '18-naming'));
      await page.fill('#name-input', 'WWWWWWWWWWWW');
      await page.waitForTimeout(300);
      shots.push(await snap(page, tag, '18b-naming-filled'));
    }
    await ctx.close();
    console.log('done ' + tag);
  }

  await browser.close();
  fs.writeFileSync(`${OUT}/_errors.txt`, errors.join('\n'));
  console.log(shots.length + ' shots -> ' + OUT);
  if (errors.length) console.log('ERRORS:\n' + errors.slice(0, 20).join('\n'));
})();
