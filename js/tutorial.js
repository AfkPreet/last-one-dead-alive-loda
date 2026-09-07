/* tutorial.js — the first night, scripted.
 *
 * Not a separate mode: a real Game with every pressure held off. Three lamps
 * instead of twelve, the light held close so everything is big enough to read,
 * no fuel except what a beat puts down by hand, the other two lamps frozen as
 * staged props, and a floor under the player's flame so nobody can lose while
 * they are reading.
 *
 * Three rules this file keeps:
 *
 *   1. A beat's `after` line fires ONLY when the player did the thing. If the
 *      timeout ends the beat, the `fail` line says what is still true. A
 *      tutorial that tells a motionless player "YOU TORE ITS FLAME OUT" has
 *      taught them that the text on screen is decoration.
 *   2. No colour words. DASHED, SOLID, SPIKES. The lesson describes shapes, so
 *      it stays true if the palette moves and it works for a player who cannot
 *      see the difference between amber and crimson.
 *   3. Nothing is parked off the map. Both props stay on screen the whole
 *      lesson and only their flame changes, so "3 LEFT" is honest and the
 *      player watches a mark change meaning rather than appear from nowhere.
 *
 * Every gap is derived from the player's own flame, never a constant, so a
 * player who ate well in beat 2 still gets a real beat 4.
 */
(function (global) {
  'use strict';

  var Store = global.Platform.Store;
  var HOME_R = 30;          // the held light: tight enough that the marks are legible

  function build(g, T) {
    var cx = 50, cy = g.worldH / 2;
    var p = g.souls[0];
    var a = g.souls[1], b = g.souls[2];
    var K = global.Game.K;

    /* A prop: on screen, at a fixed mark, not thinking, not burning. The mark
     * is remembered and re-pinned every frame, because a player who leans on a
     * prop would otherwise bulldoze it across the arena a pixel at a time. */
    function put(s, x, y, f) {
      s.frozen = true; s.offBoard = false;
      s.x = s.px = x; s.y = s.py = y; s.vx = s.vy = 0;
      s.flame = f; s.peak = Math.max(s.peak, f);
    }
    /* Beats 3 and 4 stage geometry around the player, so the player goes back
     * to the middle first. Their flame is never lowered by staging -- only
     * their position -- so a good beat-2 run still earns a real beat 4. */
    function home() { p.x = cx; p.y = cy; p.vx = p.vy = 0; }
    function repin(s) { if (s.px !== undefined) { s.x = s.px; s.y = s.py; s.vx = s.vy = 0; } }
    /* What a contact between the player and a soul `gap` brighter/dimmer is
     * actually worth. The after-lines quote this, so they are arithmetic. */
    function torn(gap) {
      return Math.min(K.STEAL_MAX, Math.max(K.STEAL_MIN, gap * K.STEAL_RATIO));
    }

    return [
      {
        id: 'move',
        say: 'YOU ARE THE ONE IN THE <em>RING</em>.<br><em>DRAG ANYWHERE</em> TO MOVE.',
        enter: function () {
          g.ringHoldR = HOME_R;
          p.x = cx; p.y = cy; p.flame = 40;
          put(a, cx, cy - 26, 40);
          put(b, cx, cy + 26, 40);
          g.embers.length = 0;
        },
        done: function (t) { return t.moved > 14 && t.beat > 0.8; },
        timeout: 8
      },
      {
        id: 'eat',
        say: 'THE <em>SPIKES</em> ARE FUEL.<br>RUN <em>INTO</em> THEM.',
        enter: function () { g.embers.length = 0; g.placeEmber(cx, cy - 15, 0.3); },
        focus: function () { return cy + 20; },
        done: function () { return p.eaten >= 1; },
        after: function () {
          return '+' + K.EMBER_VALUE + ' FLAME — AND YOUR<br><em>BURN RATE</em> WENT UP WITH IT.';
        },
        fail: 'THE FUEL IS STILL THERE.<br>RUN <em>INTO</em> IT.',
        timeout: 12
      },
      {
        id: 'prey',
        say: 'A <em>DASHED</em> RING MEANS<br>BRIGHTER THAN YOU. <em>HIT IT</em>.',
        enter: function () {
          g.embers.length = 0; home();
          // Derived, never a constant. B is left level with the player, so a
          // neutral mark sits next to the dashed one: the contrast is the point.
          put(a, cx, cy - 26, Math.min(K.FLAME_MAX, p.flame + 32));
          put(b, cx, cy + 26, p.flame);
        },
        tick: function () { repin(a); repin(b); },
        focus: function () { return cy - 26; },
        done: function () { return p.stolen > 0; },
        after: function () {
          var amt = torn(32);
          return 'YOU TOOK ' + Math.round(amt * K.STEAL_KEEP) + '. <em>A THIRD</em><br>BURNED AWAY IN THE TEARING.';
        },
        // The mark it just fed on goes level with the player, so the player
        // sees a dashed ring become a neutral one. That transition is the game.
        afterEnter: function () { a.flame = p.flame; },
        fail: 'IT IS BRIGHTER THAN YOU.<br>THAT MEANS YOU CAN <em>TAKE</em> IT.',
        timeout: 14
      },
      {
        id: 'threat',
        say: 'NOW <em>YOU</em> ARE THE BRIGHT ONE.',
        enter: function () {
          home();
          if (p.flame < 62) p.flame = 62;
          p.peak = Math.max(p.peak, p.flame);
          put(a, cx, cy - 40, p.flame);          // level, and well out of the way
          put(b, cx, cy + 26, Math.max(6, p.flame - 54));
          T.robbed0 = p.robbed;
        },
        // Props do not think, so the lesson walks this one at the player itself.
        // Something has to actually happen, or the beat is a clock with a
        // caption on it.
        tick: function (dt) {
          repin(a);
          if (p.robbed > T.robbed0) return;
          var dx = p.x - b.x, dy = p.y - b.y;
          var d = Math.hypot(dx, dy) || 1;
          b.x += (dx / d) * 22 * dt;
          b.y += (dy / d) * 22 * dt;
        },
        focus: function () { return cy + 26; },
        done: function () { return p.robbed > T.robbed0; },
        after: function () {
          return 'A <em>SOLID</em> RING HUNTS YOU.<br>IT JUST TOOK <em>' +
                 Math.round(p.robbed - T.robbed0) + '</em>.';
        },
        afterEnter: function () { b.flame = p.flame; },
        fail: 'IT IS DIMMER THAN YOU.<br>IT WANTS WHAT YOU ARE <em>HOLDING</em>.',
        timeout: 11
      },
      {
        id: 'last',
        say: 'EVERY LAMP HERE RUNS OUT.<br>INCLUDING <em>YOURS</em>.',
        enter: function () {
          g.embers.length = 0;
          g.ringHoldR = 22;
          // Let them actually go out on screen: the pips drop, the sound plays,
          // and the rule stops being a sentence.
          a.frozen = false; a.flame = 6.0;
          b.frozen = false; b.flame = 3.2;
        },
        // Either they have gone out or the player has watched them burn down to
        // nothing; both are the lesson, so there is no failure line here.
        done: function (t) { return g.aliveCount <= 1 || t.beat > 5.5; },
        after: '<em>ONE LEFT.</em><br>THAT IS THE WIN.',
        timeout: 7
      }
    ];
  }

  function Tutorial(game) {
    this.g = game;
    this.robbed0 = 0;
    this.ring0 = HOME_R;
    this.wentOut = false;
    this.beats = build(game, this);
    this.i = -1;
    this.beat = 0;         // seconds inside the current beat
    this.moved = 0;
    this.afterT = 0;
    this.line = '';
    this.step = 0;
    this.total = this.beats.length;
    this.finished = false;
    this._lastX = 0; this._lastY = 0;
    this.next();
  }

  Tutorial.prototype.next = function () {
    var b = this.beats[++this.i];
    if (!b) { this.finished = true; this.line = ''; return; }
    this.beat = 0; this.afterT = 0;
    this.step = this.i + 1;
    if (b.enter) b.enter();
    // Staging teleports the player, and a teleport is not the player moving:
    // re-anchor after enter() or beat one completes itself on the staging.
    this._lastX = this.g.souls[0].x;
    this._lastY = this.g.souls[0].y;
    this.line = b.say;
  };

  Tutorial.prototype.update = function (dt) {
    if (this.finished) return;
    var p = this.g.souls[0];
    this.beat += dt;
    this.moved += Math.hypot(p.x - this._lastX, p.y - this._lastY);
    this._lastX = p.x; this._lastY = p.y;

    var b = this.beats[this.i];
    if (this.afterT > 0) {
      this.afterT -= dt;
      if (this.afterT <= 0) this.next();
      return;
    }
    if (b.tick) b.tick(dt, this);

    // The success line fires only on success. On a timeout the player is told
    // what is still true, not what they did not do.
    var won = b.done ? b.done(this) : this.beat > b.timeout;
    if (!won && this.beat <= b.timeout) return;
    var line = won ? b.after : b.fail;
    if (won && b.afterEnter) b.afterEnter();
    if (typeof line === 'function') line = line();
    if (line) { this.line = line; this.afterT = 2.3; }
    else this.next();
  };

  /** The world Y the lesson text must not cover: whatever the beat has staged,
   *  averaged with the player, so the sentence sits in the emptier half. */
  Tutorial.prototype.focusY = function () {
    var py = this.g.souls[0].y;
    var b = this.beats[this.i];
    return b && b.focus ? (py + b.focus()) / 2 : py;
  };

  Tutorial.prototype.skip = function () { this.finished = true; this.line = ''; };

  global.Tutorial = {
    Tutorial: Tutorial,
    done: function () { return !!Store.get('tutorialDone', false); },
    markDone: function () { Store.set('tutorialDone', true); },
    /** The arena it runs in: three lamps, a light held close and under the
     *  lesson's control, no lethal drain on the player, and no fuel except
     *  what a beat puts down. */
    options: function () {
      return { seed: 'tutorial', mode: 'endless', souls: 3,
               holdRing: true, ringHoldR: HOME_R, noSpawn: true, floor: 12 };
    }
  };
})(typeof self !== 'undefined' ? self : this);
