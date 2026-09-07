/* render.js — everything you see inside the arena.
 * Canvas2D only, no shadowBlur in the hot loop; all bloom comes from cached
 * radial-gradient sprites composited with 'lighter'.
 */
(function (global) {
  'use strict';

  var J = global.Juice, clamp = J.clamp, lerp = J.lerp;
  var TAU = Math.PI * 2;
  // Contact does nothing inside this flame gap, so nothing is drawn inside it.
  // Read from the simulation rather than copied: a renderer that disagrees with
  // the rule by one point draws rings around lamps you cannot touch.
  var DEADZONE = 6;
  function deadzone() {
    var G = global.Game;
    return (G && G.K && G.K.STEAL_MIN_DIFF) || DEADZONE;
  }
  /* The palette lives in game.js, which loads after this file, so it is read
   * lazily and cached. Copying the hexes here is how the arena and the HUD
   * drifted apart the last time. */
  var _C = null;
  function pal() { return _C || (_C = (global.Game && global.Game.C) || {}); }

  function Renderer(surface) {
    this.s = surface;
    this.scale = 1; this.ox = 0; this.oy = 0;
    this.contrast = false;
    this.showNames = true;
    this.reduced = false;
    this.zoom = 1;
    this.coachBand = null;     // [top, bottom] in screen px while a coach line shows
    this.topBand = 0;          // screen px of HUD chrome that names must clear
    this.marker = null;
    this._lastT = 0;
    this._bg = null; this._bgKey = '';
  }

  var MAX_ZOOM = 2.15;

  /* Baked gradients. createRadialGradient is cheap; filling a large area with
   * one, 60 times a second, is not — especially at devicePixelRatio 2+. */
  var FIELD_PX = 256;
  var fieldSprite = null, fieldSpriteHi = null;
  function makeField(boost) {
    var c = document.createElement('canvas');
    c.width = c.height = FIELD_PX;
    var g = c.getContext('2d');
    var h = FIELD_PX / 2;
    var grad = g.createRadialGradient(h, h, 0, h, h, h);
    grad.addColorStop(0, 'rgba(32,20,62,' + (0.95 + boost) + ')');
    grad.addColorStop(0.55, 'rgba(22,13,44,0.70)');
    grad.addColorStop(0.88, 'rgba(14,9,29,0.38)');
    grad.addColorStop(1, 'rgba(10,7,22,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, FIELD_PX, FIELD_PX);
    return c;
  }
  function fieldFor(finale) {
    if (finale) { if (!fieldSpriteHi) fieldSpriteHi = makeField(0.4); return fieldSpriteHi; }
    if (!fieldSprite) fieldSprite = makeField(0);
    return fieldSprite;
  }

  var vigCache = { key: '', normal: null, danger: null };
  function vignetteFor(cw, ch, danger) {
    var key = cw + 'x' + ch;
    if (vigCache.key !== key) {
      vigCache.key = key; vigCache.normal = null; vigCache.danger = null;
    }
    var slot = danger ? 'danger' : 'normal';
    if (!vigCache[slot]) {
      var c = document.createElement('canvas');
      c.width = cw; c.height = ch;
      var g = c.getContext('2d');
      var grad = g.createRadialGradient(cw / 2, ch / 2, Math.min(cw, ch) * 0.32,
                                        cw / 2, ch / 2, Math.max(cw, ch) * 0.72);
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(1, danger ? 'rgba(120,6,30,.62)' : 'rgba(0,0,0,.55)');
      g.fillStyle = grad;
      g.fillRect(0, 0, cw, ch);
      vigCache[slot] = c;
    }
    return vigCache[slot];
  }

  Renderer.prototype.layout = function (worldH, ringR, ringRY, dt) {
    var cw = this.s.w, ch = this.s.h;
    var base = Math.min(cw / 100, ch / worldH);

    // Close in as the light closes, so the endgame is a knife fight filling the
    // screen instead of a coin-sized arena in a field of black.
    if (ringR) {
      var fit = Math.min(cw * 0.94 / (2 * ringR), ch * 0.80 / (2 * ringRY));
      var target = clamp(fit / base, 1, MAX_ZOOM);
      var k = dt ? 1 - Math.exp(-2.0 * dt) : 1;
      this.zoom += (target - this.zoom) * k;
    } else {
      this.zoom = 1;
    }

    this.scale = base * this.zoom;
    // Zoom about the arena centre, not the screen box.
    this.ox = cw / 2 - 50 * this.scale;
    this.oy = ch / 2 - (worldH / 2) * this.scale;
    this.worldH = worldH;
  };
  Renderer.prototype.toScreenX = function (x) { return this.ox + x * this.scale; };
  Renderer.prototype.toScreenY = function (y) { return this.oy + y * this.scale; };

  /* Starfield/dust backdrop, rendered once to an offscreen canvas. */
  Renderer.prototype._backdrop = function (seed) {
    var key = this.s.w + 'x' + this.s.h + ':' + seed;
    if (this._bgKey === key && this._bg) return this._bg;
    var c = document.createElement('canvas');
    c.width = this.s.w; c.height = this.s.h;
    var g = c.getContext('2d');
    g.fillStyle = '#07060d';
    g.fillRect(0, 0, c.width, c.height);
    var rng = new global.RNG.Rng('bg:' + seed);
    for (var i = 0; i < 130; i++) {
      var x = rng.float() * c.width, y = rng.float() * c.height;
      var r = rng.range(0.4, 1.5);
      var a = rng.range(0.05, 0.3);
      g.fillStyle = 'rgba(154,144,184,' + a.toFixed(3) + ')';
      g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
    }
    this._bg = c; this._bgKey = key;
    return c;
  };

  Renderer.prototype.draw = function (game, input, tSec) {
    var ctx = this.s.ctx, cw = this.s.w, ch = this.s.h;
    var dt = this._lastT ? clamp(tSec - this._lastT, 0, 0.1) : 0;
    this._lastT = tSec;
    this.layout(game.worldH, game.ringR, game.ringRY(), dt);
    var S = this.scale;
    var cxw = 50, cyw = game.worldH / 2;
    var cx = this.toScreenX(cxw), cy = this.toScreenY(cyw);
    var ringPx = game.ringR * S;                 // horizontal semi-axis, screen px
    var ringPy = game.ringRY() * S;              // vertical — the light is an ellipse

    ctx.setTransform(this.s.dpr, 0, 0, this.s.dpr, 0, 0);
    ctx.drawImage(this._backdrop(game.seedStr), 0, 0);

    ctx.save();
    // Screenshake, applied about the arena centre so rotation doesn't slide.
    if (game.cam.trauma > 0) {
      ctx.translate(cx + game.cam.x, cy + game.cam.y);
      ctx.rotate(game.cam.rot);
      ctx.translate(-cx, -cy);
    }

    this._drawField(ctx, game, cx, cy, ringPx, ringPy, tSec);
    this._drawEmbers(ctx, game, S, tSec);
    game.fx.draw(ctx, this.ox, this.oy, S);
    this._drawSouls(ctx, game, S, tSec);
    this._drawFloatText(ctx, game);
    ctx.restore();

    this._drawRingEdge(ctx, game, cx, cy, ringPx, ringPy, tSec);
    this._drawOffscreenPlayer(ctx, game, cw, ch, tSec);
    if (input && input.touching) this._drawStick(ctx, input);
    this._drawVignette(ctx, cw, ch, game);
    // Last, over the vignette: these are the only marks on screen whose whole
    // job is to say where to go, and the arena's own bloom was eating them at
    // exactly the edge they live on.
    this._drawEdgeMarkers(ctx, game, cw, ch, tSec);
  };

  /* The light is drawn in a squashed coordinate space, so one circular gradient
   * becomes the ellipse — rounder and cheaper than faking an elliptical one. */
  Renderer.prototype._drawField = function (ctx, game, cx, cy, rx, ry, t) {
    var k = ry / Math.max(0.001, rx);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(1, k);

    var fs = fieldFor(game.state === 'finale');
    var fr = rx * 1.02;
    ctx.globalAlpha = this.contrast ? 1 : 0.92;
    ctx.drawImage(fs, -fr, -fr, fr * 2, fr * 2);
    ctx.globalAlpha = 1;

    // Reference rings + spokes: cheap, and they make the shrink legible.
    ctx.beginPath(); ctx.arc(0, 0, rx, 0, TAU); ctx.clip();
    // Contrast mode DIMS the decorative grid; the labels and the player ring
    // are what get louder (see _drawSouls).
    // Slate, not violet: the grid used to be the same hue as the lamps on it.
    ctx.strokeStyle = this.contrast ? 'rgba(96,106,134,.07)' : 'rgba(96,106,134,.16)';
    ctx.lineWidth = 1 / Math.max(0.3, k);
    var step = Math.max(16, rx / 4);
    for (var r = step * 0.5; r < rx * 1.15; r += step) {
      ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.stroke();
    }
    for (var a = 0; a < 8; a++) {
      var ang = a / 8 * TAU + t * 0.02;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(ang) * rx * 1.15, Math.sin(ang) * rx * 1.15);
      ctx.stroke();
    }
    ctx.restore();
  };

  Renderer.prototype._drawRingEdge = function (ctx, game, cx, cy, rx, ry, t) {
    // Red is reserved for fuel now, so the closing ring signals urgency with
    // brightness, weight and rate instead of by turning into the food colour.
    var closing = game.ringStage === 1;
    var col = closing ? pal().ringHot : pal().ring;
    var pulse = 0.5 + 0.5 * Math.sin(t * (closing ? 9 : 2.4));
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = J.hexA(col, 0.35 + pulse * 0.45);
    ctx.lineWidth = closing ? 2.5 : 1.6;
    ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, TAU); ctx.stroke();
    ctx.strokeStyle = J.hexA(col, 0.1 + pulse * 0.12);
    ctx.lineWidth = closing ? 11 : 7;
    ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, TAU); ctx.stroke();
    ctx.restore();
  };

  Renderer.prototype._drawEmbers = function (ctx, game, S, t) {
    ctx.save();
    ctx.translate(this.ox, this.oy);
    ctx.scale(S, S);
    for (var i = 0; i < game.embers.length; i++) {
      var e = game.embers[i];
      var pop = J.Ease.outBack(e.pop);
      var r = 2.2 * pop;
      var breathe = 1 + Math.sin(t * 3.4 + e.spin * 6) * 0.11;
      var arming = e.arm > 0;
      // Read the arming time from the constant rather than restating it: this
      // was hardcoded once, the constant later moved, and the fuse then swept
      // backwards for the first fifth of a second of every respawned ember.
      var charge = arming ? clamp(1 - e.arm / global.Game.K.EMBER_ARM, 0, 1) : 1;

      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      J.drawGlow(ctx, e.x, e.y, r * (arming ? 2.4 : 4.4) * breathe, pal().ember,
        arming ? 0.16 + charge * 0.3 : 0.62 + e.lit * 0.5);
      ctx.restore();

      ctx.save();
      ctx.translate(e.x, e.y);
      ctx.rotate(e.spin);
      // An eight-point star: it reads as "spike", i.e. as "danger", which is the
      // whole joke — it is the only thing keeping you alive.
      var scale = arming ? 0.55 + charge * 0.45 : 1 + e.lit * 0.35;
      ctx.beginPath();
      for (var p = 0; p < 16; p++) {
        var ang = (p / 16) * TAU;
        var rad = (p % 2 === 0 ? r * 1.5 * breathe : r * 0.62) * scale;
        var px = Math.cos(ang) * rad, py = Math.sin(ang) * rad;
        if (p === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      if (arming) {
        // Inert: an outline, so it is unmistakably "not yet".
        ctx.strokeStyle = J.hexA(pal().ember, 0.35 + charge * 0.45);
        ctx.lineWidth = 0.45;
        ctx.stroke();
      } else {
        ctx.fillStyle = pal().ember;
        ctx.fill();
        ctx.beginPath(); ctx.arc(0, 0, r * 0.46, 0, TAU);
        ctx.fillStyle = pal().emberIn; ctx.fill();
      }
      ctx.restore();

      if (arming) {
        // A fuse everyone in the arena can read: this is worth racing for.
        ctx.beginPath();
        ctx.arc(e.x, e.y, r * 2.5, -Math.PI / 2, -Math.PI / 2 + charge * TAU);
        // Neutral, deliberately: the fuse means "not yet", which is a different
        // idea from "food", and it must not read as the amber ring the arena
        // draws around prey.
        ctx.strokeStyle = 'rgba(226,222,238,.5)';
        ctx.lineWidth = 0.5;
        ctx.stroke();
      }
    }
    ctx.restore();
  };

  /* The one rule the arena never showed: on contact, flame runs BRIGHT -> DIM.
   * A soul brighter than you feeds you; a soul dimmer than you robs you; and
   * which is which flips as your own flame changes.
   *
   * One law, stated once: A MARK'S TICKS POINT THE WAY THE FLAME GOES.
   * Flame leaves prey, so its barbs radiate OUT -- the same outward spikes, in
   * the same warm amber, as the fuel, because prey IS fuel. Flame arrives at a
   * threat, so its teeth bite IN. Learn the spiky amber thing feeds you and you
   * have learned to read every mark in the game without being told.
   *
   *   PREY    amber   dashed, crawling   barbs OUT   run into it
   *   THREAT  crimson solid, pulsing     teeth IN    run from it
   *   IDLE    slate   thin, static       no ticks    nothing happens
   *
   * IDLE is not decoration. At t=1s every lamp is within +/-6 of the player, so
   * without it the first twenty seconds of a match teach the player that this
   * game has no markings at all -- and then a mark appears with nothing to read
   * it against. A slate arc turning amber is the moment the game becomes
   * legible, and it only exists if "does nothing" and "too far away" look
   * different.
   *
   * Every dimension is authored in CSS px and divided by the world scale, so
   * the marks stop inflating with the camera: at endgame zoom the old
   * world-unit strokes rendered at 4.7px with a 9.4px dash, the same size and
   * shape as the death confetti.
   */
  var DASH = [0, 0], EMPTY = [];
  var ROLE = [];                                   // scratch, never re-allocated
  var TIER_HALF = [0.5236, 0.7679, 1.0821];        // 30, 44, 62 degrees

  Renderer.prototype._gatherRoles = function (game) {
    var me = game.player, n = 0, i;
    this._roleN = 0;
    if (!me || !me.alive) return 0;
    var dz = deadzone();
    for (i = 0; i < game.souls.length; i++) {
      var s = game.souls[i];
      if (!s.alive || s.isPlayer || s.offBoard) continue;
      var d = Math.hypot(s.x - me.x, s.y - me.y);
      var sep = d - s.radius() - me.radius();
      if (sep > 34) continue;                      // the same range the bots see at
      var e = ROLE[n] || (ROLE[n] = {});
      var diff = s.flame - me.flame;
      e.s = s; e.sep = sep; e.d = d; e.gap = Math.abs(diff);
      e.role = e.gap <= dz ? 0 : (diff > 0 ? 1 : -1);
      n++;
    }
    // Insertion sort over n <= 11, in place: nearest first, no allocation.
    for (i = 1; i < n; i++) {
      var k = ROLE[i], j = i - 1;
      while (j >= 0 && ROLE[j].sep > k.sep) { ROLE[j + 1] = ROLE[j]; j--; }
      ROLE[j + 1] = k;
    }
    // Budget. Two caps with different jobs: `body` is a global ink ceiling;
    // `full` counts only souls inside 14wu, so in the open field it never fires
    // and prey worth chasing keeps its bracket all the way out to 34wu. In a
    // pile-up every soul is inside 14 and the cap bites at once -- and those
    // souls fall back to a collar on the player's own ring instead.
    var body = 0, full = 0;
    for (i = 0; i < n; i++) {
      var it = ROLE[i];
      it.collar = (it.sep < 1.6) || (body >= 7) || (it.sep < 14 && full >= 4);
      if (!it.collar) { body++; if (it.sep < 14) full++; }
    }
    this._roleN = n;
    return n;
  };

  Renderer.prototype._drawRoles = function (ctx, game, S, t) {
    var n = this._roleN;
    if (!n) return;
    var me = game.player, px = 1 / S;
    ctx.save();
    ctx.translate(this.ox, this.oy);
    ctx.scale(S, S);
    ctx.lineCap = 'round';
    // Far to near, so the nearest mark ends up on top.
    for (var i = n - 1; i >= 0; i--) if (!ROLE[i].collar) this._bracket(ctx, ROLE[i], me, px, t);
    ctx.restore();
  };

  Renderer.prototype._bracket = function (ctx, it, me, px, t) {
    var s = it.s, role = it.role;
    // The arc always sits on the bearing from the soul TO you, so the mark
    // lands in the gap you are about to cross.
    var bear = Math.atan2(me.y - s.y, me.x - s.x);
    var ar = s.radius() + px * 7;
    var tier = it.sep < 14 ? 2 : it.sep < 24 ? 1 : 0;
    var half = role === 0 ? 0.5236 : TIER_HALF[tier];
    var bold = this.contrast ? 1.5 : 1;

    var a = it.sep > 26 ? 0.5 : it.sep > 14 ? 0.8 : 1;
    if (role !== 0) a *= Math.min(1, (it.gap - deadzone()) / 4);   // the flip is a fade
    else a *= 0.55;
    if (this.contrast) a = Math.min(1, a * 1.35);
    if (a <= 0.03) return;

    if (role === 0) {
      ctx.globalAlpha = a;
      ctx.strokeStyle = pal().idle;
      ctx.lineWidth = px * 1.6 * bold;
      ctx.beginPath(); ctx.arc(s.x, s.y, ar, bear - half, bear + half); ctx.stroke();
      ctx.globalAlpha = 1;
      return;
    }

    // The moat: a dark stroke under the mark that punches a hole through every
    // neighbour's additive bloom. This, not shadowBlur, is what makes a mark
    // survive a pile-up.
    ctx.globalAlpha = a * 0.55;
    ctx.strokeStyle = 'rgba(7,6,13,0.9)';
    ctx.lineWidth = px * 4.6 * bold;
    ctx.beginPath(); ctx.arc(s.x, s.y, ar, bear - half, bear + half); ctx.stroke();

    var q, ang, c, sn;
    if (role === 1) {
      ctx.globalAlpha = a;
      ctx.strokeStyle = pal().prey;
      ctx.lineWidth = px * (tier ? 2.4 : 1.8) * bold;
      DASH[0] = px * 5.5; DASH[1] = px * 4.5;
      ctx.setLineDash(DASH);
      if (!this.reduced) ctx.lineDashOffset = -(t * px * 9);
      ctx.beginPath(); ctx.arc(s.x, s.y, ar, bear - half, bear + half); ctx.stroke();
      ctx.setLineDash(EMPTY);
      ctx.lineDashOffset = 0;
      if (tier > 0) for (q = -1; q <= 1; q++) {
        ang = bear + q * half * 0.68; c = Math.cos(ang); sn = Math.sin(ang);
        ctx.beginPath();
        ctx.moveTo(s.x + c * (ar + px * 1.6), s.y + sn * (ar + px * 1.6));
        ctx.lineTo(s.x + c * (ar + px * 6.6), s.y + sn * (ar + px * 6.6));
        ctx.stroke();
      }
    } else {
      ctx.globalAlpha = this.reduced ? a * 0.9 : a * (0.70 + 0.30 * Math.sin(t * 5.5));
      ctx.strokeStyle = pal().threat;
      ctx.lineWidth = px * (tier ? 2.8 : 2.0) * bold;
      ctx.beginPath(); ctx.arc(s.x, s.y, ar, bear - half, bear + half); ctx.stroke();
      if (tier > 0) for (q = -1; q <= 1; q++) {
        ang = bear + q * half * 0.68; c = Math.cos(ang); sn = Math.sin(ang);
        ctx.beginPath();
        ctx.moveTo(s.x + c * (ar - px * 0.4), s.y + sn * (ar - px * 0.4));
        ctx.lineTo(s.x + c * (ar - px * 5.4), s.y + sn * (ar - px * 5.4));
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  };

  /* A soul touching you, or over the ink budget, loses its bracket and gets a
   * sector on YOUR ring instead: same colour, same law, at that soul's bearing.
   * Radial position carries the rule a fourth time -- prey sits inside your
   * ring (flame coming in), a threat outside it (flame leaving) -- so a collar
   * reads correctly with hue knocked out entirely. */
  Renderer.prototype._drawCollars = function (ctx, me, pr, px) {
    var n = this._roleN, dz = deadzone();
    for (var i = 0; i < n; i++) {
      var it = ROLE[i];
      if (!it.collar) continue;
      var bear = Math.atan2(it.s.y - me.y, it.s.x - me.x);
      var half = clamp(Math.atan2(it.s.radius(), Math.max(0.001, it.d)), 0.16, 0.42);
      var prox = clamp(1 - it.sep / 34, 0, 1);
      var a = 0.30 + 0.70 * prox * prox;
      if (it.role !== 0) a *= Math.min(1, (it.gap - dz) / 4);
      if (a <= 0.03) continue;
      var rad = it.role === 0 ? pr : pr + (it.role === -1 ? px * 9 : -px * 9);
      var col = it.role === 0 ? pal().idle : (it.role === 1 ? pal().prey : pal().threat);

      ctx.globalAlpha = a * 0.8;
      ctx.strokeStyle = 'rgba(7,6,13,0.9)';
      ctx.lineWidth = px * 5.4;
      ctx.beginPath(); ctx.arc(me.x, me.y, rad, bear - half, bear + half); ctx.stroke();

      ctx.globalAlpha = a;
      ctx.strokeStyle = col;
      ctx.lineWidth = px * 3.0;
      ctx.beginPath(); ctx.arc(me.x, me.y, rad, bear - half, bear + half); ctx.stroke();

      if (it.role !== 0) {
        var dir = it.role === -1 ? 1 : -1;          // out for a threat, in for prey
        var c = Math.cos(bear), sn = Math.sin(bear);
        ctx.lineWidth = px * 2.6;
        ctx.beginPath();
        ctx.moveTo(me.x + c * (rad + dir * px * 2.4), me.y + sn * (rad + dir * px * 2.4));
        ctx.lineTo(me.x + c * (rad + dir * px * 6.4), me.y + sn * (rad + dir * px * 6.4));
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  };

  Renderer.prototype._drawSouls = function (ctx, game, S, t) {
    var me = game.player && game.player.alive ? game.player : null;
    // Who is what to you, decided once per frame and reused by the brackets,
    // the collars and the verdict number.
    this._gatherRoles(game);

    ctx.save();
    ctx.translate(this.ox, this.oy);
    ctx.scale(S, S);

    // Dim first so bright ones sit on top -- but never the player, who is drawn
    // last of all. Sorted by flame the player landed at index 2 of 11 in a
    // measured endgame, with eight brighter souls painting over their own ring.
    var order = game.souls.slice().sort(function (a, b) { return a.flame - b.flame; });
    for (var i = 0; i < order.length; i++) {
      var s = order[i];
      if (!s.alive || s.offBoard || s.isPlayer) continue;
      this._drawSoul(ctx, game, s, t);
    }
    ctx.restore();

    // Marks over the bodies, then you over the marks.
    this._drawRoles(ctx, game, S, t);
    if (me) this._drawPlayer(ctx, game, me, S, t);
  };

  Renderer.prototype._drawSoul = function (ctx, game, s, t) {
    var r = s.radius();
    var col = s.color();
    var f01 = s.flame / 100;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    // Bloom scales hard with flame: a full soul is a lighthouse announcing
    // itself to every hungry thing in the arena.
    J.drawGlow(ctx, s.x, s.y, r * (2.6 + f01 * 3.4), col, 0.42 + f01 * 0.4);
    ctx.restore();

    ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, TAU);
    ctx.fillStyle = col; ctx.fill();

    // Hot core
    ctx.beginPath(); ctx.arc(s.x - r * 0.16, s.y - r * 0.18, r * (0.3 + f01 * 0.26), 0, TAU);
    ctx.fillStyle = 'rgba(255,255,255,' + (0.4 + f01 * 0.5).toFixed(2) + ')';
    ctx.fill();

    if (s.flash > 0) {
      ctx.beginPath(); ctx.arc(s.x, s.y, r * (1 + (1 - s.flash) * 0.9), 0, TAU);
      ctx.strokeStyle = 'rgba(255,255,255,' + (s.flash * 0.8).toFixed(2) + ')';
      ctx.lineWidth = 0.7; ctx.stroke();
    }

    if (this.showNames && this._hasRoom(game, s)) {
      // These are people the player has met, so they have to be readable:
      // brighter, outlined against the glow, and clear of the body.
      var ly = s.y - r - 2.2;
      ctx.font = '700 2.6px ui-monospace, Menlo, monospace';
      ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.lineWidth = 0.9;
      ctx.strokeStyle = 'rgba(4,3,9,.85)';
      ctx.strokeText(s.name, s.x, ly);
      ctx.fillStyle = this.contrast ? 'rgba(238,236,250,.95)' : 'rgba(206,200,232,.72)';
      ctx.fillText(s.name, s.x, ly);
    }
  };

  /* You, on top of everything, at a constant weight on screen. Every dimension
   * is CSS px over the world scale: the ring used to stroke at 6.3px at endgame
   * zoom and 1px at the open, so the one mark that has to be findable changed
   * size whenever the camera moved. */
  Renderer.prototype._drawPlayer = function (ctx, game, me, S, t) {
    var px = 1 / S;
    var r = me.radius();
    var col = me.color();
    var f01 = me.flame / 100;
    var pr = r + px * 13 + Math.sin(t * 4) * px * 1.0;

    ctx.save();
    ctx.translate(this.ox, this.oy);
    ctx.scale(S, S);

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    J.drawGlow(ctx, me.x, me.y, r * (2.6 + f01 * 3.4), col, 0.42 + f01 * 0.4);
    J.drawGlow(ctx, me.x, me.y, pr * 2.0, pal().you, 0.20);
    ctx.restore();

    ctx.lineCap = 'round';
    this._drawCollars(ctx, me, pr, px);

    // Body and core
    ctx.beginPath(); ctx.arc(me.x, me.y, r, 0, TAU);
    ctx.fillStyle = col; ctx.fill();
    ctx.beginPath(); ctx.arc(me.x - r * 0.16, me.y - r * 0.18, r * (0.3 + f01 * 0.26), 0, TAU);
    ctx.fillStyle = 'rgba(255,255,255,' + (0.4 + f01 * 0.5).toFixed(2) + ')';
    ctx.fill();
    if (me.flash > 0) {
      ctx.beginPath(); ctx.arc(me.x, me.y, r * (1 + (1 - me.flash) * 0.9), 0, TAU);
      ctx.strokeStyle = 'rgba(255,255,255,' + (me.flash * 0.8).toFixed(2) + ')';
      ctx.lineWidth = 0.7; ctx.stroke();
    }

    // The moat is what makes "you" findable inside eleven overlapping blooms —
    // and it is the only thing that works for a deuteranope, for whom the teal
    // and a flame-100 body are far enough apart to tell apart but not to find.
    ctx.beginPath(); ctx.arc(me.x, me.y, pr, 0, TAU);
    ctx.strokeStyle = 'rgba(7,6,13,0.82)';
    ctx.lineWidth = px * 6; ctx.stroke();

    ctx.beginPath(); ctx.arc(me.x, me.y, pr, 0, TAU);
    ctx.strokeStyle = pal().you;
    ctx.lineWidth = px * (this.contrast ? 3.4 : 2.2); ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(me.x - px * 8, me.y - pr - px * 13);
    ctx.lineTo(me.x, me.y - pr - px * 5);
    ctx.lineTo(me.x + px * 8, me.y - pr - px * 13);
    ctx.closePath();
    ctx.fillStyle = pal().you; ctx.fill();

    ctx.restore();

    // The exchange, in screen space so it never changes size: what this contact
    // is actually worth. Winning a steal pays 0.66x and losing one costs 1.0x,
    // and nothing in the game has ever said so.
    this._drawVerdict(ctx, me, S, t);
  };

  Renderer.prototype._drawVerdict = function (ctx, me, S) {
    var G = global.Game;
    if (!G || this._roleN === 0) return;
    var it = null;
    for (var i = 0; i < this._roleN; i++) {
      if (ROLE[i].role !== 0 && ROLE[i].sep < 7) { it = ROLE[i]; break; }
    }
    if (!it) return;
    var K = G.K;
    var amt = clamp(it.gap * K.STEAL_RATIO, K.STEAL_MIN, K.STEAL_MAX);
    var txt = it.role === 1 ? '+' + Math.round(amt * K.STEAL_KEEP)
                            : '−' + Math.round(amt);
    // Away from the soul in question, so the number never covers it.
    var bear = Math.atan2(me.y - it.s.y, me.x - it.s.x);
    var pr = (me.radius() + 13 / S) * S + 26;
    var x = this.toScreenX(me.x) + Math.cos(bear) * pr;
    var y = this.toScreenY(me.y) + Math.sin(bear) * pr;
    ctx.save();
    ctx.font = '700 15px ui-monospace, Menlo, monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(4,3,9,.9)';
    ctx.strokeText(txt, x, y);
    ctx.fillStyle = it.role === 1 ? pal().prey : pal().threat;
    ctx.fillText(txt, x, y);
    ctx.restore();
  };

  /** True when no other living soul is close enough for the labels to collide. */
  Renderer.prototype._hasRoom = function (game, s) {
    // The HUD owns the top of the screen; a name drawn into it collides with
    // the soul count, the pips and the phase label.
    if (this.toScreenY(s.y - s.radius() - 2.2) < this.topBand) return false;
    // The coach line owns its band while it is showing; a name label underneath
    // it is unreadable and makes both look like a mistake.
    if (this.coachBand) {
      // Test where the LABEL lands, not the soul: it is drawn above the body,
      // so a soul below the band can still push its name into it.
      var ly = this.toScreenY(s.y - s.radius() - 1.4);
      if (ly > this.coachBand[0] && ly < this.coachBand[1]) return false;
    }
    // Deterministic: when two labels would collide, the lower-indexed soul keeps
    // its name. Suppressing both made labels flicker in and out frame to frame.
    for (var i = 0; i < game.souls.length; i++) {
      var o = game.souls[i];
      if (o === s || !o.alive) continue;
      if (Math.abs(o.x - s.x) < 13 && Math.abs(o.y - s.y) < 7 && o.id < s.id) return false;
    }
    return true;
  };

  Renderer.prototype._drawFloatText = function (ctx, game) {
    // Positions are world units, sizes are screen px — pop-up numbers must stay
    // the same physical size no matter how the arena is scaled.
    var p = game.txt;
    if (!p.n) return;
    ctx.save();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (var i = 0; i < p.n; i++) {
      var q = p.p[i];
      var tt = q.life / q.maxL;
      var pop = 0.65 + 0.35 * J.Ease.outBack(clamp((1 - tt) * 4, 0, 1));
      ctx.globalAlpha = tt > 0.55 ? 1 : tt / 0.55;
      ctx.font = '800 ' + (q.size * pop).toFixed(1) + 'px ui-monospace, Menlo, monospace';
      var sx = this.toScreenX(q.x), sy = this.toScreenY(q.y);
      ctx.lineWidth = 3.5; ctx.strokeStyle = 'rgba(0,0,0,.8)';
      ctx.strokeText(q.text, sx, sy);
      ctx.fillStyle = q.color;
      ctx.fillText(q.text, sx, sy);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  };

  Renderer.prototype._drawStick = function (ctx, input) {
    var Ix = global.Input;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = 'rgba(0,245,212,.20)';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(input.originX, input.originY, Ix.MAX_R, 0, TAU); ctx.stroke();
    var kx = input.originX + input.x * input.mag * Ix.MAX_R;
    var ky = input.originY + input.y * input.mag * Ix.MAX_R;
    ctx.fillStyle = 'rgba(0,245,212,.30)';
    ctx.beginPath(); ctx.arc(kx, ky, 15, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(0,245,212,.75)';
    ctx.beginPath(); ctx.arc(kx, ky, 5.5, 0, TAU); ctx.fill();
    ctx.restore();
  };

  /* The camera closes in with the light but never follows, so a player who
   * flees into the dark at high zoom can be projected clean off the canvas —
   * alive, steerable and invisible. Pin a marker to the edge instead of moving
   * the camera, which would fight the shake pivot and the ring's composition.
   * Sets this.marker so tests can assert it without reading pixels. */
  /* Project a world point onto the screen border, and say whether it was
   * already on screen. One helper, because the fuel needle, the threat needle
   * and the offscreen player marker all need exactly this. */
  Renderer.prototype._edgeProject = function (wx, wy, cw, ch, inset, pad) {
    var x = this.toScreenX(wx), y = this.toScreenY(wy);
    var on = (x > pad && x < cw - pad && y > pad && y < ch - pad);
    var cx = cw / 2, cy = ch / 2;
    var dx = x - cx, dy = y - cy;
    if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) return null;
    var sx = (cw / 2 - inset) / Math.max(1e-6, Math.abs(dx));
    var sy = (ch / 2 - inset) / Math.max(1e-6, Math.abs(dy));
    var k = Math.min(sx, sy);
    return { x: cx + dx * k, y: cy + dy * k, ang: Math.atan2(dy, dx), on: on };
  };

  /* THE THIRD QUESTION: where is the fuel?
   *
   * Nothing in the game answered it. Embers are small, the camera zooms to
   * 2.15x, and the ring moves them off screen constantly, so "run into the
   * spikes" was advice you could follow only if the spikes happened to be in
   * frame. A needle on the border points at the nearest ARMED ember whenever
   * none is visible; when the fuel runs out for good it points at the nearest
   * prey instead, which is the phase change stated as a direction rather than
   * as a toast.
   *
   * At most two markers ever draw, and each is a dozen path ops -- this is not
   * where the frame budget goes.
   */
  Renderer.prototype._drawEdgeMarkers = function (ctx, game, cw, ch, t) {
    var p = game.player;
    if (!p || !p.alive || game.state === 'countdown') return;
    var INSET = 26, PAD = 0;

    // --- fuel (or, once it is gone, the nearest meal that walks) ---
    var target = game.fuelGone ? null : game.nearestFuel();
    var isPrey = false;
    if (!target) { target = game.nearestPrey(); isPrey = !!target; }
    if (target) {
      var e = this._edgeProject(target.x, target.y, cw, ch, INSET, PAD);
      // Only when it is genuinely off screen: an arrow pointing at something
      // the player can already see is noise that teaches them to ignore arrows.
      if (e && !e.on) {
        var d = Math.hypot(target.x - p.x, target.y - p.y);
        var a = 0.6 + 0.35 * clamp(1 - d / 70, 0, 1);
        this._needle(ctx, e, isPrey ? pal().prey : pal().ember, a, isPrey, t);
      }
    }

    // --- the nearest thing that can rob you, when it is coming from off screen ---
    var nearest = null, nd = Infinity;
    for (var i = 0; i < game.souls.length; i++) {
      var s = game.souls[i];
      if (!s.alive || s.isPlayer || s.offBoard) continue;
      if (p.flame - s.flame <= deadzone()) continue;
      var dd = Math.hypot(s.x - p.x, s.y - p.y);
      if (dd < nd) { nd = dd; nearest = s; }
    }
    if (nearest && nd < 42) {
      var te = this._edgeProject(nearest.x, nearest.y, cw, ch, INSET, PAD);
      if (te && !te.on) {
        var near = clamp(1 - nd / 42, 0, 1);
        var pulse = 0.6 + 0.4 * Math.sin(t * 7);
        this._threatEdge(ctx, te, (0.3 + 0.55 * near) * pulse, near);
      }
    }
  };

  /* An arrowhead with the fuel's own spikes on it, so the marker and the thing
   * it points at are obviously the same object. Shape, not just hue: the
   * spiked head means "food" at 320px and in greyscale. */
  Renderer.prototype._needle = function (ctx, e, color, alpha, hollow, t) {
    var breathe = 1 + Math.sin(t * 3.4) * 0.08;
    ctx.save();
    ctx.translate(e.x, e.y);
    // A plate first. The border is where the ring glow and every soul's bloom
    // pile up, and an unbacked marker there is a suggestion, not a signpost.
    ctx.globalAlpha = alpha * 0.8;
    ctx.beginPath(); ctx.arc(0, 0, 15, 0, TAU);
    ctx.fillStyle = 'rgba(7,6,13,.72)'; ctx.fill();
    ctx.rotate(e.ang);
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    // Six points, alternating long/short: the ember star, cut in half and
    // pointed outward.
    for (var i = 0; i <= 6; i++) {
      var ang = -Math.PI / 2 + (i / 6) * Math.PI;
      var rad = (i % 2 === 0 ? 6.2 : 12.0) * breathe;
      var px = Math.cos(ang) * rad + 3, py = Math.sin(ang) * rad;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.lineTo(-9, 0);
    ctx.closePath();
    if (hollow) {
      // Prey is a live lamp, not a pickup: outline it so the two never merge.
      ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke();
    } else {
      ctx.fillStyle = color; ctx.fill();
    }
    ctx.restore();
  };

  /* A threat off screen gets a wall, not an arrow: a thick arc lying along the
   * border with its spikes pointing IN at you -- the same outward-spike grammar
   * the threat rings use, seen from the other side. */
  Renderer.prototype._threatEdge = function (ctx, e, alpha, near) {
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.rotate(e.ang);
    ctx.globalAlpha = clamp(alpha, 0, 1) * 0.75;
    ctx.beginPath(); ctx.arc(-6, 0, 16, -1.0, 1.0);
    ctx.lineTo(-6, 0); ctx.closePath();
    ctx.fillStyle = 'rgba(7,6,13,.7)'; ctx.fill();
    ctx.globalAlpha = clamp(alpha, 0, 1);
    ctx.strokeStyle = pal().threat;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.arc(-9, 0, 15, -0.85, 0.85);
    ctx.stroke();
    ctx.lineWidth = 1.8;
    for (var i = -1; i <= 1; i++) {
      var a = i * 0.52;
      var c = Math.cos(a), s2 = Math.sin(a);
      ctx.beginPath();
      ctx.moveTo(-9 + c * 13, s2 * 13);
      ctx.lineTo(-9 + c * (7 - 3 * near), s2 * (7 - 3 * near));
      ctx.stroke();
    }
    ctx.restore();
  };

  Renderer.prototype._drawOffscreenPlayer = function (ctx, game, cw, ch, t) {
    this.marker = null;
    var p = game.player;
    if (!p || !p.alive) return;
    var m = 20;
    var x = this.toScreenX(p.x), y = this.toScreenY(p.y);
    // Only once the soul is FULLY off the canvas. Firing on the margin drew the
    // marker on top of a player who was still half visible, which read as a bug.
    var r = p.radius() * this.scale + 4;
    if (x + r > 0 && x - r < cw && y + r > 0 && y - r < ch) return;

    var cx = cw / 2, cy = ch / 2;
    var dx = x - cx, dy = y - cy;
    var d = Math.hypot(dx, dy) || 1;
    // Push out to whichever edge the direction hits first.
    var sx = (cw / 2 - m) / Math.max(1e-6, Math.abs(dx));
    var sy = (ch / 2 - m) / Math.max(1e-6, Math.abs(dy));
    var k = Math.min(sx, sy);
    var mx = cx + dx * k, my = cy + dy * k;
    this.marker = { x: mx, y: my };

    var col = p.color();
    var pulse = 0.65 + 0.35 * Math.sin(t * 7);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    J.drawGlow(ctx, mx, my, 26 * pulse, col, 0.6);
    ctx.restore();
    ctx.save();
    ctx.translate(mx, my);
    ctx.rotate(Math.atan2(dy, dx));
    ctx.beginPath();
    ctx.moveTo(9, 0); ctx.lineTo(-6, -7); ctx.lineTo(-6, 7);
    ctx.closePath();
    ctx.fillStyle = col; ctx.fill();
    ctx.strokeStyle = pal().you; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.restore();
  };

  Renderer.prototype._drawVignette = function (ctx, cw, ch, game) {
    // Redden the edges when the player is out in the void — the only "damage
    // indicator" the game has.
    var danger = !!(game._playerOutside && game.player.alive);
    ctx.drawImage(vignetteFor(cw, ch, danger), 0, 0);
  };

  global.Renderer = Renderer;
})(typeof self !== 'undefined' ? self : this);
