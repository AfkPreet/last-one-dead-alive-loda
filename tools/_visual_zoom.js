/* _visual_zoom.js — scratch. Close-ups of HUD bands + a countdown burst + a natural match. */
const { chromium, devices } = require('playwright-core');
const fs = require('fs');
const path = require('path');
const OUT = '/tmp/claude-0/-home-user-last-one-dead-alive-loda/2e61c66a-0aec-59b9-8c65-9e67c82b7a63/scratchpad/shots2';
fs.mkdirSync(OUT, { recursive: true });
const EXEC = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const ARGS = ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'];
const URL = 'http://127.0.0.1:8099/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const shot = async (page, name, clip) => {
  const f = path.join(OUT, name + '.png');
  await page.screenshot({ path: f, clip });
  console.log('  shot', f);
};

async function main() {
  const browser = await chromium.launch({ executablePath: EXEC, args: ARGS });

  /* ---- 1. countdown burst on iPhone 12 ---- */
  {
    const ctx = await browser.newContext({ ...devices['iPhone 12'] });
    const page = await ctx.newPage();
    await page.goto(URL, { waitUntil: 'networkidle' });
    await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
    await page.reload({ waitUntil: 'networkidle' });
    await sleep(800);
    await page.click('#btn-play');
    for (let i = 0; i < 16; i++) {
      await shot(page, 'cd-' + String(i).padStart(2, '0'));
      await sleep(200);
    }
    // HUD band close-ups
    await page.waitForFunction(() => window.__g && window.__g.state === 'play');
    await sleep(1500);
    const vp = page.viewportSize();
    await shot(page, 'hud-top-390', { x: 0, y: 0, width: vp.width, height: 110 });
    await shot(page, 'hud-bottom-390', { x: 0, y: vp.height - 100, width: vp.width, height: 100 });
    await ctx.close();
  }

  /* ---- 2. natural full match, iPhone 12, screenshot every 3s ---- */
  {
    const ctx = await browser.newContext({ ...devices['iPhone 12'] });
    const page = await ctx.newPage();
    await page.goto(URL, { waitUntil: 'networkidle' });
    await page.evaluate(() => { try { localStorage.setItem('coached', '9'); } catch (e) {} });
    await page.reload({ waitUntil: 'networkidle' });
    await sleep(600);
    await page.click('#btn-play');
    // drive the player with a slow orbiting drag so it plays like a human
    await page.waitForFunction(() => window.__g && window.__g.state === 'play');
    for (let i = 0; i < 22; i++) {
      const done = await page.evaluate(() => !window.__g || window.__g.state === 'done' ||
        document.getElementById('results').classList.contains('show'));
      await shot(page, 'nat-' + String(i).padStart(2, '0') + (done ? '-done' : ''));
      if (done) break;
      await sleep(2500);
    }
    await sleep(3500);
    await shot(page, 'nat-final');
    await ctx.close();
  }

  /* ---- 3. tablet HUD close-ups ---- */
  {
    const ctx = await browser.newContext({ viewport: { width: 820, height: 1180 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    await page.goto(URL, { waitUntil: 'networkidle' });
    await page.evaluate(() => { try { localStorage.setItem('coached', '9'); } catch (e) {} });
    await page.reload({ waitUntil: 'networkidle' });
    await sleep(600);
    await page.click('#btn-play');
    await page.waitForFunction(() => window.__g && window.__g.state === 'play');
    await sleep(1500);
    await shot(page, 'tab-hud-top', { x: 0, y: 0, width: 820, height: 130 });
    const vp3 = page.viewportSize();
    await shot(page, 'tab-hud-bottom', { x: 0, y: vp3.height - 100, width: vp3.width, height: 100 });
    await ctx.close();
  }

  /* ---- 4. 320px: results burnline + stat tiles close-up, and dead-player HUD ---- */
  {
    const ctx = await browser.newContext({ viewport: { width: 320, height: 568 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true, userAgent: devices['iPhone 12'].userAgent });
    const page = await ctx.newPage();
    await page.goto(URL, { waitUntil: 'networkidle' });
    await page.evaluate(() => { try { localStorage.setItem('coached', '9'); } catch (e) {} });
    await page.reload({ waitUntil: 'networkidle' });
    await sleep(600);
    await page.click('#btn-play');
    await page.waitForFunction(() => window.__g && window.__g.state === 'play');
    await sleep(1200);
    await shot(page, 'se-hud-top', { x: 0, y: 0, width: 320, height: 100 });
    await page.evaluate(() => { window.__g.player.flame = 0.01; });
    await page.waitForFunction(() => window.__g.state === 'spectate');
    await sleep(400);
    const vp4 = page.viewportSize();
    await shot(page, 'se-dead-hud-bottom', { x: 0, y: vp4.height - 88, width: vp4.width, height: 88 });
    await page.evaluate(() => window.__g.skipSpectate());
    await sleep(4200);
    await shot(page, 'se-results-full');
    const strip = await page.locator('#res-strip').boundingBox();
    await shot(page, 'se-burnline', { x: 0, y: Math.max(0, strip.y - 14), width: 320, height: 60 });
    const stats = await page.locator('#res-stats').boundingBox();
    await shot(page, 'se-stats', { x: 0, y: stats.y - 6, width: 320, height: Math.min(200, stats.height + 12) });
    await ctx.close();
  }

  await browser.close();
}
main();
