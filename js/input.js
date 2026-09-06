/* input.js — one-thumb control.
 *
 * Scheme: a *dynamic, sticky* virtual joystick. The stick is born wherever the
 * thumb lands (no fixed on-screen pad to reach for), and if the thumb travels
 * past MAX_R the origin is dragged along behind it, so long swipes never "run
 * out of stick". Desktop gets WASD/arrows and click-drag, which produce the
 * identical normalised vector the game reads.
 */
(function (global) {
  'use strict';

  var DEAD_R = 6;    // css px of slop before we register intent — kills jitter
  var MAX_R  = 46;   // css px for full deflection; ~9mm, comfortable thumb throw
  var TAP_MS = 220;  // press shorter than this...
  var TAP_R  = 12;   // ...and tighter than this counts as a tap, not a drag

  function Input(el) {
    this.el = el;
    this.active = false;      // is a pointer/key currently steering
    this.touching = false;    // is a *pointer* down (drives the on-screen stick art)
    this.x = 0; this.y = 0;   // normalised direction, magnitude 0..1
    this.mag = 0;
    this.originX = 0; this.originY = 0;   // stick base, css px, for rendering
    this.knobX = 0; this.knobY = 0;       // stick knob, css px, for rendering
    this.onTap = null;
    this.enabled = true;

    this._id = null;
    this._startT = 0;
    this._startX = 0; this._startY = 0;
    this._moved = 0;
    this._keys = Object.create(null);

    this._bind();
  }

  Input.prototype._bind = function () {
    var self = this, el = this.el;
    var opts = { passive: false };

    function local(e) {
      var r = el.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }

    function down(e) {
      if (!self.enabled) return;
      if (self._id !== null) return;              // first finger wins; ignore the rest
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      self._id = e.pointerId;
      var p = local(e);
      self.originX = self._startX = p.x;
      self.originY = self._startY = p.y;
      self.knobX = p.x; self.knobY = p.y;
      self.touching = true;
      self._startT = performance.now();
      self._moved = 0;
      self.x = self.y = self.mag = 0;
      if (el.setPointerCapture) { try { el.setPointerCapture(e.pointerId); } catch (err) {} }
      e.preventDefault();
    }

    function move(e) {
      if (self._id !== e.pointerId) return;
      var p = local(e);
      var dx = p.x - self.originX, dy = p.y - self.originY;
      var d = Math.hypot(dx, dy);
      self._moved = Math.max(self._moved, Math.hypot(p.x - self._startX, p.y - self._startY));

      if (d > MAX_R) {
        // Sticky origin: drag the base along so the stick stays at full tilt.
        var k = (d - MAX_R) / d;
        self.originX += dx * k;
        self.originY += dy * k;
        dx = p.x - self.originX; dy = p.y - self.originY;
        d = MAX_R;
      }
      self.knobX = p.x; self.knobY = p.y;

      if (d <= DEAD_R) {
        self.x = self.y = self.mag = 0;
        self.active = false;
      } else {
        var m = (d - DEAD_R) / (MAX_R - DEAD_R);   // rescale so output starts at 0 past the dead zone
        if (m > 1) m = 1;
        self.x = dx / d; self.y = dy / d;
        self.mag = m;
        self.active = true;
      }
      e.preventDefault();
    }

    function up(e) {
      if (self._id !== e.pointerId) return;
      var dt = performance.now() - self._startT;
      self._id = null;
      self.touching = false;
      self.active = false;
      self.x = self.y = self.mag = 0;
      if (dt <= TAP_MS && self._moved <= TAP_R && self.onTap) self.onTap(self._startX, self._startY);
      if (e.cancelable) e.preventDefault();
    }

    el.addEventListener('pointerdown', down, opts);
    el.addEventListener('pointermove', move, opts);
    el.addEventListener('pointerup', up, opts);
    el.addEventListener('pointercancel', up, opts);
    el.addEventListener('lostpointercapture', function (e) {
      if (self._id === e.pointerId) { self._id = null; self.touching = false; self.active = false; self.mag = 0; }
    });
    // Belt and braces against iOS gestures that pointer events don't cover.
    el.addEventListener('touchstart', function (e) { if (e.cancelable) e.preventDefault(); }, opts);
    el.addEventListener('touchmove', function (e) { if (e.cancelable) e.preventDefault(); }, opts);
    el.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    el.addEventListener('dblclick', function (e) { e.preventDefault(); });

    global.addEventListener('keydown', function (e) {
      if (e.repeat) return;
      self._keys[e.key.toLowerCase()] = true;
      self._syncKeys();
    });
    global.addEventListener('keyup', function (e) {
      self._keys[e.key.toLowerCase()] = false;
      self._syncKeys();
    });
    global.addEventListener('blur', function () {
      self._keys = Object.create(null);
      self._id = null; self.touching = false; self.active = false; self.mag = 0; self.x = self.y = 0;
    });
  };

  Input.prototype._syncKeys = function () {
    if (this._id !== null) return;              // a live pointer outranks the keyboard
    var k = this._keys;
    var dx = (k.d || k.arrowright ? 1 : 0) - (k.a || k.arrowleft ? 1 : 0);
    var dy = (k.s || k.arrowdown ? 1 : 0) - (k.w || k.arrowup ? 1 : 0);
    if (dx === 0 && dy === 0) {
      this.x = this.y = this.mag = 0; this.active = false;
      return;
    }
    var d = Math.hypot(dx, dy);
    this.x = dx / d; this.y = dy / d; this.mag = 1; this.active = true;
  };

  Input.prototype.reset = function () {
    this._id = null; this._keys = Object.create(null);
    this.touching = this.active = false;
    this.x = this.y = this.mag = 0;
  };

  Input.DEAD_R = DEAD_R;
  Input.MAX_R = MAX_R;
  global.Input = Input;
})(typeof self !== 'undefined' ? self : this);
