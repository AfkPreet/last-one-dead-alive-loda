/* juice.js — the layer that makes hits feel like hits.
 * Trauma-based screenshake, hitstop, a pooled particle system, floating text,
 * and pre-rendered glow sprites (shadowBlur is far too expensive per-frame on
 * a phone, so every glow in this game is a cached radial-gradient bitmap).
 */
(function (global) {
  'use strict';

  /* ---- easing ---------------------------------------------------------------- */
  var Ease = {
    linear:    function (t) { return t; },
    outCubic:  function (t) { return 1 - Math.pow(1 - t, 3); },
    inCubic:   function (t) { return t * t * t; },
    outQuint:  function (t) { return 1 - Math.pow(1 - t, 5); },
    inOutCubic:function (t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; },
    outBack:   function (t) { var c = 1.70158, c3 = c + 1; return 1 + c3 * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); },
    outElastic:function (t) {
      var c4 = (2 * Math.PI) / 3;
      return t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
    },
    outBounce: function (t) {
      var n1 = 7.5625, d1 = 2.75;
      if (t < 1 / d1) return n1 * t * t;
      if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
      if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
      return n1 * (t -= 2.625 / d1) * t + 0.984375;
    }
  };
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }

  /* ---- glow sprite cache -----------------------------------------------------
   * Key: colour + radius bucket. Buckets keep the cache small (a few dozen
   * bitmaps) while still looking smooth, because we scale on draw. */
  /* One 128px sprite per colour, scaled at draw time. Fixed size beats radius
   * bucketing: no cache blowup, no visible size-quantisation, and a soft radial
   * falloff survives any amount of scaling. */
  var GLOW_PX = 128;
  var glowCache = Object.create(null);
  function glowSprite(color) {
    var c = glowCache[color];
    if (c) return c;
    c = document.createElement('canvas');
    c.width = c.height = GLOW_PX;
    var g = c.getContext('2d');
    var h = GLOW_PX / 2;
    var grad = g.createRadialGradient(h, h, 0, h, h, h);
    grad.addColorStop(0.00, hexA(color, 1.0));
    grad.addColorStop(0.16, hexA(color, 0.70));
    grad.addColorStop(0.42, hexA(color, 0.24));
    grad.addColorStop(0.72, hexA(color, 0.055));
    grad.addColorStop(1.00, hexA(color, 0));
    g.fillStyle = grad;
    g.fillRect(0, 0, GLOW_PX, GLOW_PX);
    glowCache[color] = c;
    return c;
  }
  /** Draw a cached glow centred at x,y, scaled to `radius` (in the ctx's units). */
  function drawGlow(ctx, x, y, radius, color, alpha) {
    var s = glowSprite(color);
    ctx.globalAlpha = alpha === undefined ? 1 : alpha;
    ctx.drawImage(s, x - radius, y - radius, radius * 2, radius * 2);
    ctx.globalAlpha = 1;
  }

  var rgbCache = Object.create(null);
  function hexA(hex, a) {
    var rgb = rgbCache[hex];
    if (!rgb) {
      var h = hex.replace('#', '');
      if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
      rgb = rgbCache[hex] = [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    }
    return 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',' + a + ')';
  }
  function toRgb(hex) {
    hexA(hex, 1);
    return rgbCache[hex];
  }
  /** Sample a colour ramp: stops = [[pos, '#hex'], ...] with pos in 0..1. */
  function ramp(stops, t) {
    t = clamp(t, 0, 1);
    for (var i = 1; i < stops.length; i++) {
      if (t <= stops[i][0]) {
        var a = stops[i - 1], b = stops[i];
        var k = (t - a[0]) / Math.max(1e-6, b[0] - a[0]);
        var ca = toRgb(a[1]), cb = toRgb(b[1]);
        return 'rgb(' + Math.round(lerp(ca[0], cb[0], k)) + ',' +
                        Math.round(lerp(ca[1], cb[1], k)) + ',' +
                        Math.round(lerp(ca[2], cb[2], k)) + ')';
      }
    }
    return stops[stops.length - 1][1];
  }
  /** Same ramp but snapped to N buckets so the glow cache stays tiny. */
  function rampHex(stops, t, buckets) {
    buckets = buckets || 12;
    var q = Math.round(clamp(t, 0, 1) * buckets) / buckets;
    var c = ramp(stops, q);
    var m = /rgb\((\d+),(\d+),(\d+)\)/.exec(c);
    if (!m) return c;
    return '#' + ((1 << 24) + (+m[1] << 16) + (+m[2] << 8) + +m[3]).toString(16).slice(1);
  }

  /* ---- camera: trauma-squared shake ------------------------------------------
   * Kelly's model: store trauma 0..1, shake by trauma^2 so small hits barely
   * register and big ones slam. Decays linearly. */
  function Camera() {
    this.trauma = 0;
    this.x = 0; this.y = 0; this.rot = 0;
    this.maxOffset = 14;      // css px at full trauma
    this.maxRot = 0.035;      // radians
    this.decay = 1.5;         // trauma per second
    this.enabled = true;
    this._t = 0;
  }
  Camera.prototype.shake = function (amount) {
    if (!this.enabled) return;
    this.trauma = clamp(this.trauma + amount, 0, 1);
  };
  Camera.prototype.update = function (dt, rng) {
    this._t += dt;
    if (this.trauma <= 0) { this.x = this.y = this.rot = 0; return; }
    var s = this.trauma * this.trauma;
    // Cheap smooth noise: three out-of-phase sines beat rand() (no jitter tearing).
    var t = this._t * 46;
    this.x = s * this.maxOffset * (Math.sin(t) * 0.6 + Math.sin(t * 2.31 + 1.7) * 0.4);
    this.y = s * this.maxOffset * (Math.sin(t * 1.13 + 4.2) * 0.6 + Math.sin(t * 2.7 + 0.3) * 0.4);
    this.rot = s * this.maxRot * Math.sin(t * 0.87 + 2.1);
    this.trauma = Math.max(0, this.trauma - this.decay * dt);
  };

  /* ---- hitstop ----------------------------------------------------------------
   * Freeze the simulation for a few frames on impact. The single cheapest way to
   * make a collision feel like it has mass. */
  function Hitstop() { this.left = 0; }
  Hitstop.prototype.hit = function (seconds) { this.left = Math.max(this.left, seconds); };
  /** Returns the dt the simulation should actually advance by. */
  Hitstop.prototype.consume = function (dt) {
    if (this.left <= 0) return dt;
    this.left -= dt;
    if (this.left > 0) return 0;
    var rest = -this.left; this.left = 0;
    return rest;
  };

  /* ---- particles ------------------------------------------------------------
   * Flat pooled array, no allocation during play. Dead particles are swapped to
   * the tail so the live prefix stays contiguous. */
  function Particles(max) {
    this.max = max || 480;
    this.n = 0;
    this.cursor = 0;                 // round-robin recycle index when full
    this.p = new Array(this.max);
    for (var i = 0; i < this.max; i++) {
      this.p[i] = { x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 1, r: 1, color: '#fff', drag: 0.9, glow: false, grav: 0, spin: 0, rot: 0, shape: 0 };
    }
  }
  Particles.prototype.spawn = function (o) {
    var q;
    if (this.n < this.max) {
      q = this.p[this.n++];
    } else {
      // Full: recycle round-robin so a burst at one spot can't keep stomping
      // the same slot and render as a single particle.
      q = this.p[this.cursor];
      this.cursor = (this.cursor + 1) % this.max;
    }
    q.x = o.x; q.y = o.y; q.vx = o.vx || 0; q.vy = o.vy || 0;
    q.life = q.max = o.life || 0.5;
    q.r = o.r || 2; q.color = o.color || '#fff';
    q.drag = o.drag === undefined ? 0.90 : o.drag;
    q.glow = !!o.glow; q.grav = o.grav || 0;
    q.rot = o.rot || 0; q.spin = o.spin || 0; q.shape = o.shape || 0;
    return q;
  };
  /** Radial burst. rng must be a seeded RNG.Rng so replays stay identical. */
  Particles.prototype.burst = function (rng, x, y, count, opts) {
    opts = opts || {};
    var spd0 = opts.speed || 60, spd1 = opts.speed2 || spd0 * 2.2;
    for (var i = 0; i < count; i++) {
      var a = opts.dir === undefined ? rng.angle() : opts.dir + rng.range(-1, 1) * (opts.spread || Math.PI);
      var s = rng.range(spd0, spd1);
      this.spawn({
        x: x, y: y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: rng.range(opts.life || 0.3, opts.life2 || (opts.life || 0.3) * 2),
        r: rng.range(opts.r || 1.2, opts.r2 || 3),
        color: opts.colors ? rng.pick(opts.colors) : (opts.color || '#fff'),
        drag: opts.drag === undefined ? 0.90 : opts.drag,
        glow: opts.glow !== false, grav: opts.grav || 0,
        rot: rng.angle(), spin: rng.range(-8, 8), shape: opts.shape || 0
      });
    }
  };
  Particles.prototype.update = function (dt) {
    var i = 0;
    while (i < this.n) {
      var q = this.p[i];
      q.life -= dt;
      if (q.life <= 0) {
        this.p[i] = this.p[this.n - 1]; this.p[this.n - 1] = q; this.n--;
        continue;
      }
      var d = Math.pow(q.drag, dt * 60);
      q.vx *= d; q.vy *= d;
      q.vy += q.grav * dt;
      q.x += q.vx * dt; q.y += q.vy * dt;
      q.rot += q.spin * dt;
      i++;
    }
  };
  /** Particles are simulated in world units but drawn in screen pixels, so the
   *  glow sprite is never scaled by the world transform. */
  Particles.prototype.draw = function (ctx, ox, oy, scale) {
    ox = ox || 0; oy = oy || 0; scale = scale || 1;
    var prev = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = 'lighter';
    for (var i = 0; i < this.n; i++) {
      var q = this.p[i];
      var t = q.life / q.max;
      var a = t > 0.7 ? 1 : t / 0.7;                 // hold, then fade
      var r = q.r * (0.35 + 0.65 * t) * scale;
      var x = ox + q.x * scale, y = oy + q.y * scale;
      if (q.glow) drawGlow(ctx, x, y, r * 3.2, q.color, a * 0.5);
      ctx.globalAlpha = a;
      ctx.fillStyle = q.color;
      if (q.shape === 1) {                            // shard
        ctx.save();
        ctx.translate(x, y); ctx.rotate(q.rot);
        ctx.fillRect(-r, -r * 0.34, r * 2, r * 0.68);
        ctx.restore();
      } else {
        ctx.beginPath();
        ctx.arc(x, y, r, 0, 6.283185);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = prev;
  };
  Particles.prototype.clear = function () { this.n = 0; this.cursor = 0; };

  /* ---- floating text --------------------------------------------------------- */
  function FloatText(max) {
    this.max = max || 24; this.n = 0; this.cursor = 0; this.p = new Array(this.max);
    for (var i = 0; i < this.max; i++) this.p[i] = { x: 0, y: 0, vy: 0, life: 0, maxL: 1, text: '', color: '#fff', size: 12 };
  }
  FloatText.prototype.add = function (x, y, text, color, size) {
    var q;
    if (this.n < this.max) {
      q = this.p[this.n++];
    } else {
      q = this.p[this.cursor];
      this.cursor = (this.cursor + 1) % this.max;
    }
    q.x = x; q.y = y; q.vy = -34; q.life = q.maxL = 0.9;
    q.text = text; q.color = color || '#fff'; q.size = size || 13;
  };
  FloatText.prototype.update = function (dt) {
    var i = 0;
    while (i < this.n) {
      var q = this.p[i];
      q.life -= dt;
      if (q.life <= 0) { this.p[i] = this.p[this.n - 1]; this.p[this.n - 1] = q; this.n--; continue; }
      q.y += q.vy * dt; q.vy *= Math.pow(0.93, dt * 60);
      i++;
    }
  };
  FloatText.prototype.draw = function (ctx) {
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (var i = 0; i < this.n; i++) {
      var q = this.p[i];
      var t = q.life / q.maxL;
      var pop = 1 + 0.35 * Ease.outBack(clamp((1 - t) * 4, 0, 1)) - 0.35;
      ctx.globalAlpha = t > 0.55 ? 1 : t / 0.55;
      ctx.font = '800 ' + (q.size * pop).toFixed(1) + 'px ui-monospace, Menlo, monospace';
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.75)';
      ctx.strokeText(q.text, q.x, q.y);
      ctx.fillStyle = q.color;
      ctx.fillText(q.text, q.x, q.y);
    }
    ctx.globalAlpha = 1;
  };
  FloatText.prototype.clear = function () { this.n = 0; this.cursor = 0; };

  global.Juice = {
    Ease: Ease, Camera: Camera, Hitstop: Hitstop,
    Particles: Particles, FloatText: FloatText,
    drawGlow: drawGlow, glowSprite: glowSprite,
    hexA: hexA, ramp: ramp, rampHex: rampHex, toRgb: toRgb,
    clamp: clamp, lerp: lerp
  };
})(typeof self !== 'undefined' ? self : this);
