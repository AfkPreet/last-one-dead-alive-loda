const { chromium, devices } = require('playwright');
(async()=>{
 const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--use-gl=swiftshader','--enable-unsafe-swiftshader','--no-sandbox']});
 const ctx=await b.newContext({...devices['iPhone 12']}); const p=await ctx.newPage();
 await p.goto('http://127.0.0.1:8099/index.html',{waitUntil:'networkidle'}); await p.waitForTimeout(600);
 await p.click('#btn-play'); await p.waitForTimeout(7000);
 console.log(JSON.stringify(await p.evaluate(()=>{
  const r=id=>{const e=document.getElementById(id); if(!e) return null; const b=e.getBoundingClientRect(); return {t:+b.top.toFixed(1),b:+b.bottom.toFixed(1),l:+b.left.toFixed(1),r:+b.right.toFixed(1),w:+b.width.toFixed(1),h:+b.height.toFixed(1)};};
  const cs=n=>getComputedStyle(document.getElementById(n));
  return {vw:innerWidth,vh:innerHeight,
   letgo:r('btn-letgo'), alive:r('hud-alive'), pips:r('pips'), phase:r('hud-phase-label'),
   bar:r('flamebar'), burn:r('burnline-hud'), coach:r('coach'),
   coachFS:cs('coach').fontSize, phaseFS:cs('hud-phase-label').fontSize, phaseColor:cs('hud-phase-label').color,
   burnFS:cs('burnline-hud').fontSize,
   ring: (()=>{const g=window.__g,rr=window.__r; return {ringR:+g.ringR.toFixed(1), wW:g.worldW, wH:g.worldH};})()
  };
 }),null,1));
 await b.close();
})();
