/* _audit2b.js — scratch: finale/win/reveal/naming, a natural void, high contrast. */
const { chromium, devices } = require('playwright');
const fs = require('fs');
const URL = 'http://127.0.0.1:8099/index.html';
const OUT = '/tmp/claude-0/-home-user-last-one-dead-alive-loda/2e61c66a-0aec-59b9-8c65-9e67c82b7a63/scratchpad/shots2b';
fs.mkdirSync(OUT, { recursive: true });

const VIEWS = [
  { tag: 'ip12', ctx: { ...devices['iPhone 12'] } },
  { tag: 'se320', ctx: { viewport: { width: 320, height: 568 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: devices['iPhone 12'].userAgent } }
];

(async () => {
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox']
  });

  for (const v of VIEWS) {
    const tag = v.tag;
    const ctx = await browser.newContext(v.ctx);
    const page = await ctx.newPage();
    page.on('pageerror', e => console.log(tag + ' PAGEERROR ' + e.message));
    await page.goto(URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(700);

    // ---- natural-ish void: nudge the player just past the ring on the NORTH side
    await page.click('#btn-play');
    await page.waitForTimeout(5200);
    await page.evaluate(() => {
      const g = window.__g;
      g.t = Math.max(g.t, 26);
      g.player.flame = 55;
      g.player.x = g.worldW * 0.5;
      g.player.y = g.worldH * 0.5 - g.ringR * g.constructor.K ? 0 : 0;
    });
    await page.evaluate(() => {
      const g = window.__g;
      g.player.x = g.worldW * 0.5;
      g.player.y = g.worldH * 0.5 - g.ringRY() * 1.12;
    });
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/${tag}-20-void-north.png` });
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${OUT}/${tag}-20b-void-north.png` });

    // ---- LET GO press-and-hold visual
    await page.evaluate(() => { const g = window.__g; g.player.x = g.worldW*0.5; g.player.y = g.worldH*0.5; });
    const lg = await page.locator('#btn-letgo').boundingBox();
    await page.mouse.move(lg.x + lg.width / 2, lg.y + lg.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(320);
    await page.screenshot({ path: `${OUT}/${tag}-21-letgo-holding.png` });
    await page.mouse.up();
    await page.waitForTimeout(200);

    // ---- force a WIN: keep nuking rivals until only the player burns
    await page.evaluate(() => {
      window.__killer = setInterval(() => {
        const g = window.__g; if (!g) return;
        g.player.flame = Math.max(g.player.flame, 45);
        for (const s of g.souls) if (!s.isPlayer && s.alive) s.flame = 0.2;
      }, 120);
    });
    for (let i = 0; i < 100; i++) {
      const st = await page.evaluate(() => ({ s: window.__g.state, a: window.__g.aliveCount }));
      if (st.s === 'finale' || st.a <= 1) break;
      await page.waitForTimeout(200);
    }
    await page.evaluate(() => clearInterval(window.__killer));
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/${tag}-22-finale.png` });
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${OUT}/${tag}-22b-finale.png` });
    await page.evaluate(() => { window.__g.player.flame = 3; });
    for (let i = 0; i < 120; i++) {
      const done = await page.evaluate(() => document.getElementById('results').classList.contains('show'));
      if (done) break;
      await page.waitForTimeout(200);
    }
    await page.screenshot({ path: `${OUT}/${tag}-23-reveal-t0.png` });
    await page.waitForTimeout(1100);
    await page.screenshot({ path: `${OUT}/${tag}-24-reveal-t1.png` });
    await page.waitForTimeout(1400);
    await page.screenshot({ path: `${OUT}/${tag}-25-results-win.png` });
    fs.writeFileSync(`${OUT}/${tag}-win.txt`, await page.evaluate(() => JSON.stringify({
      reveal: document.getElementById('res-reveal').innerText,
      strip: document.getElementById('res-strip').innerText,
      stats: document.getElementById('res-stats').innerText,
      share: window.__sharePayload || null
    }, null, 1)));
    // share note
    await page.click('#btn-share').catch(() => {});
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}/${tag}-26-results-share-note.png` });
    // naming
    for (let i = 0; i < 30; i++) {
      if (await page.evaluate(() => document.getElementById('naming').classList.contains('show'))) break;
      await page.waitForTimeout(300);
    }
    await page.screenshot({ path: `${OUT}/${tag}-27-naming.png` });
    await page.fill('#name-input', 'WWWWWWWWWWWW').catch(() => {});
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/${tag}-28-naming-filled.png` });
    await page.click('#btn-name-ok').catch(() => {});
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${OUT}/${tag}-29-menu-after-win.png` });

    // ---- high contrast + names off
    await page.click('#btn-settings').catch(() => {});
    await page.waitForTimeout(400);
    await page.click('#set-contrast').catch(() => {});
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${OUT}/${tag}-30-settings-contrast-on.png` });
    await page.click('#btn-settings-back');
    await page.waitForTimeout(300);
    await page.click('#btn-play');
    await page.waitForTimeout(9000);
    await page.screenshot({ path: `${OUT}/${tag}-31-play-highcontrast.png` });

    await ctx.close();
    console.log('done ' + tag);
  }
  await browser.close();
})();
