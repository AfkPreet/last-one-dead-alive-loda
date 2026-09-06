/* main.js — app shell: screens, the frame loop, HUD, onboarding and the reveal.
 * The arena lives in game.js/render.js; this file is everything around it.
 */
(function (global) {
  'use strict';

  var P = global.Platform, Store = P.Store, S = global.Share, A = global.Audio2, R = global.RNG;
  var $ = function (id) { return document.getElementById(id); };

  var els = {
    frame: $('frame'), stage: $('stage'), hud: $('hud'),
    alive: $('hud-alive'), clock: $('hud-clock'), burn: $('hud-burn'), pips: $('pips'),
    phase: $('hud-phase-label'), bar: $('flamebar-fill'),
    coach: $('coach'), count: $('countdown'), toast: $('toast'),
    menu: $('menu'), how: $('how'), settings: $('settings'), results: $('results'),
    menuSeed: $('menu-seed'), streak: $('streakline'),
    reveal: $('res-reveal'), strip: $('res-strip'), stats: $('res-stats'), shareNote: $('share-note')
  };

  var surface = new P.Surface(els.stage);
  var renderer = new global.Renderer(surface);
  var input = new global.Input(els.stage);
  var game = null;
  var mode = Store.get('mode', 'daily');
  var challenge = S.parseChallenge();
  var sharePayload = '';               // built at death; the click handler must not compute it
  var lastResult = null;
  var revealTimers = [];
  var screen = 'menu';

  /* ---------- helpers ---------- */
  function show(name) {
    ['menu', 'how', 'settings', 'results'].forEach(function (k) {
      els[k].classList.toggle('show', k === name);
    });
    els.hud.classList.toggle('show', name === null);
    els.hud.setAttribute('aria-hidden', name === null ? 'false' : 'true');
    input.enabled = (name === null);
    if (name !== null) input.reset();
    screen = name;
  }
  /* One pip per soul, so the player never has to parse an ordinal mid-match. */
  var pipEls = [];
  function buildPips() {
    els.pips.innerHTML = '';
    pipEls = [];
    for (var i = 0; i < Game.K.SOULS; i++) {
      var d = document.createElement('div');
      d.className = 'pip lit';
      els.pips.appendChild(d);
      pipEls.push(d);
    }
  }
  function updatePips() {
    // Sorted so the pips go out left-to-right: the row reads as a countdown.
    var souls = game.souls;
    var order = pipOrder;
    for (var i = 0; i < order.length; i++) {
      var s = souls[order[i]];
      var cls = 'pip ' + (s.alive ? (s.isPlayer ? 'you' : 'lit') : 'out');
      if (pipEls[i].className !== cls) pipEls[i].className = cls;
    }
  }
  var pipOrder = [];

  var toastT = 0;
  function toast(msg, ms) {
    els.toast.textContent = msg;
    els.toast.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(function () { els.toast.classList.remove('show'); }, ms || 1800);
  }
  function haptic(p) { P.vibrate(p); }

  /* ---------- settings ---------- */
  var settings = {
    sound: Store.get('sound', true),
    haptics: Store.get('haptics', true),
    shake: Store.get('shake', !P.prefersReducedMotion()),
    contrast: Store.get('contrast', false),
    names: Store.get('names', true)
  };
  function applySettings() {
    A.setEnabled(settings.sound);
    Store.set('sound', settings.sound);
    Store.set('haptics', settings.haptics);
    Store.set('shake', settings.shake);
    Store.set('contrast', settings.contrast);
    Store.set('names', settings.names);
    renderer.contrast = settings.contrast;
    renderer.showNames = settings.names;
    if (game) { game.cam.enabled = settings.shake; game.reduced = !settings.shake; }
  }
  ['sound', 'haptics', 'shake', 'contrast', 'names'].forEach(function (k) {
    var el = $('set-' + k);
    el.checked = settings[k];
    el.addEventListener('change', function () { settings[k] = el.checked; applySettings(); A.play('ui'); });
  });
  $('haptic-note').textContent = P.hasHaptics
    ? 'Vibration supported on this device.'
    : 'This browser has no vibration API (iOS never has), so haptics do nothing here.';

  /* ---------- menu ---------- */
  function seedFor(m) {
    if (challenge) {
      if (challenge.seed) return challenge.seed;
      if (challenge.day) return 'LOD-DAY-' + challenge.day;
    }
    if (m === 'daily') return R.dailySeedString();
    return 'E-' + R.dayNumber() + '-' + Math.floor(performance.now() * 1000 % 1e9).toString(36);
  }
  function dayNumFor() {
    if (challenge && challenge.day) return challenge.day;
    return R.dayNumber();
  }
  function refreshMenu() {
    var p = S.loadProgress();
    if (challenge) {
      els.menuSeed.textContent = challenge.name
        ? ('CHALLENGE FROM ' + challenge.name)
        : ('CHALLENGE · DAY ' + (challenge.day || '?'));
      $('btn-mode').textContent = 'play today instead';
    } else if (mode === 'daily') {
      els.menuSeed.textContent = 'DAILY · DAY ' + R.dayNumber();
      $('btn-mode').textContent = 'switch to endless';
    } else {
      els.menuSeed.textContent = 'ENDLESS · RANDOM ARENA';
      $('btn-mode').textContent = 'switch to daily';
    }
    var bits = [];
    if (p.streak > 0) bits.push('streak ' + p.streak + (p.best > p.streak ? ' (best ' + p.best + ')' : ''));
    if (p.plays > 0) bits.push(p.wins + '/' + p.plays + ' died last');
    els.streak.textContent = bits.join(' · ');
  }

  /* ---------- onboarding ---------- */
  var coachSeen = Store.get('coached', 0);
  var coachQueue = [], coachUntil = 0;
  function coach(msg, secs) {
    coachQueue.push([msg, secs || 2.6]);
  }
  function pumpCoach(now) {
    if (now < coachUntil) return;
    if (!coachQueue.length) { els.coach.classList.remove('show'); return; }
    var c = coachQueue.shift();
    els.coach.innerHTML = c[0];
    els.coach.classList.add('show');
    coachUntil = now + c[1];
  }

  /* ---------- match ---------- */
  var loopId = 0, lastT = 0, acc = 0;
  var STEP = 1 / 60, MAX_FRAME = 0.25, MAX_STEPS = 5;
  var countdownN = 0, countdownT = 0;
  var seenPickup = false, seenSteal = false, seenDrain = false, warnedOnce = false;

  function startMatch() {
    A.unlock();
    cancelAnimationFrame(loopId);
    revealTimers.forEach(clearTimeout); revealTimers = [];

    var m = challenge ? 'daily' : mode;
    game = new Game({ seed: seedFor(m), mode: m });
    game.cam.enabled = settings.shake;
    game.reduced = !settings.shake;
    renderer.contrast = settings.contrast;
    renderer.showNames = settings.names;

    // A challenger's soul is renamed after them, but nothing about the
    // simulation changes — the daily has to be identical for everyone or the
    // shared scores mean nothing.
    if (challenge && challenge.name) {
      var idx = 1 + (R.hashString(game.seedStr) % (Game.K.SOULS - 1));
      game.souls[idx].name = challenge.name;
      game.ghostSoul = game.souls[idx];
    }

    // Player pip first, then bots — the row then reads left-to-right as a
    // countdown with "you" always in the same place.
    pipOrder = [0];
    for (var pi = 1; pi < Game.K.SOULS; pi++) pipOrder.push(pi);
    buildPips();
    els.results.classList.remove('settled');

    seenPickup = seenSteal = seenDrain = warnedOnce = false;
    coachQueue.length = 0; coachUntil = 0;
    els.coach.classList.remove('show');
    ghostPassed = false;

    global.__g = game;                 // test harness hook (tools/smoke.js)
    show(null);
    countdownN = 3; countdownT = 0;
    lastT = performance.now(); acc = 0;
    A.startMusic();
    A.setIntensity(0);

    if (coachSeen < 2) {
      coach('<em>DRAG</em> ANYWHERE TO MOVE', 2.2);
      coach('THE SPIKES ARE <em>FUEL</em>.<br>RUN <em>INTO</em> THEM.', 3.2);
    }
    loopId = requestAnimationFrame(frame);
  }

  var ghostPassed = false;

  function frame(now) {
    loopId = requestAnimationFrame(frame);
    var dt = (now - lastT) / 1000;
    lastT = now;
    if (dt > MAX_FRAME) dt = MAX_FRAME;          // a backgrounded tab must not fast-forward the match
    acc += dt;

    // Countdown runs on wall time, before the sim starts.
    if (game.state === 'countdown') {
      countdownT += dt;
      if (countdownT >= 0.75) {
        countdownT = 0;
        if (countdownN > 0) {
          els.count.textContent = countdownN === 0 ? '' : countdownN;
          els.count.classList.remove('tick');
          void els.count.offsetWidth;                 // restart the CSS animation
          els.count.classList.add('tick');
          A.play('count', 3 - countdownN);
          haptic(12);
          countdownN--;
        } else {
          els.count.textContent = 'BURN';
          toast('BE THE LAST TO DIE', 2400);
          els.count.classList.remove('tick');
          void els.count.offsetWidth;
          els.count.classList.add('tick');
          A.play('count', 3);
          haptic([18, 40, 18]);
          game.startPlay();
        }
      }
      acc = 0;
    }

    var steps = 0;
    while (acc >= STEP && steps < MAX_STEPS) {
      game.update(STEP, input);
      acc -= STEP; steps++;
    }
    if (steps === MAX_STEPS) acc = 0;             // fell behind; drop the backlog rather than spiral

    drainEvents();
    updateHud();
    pumpCoach(now / 1000);
    renderer.draw(game, input, now / 1000);
  }

  function drainEvents() {
    var ev = game.events;
    for (var i = 0; i < ev.length; i++) {
      var e = ev[i];
      switch (e.type) {
        case 'pickup':
          A.play('pickup', Math.min(6, e.data.n)); haptic(14);
          if (!seenPickup) {
            seenPickup = true;
            if (coachSeen < 2) coach('FUEL. BUT <em>BRIGHT BURNS FASTER</em>.', 2.8);
          }
          break;
        case 'steal':
          A.play('steal'); haptic([22, 26, 22]);
          if (!seenSteal) { seenSteal = true; if (coachSeen < 2) coach('YOU TORE ITS FLAME OUT.<br>THE <em>DIM</em> EAT THE <em>BRIGHT</em>.', 2.8); }
          break;
        case 'drained':
          A.play('drained'); haptic([34, 30, 34, 30, 44]);
          if (!seenDrain) { seenDrain = true; if (coachSeen < 2) coach('IT ROBBED YOU BECAUSE<br>YOU WERE <em>BRIGHTER</em>.', 2.8); }
          break;
        case 'emberLit': A.play('ui'); break;
        case 'dash': A.play('ui'); haptic(10); break;
        case 'dashFail': toast('TOO DIM TO DASH', 900); break;
        case 'soulDied':
          A.play('soulOut', Game.K.SOULS - e.data.left);
          if (game.ghostSoul && e.data.name === game.ghostSoul.name) toast(e.data.name + ' IS OUT', 1400);
          break;
        case 'ringWarn':
          A.play('ringWarn');
          if (coachSeen < 2 && !warnedOnce) { warnedOnce = true; coach('THE LIGHT IS CLOSING.', 2.0); }
          break;
        case 'ringMove': A.play('ringMove'); break;
        case 'fuelGone': A.play('danger'); toast('NO FUEL LEFT — TAKE IT FROM SOMEONE', 2400); break;
        case 'finale': A.play('danger'); haptic([60, 40, 60]); break;
        case 'playerDied': A.play('death'); haptic([90, 60, 140]); break;
        case 'finished': onFinished(e.data); break;
      }
    }
    ev.length = 0;

    // Music tightens as the arena empties.
    A.setIntensity(1 - (game.aliveCount - 1) / (Game.K.SOULS - 1));

    if (!ghostPassed && challenge && challenge.time && game.player.alive && game.t > challenge.time) {
      ghostPassed = true;
      toast('YOU OUTLIVED ' + (challenge.name || 'THEM'), 2200);
      haptic([30, 30, 30]);
    }
  }

  function updateHud() {
    var p = game.player;
    els.alive.textContent = game.aliveCount;
    els.clock.textContent = S.mmss(game.t);
    updatePips();

    var f = p.alive ? p.flame : 0;
    els.bar.style.width = Math.max(0, Math.min(100, f)).toFixed(1) + '%';
    els.bar.style.background = global.Juice.rampHex(Game.FLAME_RAMP, f / 100, 14);

    // The needle that makes "the fuel is the poison" legible: it climbs the
    // instant you brighten, so eating is visibly a trade, not a reward.
    var rate = game.playerBurnRate();
    els.burn.textContent = '-' + rate.toFixed(1) + '/s';
    els.burn.style.color = global.Juice.rampHex(Game.FLAME_RAMP, Math.min(1, rate / 9), 10);

    var label, warn = false;
    if (!p.alive) { label = 'YOU ARE OUT — TAP TO SKIP'; warn = true; }
    else if (game.letGoUsed) { label = 'LETTING GO'; warn = true; }
    else if (game.state === 'finale') { label = 'LAST ONE BURNING'; warn = true; }
    else if (game.fuelGone) { label = 'NO FUEL LEFT'; warn = true; }
    else if (game._playerOutside) { label = 'YOU ARE IN THE VOID'; warn = true; }
    else if (game.ringStage === 1) { label = 'THE LIGHT IS CLOSING'; warn = true; }
    else label = 'THE LIGHT HOLDS';
    if (els.phase.textContent !== label) els.phase.textContent = label;
    els.phase.classList.toggle('warn', warn);
  }

  /* ---------- results ---------- */
  function onFinished(res) {
    lastResult = res;
    A.stopMusic(0.8);
    cancelAnimationFrame(loopId);
    loopId = requestAnimationFrame(idleFrame);

    var dayNum = dayNumFor();
    var progress = (res.mode === 'daily') ? S.recordDaily(dayNum, res) : S.loadProgress();
    // Precompute the share string NOW. Building it inside the click handler
    // would risk losing iOS's transient activation before navigator.share runs.
    S.challengeUrl(res, dayNum);
    global.__sharePayload = sharePayload = S.buildText(res, dayNum, progress, settings.contrast,
      challenge && challenge.name ? { name: challenge.name, time: challenge.time } : null);

    coachSeen = Math.min(9, coachSeen + 1);
    Store.set('coached', coachSeen);

    renderReveal(res, progress);
    show('results');
    // The results panel starts almost transparent so the punchline lands over
    // the arena, on the player's own death bloom, not after a screen wipe.
    revealTimers.push(setTimeout(function () {
      els.results.classList.add('settled');
    }, res.won ? 3000 : 2200));
    A.play(res.won ? 'win' : 'lose');
    haptic(res.won ? [40, 50, 40, 50, 120] : [120]);
    // The player's own link should carry their run, not the challenger's.
    if (challenge) { S.clearChallengeParams(); challenge = null; }
  }

  function renderReveal(res, progress) {
    els.reveal.className = 'reveal ' + (res.won ? 'win' : 'lose');
    els.reveal.innerHTML = '';
    els.strip.textContent = '';
    revealTimers.forEach(clearTimeout); revealTimers = [];

    function line(cls, html, delay) {
      var d = document.createElement('div');
      d.className = cls;
      d.innerHTML = html;
      d.style.animationDelay = delay + 'ms';
      els.reveal.appendChild(d);
    }

    if (res.won) {
      // Paced. The joke only works if the second line arrives after the first
      // has already been read as a defeat.
      line('r1', 'YOU DIED LAST.', 0);
      line('r2', '…which means you were the last one alive.', 1200);
      line('r3', 'LAST ONE DEAD = LAST ONE ALIVE', 2300);
    } else if (res.letGo) {
      line('r1', 'YOU LET GO.', 0);
      line('r2', res.outlasted + ' souls were still burning.', 900);
      line('r3', 'IT ASKED YOU TO DIE <b>LAST</b>', 1700);
    } else {
      // Never a bare ordinal: "#4" means the opposite here to everywhere else,
      // and a second of "wait, is that good?" at first death loses the player.
      line('r1', 'YOU WENT OUT EARLY.', 0);
      line('r2', res.outlasted === 1
        ? 'One soul outlasted you.'
        : res.outlasted + ' souls outlasted you.', 900);
      line('r3', 'YOU HAD TO DIE <b>LAST</b>', 1700);
    }

    revealTimers.push(setTimeout(function () {
      els.strip.textContent = S.burnline(res.samples, res.time, settings.contrast);
    }, res.won ? 2500 : 1900));

    els.stats.innerHTML =
      '<div>BURNED FOR<b>' + S.mmss(res.time) + '</b></div>' +
      '<div>OUTLASTED YOU<b>' + res.outlasted + ' / ' + (res.total - 1) + '</b></div>' +
      '<div>FUEL EATEN<b>' + res.eaten + '</b></div>' +
      '<div>FLAME STOLEN<b>' + res.stolen + '</b></div>';
    els.shareNote.textContent = '';
  }

  /* Keep rendering the frozen arena behind the results screen. */
  function idleFrame(now) {
    loopId = requestAnimationFrame(idleFrame);
    game.cam.update(1 / 60);
    game.fx.update(1 / 60);
    game.txt.update(1 / 60);
    renderer.draw(game, null, now / 1000);
  }

  /* ---------- input wiring ---------- */
  input.onTap = function () {
    if (screen !== null || !game) return;
    if (game.state === 'spectate') { game.skipSpectate(); return; }
    game.dash();
  };
  global.addEventListener('keydown', function (e) {
    if (e.key === ' ' && screen === null && game) {
      e.preventDefault();
      if (game.state === 'spectate') game.skipSpectate(); else game.dash();
    }
    if (e.key === 'Enter' && screen === 'menu') startMatch();
  });

  /* ---------- buttons ---------- */
  $('btn-letgo').addEventListener('click', function (e) {
    e.stopPropagation();
    if (!game || screen !== null) return;
    if (game.state === 'spectate') { game.skipSpectate(); return; }
    if (game.letGo()) { A.play('death'); haptic([140, 60, 40]); }
  });

  $('btn-play').addEventListener('click', function () { A.unlock(); A.play('ui'); startMatch(); });
  $('btn-again').addEventListener('click', function () { A.play('ui'); startMatch(); });
  $('btn-menu').addEventListener('click', function () {
    A.play('ui'); cancelAnimationFrame(loopId); refreshMenu(); show('menu');
  });
  $('btn-how').addEventListener('click', function () { A.play('ui'); show('how'); });
  $('btn-how-back').addEventListener('click', function () { A.play('ui'); show('menu'); });
  $('btn-settings').addEventListener('click', function () { A.play('ui'); show('settings'); });
  $('btn-settings-back').addEventListener('click', function () { A.play('ui'); applySettings(); show('menu'); });
  $('btn-mode').addEventListener('click', function () {
    A.play('ui');
    if (challenge) { challenge = null; S.clearChallengeParams(); }
    else { mode = mode === 'daily' ? 'endless' : 'daily'; Store.set('mode', mode); }
    refreshMenu();
  });

  // Not async, and it does no work before navigator.share — that is the whole
  // reason sharing works on iOS.
  $('btn-share').addEventListener('click', function () {
    if (!sharePayload) return;
    S.share(sharePayload, function (outcome) {
      if (outcome === 'copied') { toast('COPIED — GO PASTE IT'); els.shareNote.textContent = 'Result copied to your clipboard.'; }
      else if (outcome === 'shared') toast('SHARED');
      else if (outcome === 'manual') {
        els.shareNote.textContent = sharePayload;
        toast('SELECT AND COPY BELOW', 2600);
      }
    });
    A.play('ui');
  });

  /* ---------- lifecycle ---------- */
  P.onHidden(function () {
    A.suspend();
    input.reset();
  });
  P.onVisible(function () {
    lastT = performance.now(); acc = 0;      // don't integrate the time we were away
    if (settings.sound) A.resume();
  });
  surface.onResize = function () {
    // Mid-match the world stays as dealt; a resize must not change the arena.
    if (!game) renderer.layout(Game.WORLD_H, 0, 0, 0);
  };

  if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
    global.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    });
  }

  /* ---------- boot ---------- */
  applySettings();
  refreshMenu();
  show('menu');
  if (challenge) toast(challenge.name ? (challenge.name + ' CHALLENGED YOU') : 'CHALLENGE ARENA LOADED', 2600);

  // A still frame of an idle arena behind the title screen.
  (function preview() {
    var g = new Game({ seed: 'menu-preview', mode: 'endless', auto: true });
    g.reduced = false;
    g.startPlay();
    var t0 = performance.now();
    (function tick(now) {
      if (screen !== 'menu') return;
      requestAnimationFrame(tick);
      if (g.state === 'done') { g = new Game({ seed: 'menu-' + (now | 0), mode: 'endless', auto: true }); g.startPlay(); }
      g.update(1 / 60, null);
      g.events.length = 0;
      renderer.draw(g, null, (now - t0) / 1000);
    })(t0);
  })();
})(typeof self !== 'undefined' ? self : this);
