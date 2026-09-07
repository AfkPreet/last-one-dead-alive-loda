/* main.js — app shell: screens, the frame loop, HUD, onboarding and the reveal.
 * The arena lives in game.js/render.js; this file is everything around it.
 */
(function (global) {
  'use strict';

  var P = global.Platform, Store = P.Store, S = global.Share, A = global.Audio2, R = global.RNG;
  var $ = function (id) { return document.getElementById(id); };

  var els = {
    frame: $('frame'), stage: $('stage'), hud: $('hud'),
    clock: $('hud-clock'), burn: $('hud-burn'), life: $('hud-life'), pips: $('pips'),
    phase: $('hud-phase-label'), bar: $('flamebar-fill'),
    barBox: $('flamebar'), dead: $('flamebar-dead'), marks: $('flamebar-marks'),
    tallyPrey: $('tally-prey'), tallyThreat: $('tally-threat'),
    tut: $('tut'), tutLine: $('tut-line'), tutDots: $('tut-dots'),
    coach: $('coach'), count: $('countdown'), toast: $('toast'),
    menu: $('menu'), how: $('how'), settings: $('settings'), results: $('results'),
    naming: $('naming'), nameInput: $('name-input'), tag: $('menu-tag'),
    menuSeed: $('menu-seed'), streak: $('streakline'),
    reveal: $('res-reveal'), strip: $('res-strip'), stats: $('res-stats'), shareNote: $('share-note')
  };

  var surface = new P.Surface(els.stage);
  var renderer = new global.Renderer(surface);
  var input = new global.Input(els.stage);
  var game = null;
  var tut = null;                      // the scripted first night, or null
  var ledger = global.Story.load();
  var mode = Store.get('mode', 'daily');
  var challenge = S.parseChallenge();
  var sharePayload = '';               // built at death; the click handler must not compute it
  var lastResult = null;
  var revealTimers = [];
  var screen = 'menu';

  /* ---------- helpers ---------- */
  function show(name) {
    ['menu', 'how', 'settings', 'results', 'naming'].forEach(function (k) {
      els[k].classList.toggle('show', k === name);
    });
    els.hud.classList.toggle('show', name === null);
    els.hud.setAttribute('aria-hidden', name === null ? 'false' : 'true');
    if (name !== null) els.tut.classList.remove('show');
    input.enabled = (name === null);
    if (name !== null) input.reset();
    screen = name;
  }
  /* One pip per soul, so the player never has to parse an ordinal mid-match. */
  var pipEls = [], pipCount = null;
  function buildPips() {
    els.pips.innerHTML = '';
    pipEls = [];
    for (var i = 0; i < game.souls.length; i++) {
      var d = document.createElement('div');
      d.className = 'pip lit';
      els.pips.appendChild(d);
      pipEls.push(d);
    }
    pipCount = document.createElement('span');
    pipCount.className = 'pipcount';
    els.pips.appendChild(pipCount);
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
    // Counting dots is fine at twelve and wrong at three: in the finale the
    // exact number is a decision, so it gets a numeral and nothing else does.
    var n = game.aliveCount, show = n <= 4;
    var txt = show ? n + ' LEFT' : '';
    if (pipCount._t !== txt) { pipCount._t = txt; pipCount.textContent = txt; }
    pipCount.classList.toggle('show', show);
  }
  var pipOrder = [];

  var toastT = 0;
  function toast(msg, ms) {
    els.toast.textContent = msg;
    els.toast.classList.add('show');
    // One text channel at a time. A toast, a phase label and a coach line used
    // to fire together in three type styles about the same second.
    els.hud.classList.add('toasting');
    clearTimeout(toastT);
    toastT = setTimeout(function () {
      els.toast.classList.remove('show');
      els.hud.classList.remove('toasting');
    }, ms || 1800);
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
      if (challenge.day) return R.seedForDay(challenge.day);   // same arena as that day's daily
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
    // A first-timer is about to get a lesson, not a match; say so on the button
    // rather than dropping them into one and explaining afterwards.
    $('btn-play').textContent = global.Tutorial.done() ? 'ENTER THE DARK' : 'LEARN THE DARK';

    // The tagline above already names who you hold, so this line is only your
    // own record. Kept to one line on a 320px screen.
    var bits = [];
    if (ledger.you) bits.push('you are ' + ledger.you);
    if (ledger.nights > 0) bits.push(ledger.carried + '/' + ledger.nights + ' carried');
    if (ledger.chain > 1) bits.push(ledger.chain + ' in a row');
    if (p.streak > 1) bits.push('🔥' + p.streak);
    els.streak.textContent = bits.join(' · ');

    // Night one states the rule; after that the tagline names who you hold.
    if (ledger.nights > 0 && ledger.carrying) {
      els.tag.innerHTML = ledger.carrying.name
        ? 'You are carrying <b>' + ledger.carrying.name + '</b>.<br>Carry it to the end of the night.'
        : 'You are carrying someone who<br>left no name.<b> Carry it to the end.</b>';
    }
  }

  /* ---------- onboarding ---------- */
  var coachSeen = Store.get('coached', 0);
  var coachQueue = [], coachUntil = 0;
  function coach(msg, secs) {
    // Nothing to teach a lamp that has already gone out.
    if (game && game.player && !game.player.alive) return;
    coachQueue.push([msg, secs || 2.6]);
  }
  function pumpCoach(now) {
    // Tell the renderer which band of the screen the coach line is occupying so
    // soul name labels get out of its way.
    //
    // This used to read two bounding rects EVERY frame, immediately after the
    // HUD had written to the same elements — a forced synchronous layout per
    // frame for a number that only changes when the phone rotates. It is
    // measured with the rest of the HUD now, and the coach's own band is read
    // only while a line is actually up.
    if (!topBandPx) measureHud();
    renderer.topBand = topBandPx;
    if (els.coach.classList.contains('show')) {
      var fb = els.frame.getBoundingClientRect();
      // Put the line in the half the player is not in.
      if (game && game.player && game.player.alive) {
        var py = renderer.toScreenY(game.player.y);
        els.coach.classList.toggle('low', py < fb.height * 0.5);
      }
      var cb = els.coach.getBoundingClientRect();
      renderer.coachBand = [cb.top - fb.top - 6, cb.bottom - fb.top + 6];
    } else {
      renderer.coachBand = null;
    }
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

  /* Adaptive resolution. Frame cost here is almost entirely fill rate, so on a
   * phone that can't hold 60fps the right lever is pixels, not effects. Steps
   * down only, with a long window and hysteresis, so it never oscillates. */
  var QUALITY_STEPS = [1, 0.8, 0.65, 0.5];
  var qIndex = 0, qSamples = [], qCooldown = 0;

  /* Adaptive resolution. Frame cost here is almost entirely fill rate, so on a
   * device that can't hold its own refresh rate the right lever is pixels.
   *
   * The signal is the frame interval, not time measured around renderer.draw():
   * Canvas2D commands are queued, so the draw call returns long before the
   * rasterisation it caused is finished, and timing it underestimates badly.
   *
   * The interval alone is ambiguous, though — a phone in low-power mode paces
   * rAF at 30fps while rendering perfectly happily, and reading that as load
   * would throw away half the resolution for nothing. So compare the typical
   * frame against the *best* frame: the fastest frames approximate the device's
   * own cadence, and only a gap between the two means we are the bottleneck. */
  function adaptQuality(frameMs, now) {
    if (now < qCooldown) return;
    qSamples.push(frameMs);
    if (qSamples.length < 90) return;
    qSamples.sort(function (a, b) { return a - b; });
    var p10 = qSamples[Math.floor(qSamples.length * 0.10)];   // ~ the device's cadence
    var p70 = qSamples[Math.floor(qSamples.length * 0.70)];   // ~ what we actually deliver
    qSamples.length = 0;

    var capped = p10 > 28;                 // the device is pacing at ~30fps by choice
    var struggling = capped ? p70 > 42 : p70 > 21;
    // Climb-back must be unreachable at the device's own floor, or the ladder
    // oscillates: a capped device that legitimately stepped down sits at 33.3ms,
    // which would read as headroom, and it would bounce up and down forever.
    // A 30fps-paced device simply cannot report headroom through this signal.
    var comfortable = !capped && p70 < 13;

    if (struggling && qIndex < QUALITY_STEPS.length - 1) {
      qIndex++;
      surface.setQuality(QUALITY_STEPS[qIndex]);
      qCooldown = now + 3000;              // let it settle before judging again
    } else if (comfortable && qIndex > 0) {
      qIndex--;
      surface.setQuality(QUALITY_STEPS[qIndex]);
      qCooldown = now + 8000;              // climb back reluctantly
    }
  }

  var countdownN = 0, countdownT = 0, openingLines = [];
  var seenPickup = false, seenSteal = false, seenDrain = false, warnedOnce = false;

  function startMatch(teach) {
    A.unlock();
    stopPreview();
    cancelAnimationFrame(loopId);
    revealTimers.forEach(clearTimeout); revealTimers = [];

    // A ?s= challenge is somebody's ENDLESS arena, not today's daily. Tagging it
    // 'daily' would let it move the daily streak and would re-share as
    // "?d=<today>", dropping the seed and breaking the challenge chain at the
    // first forward. The tag is metadata only — seedFor() below picks the arena.
    var m = challenge ? (challenge.seed ? 'endless' : 'daily') : mode;
    game = new Game(teach ? global.Tutorial.options() : { seed: seedFor(m), mode: m });
    game.cam.enabled = settings.shake;
    game.reduced = !settings.shake;
    renderer.contrast = settings.contrast;
    renderer.showNames = settings.names;

    // Name the other eleven from your own ledger: strangers on night one, and
    // by night ten a field of people you have outlasted, lost to, or dropped.
    // Purely cosmetic — the arena itself stays identical for everyone.
    var pool = global.Story.namePool(ledger, new R.Rng(game.seedStr + ':names'), game.souls.length - 1);
    for (var pi = 1; pi < game.souls.length; pi++) game.souls[pi].name = pool[pi - 1];

    // A challenger's soul is renamed after them, but nothing about the
    // simulation changes — the daily has to be identical for everyone or the
    // shared scores mean nothing.
    if (challenge && challenge.name) {
      var idx = 1 + (R.hashString(game.seedStr) % (game.souls.length - 1));
      game.souls[idx].name = challenge.name;
      game.ghostSoul = game.souls[idx];
    }

    // Player pip first, then bots — the row then reads left-to-right as a
    // countdown with "you" always in the same place.
    pipOrder = [0];
    for (var pi = 1; pi < game.souls.length; pi++) pipOrder.push(pi);
    buildPips();
    els.results.classList.remove('settled');

    seenPickup = seenSteal = seenDrain = warnedOnce = false;
    coachQueue.length = 0; coachUntil = 0;
    els.coach.classList.remove('show');
    ghostPassed = false;

    global.__g = game; global.__r = renderer; global.__i = input;   // test harness hooks (tools/*.js)
    // The opening is three lines on the three countdown beats. After a few
    // nights it collapses to the one line that still matters.
    // Decay keeps the LAST line — the character and the goal — not the first,
    // which is only scene-setting a returning player already has.
    var op = global.Story.opening(ledger);
    openingLines = ledger.nights < 3 ? op : [op[op.length - 1]];
    show(null);
    measureHud();                       // the strip is display:none until now
    // Fire the first line on the very first frame rather than after a beat of
    // dead air.
    countdownN = openingLines.length; countdownT = 99;
    lastT = performance.now(); acc = 0;
    A.startMusic();
    A.setIntensity(0);

    // The lesson replaces the coach entirely — being taught the same thing
    // twice in two different type styles is how a tutorial stops being read.
    tut = teach ? new global.Tutorial.Tutorial(game) : null;
    els.hud.classList.toggle('teaching', !!teach);
    els.tut.classList.toggle('show', !!teach);
    if (teach) {
      buildTutDots(tut.total);
      // No countdown and no opening prose: the lesson is the opening.
      openingLines = []; countdownN = 0;
      els.count.textContent = ''; els.count.classList.remove('line', 'tick');
      game.startPlay();
      pumpTut();
    } else if (coachSeen < 2) {
      coach('<em>DRAG</em> ANYWHERE TO MOVE', 2.2);
      coach('THE SPIKES ARE <em>FUEL</em>.<br>RUN <em>INTO</em> THEM.', 3.2);
    }
    loopId = requestAnimationFrame(frame);
  }

  /* ---------- the lesson ---------- */
  var tutDotEls = [];
  function buildTutDots(n) {
    els.tutDots.innerHTML = '';
    tutDotEls = [];
    for (var i = 0; i < n; i++) {
      var d = document.createElement('i');
      els.tutDots.appendChild(d);
      tutDotEls.push(d);
    }
  }
  function pumpTut() {
    if (!tut) return;
    if (els.tutLine.innerHTML !== tut.line) els.tutLine.innerHTML = tut.line;
    for (var i = 0; i < tutDotEls.length; i++) {
      var cls = i + 1 < tut.step ? 'past' : (i + 1 === tut.step ? 'on' : '');
      if (tutDotEls[i].className !== cls) tutDotEls[i].className = cls;
    }
    // Same rule as the coach line, but aimed at whatever the beat has staged:
    // the sentence goes in the half the lesson is not happening in.
    var h = els.frame.getBoundingClientRect().height;
    els.tutLine.classList.toggle('low', renderer.toScreenY(tut.focusY()) < h * 0.5);
    var lb = els.tutLine.getBoundingClientRect(), fb = els.frame.getBoundingClientRect();
    renderer.coachBand = [lb.top - fb.top - 6, lb.bottom - fb.top + 6];
  }
  /** Hand the player off to a real night. Called on the last beat and on skip. */
  function endTutorial() {
    if (!tut) return;
    tut = null;
    global.Tutorial.markDone();
    // The old one-shot coach lines taught the same two things; don't repeat them.
    coachSeen = Math.max(coachSeen, 2);
    Store.set('coached', coachSeen);
    els.tut.classList.remove('show');
    els.hud.classList.remove('teaching');
    renderer.coachBand = null;
    startMatch();
  }

  var ghostPassed = false;

  function frame(now) {
    loopId = requestAnimationFrame(frame);
    var frameMs = now - lastT;
    var dt = frameMs / 1000;
    lastT = now;
    if (dt > MAX_FRAME) dt = MAX_FRAME;          // a backgrounded tab must not fast-forward the match
    else adaptQuality(frameMs, now);             // stalls aren't render cost; skip them
    acc += dt;

    // Countdown runs on wall time, before the sim starts.
    if (game.state === 'countdown') {
      countdownT += dt;
      // Keep the lamps' name labels out from under the opening.
      var ci = els.count.firstElementChild;
      if (ci) {
        var cr = ci.getBoundingClientRect(), cf = els.frame.getBoundingClientRect();
        renderer.coachBand = [cr.top - cf.top - 6, cr.bottom - cf.top + 6];
      }
      // Prose needs longer on screen than a digit does; the last beat is short.
      var hold = countdownN > 0 ? 2.0 : 0.7;
      if (countdownT >= hold) {
        countdownT = 0;
        if (countdownN > 0) {
          var idx = openingLines.length - countdownN;
          // Wrapped so the prose gets its own scrim and its own measurable box:
          // the opening used to print straight over the lamps' name labels.
          els.count.innerHTML = '<span class="count-in">' + (openingLines[idx] || '') + '</span>';
          els.count.classList.add('line');
          els.count.classList.remove('tick');
          void els.count.offsetWidth;                 // restart the CSS animation
          els.count.classList.add('tick');
          A.play('count', idx);
          haptic(12);
          countdownN--;
        } else {
          els.count.textContent = 'BURN';
          renderer.coachBand = null;
          els.count.classList.remove('line', 'tick');
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
    if (tut) {
      tut.update(dt);
      if (tut.finished) { endTutorial(); return; }
      pumpTut();
    } else if (game.state !== 'countdown' && game.player.alive) pumpCoach(now / 1000);
    else if (!game.player.alive) { els.coach.classList.remove('show'); renderer.coachBand = null; }

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
          A.play('soulOut', game.souls.length - e.data.left);
          if (game.ghostSoul && e.data.name === game.ghostSoul.name) toast(e.data.name + ' IS OUT', 1400);
          break;
        case 'ringWarn':
          // No coach line here: the phase label already reads THE LIGHT IS
          // CLOSING for as long as it is true, and saying it twice at once just
          // put the same sentence on screen in two places.
          A.play('ringWarn');
          break;
        case 'ringMove': A.play('ringMove'); break;
        // No toast: the phase label carries this for as long as it is true, and
        // the edge needle has already swung from fuel to the nearest prey.
        case 'fuelGone': A.play('danger'); break;
        case 'finale': A.play('danger'); haptic([60, 40, 60]); break;
        case 'playerDied': A.play('death'); haptic([90, 60, 140]); break;
        case 'finished': onFinished(e.data); break;
      }
    }
    ev.length = 0;

    // Music tightens as the arena empties.
    A.setIntensity(1 - (game.aliveCount - 1) / Math.max(1, game.souls.length - 1));

    if (!ghostPassed && challenge && challenge.time && game.player.alive && game.t > challenge.time) {
      ghostPassed = true;
      toast('YOU OUTLIVED ' + (challenge.name || 'THEM'), 2200);
      haptic([30, 30, 30]);
    }
  }

  /* Your own flame ramped in the ONE colour that means "you". The bar used to
   * be painted with FLAME_RAMP, i.e. the same violet as every rival body on
   * screen — the one readout that is unambiguously yours wore everybody's
   * colour. Luminance still rises with flame, so it is the same ordered scale;
   * only the hue is now unique. */
  var YOU_RAMP = [[0.00, '#0a5f53'], [0.45, '#12d7b4'], [1.00, '#bafff2']];

  /* The strip's marks are DOM, so they are positioned with transforms and only
   * written when they actually move. Width is measured on resize, never in the
   * frame loop — reading clientWidth every frame is a forced layout 60 times a
   * second for a number that changes when the phone rotates. */
  var barW = 0, topBandPx = 0, markEls = [];
  function measureHud() {
    barW = els.barBox.clientWidth || 0;
    var fb = els.frame.getBoundingClientRect();
    var pb = els.phase.getBoundingClientRect();
    topBandPx = pb.height ? pb.bottom - fb.top + 6 : 0;
  }
  function markAt(i) {
    while (markEls.length <= i) {
      var el = document.createElement('i');
      els.marks.appendChild(el);
      markEls.push(el);
    }
    return markEls[i];
  }
  function updateStrip(f, rc, alive) {
    if (!barW) measureHud();
    var px = barW / 100;
    var m = rc.marks, n = alive ? m.length / 2 : 0;
    for (var i = 0; i < n; i++) {
      var el = markAt(i);
      var flame = m[i * 2], role = m[i * 2 + 1];
      var x = Math.round(Math.max(0, Math.min(100, flame)) * px * 2) / 2;
      if (el._x !== x) { el._x = x; el.style.transform = 'translateX(' + x + 'px)'; }
      var cls = role > 0 ? 'prey' : role < 0 ? 'threat' : 'tie';
      if (el._c !== cls) { el._c = cls; el.className = cls; }
      if (el._h !== 1) { el._h = 1; el.hidden = false; }
    }
    for (var j = n; j < markEls.length; j++) {
      if (markEls[j]._h !== 0) { markEls[j]._h = 0; markEls[j].hidden = true; }
    }
    // The dead zone travels with you: +/-6 flame, centred on your own edge.
    var dz = (Game.K.STEAL_MIN_DIFF || 6);
    var dx = Math.round((f - dz) * px * 2) / 2;
    if (els.dead._x !== dx) { els.dead._x = dx; els.dead.style.transform = 'translateX(' + dx + 'px)'; }
    // Width is a layout property and the dead zone never changes size; writing
    // it every frame invalidated layout sixty times a second for a constant.
    var w = (dz * 2) + '%';
    if (els.dead._w !== w) { els.dead._w = w; els.dead.style.width = w; }
  }

  function updateHud() {
    var p = game.player;
    els.clock.textContent = S.mmss(game.t);
    updatePips();

    var f = p.alive ? p.flame : 0;
    var rc = game.roleCounts();
    els.bar.style.width = Math.max(0, Math.min(100, f)).toFixed(1) + '%';
    els.bar.style.background = global.Juice.rampHex(YOU_RAMP, f / 100, 12);
    updateStrip(f, rc, p.alive);
    // Nothing on the track ahead of you AND somebody behind it: you are the
    // brightest lamp burning, which is this game's definition of being the
    // meal. Both halves matter — at the start of a match every lamp is at 40
    // and prey is 0 because the whole field is inside the dead zone, which is
    // the opposite situation and must not raise the same alarm.
    els.barBox.classList.toggle('over', p.alive && rc.prey === 0 && rc.threat > 0);

    setTally(els.tallyPrey, rc.prey, false, false);
    // A count is not urgency. The pill only pulses when the nearest thing that
    // can rob you is actually close enough to do it.
    setTally(els.tallyThreat, rc.threat, true, rc.nearThreat < 17);

    /* THE ANSWER TO "AM I ABOUT TO GO OUT".
     * flame alone cannot answer it (flame 30 is a minute early and four seconds
     * late), and a bare rate cannot either. flame / rate can, in one figure,
     * and it doubles as the game's economics lesson: eat, and the number jumps
     * while the rate beside it climbs, so the diminishing return is something
     * you watch rather than something you are told. */
    var out = !p.alive;
    els.hud.classList.toggle('out', out);
    var crit = false, dire = false;
    if (out) {
      els.life.textContent = 'OUT';
      els.burn.textContent = '';
      $('btn-letgo').firstChild.textContent = 'SKIP';
    } else {
      var secs = game.playerSecondsLeft();
      var txt = secs >= 10 ? Math.round(secs) + 's' : secs.toFixed(1) + 's';
      if (els.life._t !== txt) { els.life._t = txt; els.life.textContent = txt; }
      var rate = game.playerBurnRate();
      var rtxt = '-' + rate.toFixed(1) + '/s';
      if (els.burn._t !== rtxt) { els.burn._t = rtxt; els.burn.textContent = rtxt; }
      crit = secs < 6; dire = secs < 3;
      var lcls = 'life' + (dire ? ' crit dire' : crit ? ' crit' : secs < 10 ? ' warn' : '');
      if (els.life.className !== lcls) els.life.className = lcls;
      $('btn-letgo').firstChild.textContent = 'LET GO';
    }
    // The blink lives on #hud so the number, the strip and the screen border
    // all flash in phase — one alarm, not three things that happen to be red.
    els.hud.classList.toggle('crit', crit);
    els.hud.classList.toggle('dire', dire);

    var label, warn = false;
    if (!p.alive) { label = 'YOU ARE OUT — TAP TO SKIP'; warn = true; }
    else if (game.letGoUsed) { label = 'LETTING GO'; warn = true; }
    else if (game.state === 'finale') { label = 'LAST ONE BURNING'; warn = true; }
    else if (game.fuelGone) { label = 'NO FUEL LEFT — TAKE IT FROM SOMEONE'; warn = true; }
    else if (game._playerOutside) { label = 'YOU ARE IN THE VOID'; warn = true; }
    else if (game.ringStage === 1) { label = 'THE LIGHT IS CLOSING'; warn = true; }
    else label = 'THE LIGHT HOLDS';
    if (els.phase.textContent !== label) els.phase.textContent = label;
    els.phase.classList.toggle('warn', warn);
  }

  /* A tally at zero is still information — it says "nothing here can touch you"
   * — so it dims rather than disappearing and the row never reflows. */
  function setTally(el, n, isThreat, near) {
    var b = el._n || (el._n = el.getElementsByTagName('b')[0]);
    if (b.textContent !== String(n)) b.textContent = n;
    var cls = 'tally ' + (isThreat ? 'threat' : 'prey') +
              (n === 0 ? ' zero' : '') + (isThreat && n > 0 && near ? ' near' : '');
    if (el.className !== cls) el.className = cls;
  }

  /* Deadpan sign-off, drawn from a seeded stream so a given run always gets the
   * same line — two players comparing the same daily see the same joke. */
  var DEATH_LINES = {
    letGo: [
      'You had a whole night and you spent it on a button.',
      'You set it down. That was always allowed.',
      'Nobody made you carry it.'
    ],
    first: [
      'First out. Somebody has to be.',
      'You were the brightest thing here. That is what did it.',
      'Twelve lamps, and the dark picked you.'
    ],
    bright: [
      'You were holding too much to last.',
      'Something dimmer wanted what you were carrying.',
      'You made yourself the biggest fire in the field.'
    ],
    dim: [
      'You ran out. The quiet way.',
      'You were almost nothing, and then you were.',
      'The dark did most of the work.'
    ],
    close: [
      'One more second.',
      'Second-last is still not last.',
      'It nearly got there.'
    ]
  };

  function deathLine(res) {
    var r = new R.Rng(res.seed + ':epitaph:' + res.rank);
    var pool = res.letGo ? DEATH_LINES.letGo
             : res.rank === res.total ? DEATH_LINES.first
             : res.rank <= 3 ? DEATH_LINES.close
             : res.peak >= 55 ? DEATH_LINES.bright
             : DEATH_LINES.dim;
    return r.pick(pool);
  }

  /* ---------- results ---------- */
  function onFinished(res) {
    lastResult = res;
    // A match toast landing on the results copy reads as a layout bug.
    clearTimeout(toastT);
    els.toast.classList.remove('show');
    els.hud.classList.remove('toasting', 'crit', 'dire');
    A.stopMusic(0.8);
    cancelAnimationFrame(loopId);
    loopId = requestAnimationFrame(idleFrame);

    // Who you were carrying, whether they reached the end, and who fills you
    // tomorrow. Reads the run's real numbers; writes the ledger for next time.
    var night = global.Story.resolveNight(ledger, res, res.standings);

    var dayNum = dayNumFor();
    var progress = S.recordDaily(dayNum, res);   // no-ops unless this was today's daily
    // Precompute the share string NOW. Building it inside the click handler
    // would risk losing iOS's transient activation before navigator.share runs.
    S.challengeUrl(res, dayNum);
    global.__sharePayload = sharePayload = S.buildText(res, dayNum, progress, settings.contrast,
      challenge && challenge.name ? { name: challenge.name, time: challenge.time } : null,
      night ? night.carriedName : null);

    coachSeen = Math.min(9, coachSeen + 1);
    Store.set('coached', coachSeen);

    renderReveal(res, progress, night);
    show('results');
    // The results panel starts almost transparent so the punchline lands over
    // the arena, on the player's own death bloom, not after a screen wipe.
    revealTimers.push(setTimeout(function () {
      els.results.classList.add('settled');
    }, res.won ? 3000 : 2200));
    A.play(res.won ? 'win' : 'lose');
    haptic(res.won ? [40, 50, 40, 50, 120] : [120]);
    if (night && night.askName) {
      // Only after you have actually carried a night to its end -- and only if
      // the player is still on the results screen. Otherwise this ambushes
      // them a second after they have already walked back to the menu.
      revealTimers.push(setTimeout(function () {
        if (screen !== 'results') return;
        show('naming');
        // It is a form: put the caret in it.
        try { els.nameInput.focus(); } catch (e) {}
      }, 4600));
    }
    // The player's own link should carry their run, not the challenger's.
    if (challenge) { S.clearChallengeParams(); challenge = null; }
  }

  function renderReveal(res, progress, night) {
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
      // The pun is the turn; this is the point of it.
      line('r4', night && night.carriedName
        ? night.carriedName + ' reached the end of the night in your hands.'
        : 'It reached the end of the night in your hands.', 3100);
      // And the honest half. Being last and giving light are two different
      // goods; the game only scores the one that was about you, so it should at
      // least say what that one cost. Both numbers are exact.
      line('r5', res.spilt >= 12
        ? 'Staying cost the light ' + res.spilt + '.'
        : 'And you took almost nothing to do it.', 3900);
    } else {
      // Never a bare ordinal: "#4" means the opposite here to everywhere else,
      // and one second of "wait, is that good?" at first death loses the player.
      // Only name who died last if the match actually played out. When you go
      // out early we stop simulating after a few seconds of spectating, so the
      // remaining order is a guess and stating it as fact would be a lie.
      var winner = (!res.cut && res.standings && res.standings[0]) ? res.standings[0].name : null;
      line('r1', res.letGo ? 'YOU LET GO.' : 'YOU WENT OUT EARLY.', 0);
      var who = night && night.carriedName ? night.carriedName : 'It';
      var fact = res.letGo ? 'You set ' + (night && night.carriedName ? night.carriedName : 'it') + ' down.'
                           : who + ' went out in your hands.';
      fact += '<br><span class="dim">' +
        (res.outlasted === 1 ? 'One lamp outlasted you.'
                             : res.outlasted + ' lamps outlasted you.') +
        (winner ? ' ' + winner + ' reached the end.' : '') + '</span>';
      line('r2', fact, 900);
      line('r3', 'THE NIGHT ENDS WITH THE <b>LAST</b> LAMP', 1800);
      line('r4', deathLine(res), 2500);
    }

    revealTimers.push(setTimeout(function () {
      renderStrip(res);
    }, res.won ? 2500 : 1900));

    els.stats.innerHTML =
      // Labels kept to one line each: a wrapping label makes its tile taller
      // than the one beside it and the grid stops reading as a grid.
      '<div>BURNED FOR<b>' + S.mmss(res.time) + '</b></div>' +
      '<div>OUTLASTED YOU<b>' + res.outlasted + ' / ' + (res.total - 1) + '</b></div>' +
      '<div>LIGHT GIVEN<b>' + res.gave + '</b></div>' +
      // The cost of taking, stated plainly. A third of every tear is destroyed
      // and never becomes light -- this is the number that judges how you won.
      '<div>LIGHT SPILLED<b>' + res.spilt + '</b></div>';
    els.shareNote.textContent = '';
  }

  /* The share text is emoji because it has to paste into a group chat. On
   * screen we can do better: real cells on the flame ramp, so the unlit ones
   * read as burnt down rather than as missing glyphs. */
  function renderStrip(res) {
    var cells = S.burnCells(res.samples, res.time);
    var html = '<div class="strip-cap">YOUR FLAME, EVERY ' + S.CELL_SECONDS + ' SECONDS</div><div class="strip-rows">';
    for (var i = 0; i < cells.length; i += 10) {
      html += '<div class="strip-row">';
      var row = cells.slice(i, i + 10);
      for (var j = 0; j < row.length; j++) {
        var c = row[j];
        if (c.end) {
          html += '<div class="strip-cell end">💀</div>';
        } else if (c.spent) {
          html += '<div class="strip-cell spent"></div>';
        } else {
          var col = global.Juice.rampHex(Game.FLAME_RAMP, c.v / 100, 10);
          // Unlit cells keep a visible body so the strip reads as a strip.
          html += '<div class="strip-cell" style="background:' + (c.v < 6 ? '#241f38' : col) + '"></div>';
        }
      }
      html += '</div>';
    }
    els.strip.innerHTML = html + '</div>';
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
    if (game.state === 'countdown') { countdownN = 0; countdownT = 99; return; }
    if (game.state === 'spectate') { game.skipSpectate(); return; }
    game.dash();
  };
  global.addEventListener('keydown', function (e) {
    if (e.key === ' ' && screen === null && game) {
      e.preventDefault();
      if (game.state === 'spectate') game.skipSpectate(); else game.dash();
    }
    if (e.key === 'Enter' && screen === 'menu') startMatch(!global.Tutorial.done());
  });

  /* ---------- buttons ---------- */
  /* LET GO is held for 600ms, not tapped. The offer of death stays permanent and
   * un-dialogged, but a thumb that brushes the corner mid-panic doesn't end the run. */
  (function () {
    var btn = $('btn-letgo'), timer = 0, armed = false;
    function cancel() {
      if (timer) { clearTimeout(timer); timer = 0; }
      btn.classList.remove('arming');
      armed = false;
    }
    btn.addEventListener('pointerdown', function (e) {
      e.stopPropagation(); e.preventDefault();
      if (!game || screen !== null) return;
      if (game.state === 'spectate') { game.skipSpectate(); return; }
      if (!game.player.alive) return;
      // Touch pointers are implicitly captured by their target, so pointerleave
      // never fires and sliding off would not abort. Release the capture and
      // track the bounds ourselves.
      if (btn.hasPointerCapture && btn.hasPointerCapture(e.pointerId)) {
        try { btn.releasePointerCapture(e.pointerId); } catch (err) {}
      }
      armed = true;
      btn.classList.add('arming');
      haptic(8);
      timer = setTimeout(function () {
        cancel();
        if (game && game.letGo()) { A.play('death'); haptic([140, 60, 40]); }
      }, 600);
    });
    btn.addEventListener('pointermove', function (e) {
      if (!armed) return;
      var r = btn.getBoundingClientRect();
      var out = e.clientX < r.left - 8 || e.clientX > r.right + 8 ||
                e.clientY < r.top - 8 || e.clientY > r.bottom + 8;
      if (out) cancel();                 // slid off: changed your mind
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (ev) {
      btn.addEventListener(ev, function (e) { if (armed) { e.stopPropagation(); } cancel(); });
    });
    btn.addEventListener('click', function (e) { e.stopPropagation(); e.preventDefault(); });
  })();

  function finishNaming(name) {
    if (name) global.Story.nameYourself(ledger, name);
    A.play('ui');
    refreshMenu();
    show('results');
    els.results.classList.add('settled');
  }
  $('btn-name-ok').addEventListener('click', function () { finishNaming(els.nameInput.value); });
  $('btn-name-skip').addEventListener('click', function () { finishNaming(null); });
  els.nameInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); finishNaming(els.nameInput.value); }
  });
  els.nameInput.addEventListener('input', function () {
    $('name-count').textContent = els.nameInput.value.length + '/12';
  });

  // First ever play goes through the lesson; after that the button is the game.
  $('btn-play').addEventListener('click', function () {
    A.unlock(); A.play('ui'); startMatch(!global.Tutorial.done());
  });
  $('btn-tut-skip').addEventListener('click', function (e) {
    e.stopPropagation(); A.play('ui'); endTutorial();
  });
  $('btn-replay-tut').addEventListener('click', function () {
    A.unlock(); A.play('ui'); applySettings(); startMatch(true);
  });
  $('btn-again').addEventListener('click', function () { A.play('ui'); startMatch(); });
  $('btn-menu').addEventListener('click', function () {
    A.play('ui');
    revealTimers.forEach(clearTimeout); revealTimers = [];
    cancelAnimationFrame(loopId);
    A.stopMusic(0.4);
    refreshMenu();
    show('menu');
    startPreview();
  });
  $('btn-how').addEventListener('click', function () { A.play('ui'); show('how'); });
  $('btn-how-back').addEventListener('click', function () { A.play('ui'); show('menu'); startPreview(); });
  $('btn-settings').addEventListener('click', function () { A.play('ui'); show('settings'); });
  $('btn-settings-back').addEventListener('click', function () { A.play('ui'); applySettings(); show('menu'); startPreview(); });
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
    if (!settings.sound) return;
    A.resume();
    // suspend() stops the scheduler, so resuming the context is not enough —
    // without this the match plays out in silence after the first app switch.
    if (game && screen === null && game.state !== 'done') A.startMusic();
  });
  surface.onResize = function () {
    // Mid-match the world stays as dealt; a resize must not change the arena.
    if (!game) renderer.layout(Game.WORLD_H, 0, 0, 0);
    measureHud();
  };

  // The single-file bundle (tools/bundle.js) ships without a manifest or an
  // sw.js beside it, so the manifest link doubles as "this is the full site".
  var isFullSite = !!document.querySelector('link[rel="manifest"]');
  if (isFullSite && 'serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
    global.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    });
  }

  /* ---------- boot ---------- */
  applySettings();
  refreshMenu();
  show('menu');

  if (challenge) toast(challenge.name ? (challenge.name + ' CHALLENGED YOU') : 'CHALLENGE ARENA LOADED', 2600);

  /* A live match idling behind the title screen. Restarted every time we return
   * to the menu — otherwise the menu sits on the frozen last frame of the match
   * you just lost. */
  var previewId = 0, previewGame = null, previewT0 = 0, previewN = 0;
  function startPreview() {
    cancelAnimationFrame(previewId);
    previewGame = new Game({ seed: 'menu-' + (previewN++), mode: 'endless', auto: true });
    namePreview(previewGame);
    previewGame.startPlay();
    previewT0 = performance.now();
    previewId = requestAnimationFrame(function tick(now) {
      if (screen !== 'menu') { previewId = 0; return; }
      previewId = requestAnimationFrame(tick);
      if (previewGame.state === 'done') {
        previewGame = new Game({ seed: 'menu-' + (previewN++), mode: 'endless', auto: true });
        namePreview(previewGame);
        previewGame.startPlay();
      }
      previewGame.update(1 / 60, null);
      previewGame.events.length = 0;      // the menu is silent; drop them
      renderer.draw(previewGame, null, (now - previewT0) / 1000);
    });
  }
  /** The idle arena behind the title has to be the same world the story is
   *  about; a solemn line over a field of joke handles reads as an accident. */
  function namePreview(g) {
    var pool = global.Story.namePool(ledger, new R.Rng(g.seedStr + ':names'), g.souls.length - 1);
    for (var i = 1; i < g.souls.length; i++) g.souls[i].name = pool[i - 1];
  }

  function stopPreview() {
    cancelAnimationFrame(previewId);
    previewId = 0;
  }

  startPreview();
})(typeof self !== 'undefined' ? self : this);
