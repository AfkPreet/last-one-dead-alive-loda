/* _visual_audit.js — scratch. Drives the live build and screenshots every state. */
const { chromium, devices } = require('playwright-core');
const fs = require('fs');
const path = require('path');

const OUT = '/tmp/claude-0/-home-user-last-one-dead-alive-loda/2e61c66a-0aec-59b9-8c65-9e67c82b7a63/scratchpad/shots';
fs.mkdirSync(OUT, { recursive: true });

const EXEC = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const ARGS = ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'];
const URL = 'http://127.0.0.1:8099/';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function shot(page, tag, name) {
  const f = path.join(OUT, `${tag}__${name}.png`);
  await page.screenshot({ path: f });
  console.log('  shot', f);
  return f;
}

const PROFILES = [
  { tag: '01-iphone12', ctx: { ...devices['iPhone 12'] }, full: true },
  { tag: '02-iphoneSE320', ctx: { viewport: { width: 320, height: 568 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: devices['iPhone 12'].userAgent }, full: true },
  { tag: '03-tablet820', ctx: { viewport: { width: 820, height: 1180 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, full: false },
  { tag: '04-landscape740x360', ctx: { viewport: { width: 740, height: 360 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, full: false },
  { tag: '05-tall360x900', ctx: { viewport: { width: 360, height: 900 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }, full: false },
  { tag: '06-desktop1280', ctx: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 }, full: false },
];

async function run(browser, prof) {
  console.log('==', prof.tag);
  const context = await browser.newContext({ ...prof.ctx, colorScheme: 'dark' });
  const page = await context.newPage();
  page.on('console', m => { if (m.type() === 'error') console.log('  [console error]', m.text()); });
  page.on('pageerror', e => console.log('  [pageerror]', e.message));
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
  await page.reload({ waitUntil: 'networkidle' });
  await sleep(900);

  await shot(page, prof.tag, 'a-title');

  // how-to
  await page.click('#btn-how'); await sleep(500);
  await shot(page, prof.tag, 'b-howto-top');
  await page.evaluate(() => { const s = document.querySelector('#how .stack'); s.scrollTop = s.scrollHeight; });
  await sleep(300);
  await shot(page, prof.tag, 'c-howto-bottom');
  await page.click('#btn-how-back'); await sleep(400);

  // settings
  await page.click('#btn-settings'); await sleep(400);
  await shot(page, prof.tag, 'd-settings');
  await page.click('#btn-settings-back'); await sleep(400);

  // match
  await page.click('#btn-play');
  await sleep(500);
  await shot(page, prof.tag, 'e-countdown');
  await sleep(1000);
  await shot(page, prof.tag, 'f-countdown-1');
  await page.waitForFunction(() => window.__g && window.__g.state === 'play', null, { timeout: 15000 });
  await sleep(700);
  await shot(page, prof.tag, 'g-early-coach');
  await sleep(2500);
  await shot(page, prof.tag, 'h-early2');

  // consecutive frames for animation judgement
  await sleep(2000);
  await shot(page, prof.tag, 'i-mid-frameA');
  await sleep(120);
  await shot(page, prof.tag, 'i-mid-frameB');

  // jump the clock to the ring squeeze
  await page.evaluate(() => { window.__g.t = 26.5; });
  await sleep(1500);
  await shot(page, prof.tag, 'j-ring-closing');

  // LET GO arming state
  const box = await page.locator('#btn-letgo').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await sleep(300);
  await shot(page, prof.tag, 'k-letgo-arming');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height + 60);
  await page.mouse.up();
  await sleep(200);

  // void: shove the player outside the ring
  await page.evaluate(() => {
    const g = window.__g;
    g.player.x = 50 + g.ringR * 1.35;
    g.player.y = g.worldH / 2;
    g.player.flame = 34;
  });
  await sleep(900);
  await shot(page, prof.tag, 'l-void');

  // crowd shot: cluster souls near the player to test label collisions
  await page.evaluate(() => {
    const g = window.__g;
    g.player.x = 50; g.player.y = g.worldH / 2; g.player.flame = 30;
    let k = 0;
    for (const s of g.souls) {
      if (s.isPlayer || !s.alive) continue;
      const a = (k / 11) * Math.PI * 2; k++;
      s.x = 50 + Math.cos(a) * 9;
      s.y = g.worldH / 2 + Math.sin(a) * 6;
      s.flame = 20 + k * 5;
    }
  });
  await sleep(400);
  await shot(page, prof.tag, 'm-crowd-labels');

  // kill the player -> spectate
  await page.evaluate(() => { window.__g.player.flame = 0.01; });
  await page.waitForFunction(() => window.__g && window.__g.state === 'spectate', null, { timeout: 8000 });
  await sleep(600);
  await shot(page, prof.tag, 'n-spectate');
  await sleep(1200);
  await shot(page, prof.tag, 'n2-spectate-later');

  // to results (loss)
  await page.evaluate(() => window.__g.skipSpectate());
  await sleep(600);
  await shot(page, prof.tag, 'o-results-loss-early');
  await sleep(1600);
  await shot(page, prof.tag, 'p-results-loss-mid');
  await sleep(2500);
  await shot(page, prof.tag, 'q-results-loss-settled');

  // share pressed
  await page.click('#btn-share'); await sleep(700);
  await shot(page, prof.tag, 'r-results-share-note');

  // WIN run
  await page.click('#btn-again');
  await page.waitForFunction(() => window.__g && window.__g.state === 'play', null, { timeout: 15000 });
  await sleep(600);
  await page.evaluate(() => {
    const g = window.__g;
    g.t = 38;
    for (const s of g.souls) if (!s.isPlayer) s.flame = 0.02;
    g.player.flame = 70;
  });
  await page.waitForFunction(() => window.__g && (window.__g.state === 'finale' || window.__g.state === 'done'), null, { timeout: 10000 });
  await sleep(500);
  await shot(page, prof.tag, 's-finale-last-burning');
  await page.evaluate(() => { window.__g.player.flame = 0.02; });
  await page.waitForFunction(() => document.getElementById('results').classList.contains('show'), null, { timeout: 10000 });
  await sleep(700);
  await shot(page, prof.tag, 't-results-win-early');
  await sleep(1500);
  await shot(page, prof.tag, 'u-results-win-mid');
  await sleep(2500);
  await shot(page, prof.tag, 'v-results-win-settled');

  // naming screen (exists in DOM)
  const hasNaming = await page.evaluate(() => !!document.getElementById('naming'));
  if (hasNaming) {
    await page.evaluate(() => {
      document.querySelectorAll('.screen').forEach(e => e.classList.remove('show'));
      document.getElementById('naming').classList.add('show');
    });
    await sleep(400);
    await shot(page, prof.tag, 'w-naming');
    await page.evaluate(() => {
      const i = document.getElementById('name-input');
      if (i) { i.value = 'WICKERMAN'; i.dispatchEvent(new Event('input')); }
    });
    await sleep(300);
    await shot(page, prof.tag, 'w2-naming-filled');
  }

  // back to menu with progress + high contrast
  await page.evaluate(() => {
    document.querySelectorAll('.screen').forEach(e => e.classList.remove('show'));
    document.getElementById('results').classList.add('show');
  });
  await page.click('#btn-menu'); await sleep(600);
  await shot(page, prof.tag, 'x-menu-with-streak');
  await page.click('#btn-settings'); await sleep(300);
  await page.evaluate(() => { const c = document.getElementById('set-contrast'); c.checked = true; c.dispatchEvent(new Event('change')); });
  await sleep(200);
  await shot(page, prof.tag, 'y0-settings-contrast-on');
  await page.click('#btn-settings-back'); await sleep(600);
  await shot(page, prof.tag, 'y-menu-highcontrast');
  await page.click('#btn-play');
  await page.waitForFunction(() => window.__g && window.__g.state === 'play', null, { timeout: 15000 });
  await sleep(2500);
  await shot(page, prof.tag, 'z-match-highcontrast');

  await context.close();
}

(async () => {
  const browser = await chromium.launch({ executablePath: EXEC, args: ARGS });
  const only = process.argv[2];
  for (const p of PROFILES) {
    if (only && !p.tag.includes(only)) continue;
    try { await run(browser, p); } catch (e) { console.log('  FAILED', p.tag, e.message); }
  }
  await browser.close();
})();
