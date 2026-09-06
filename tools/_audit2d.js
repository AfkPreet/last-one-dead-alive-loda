const { chromium, devices } = require('playwright');
const fs = require('fs');
const OUT='/tmp/claude-0/-home-user-last-one-dead-alive-loda/2e61c66a-0aec-59b9-8c65-9e67c82b7a63/scratchpad/shots2d';
fs.mkdirSync(OUT,{recursive:true});
(async()=>{
 const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--use-gl=swiftshader','--enable-unsafe-swiftshader','--no-sandbox']});
 for (const [tag,vp] of [['ip12',{...devices['iPhone 12']}],['se320',{viewport:{width:320,height:568},deviceScaleFactor:2,isMobile:true,hasTouch:true,userAgent:devices['iPhone 12'].userAgent}]]) {
  const ctx=await b.newContext(vp); const page=await ctx.newPage();
  await page.goto('http://127.0.0.1:8099/index.html',{waitUntil:'networkidle'});
  await page.waitForTimeout(600);
  await page.evaluate(()=>{ try{localStorage.setItem('lod.contrast','1');}catch(e){} });
  await page.click('#btn-settings'); await page.waitForTimeout(350);
  // toggle via the switch element
  await page.locator('#settings .row', {hasText:'High contrast'}).locator('i.sw').click();
  await page.waitForTimeout(200);
  await page.screenshot({path:`${OUT}/${tag}-settings-hc-on.png`});
  // names off too
  await page.locator('#settings .row', {hasText:'Show lamp names'}).locator('i.sw').click();
  await page.waitForTimeout(150);
  await page.click('#btn-settings-back'); await page.waitForTimeout(300);
  await page.click('#btn-play'); await page.waitForTimeout(11000);
  await page.screenshot({path:`${OUT}/${tag}-play-hc-nonames.png`});
  await page.waitForTimeout(6000);
  await page.screenshot({path:`${OUT}/${tag}-play-hc-nonames-2.png`});
  await ctx.close();
 }
 await b.close(); console.log('ok');
})();
