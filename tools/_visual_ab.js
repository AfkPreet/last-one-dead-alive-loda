/* _visual_ab.js — scratch. Freeze the sim, then A/B contrast + names, and crop labels. */
const { chromium, devices } = require('playwright-core');
const fs = require('fs');
const path = require('path');
const OUT = '/tmp/claude-0/-home-user-last-one-dead-alive-loda/2e61c66a-0aec-59b9-8c65-9e67c82b7a63/scratchpad/shots3';
fs.mkdirSync(OUT, { recursive: true });
const EXEC = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const ARGS = ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'];
const URL = 'http://127.0.0.1:8099/';
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({ executablePath: EXEC, args: ARGS });
  const ctx = await browser.newContext({ viewport: { width: 320, height: 568 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: devices['iPhone 12'].userAgent });
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.evaluate(() => { try { localStorage.setItem('coached', '9'); localStorage.setItem('contrast', 'false'); } catch (e) {} });
  await page.reload({ waitUntil: 'networkidle' });
  await sleep(600);
  await page.click('#btn-play');
  await page.waitForFunction(() => window.__g && window.__g.state === 'play');
  await sleep(9000);
  // freeze the sim; the renderer keeps drawing
  await page.evaluate(() => { window.__g.update = function () {}; });
  await sleep(400);
  await page.screenshot({ path: path.join(OUT, 'ab-contrast-off.png') });
  await page.screenshot({ path: path.join(OUT, 'ab-arena-crop-off.png'), clip: { x: 0, y: 150, width: 320, height: 260 } });
  await page.evaluate(() => { window.__r.contrast = true; });
  await sleep(400);
  await page.screenshot({ path: path.join(OUT, 'ab-contrast-on.png') });
  await page.screenshot({ path: path.join(OUT, 'ab-arena-crop-on.png'), clip: { x: 0, y: 150, width: 320, height: 260 } });
  await page.evaluate(() => { window.__r.contrast = false; window.__r.showNames = false; });
  await sleep(400);
  await page.screenshot({ path: path.join(OUT, 'ab-names-off.png') });
  // bottom-of-arena label band, zoomed
  await page.evaluate(() => { window.__r.showNames = true; });
  await sleep(300);
  await page.screenshot({ path: path.join(OUT, 'ab-bottom-band.png'), clip: { x: 0, y: 380, width: 320, height: 180 } });
  await ctx.close();
  await browser.close();
})();
