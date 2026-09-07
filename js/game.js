/* game.js — the arena simulation.
 *
 * DESIGN NOTE, because every rule below looks like a bug otherwise:
 * this is a battle royale played backwards. The spiky red things are food, not
 * hazards. Touching a brighter soul lets you tear its flame out, so the leader
 * is prey. The winner is the LAST soul to go out — which, once you say it out
 * loud, is just "the last one alive".
 *
 * ON THE DRAIN FORMULA, so nobody re-derives this the hard way: drain rises
 * with flame, which means each extra point of flame buys LESS time than the
 * last — but it still buys some. Time-to-zero is the integral of dF/drain(F),
 * which is strictly increasing in starting flame for any positive drain, so no
 * formula of this shape can ever make "more life" mean "less life". Hoarding is
 * punished by PREDATION, not by arithmetic: a bright soul is physically bigger,
 * every dimmer soul can rob it, and the amount robbed scales with the gap.
 */
(function (global) {
  'use strict';

  var J = global.Juice, clamp = J.clamp, lerp = J.lerp;

  /* ============================ TUNING ============================
   * All distances are in WORLD UNITS. The world is 100 units wide and
   * WORLD_H tall (derived from the screen aspect), so the game plays
   * identically on every device and a daily seed is fair for everyone. */
  var K = {
    SOULS: 12,
    FLAME_MAX: 100,
    FLAME_START: 40,

    // dFlame/dt = -(BASE + K*flame). Diminishing returns on flame: the first 10
    // points buy ~7s, the tenth 10 buy ~2s. It is a tax on brightness, not a
    // punishment for it — see the note at the top of this file.
    DRAIN_BASE: 1.15,
    DRAIN_K: 0.045,
    VOID_DRAIN: 5.5,          // extra drain per second while outside the light

    SPEED_MIN: 27,            // units/s at flame 0 — a crawl
    SPEED_SPAN: 30,           // + this much at flame 100 — bright is fast
    VOID_SPEED: 0.84,         // speed multiplier out in the dark
    ACCEL: 9.5,               // how fast a soul reaches its desired velocity (1/s)

    R_MIN: 2.05,              // radius at flame 0
    R_SPAN: 2.35,             // + this much at flame 100 — bright is a big target

    EMBER_R: 2.0,
    EMBER_VALUE: 9,
    EMBER_LIVE: 10,           // at a full table of 12
    EMBER_PER_SOUL: 0.9,      // fuel shrinks with the field, so it is always contested
    EMBER_MIN: 4,
    EMBER_RESPAWN: 0.4,      // many small pickups beat a few big ones: the
                              // arena must always show the player something to run at
    FUEL_DECAY: 0.02,        // respawn interval multiplier per second elapsed
    EMBER_PULL: 2.2,          // grab radius bonus, forgiving on a phone
    EMBER_ARM: 1.5,           // seconds a new ember spends inert and visible
    FUEL_CUTOFF: 40,          // seconds — after this, no more embers spawn, ever

    // The dark thickens. Without this the midgame settles into a stalemate where
    // the survivors sit at a comfortable flame and nobody dies for 25 seconds.
    ENTROPY_PER_SEC: 1 / 110,

    FINALE_SECS: 3.0,         // the last soul always gets a 3s burnout, never 0.1s
    FINALE_FLAME: 26,         // ...and a last flare-up so there is something to watch

    ELLIPSE_Y: 1.42,          // the light is taller than it is wide — it has to
                              // fill a portrait screen, not sit in the middle of one
    BOUND: 48,                // soft world edge, as a fraction-of-100 semi-axis

    STEAL_MIN_DIFF: 6,        // flame gap needed before contact does anything
    STEAL_RATIO: 0.42,        // of the gap...
    STEAL_MIN: 7, STEAL_MAX: 26,
    STEAL_KEEP: 0.66,         // ...the thief keeps this much; the rest is lost to the void
    STEAL_CD: 0.7,            // per-pair cooldown, seconds
    KNOCKBACK: 46,            // units/s applied to the victim

    // Tap to dash: you spend flame to move. Paying life for speed is the whole
    // game in one button, and the cost is what keeps it from being free.
    DASH_COST: 6,
    DASH_SPEED: 2.7,
    DASH_TIME: 0.26,
    DASH_CD: 1.0,
    DASH_MIN_FLAME: 9,

    GRACE: 12,                // seconds before bots will hunt the player
    SPECTATE_SPEED: 3.4,      // fast-forward multiplier after you die
    SPECTATE_MAX: 7.0         // real seconds of spectating before we cut to results
  };

  /* Light-ring schedule: [seconds, radius]. Linear between keyframes. */
  /* The light closes in stages: a hold to breathe, then a squeeze. Calibrated so
   * the arena reaches its tightest right as the match resolves (~50s). */
  var RING = [
    [0, 47], [7, 47],
    [15, 35], [20, 35],
    [27, 25], [32, 25],
    [39, 16], [43, 16],
    [50, 9.5], [9999, 9.5]
  ];

  /* Flame -> colour.
   *
   * A SINGLE HUE, ramped by luminance, deliberately. The old ramp ran blue ->
   * violet -> magenta -> RED -> amber -> white, which put a soul at flame 60 at
   * deltaE 6.8 from the ember colour: a rival and a piece of food were the same
   * colour on screen. (Measured; see tools/palette.js.)
   *
   * Now flame is encoded twice — luminance AND radius — and every hue outside
   * this ramp is free to mean something else:
   *   crimson  = fuel        (deltaE 79 from the nearest soul colour)
   *   cyan     = you / prey  (deltaE 57)
   *   amber    = a threat    (deltaE 60)
   * Luminance rises monotonically from 0.017 to 1.0, so the ramp reads as an
   * ordered scale rather than as a set of unrelated colours.
   */
  /* Respaced so the LUMINANCE ladder is even, not just the hue. The old stops
   * stepped L* by 9.6 12.1 3.8 8.2 4.8 4.8 10.8 5.4 17.2 15.4 (sigma 3.86) --
   * two lamps 10 flame apart could be dE00 3.8 from each other, which is
   * "identical" on a moving 10px disc. These stops give sigma 1.32 and a
   * minimum step of 5.0 (4.6 for a protanope). Top is #f0e2ff, not white:
   * pure white is reserved for the hot core and the hit flash, the two marks
   * that mean "something is happening right now". */
  var FLAME_RAMP = [
    [0.00, '#2a2159'],
    [0.20, '#4a37c8'],
    [0.40, '#7a4bee'],
    [0.60, '#a273f6'],
    [0.80, '#c9a6fa'],
    [1.00, '#f0e2ff']
  ];

  /* One meaning per hue, and every rule also carried by a second, non-hue
   * channel (ring style, tick direction, position on the flame strip).
   *
   *   WARM AMBER  = "run into this"  -> fuel, and prey rings
   *   CRIMSON     = "this costs you" -> threat rings, the closing light, the void
   *   TEAL        = you, and nothing else
   *
   * Grouping by ACTION rather than by object is what got the palette back
   * inside its budget: the old set spent crimson on fuel AND on the closing
   * ring, then had nothing warm left for prey, so prey borrowed the player's
   * own cyan (deltaE 0.0 from the "you" marker). */
  var C = {
    prey:   '#ffd166',      // brighter than you: touching it feeds you
    threat: '#f01d45',      // dimmer than you: touching it costs you
    idle:   '#7f8899',      // in range, inside the dead zone: nothing happens
    void:   '#07060d',
    field:  '#150e28',
    field2: '#0b0716',
    // Arena furniture, deliberately NOT violet: the old #7b2ff7 boundary was
    // dE00 2.0 from a flame-34 lamp, so the edge of the world and a rival were
    // the same colour. Slate is 18.0 from the nearest lamp on the ramp.
    ring:   '#606a86',
    ringHot:'#f01d45',      // must stay === threat: both mean "this costs you"
    ember:  '#ffb020',
    emberIn:'#ffd88a',
    you:    '#12d7b4',
    text:   '#f2eefc',
    dim:    '#9a90b8'
  };

  /* Fallback names for a match run without a ledger (the menu preview, the sim).
   * Story.namePool overrides these for real nights. */
  var NAMES = [
    'CINDER', 'WICK', 'SOOT', 'PYRE', 'GLIM', 'ASHFALL', 'SMOLDER', 'KINDLE',
    'FLICKER', 'DUSK', 'EMBERLY', 'CHAR', 'TALLOW', 'GLOAM', 'MURK', 'RUSHLIGHT',
    'TAPER', 'SPARK', 'BRAND', 'LANTERN', 'HOLLOW', 'MARA', 'VESTA', 'EMBER'
  ];

  var ARCH = {
    GREEDY:  { ember: 1.60, hunt: 0.55, flee: 0.55, ring: 1.0, sep: 0.55, wander: 0.30, target: [58, 78], react: 0.10, fear: 0.7 },
    HUNTER:  { ember: 0.80, hunt: 1.75, flee: 0.35, ring: 1.0, sep: 0.35, wander: 0.22, target: [28, 44], react: 0.08, fear: 0.5 },
    COWARD:  { ember: 1.05, hunt: 0.25, flee: 1.55, ring: 1.45, sep: 0.90, wander: 0.30, target: [31, 47], react: 0.12, fear: 1.2 },
    CAMPER:  { ember: 0.85, hunt: 0.70, flee: 0.85, ring: 1.6, sep: 0.70, wander: 0.18, target: [34, 52], react: 0.12, fear: 0.9 },
    CHAOS:   { ember: 1.15, hunt: 1.10, flee: 0.70, ring: 0.9, sep: 0.45, wander: 0.95, target: [40, 70], react: 0.06, fear: 0.6 }
  };
  var ARCH_KEYS = ['GREEDY', 'HUNTER', 'COWARD', 'CAMPER', 'CHAOS'];

  /* ============================ ENTITIES ============================ */

  function Soul(id, name, isPlayer) {
    this.id = id;
    this.name = name;
    this.isPlayer = !!isPlayer;
    this.x = 0; this.y = 0;
    this.vx = 0; this.vy = 0;
    this.dx = 0; this.dy = 0;          // desired direction, unit-ish
    this.flame = K.FLAME_START;
    this.alive = true;
    this.rank = 0;
    this.diedAt = 0;
    this.arch = 'CAMPER';
    this.w = ARCH.CAMPER;
    this.targetFlame = 45;
    this.think = 0;                    // reaction timer
    this.wanderA = 0;
    this.flash = 0;                    // white hit flash, seconds
    this.cd = null;                     // steal cooldown map, id -> time
    this.trail = 0;
    this.throttle = 0;
    this.dashT = 0; this.dashCd = 0; this.dashX = 0; this.dashY = 0;
    this.dashes = 0;
    this.kills = 0;
    this.eaten = 0;
    this.stolen = 0;
    this.robbed = 0;             // flame torn OUT of this soul by dimmer ones
    this.gave = 0;                     // flame this soul burned as light
    this.spilt = 0;                    // flame this soul destroyed by tearing
    this.peak = K.FLAME_START;
  }
  Soul.prototype.radius = function () { return K.R_MIN + K.R_SPAN * (this.flame / K.FLAME_MAX); };
  Soul.prototype.speed = function () { return K.SPEED_MIN + K.SPEED_SPAN * (this.flame / K.FLAME_MAX); };
  /* 20 buckets, not 14. rampHex quantises to round(t*n)/n, so at 14 the flames
   * 0,10,...,100 land on buckets 0,1,3,4,6,7,8,10,11,13,14 -- the quantiser
   * alone turned even stops back into uneven colour. At 20 it is 0,2,4,...,20. */
  Soul.prototype.color = function () { return J.rampHex(FLAME_RAMP, this.flame / K.FLAME_MAX, 20); };

  function Ember(x, y, seedPhase, arm) {
    this.x = x; this.y = y;
    this.alive = true;
    this.spin = seedPhase;
    this.born = 0;
    this.pop = 0;                       // 0..1 spawn-in animation
    this.arm = arm;                     // seconds until it can be eaten
    this.lit = 0;                       // 0..1 ignition flash
  }

  /* ============================ GAME ============================ */

  function Game(opts) {
    this.seedStr = opts.seed;
    this.mode = opts.mode || 'daily';
    this.rng = new global.RNG.Rng(this.seedStr);
    this.vrng = new global.RNG.Rng(this.seedStr + ':fx');   // visual-only stream
    // Fixed, not derived from the screen: two players on different phones must
    // get the identical arena or the daily's shared score means nothing.
    this.worldH = Game.WORLD_H;

    this.t = 0;                    // simulated seconds
    this.real = 0;                 // wall seconds since match start
    this.state = 'countdown';      // countdown | play | spectate | finale | done
    this.souls = [];
    this.embers = [];
    this.emberTimer = 0;
    this.aliveCount = opts.souls || K.SOULS;
    this.player = null;
    this.ringR = RING[0][1];
    this.ringPrev = this.ringR;
    this.ringStage = 0;
    this.finaleT = 0;
    this.spectateT = 0;
    this.fuelGone = false;
    // Two ledgers the story hangs on, both exact rather than estimated:
    //   light  — flame actually consumed by draining, i.e. oil turned into light
    //   spilled — flame destroyed mid-transfer, which never drains and so never
    //             shines. Conservation holds: startFlame + fuelEaten = light + spilled.
    this.light = 0;
    this.spilled = 0;
    this.startFlame = 0;
    this._soloRate = 0;
    this.letGoUsed = false;
    this.result = null;

    this.cam = new J.Camera();
    this.stop = new J.Hitstop();
    this.fx = new J.Particles(460);
    this.txt = new J.FloatText(20);

    this.events = [];              // drained by the UI layer each frame
    this.samples = [];             // [t, flame] of the player, for the share strip
    this.sampleT = 0;
    this.log = [];                 // kill/death feed
    this.reduced = false;
    this.showNames = true;
    this.auto = !!opts.auto;        // headless balance runs drive the player with bot AI
    // Tutorial hooks. Each one only ever removes a pressure; none of them change
    // how the simulation resolves, so the tutorial is the real game with the
    // clock held still.
    this.soulCount = opts.souls || K.SOULS;
    this.holdRing = !!opts.holdRing;    // the light stays where it is
    this.ringHoldR = opts.ringHoldR || 0;  // ...at this radius; the lesson animates it
    this.noSpawn = !!opts.noSpawn;      // fuel is placed by hand, not by the arena
    this.floor = opts.floor || 0;       // the player cannot be driven below this flame

    this._build();
  }

  Game.prototype.emit = function (type, data) { this.events.push({ type: type, data: data }); };

  Game.prototype._build = function () {
    var rng = this.rng;
    var names = NAMES.slice();
    rng.shuffle(names);
    var cx = 50, cy = this.worldH / 2;

    // Souls start evenly spaced on a circle so nobody is born with an edge,
    // with a small seeded jitter so the daily still feels hand-dealt.
    var a0 = rng.angle();
    for (var i = 0; i < this.soulCount; i++) {
      var isPlayer = (i === 0);
      var s = new Soul(i, isPlayer ? 'YOU' : names[i - 1] || ('SOUL' + i), isPlayer);
      var a = a0 + (i / this.soulCount) * Math.PI * 2 + rng.range(-0.06, 0.06);
      var rad = 0.63 + rng.range(-0.05, 0.05);           // fraction of the ring
      s.x = cx + Math.cos(a) * rad * this.ringR;
      s.y = cy + Math.sin(a) * rad * this.ringR * K.ELLIPSE_Y;
      s.wanderA = rng.angle();
      s.cd = Object.create(null);
      if (!isPlayer || this.auto) {
        s.arch = rng.pick(ARCH_KEYS);
        s.w = ARCH[s.arch];
        s.targetFlame = rng.range(s.w.target[0], s.w.target[1]);
        s.think = rng.range(0, s.w.react);
        if (!isPlayer) s.flame = K.FLAME_START + rng.range(-9, 9);
      }
      this.souls.push(s);
      if (isPlayer) this.player = s;
    }

    for (var i2 = 0; i2 < this.souls.length; i2++) this.startFlame += this.souls[i2].flame;
    if (!this.noSpawn) { for (var e = 0; e < K.EMBER_LIVE; e++) this._spawnEmber(true); }
  };

  /* Normalised distance from the centre of the light: <=1 is inside, whatever
   * the ring's current size. All the "am I in the dark" logic goes through this. */
  Game.prototype.nd = function (x, y, r) {
    r = r === undefined ? this.ringR : r;
    var dx = (x - 50) / r;
    var dy = (y - this.worldH / 2) / (r * K.ELLIPSE_Y);
    return Math.sqrt(dx * dx + dy * dy);
  };
  Game.prototype.ringRY = function () { return this.ringR * K.ELLIPSE_Y; };

  Game.prototype._ringRadius = function (t) {
    if (this.holdRing) return this.ringHoldR || RING[0][1];
    for (var i = 1; i < RING.length; i++) {
      if (t <= RING[i][0]) {
        var a = RING[i - 1], b = RING[i];
        var k = (t - a[0]) / Math.max(0.001, b[0] - a[0]);
        return lerp(a[1], b[1], J.Ease.inOutCubic(clamp(k, 0, 1)));
      }
    }
    return RING[RING.length - 1][1];
  };

  Game.prototype._spawnEmber = function (initial) {
    var rng = this.rng;
    var cx = 50, cy = this.worldH / 2;
    // Rejection-sample a spot inside the light that isn't on top of anyone.
    for (var tries = 0; tries < 32; tries++) {
      var a = rng.angle();
      var rr = 0.40 + 0.55 * Math.sqrt(rng.float());      // fraction of the ring
      var x = cx + Math.cos(a) * rr * this.ringR;
      var y = cy + Math.sin(a) * rr * this.ringR * K.ELLIPSE_Y;
      var ok = true;
      for (var i = 0; i < this.souls.length; i++) {
        var s = this.souls[i];
        if (!s.alive) continue;
        var d = Math.hypot(s.x - x, s.y - y);
        if (d < (initial ? 8 : 5)) { ok = false; break; }
      }
      if (!ok) continue;
      for (var j = 0; j < this.embers.length; j++) {
        if (Math.hypot(this.embers[j].x - x, this.embers[j].y - y) < 6.5) { ok = false; break; }
      }
      if (!ok) continue;
      var em = new Ember(x, y, rng.angle(), initial ? K.EMBER_ARM * 0.35 : K.EMBER_ARM);
      em.born = this.t;
      this.embers.push(em);
      return em;
    }
    return null;
  };

  /** Put fuel at a chosen spot — used by the tutorial to stage a lesson. */
  Game.prototype.placeEmber = function (x, y, arm) {
    var em = new Ember(x, y, this.rng.angle(), arm === undefined ? K.EMBER_ARM : arm);
    em.born = this.t;
    this.embers.push(em);
    return em;
  };

  Game.prototype._emberQuota = function () {
    if (this.noSpawn) return 0;
    // No fuel for a soul with nobody left to fight over it — otherwise the
    // arena keeps topping up the winner and the final burnout never lands.
    if (this.aliveCount <= 1) return 0;
    if (this.t >= K.FUEL_CUTOFF) return 0;
    return clamp(Math.round(this.aliveCount * K.EMBER_PER_SOUL), K.EMBER_MIN, K.EMBER_LIVE);
  };

  /* ---------------- update ---------------- */

  Game.prototype.update = function (rdt, input) {
    this.real += rdt;
    this.cam.update(rdt);

    if (this.state === 'countdown') return;

    var speed = 1;
    if (this.state === 'spectate') speed = K.SPECTATE_SPEED;
    if (this.state === 'finale') speed = 0.55;              // slow-mo hero death

    var dt = this.stop.consume(rdt) * speed;
    if (dt <= 0) { this.fx.update(rdt); this.txt.update(rdt); return; }

    // Clamp the step so a backgrounded tab can't teleport everyone.
    dt = Math.min(dt, 0.05 * speed);

    this.t += dt;
    this._updateRing(dt);
    this._updateEmbers(dt);
    this._updateSouls(dt, input);
    this._collide(dt);
    this._drain(dt);

    this.fx.update(dt);
    this.txt.update(dt);

    // Sample the player's flame for the shareable timeline strip.
    this.sampleT += dt;
    if (this.sampleT >= 0.4) {
      this.sampleT = 0;
      this.samples.push([this.t, this.player.alive ? this.player.flame : 0]);
    }

    if (this.state === 'spectate') {
      this.spectateT += rdt;
      if (this.spectateT >= K.SPECTATE_MAX) this._finish();
    }
    if (this.state === 'finale') {
      this.finaleT += dt;
    }
  };

  Game.prototype._updateRing = function (dt) {
    var target = this._ringRadius(this.t);
    if (target < this.ringPrev - 0.001 && this.ringStage === 0) {
      this.ringStage = 1;
      this.emit('ringMove');
    } else if (target >= this.ringPrev - 0.001 && this.ringStage === 1) {
      this.ringStage = 0;
    }
    // Warn a beat before each closure so it never feels unfair.
    var soon = this._ringRadius(this.t + 2.5);
    if (soon < target - 0.15 && !this._warned) { this._warned = true; this.emit('ringWarn'); }
    if (soon >= target - 0.15) this._warned = false;

    this.ringPrev = target;
    this.ringR = target;

    // The lesson places its own fuel, so it never reaches a fuel cutoff — and a
    // "NO FUEL LEFT" alarm 40 seconds into a tutorial is a bug wearing a toast.
    if (!this.fuelGone && !this.noSpawn && this.t >= K.FUEL_CUTOFF) {
      this.fuelGone = true;
      for (var i = 0; i < this.embers.length; i++) {
        var em = this.embers[i];
        this.fx.burst(this.vrng, em.x, em.y, 10, { colors: [C.ember, '#ff7aa2'], speed: 24, speed2: 70, life: 0.3, life2: 0.7, r: 0.5, r2: 1.4 });
      }
      this.embers.length = 0;
      this.emit('fuelGone');
    }
  };

  Game.prototype._updateEmbers = function (dt) {
    var quota = this._emberQuota();
    for (var i = this.embers.length - 1; i >= 0; i--) {
      var em = this.embers[i];
      em.spin += dt * 1.4;
      em.pop = Math.min(1, em.pop + dt * 4.5);
      if (em.arm > 0) {
        em.arm -= dt;
        if (em.arm <= 0) {
          em.arm = 0; em.lit = 1;
          this.fx.burst(this.vrng, em.x, em.y, 9,
            { colors: [C.ember, C.emberIn], speed: 18, speed2: 62, life: 0.16, life2: 0.4, r: 0.5, r2: 1.5 });
          this.emit('emberLit', { x: em.x, y: em.y });
        }
      } else if (em.lit > 0) {
        em.lit = Math.max(0, em.lit - dt * 3);
      }
      // An ember caught outside the shrinking light is lost with it.
      if (this.nd(em.x, em.y) > 1.02) {
        this.fx.burst(this.vrng, em.x, em.y, 6, { colors: [C.ember], speed: 10, speed2: 40, life: 0.25, life2: 0.5, r: 0.5, r2: 1.2 });
        this.embers.splice(i, 1);
      }
    }
    if (this.embers.length < quota) {
      this.emberTimer -= dt;
      var guard = 0;
      while (this.emberTimer <= 0 && this.embers.length < quota && guard++ < 4) {
        this.emberTimer += K.EMBER_RESPAWN * (1 + this.t * K.FUEL_DECAY);
        this._spawnEmber(false);
      }
      if (this.emberTimer < 0) this.emberTimer = 0;
    } else {
      this.emberTimer = 0;
    }
  };

  /* ---- bot brains ------------------------------------------------------------
   * A weighted steering blend. Each behaviour returns a direction; archetype
   * weights decide the personality. The key line is the flame budget: a bot
   * that is already brighter than it wants to be stops chasing embers and
   * starts running away, which is how the player learns the rule by watching. */
  Game.prototype._steerBot = function (s, dt) {
    var cx = 50, cy = this.worldH / 2;
    var w = s.w;
    var ax = 0, ay = 0;
    var over = s.flame > s.targetFlame;
    var f01 = s.flame / K.FLAME_MAX;

    // --- fuel: nearest ember, but only if we actually want to be brighter
    if (!over && this.embers.length) {
      var best = null, bestD = 1e9;
      for (var i = 0; i < this.embers.length; i++) {
        var em = this.embers[i];
        var d = Math.hypot(em.x - s.x, em.y - s.y) + em.arm * 5;
        // Don't chase fuel that's about to fall outside the light.
        if (this.nd(em.x, em.y) > 0.94) d += 40;
        if (d < bestD) { bestD = d; best = em; }
      }
      if (best) {
        var hunger = clamp((s.targetFlame - s.flame) / 30, 0.25, 1.4);
        ax += ((best.x - s.x) / Math.max(0.01, bestD)) * w.ember * hunger;
        ay += ((best.y - s.y) / Math.max(0.01, bestD)) * w.ember * hunger;
      }
    }

    // --- prey and predators. Brighter than me = food. Dimmer than me = danger.
    var hx = 0, hy = 0, fx = 0, fy = 0;
    for (var j = 0; j < this.souls.length; j++) {
      var o = this.souls[j];
      if (o === s || !o.alive) continue;
      var dx = o.x - s.x, dy = o.y - s.y;
      var dd = Math.hypot(dx, dy);
      if (dd > 34 || dd < 0.01) continue;
      var pull = 1 - dd / 34;
      var diff = o.flame - s.flame;
      if (o.isPlayer && this.t < K.GRACE) continue;          // early-game grace
      if (diff > K.STEAL_MIN_DIFF) {
        var greed = clamp(diff / 40, 0.2, 1.2);
        hx += (dx / dd) * pull * greed; hy += (dy / dd) * pull * greed;
      } else if (diff < -K.STEAL_MIN_DIFF) {
        var scare = clamp(-diff / 40, 0.2, 1.3) * w.fear;
        fx -= (dx / dd) * pull * scare; fy -= (dy / dd) * pull * scare;
      }
      // Personal space regardless of flame.
      if (dd < 9) { fx -= (dx / dd) * (1 - dd / 9) * w.sep; fy -= (dy / dd) * (1 - dd / 9) * w.sep; }
    }
    ax += hx * w.hunt + fx * w.flee;
    ay += hy * w.hunt + fy * w.flee;

    // --- the light. Overwhelming once you're actually outside it.
    var rx = cx - s.x, ry = cy - s.y;
    var rd = Math.hypot(rx, ry);
    var margin = (1 - this.nd(s.x, s.y)) * this.ringR;   // world-ish units to the edge
    if (rd > 0.01) {
      var pullIn = 0;
      if (margin < 0) pullIn = 7.0;                       // outside: nothing else matters
      else if (margin < 7) pullIn = w.ring * (1.6 - margin / 7);
      else pullIn = w.ring * 0.14;                         // gentle drift to the middle
      ax += (rx / rd) * pullIn;
      ay += (ry / rd) * pullIn;
    }

    // --- wander so nobody moves like a turret
    s.wanderA += this.rng.range(-2.4, 2.4) * dt;
    ax += Math.cos(s.wanderA) * w.wander;
    ay += Math.sin(s.wanderA) * w.wander;

    // --- endgame: no fuel left, so the only flame left is in other souls
    if (this.fuelGone) {
      ax += hx * 0.9; ay += hy * 0.9;
    }

    var m = Math.hypot(ax, ay);
    if (m > 0.001) { s.dx = ax / m; s.dy = ay / m; }
    // A bright bot deliberately eases off — being fast is what kills it.
    s.throttle = over ? lerp(1, 0.82, clamp((s.flame - s.targetFlame) / 30, 0, 1)) : 1;
    if (f01 > 0.9) s.throttle *= 0.92;
  };

  Game.prototype._updateSouls = function (dt, input) {
    var cx = 50, cy = this.worldH / 2;
    for (var i = 0; i < this.souls.length; i++) {
      var s = this.souls[i];
      if (!s.alive) continue;
      s.flash = Math.max(0, s.flash - dt * 4);

      // Frozen souls are staged props: the tutorial parks them where it needs
      // them and they stay put. They can still be robbed, so a frozen soul is a
      // target you can practise on rather than a chase you can lose.
      if (s.frozen) { s.vx = s.vy = 0; s.throttle = 0; continue; }

      if (s.isPlayer && this.auto) {
        s.think -= dt;
        if (s.think <= 0) { s.think = s.w.react; this._steerBot(s, dt); }
      } else if (s.isPlayer) {
        // Control is kept through the finale: the win is the player performing
        // their own death, not the engine performing it for them.
        if ((this.state === 'play' || this.state === 'finale') && input && input.mag > 0) {
          s.dx = input.x; s.dy = input.y;
          s.throttle = input.mag;
        } else {
          s.throttle = 0;
        }
      } else {
        s.think -= dt;
        if (s.think <= 0) { s.think = s.w.react; this._steerBot(s, dt); }
      }

      s.dashCd = Math.max(0, s.dashCd - dt);
      var outside = this.nd(s.x, s.y) > 1;
      var sp;
      if (s.dashT > 0) {
        s.dashT -= dt;
        s.dx = s.dashX; s.dy = s.dashY;
        sp = s.speed() * K.DASH_SPEED;
        if (!this.reduced) {
          this.fx.spawn({ x: s.x, y: s.y, vx: this.vrng.range(-14, 14), vy: this.vrng.range(-14, 14),
            life: 0.28, r: this.vrng.range(1.0, 2.2), color: s.color(), drag: 0.85, glow: true });
        }
      } else {
        sp = s.speed() * (outside ? K.VOID_SPEED : 1) * (s.throttle || 0);
      }
      var tvx = s.dx * sp, tvy = s.dy * sp;
      var k = 1 - Math.exp(-K.ACCEL * dt);
      s.vx += (tvx - s.vx) * k;
      s.vy += (tvy - s.vy) * k;
      s.x += s.vx * dt;
      s.y += s.vy * dt;

      // Soft world bounds: you can flee into the dark, but not off the map.
      var nb = this.nd(s.x, s.y, K.BOUND);
      if (nb > 1) {
        s.x = cx + (s.x - cx) / nb;
        s.y = cy + (s.y - cy) / nb;
        s.vx *= 0.4; s.vy *= 0.4;
      }

      // Trail — denser and hotter the brighter you are, so a bright soul can see
      // (and every hunter can see) exactly how much it is carrying.
      var sped = Math.hypot(s.vx, s.vy);
      s.trail -= dt * (1 + sped / 22) * (0.6 + s.flame / 60);
      if (s.trail <= 0 && !this.reduced) {
        s.trail = 0.05;
        var col = s.color();
        this.fx.spawn({
          x: s.x - s.vx * 0.02, y: s.y - s.vy * 0.02,
          vx: -s.vx * 0.12 + this.vrng.range(-4, 4),
          vy: -s.vy * 0.12 + this.vrng.range(-4, 4),
          life: this.vrng.range(0.22, 0.5), r: this.vrng.range(0.5, 1.5) * (0.6 + s.flame / 90),
          color: col, drag: 0.86, glow: true
        });
      }
    }
  };

  Game.prototype._collide = function (dt) {
    // Ember pickups
    for (var i = this.embers.length - 1; i >= 0; i--) {
      var em = this.embers[i];
      for (var j = 0; j < this.souls.length; j++) {
        var s = this.souls[j];
        if (!s.alive) continue;
        if (em.arm > 0) continue;                 // still igniting — not food yet
        var d = Math.hypot(s.x - em.x, s.y - em.y);
        if (d < s.radius() + K.EMBER_R + K.EMBER_PULL) {
          var before = s.flame;
          s.flame = Math.min(K.FLAME_MAX, s.flame + K.EMBER_VALUE);
          s.peak = Math.max(s.peak, s.flame);
          s.eaten++;
          this.embers.splice(i, 1);
          this.fx.burst(this.vrng, em.x, em.y, s.isPlayer ? 20 : 10,
            { colors: [C.ember, C.emberIn, '#ff9f1c'], speed: 30, speed2: 120, life: 0.22, life2: 0.55, r: 0.6, r2: 1.9 });
          if (s.isPlayer) {
            this.txt.add(em.x, em.y - 4, '+' + Math.round(s.flame - before), '#ffd0dc', 13);
            this.cam.shake(0.16);
            this.stop.hit(0.035);
            this.emit('pickup', { n: s.eaten });
          }
          break;
        }
      }
    }

    // Soul vs soul: the brighter one loses. Always.
    for (var a = 0; a < this.souls.length; a++) {
      var A = this.souls[a];
      if (!A.alive) continue;
      for (var b = a + 1; b < this.souls.length; b++) {
        var B = this.souls[b];
        if (!B.alive) continue;
        var dx = B.x - A.x, dy = B.y - A.y;
        var dd = Math.hypot(dx, dy);
        var rr = A.radius() + B.radius();
        if (dd > rr || dd < 0.0001) continue;

        // Always resolve the overlap so souls never stack. A frozen soul is a
        // fixture: it does not get shoved, or the lesson's staging drifts
        // across the arena as the player leans on it.
        var push = (rr - dd) * 0.5;
        var ka = A.frozen ? 0 : (B.frozen ? 2 : 1);
        var kb = B.frozen ? 0 : (A.frozen ? 2 : 1);
        A.x -= (dx / dd) * push * ka; A.y -= (dy / dd) * push * ka;
        B.x += (dx / dd) * push * kb; B.y += (dy / dd) * push * kb;

        var key = A.id + ':' + B.id;
        if ((A.cd[key] || 0) > this.t) continue;

        var diff = A.flame - B.flame;
        if (Math.abs(diff) < K.STEAL_MIN_DIFF) continue;
        var bright = diff > 0 ? A : B;
        var dim = diff > 0 ? B : A;
        var amount = clamp(Math.abs(diff) * K.STEAL_RATIO, K.STEAL_MIN, K.STEAL_MAX);
        amount = Math.min(amount, bright.flame);
        bright.flame -= amount;
        var kept = amount * K.STEAL_KEEP;
        var lost = amount - kept;
        this.spilled += lost;
        dim.spilt += lost;                  // charged to whoever did the tearing
        dim.flame = Math.min(K.FLAME_MAX, dim.flame + kept);
        dim.peak = Math.max(dim.peak, dim.flame);
        dim.stolen += amount;
        bright.robbed += amount;
        A.cd[key] = B.cd[key] = this.t + K.STEAL_CD;

        var kx = (bright.x - dim.x) / dd, ky = (bright.y - dim.y) / dd;
        bright.vx += kx * K.KNOCKBACK; bright.vy += ky * K.KNOCKBACK;
        dim.vx -= kx * K.KNOCKBACK * 0.35; dim.vy -= ky * K.KNOCKBACK * 0.35;
        bright.flash = 1;

        var mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2;
        this.fx.burst(this.vrng, mx, my, 22,
          { colors: [bright.color(), '#ffffff', dim.color()], speed: 40, speed2: 170, life: 0.2, life2: 0.6, r: 0.7, r2: 2.2, shape: 1 });

        if (dim.isPlayer) {
          this.txt.add(mx, my - 5, '+' + Math.round(amount * K.STEAL_KEEP), C.you, 15);
          this.cam.shake(0.38); this.stop.hit(0.075);
          this.emit('steal', { from: bright.name });
        } else if (bright.isPlayer) {
          this.txt.add(mx, my - 5, '-' + Math.round(amount), C.threat, 15);
          this.cam.shake(0.5); this.stop.hit(0.09);
          this.emit('drained', { by: dim.name });
        } else {
          this.cam.shake(0.06);
        }
      }
    }
  };

  Game.prototype._drain = function (dt) {
    var cx = 50, cy = this.worldH / 2;
    var entropy = 1 + this.t * K.ENTROPY_PER_SEC;
    // A floored player must never enter the finale burn-down: that path is a
    // scripted burn to zero and it is the one place the floor cannot hold.
    var solo = this.aliveCount === 1 && !this.floor;
    for (var i = 0; i < this.souls.length; i++) {
      var s = this.souls[i];
      if (!s.alive) continue;
      if (s.frozen) continue;              // staged props don't burn
      if (solo) {
        // The last soul burning gets a guaranteed FINALE_SECS of screen time.
        // Left to the normal formula this moment lasts a tenth of a second.
        if (this._soloRate === 0) {
          // The final flare is given oil, so count it as oil the lamp had.
          this.startFlame += Math.max(0, K.FINALE_FLAME - s.flame);
          s.flame = Math.max(s.flame, K.FINALE_FLAME);
          s.peak = Math.max(s.peak, s.flame);
          this._soloRate = s.flame / K.FINALE_SECS;
        }
        var burn = Math.min(s.flame, this._soloRate * dt);
        this.light += burn;
        s.gave += burn;
        s.flame -= this._soloRate * dt;
        if (s.isPlayer) {
          this._playerOutside = false;
          // The floor is a promise, and it has to hold on every path out of
          // this function — including the finale, which is the one path that
          // deliberately burns a lamp all the way down.
          if (this.floor && s.flame < this.floor) s.flame = this.floor;
        }
        if (s.flame <= 0) { s.flame = 0; this._kill(s); }
        continue;
      }
      var d = (K.DRAIN_BASE + K.DRAIN_K * s.flame) * entropy;
      var outside = this.nd(s.x, s.y) > 1;
      if (outside) {
        d += K.VOID_DRAIN;
        if (s.isPlayer && !this.reduced && this.vrng.float() < dt * 24) {
          this.fx.spawn({ x: s.x + this.vrng.range(-3, 3), y: s.y + this.vrng.range(-3, 3),
            vx: this.vrng.range(-16, 16), vy: this.vrng.range(-30, -8),
            life: 0.4, r: 1.1, color: s.color(), drag: 0.9, glow: true });
        }
      }
      var burned = Math.min(s.flame, d * dt);
      this.light += burned;
      s.gave += burned;
      s.flame -= d * dt;
      if (s.isPlayer) {
        this._playerOutside = outside;
        if (this.floor && s.flame < this.floor) s.flame = this.floor;
      }

      if (s.flame <= 0) {
        s.flame = 0;
        this._kill(s);
      }
    }
  };

  Game.prototype._kill = function (s) {
    s.alive = false;
    s.rank = this.aliveCount;        // #1 == died last == won
    s.diedAt = this.t;
    this.aliveCount--;

    var col = s.isPlayer ? C.you : '#ffffff';
    this.fx.burst(this.vrng, s.x, s.y, s.isPlayer ? 64 : 26,
      { colors: [col, C.threat, C.ring], speed: 30, speed2: s.isPlayer ? 210 : 120,
        life: 0.35, life2: s.isPlayer ? 1.3 : 0.8, r: 0.8, r2: s.isPlayer ? 3.2 : 2.0, drag: 0.93 });
    this.log.push({ name: s.name, rank: s.rank, t: s.diedAt, player: s.isPlayer });

    if (s.isPlayer) {
      this.cam.shake(1.0); this.stop.hit(0.28);
      this.emit('playerDied', { rank: s.rank });
      if (this.aliveCount === 1) this.embers.length = 0;
      if (this.aliveCount > 0) {
        this.state = this.auto ? 'play' : 'spectate';
        this.spectateT = 0;
      } else {
        this._finish();
      }
    } else {
      this.cam.shake(0.18);
      this.emit('soulDied', { name: s.name, rank: s.rank, left: this.aliveCount });
      if (this.aliveCount === 1 && this.player.alive) {
        this.state = 'finale';
        this.finaleT = 0;
        this.embers.length = 0;
        this.emit('finale');
      } else if (this.aliveCount === 1) {
        this.embers.length = 0;
      } else if (this.aliveCount === 0) {
        this._finish();
      }
    }
  };

  /** Total flame the arena ever handed out as fuel. */
  Game.prototype._fuelEaten = function () {
    var n = 0;
    for (var i = 0; i < this.souls.length; i++) n += this.souls[i].eaten;
    return n * K.EMBER_VALUE;
  };

  Game.prototype._finish = function () {
    if (this.state === 'done') return;
    this.state = 'done';
    var p = this.player;
    // Anyone still burning when we cut away is ranked by how much flame they had
    // left. That is a guess, not an observation — see `cut` below.
    var stragglers = this.souls.filter(function (s) { return s.alive; })
      .sort(function (a, b) { return a.flame - b.flame; });
    for (var i = 0; i < stragglers.length; i++) {
      stragglers[i].alive = false;
      stragglers[i].rank = stragglers.length - i;
      stragglers[i].diedAt = this.t;
      this.aliveCount--;                 // keep the counter honest to the end
    }
    this.result = {
      rank: p.rank || 1,
      total: K.SOULS,
      time: p.diedAt || this.t,
      matchTime: this.t,
      // True when the match was still running when we stopped simulating it.
      // The placements of everyone still burning are then estimates, so the
      // results screen must not report who died last as though it watched.
      // (Read from stragglers: by now they have all been marked dead above.)
      cut: stragglers.length > 0,
      eaten: p.eaten,
      stolen: Math.round(p.stolen),
      gave: Math.round(p.gave),         // light this player personally gave
      spilt: Math.round(p.spilt),       // light this player personally destroyed
      light: Math.round(this.light),      // total light the arena gave
      spilled: Math.round(this.spilled),  // total destroyed by tearing
      oil: Math.round(this.startFlame + this._fuelEaten()),   // all there ever was
      peak: Math.round(p.peak),
      won: (p.rank || 1) === 1,
      outlasted: (p.rank || 1) - 1,        // how many souls managed to die after you
      letGo: this.letGoUsed,
      dashes: p.dashes,
      seed: this.seedStr,
      mode: this.mode,
      samples: this.samples.slice(),
      standings: this.souls.slice().sort(function (a, b) { return a.rank - b.rank; })
        .map(function (s) { return { name: s.name, rank: s.rank, t: s.diedAt, player: s.isPlayer }; })
    };
    this.emit('finished', this.result);
  };

  /** The player's current flame loss per second — what the HUD needle shows. */
  Game.prototype.playerBurnRate = function () {
    var s = this.player;
    if (!s.alive) return 0;
    if (this.aliveCount === 1 && this._soloRate > 0) return this._soloRate;
    var d = (K.DRAIN_BASE + K.DRAIN_K * s.flame) * (1 + this.t * K.ENTROPY_PER_SEC);
    if (this.nd(s.x, s.y) > 1) d += K.VOID_DRAIN;
    return d;
  };

  /* Where the player stands in the field, as three numbers the HUD can show.
   * Lamps the lesson has taken off the board are not counted: the HUD must never
   * report a rival the player cannot see.
   * `prey` is how many lamps you may take from, `threat` how many may take from
   * you, `top` the brightest rival's flame — the tick the flame bar draws so
   * "am I the biggest fire here" is answerable without counting rings. */
  Game.prototype.roleCounts = function () {
    var p = this.player, out = this._rc || (this._rc = { marks: [] });
    var marks = out.marks;
    marks.length = 0;
    out.prey = out.threat = out.top = 0;
    out.nearThreat = out.nearPrey = 1e4;   // finite, so the HUD never compares against Infinity
    if (!p.alive) return out;
    for (var i = 0; i < this.souls.length; i++) {
      var s = this.souls[i];
      if (!s.alive || s.isPlayer || s.offBoard) continue;
      if (s.flame > out.top) out.top = s.flame;
      var diff = s.flame - p.flame;
      var d = Math.hypot(s.x - p.x, s.y - p.y);
      // 1 = prey, -1 = threat, 0 = inside the dead zone, where contact is inert.
      var role = 0;
      if (diff > K.STEAL_MIN_DIFF) {
        role = 1; out.prey++;
        if (d < out.nearPrey) out.nearPrey = d;
      } else if (diff < -K.STEAL_MIN_DIFF) {
        role = -1; out.threat++;
        if (d < out.nearThreat) out.nearThreat = d;
      }
      marks.push(s.flame, role);
    }
    return out;
  };

  /* Flame is time, so say it in seconds: this is the number the HUD shows.
   * It rises when you eat and falls as you brighten, which is the whole
   * economy of the game expressed as one figure.
   *
   * It is NOT flame / burn-rate. Drain is proportional to flame, so the rate
   * falls as you dim and the naive quotient is badly pessimistic -- measured at
   * 10.8s against a real 16.4s, a 51% lie in the one readout the player is
   * asked to trust. Integrate instead. With
   *
   *     df/dt = -(A + B*f),   A = DRAIN_BASE*entropy (+ VOID_DRAIN outside)
   *                           B = DRAIN_K*entropy
   *
   * the time to reach flame 0 is ln(1 + B*f/A) / B.
   *
   * Entropy climbs while you burn, so that first pass is optimistic at high
   * flame (+12.7% at flame 80). One fixed-point step -- re-evaluate entropy at
   * the midpoint of the interval the first pass predicted -- takes the worst
   * case to about 2% for the cost of a second log. Measured against a pure-drain
   * sim across flame 8..80 and t 0..40. */
  Game.prototype.playerSecondsLeft = function () {
    var p = this.player;
    if (!p.alive) return 0;
    // The finale burns the last lamp down on a fixed schedule, so there is no
    // curve to integrate: the rate IS the answer.
    if (this.aliveCount === 1 && this._soloRate > 0) return p.flame / this._soloRate;
    var out = this.nd(p.x, p.y) > 1 ? K.VOID_DRAIN : 0;
    var t = this._lifeAt(this.t, p.flame, out);
    return Math.min(999, this._lifeAt(this.t + t * 0.5, p.flame, out));
  };
  Game.prototype._lifeAt = function (tEntropy, flame, voidDrain) {
    var entropy = 1 + tEntropy * K.ENTROPY_PER_SEC;
    var A = K.DRAIN_BASE * entropy + voidDrain;
    var B = K.DRAIN_K * entropy;
    if (A <= 0 || B <= 0) return 999;
    return Math.log(1 + B * flame / A) / B;
  };

  /* Nearest armed ember, for the fuel needle at the screen edge. Arming embers
   * are deliberately excluded — pointing a player at food they cannot eat yet
   * is worse than pointing them nowhere. */
  Game.prototype.nearestFuel = function () {
    var p = this.player, best = null, bd = Infinity;
    if (!p.alive) return null;
    for (var i = 0; i < this.embers.length; i++) {
      var e = this.embers[i];
      if (e.arm > 0) continue;
      var d = Math.hypot(e.x - p.x, e.y - p.y);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  };

  /* Once the fuel is gone the needle has to point at something, and what it
   * points at IS the phase change: the food is other people now. */
  Game.prototype.nearestPrey = function () {
    var p = this.player, best = null, bd = Infinity;
    if (!p.alive) return null;
    for (var i = 0; i < this.souls.length; i++) {
      var s = this.souls[i];
      if (!s.alive || s.isPlayer || s.offBoard) continue;
      if (s.flame - p.flame <= K.STEAL_MIN_DIFF) continue;
      var d = Math.hypot(s.x - p.x, s.y - p.y);
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  };

  /* The game's stated goal is to die, so death is on offer at all times and
   * without a confirmation. Almost everyone presses it once, goes out 9th, and
   * learns the entire design in one second: it never asked you to die, it asked
   * you to die LAST. */
  Game.prototype.letGo = function () {
    var s = this.player;
    if (!s.alive || (this.state !== 'play' && this.state !== 'finale')) return false;
    s.flame = 0;
    this.letGoUsed = true;
    this.fx.burst(this.vrng, s.x, s.y, 30,
      { colors: [C.you, '#ffffff'], speed: 20, speed2: 150, life: 0.3, life2: 1.0, r: 0.7, r2: 2.6 });
    this._kill(s);
    return true;
  };

  /** Returns true if the dash fired. Costs flame, so it is never free speed. */
  Game.prototype.dash = function () {
    var s = this.player;
    if (!s.alive || (this.state !== 'play' && this.state !== 'finale')) return false;
    if (s.dashCd > 0 || s.dashT > 0) return false;
    if (s.flame < K.DASH_MIN_FLAME) { this.emit('dashFail'); return false; }
    var dx = s.dx, dy = s.dy;
    var m = Math.hypot(dx, dy);
    if (m < 0.01) {                       // standing still: dash the way you're moving
      m = Math.hypot(s.vx, s.vy);
      if (m < 0.01) return false;
      dx = s.vx / m; dy = s.vy / m;
    } else { dx /= m; dy /= m; }
    s.dashX = dx; s.dashY = dy;
    s.dashT = K.DASH_TIME;
    s.dashCd = K.DASH_CD;
    s.flame = Math.max(0, s.flame - K.DASH_COST);
    s.dashes++;
    this.fx.burst(this.vrng, s.x, s.y, 14,
      { colors: [s.color(), '#ffffff'], dir: Math.atan2(-dy, -dx), spread: 0.8,
        speed: 40, speed2: 130, life: 0.18, life2: 0.42, r: 0.6, r2: 1.8, shape: 1 });
    this.cam.shake(0.12);
    this.emit('dash');
    return true;
  };

  Game.prototype.startPlay = function () {
    if (this.state === 'countdown') this.state = 'play';
  };
  Game.prototype.skipSpectate = function () {
    if (this.state === 'spectate') this._finish();
  };

  Game.WORLD_H = 178;      // fixed 100 x 178 world — see the constructor
  Game.K = K;
  Game.C = C;
  Game.RING = RING;
  Game.FLAME_RAMP = FLAME_RAMP;
  Game.Soul = Soul;
  global.Game = Game;
})(typeof self !== 'undefined' ? self : this);
