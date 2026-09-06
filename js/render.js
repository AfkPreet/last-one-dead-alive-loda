/* render.js — everything you see inside the arena.
 * Canvas2D only, no shadowBlur in the hot loop; all bloom comes from cached
 * radial-gradient sprites composited with 'lighter'.
 */
(function (global) {
  'use strict';

  var J = global.Juice, clamp = J.clamp, lerp = J.lerp;
  var TAU = Math.PI * 2;

  function Renderer(surface) {
    this.s = surface;
    this.scale = 1; this.ox = 0; this.oy = 0;
    this.contrast = false;
    this.showNames = true;
    this.reduced = false;
    this.zoom = 1;
    this.coachBand = null;     // [top, bottom] in screen px while a coach line shows
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
    ctx.strokeStyle = this.contrast ? 'rgba(123,47,247,.06)' : 'rgba(123,47,247,.13)';
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
    var closing = game.ringStage === 1;
    var col = closing ? '#ff2d55' : '#7b2ff7';
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
      J.drawGlow(ctx, e.x, e.y, r * (arming ? 2.4 : 4.4) * breathe, '#ff2d55',
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
        ctx.strokeStyle = 'rgba(255,45,85,' + (0.35 + charge * 0.45).toFixed(2) + ')';
        ctx.lineWidth = 0.45;
        ctx.stroke();
      } else {
        ctx.fillStyle = '#ff2d55';
        ctx.fill();
        ctx.beginPath(); ctx.arc(0, 0, r * 0.46, 0, TAU);
        ctx.fillStyle = '#ffd0dc'; ctx.fill();
      }
      ctx.restore();

      if (arming) {
        // A fuse everyone in the arena can read: this is worth racing for.
        ctx.beginPath();
        ctx.arc(e.x, e.y, r * 2.5, -Math.PI / 2, -Math.PI / 2 + charge * TAU);
        ctx.strokeStyle = 'rgba(255,208,220,.55)';
        ctx.lineWidth = 0.5;
        ctx.stroke();
      }
    }
    ctx.restore();
  };

  Renderer.prototype._drawSouls = function (ctx, game, S, t) {
    ctx.save();
    ctx.translate(this.ox, this.oy);
    ctx.scale(S, S);

    // Draw dim souls first so bright ones (the targets) sit on top.
    var order = game.souls.slice().sort(function (a, b) { return a.flame - b.flame; });

    for (var i = 0; i < order.length; i++) {
      var s = order[i];
      if (!s.alive) continue;
      var r = s.radius();
      var col = s.color();
      var f01 = s.flame / 100;

      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      // Bloom scales hard with flame: a full soul is a lighthouse announcing
      // itself to every hungry thing in the arena.
      J.drawGlow(ctx, s.x, s.y, r * (2.6 + f01 * 3.4), col, 0.42 + f01 * 0.4);
      ctx.restore();

      // Body
      ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, TAU);
      ctx.fillStyle = col; ctx.fill();

      // Hot core
      ctx.beginPath(); ctx.arc(s.x - r * 0.16, s.y - r * 0.18, r * (0.3 + f01 * 0.26), 0, TAU);
      ctx.fillStyle = 'rgba(255,255,255,' + (0.4 + f01 * 0.5).toFixed(2) + ')';
      ctx.fill();

      // Hit flash
      if (s.flash > 0) {
        ctx.beginPath(); ctx.arc(s.x, s.y, r * (1 + (1 - s.flash) * 0.9), 0, TAU);
        ctx.strokeStyle = 'rgba(255,255,255,' + (s.flash * 0.8).toFixed(2) + ')';
        ctx.lineWidth = 0.7; ctx.stroke();
      }

      if (s.isPlayer) {
        // A cyan ring + chevron so "you" is unmistakable without relying on hue.
        var pr = r + 2.2 + Math.sin(t * 4) * 0.35;
        ctx.beginPath(); ctx.arc(s.x, s.y, pr, 0, TAU);
        ctx.strokeStyle = '#00f5d4';
        ctx.lineWidth = this.contrast ? 1.5 : 0.75;
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(s.x - 2.1, s.y - pr - 2.4);
        ctx.lineTo(s.x, s.y - pr - 0.5);
        ctx.lineTo(s.x + 2.1, s.y - pr - 2.4);
        ctx.closePath();
        ctx.fillStyle = '#00f5d4'; ctx.fill();
      } else if (this.showNames && this._hasRoom(game, s)) {
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
    }
    ctx.restore();
  };

  /** True when no other living soul is close enough for the labels to collide. */
  Renderer.prototype._hasRoom = function (game, s) {
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
    ctx.strokeStyle = '#00f5d4'; ctx.lineWidth = 1.5; ctx.stroke();
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
