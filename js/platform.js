/* platform.js — the boring, load-bearing mobile-web plumbing.
 * Canvas sizing under devicePixelRatio, viewport churn on iOS, page-hide pausing,
 * haptics, and persistent storage that never throws.
 */
(function (global) {
  'use strict';

  var MAX_DPR = 2;                 // 3x on a phone buys nothing and costs 2.25x fill rate.

  /* ---- Storage: private mode / blocked cookies must not crash the game ------- */
  var Store = {
    get: function (k, dflt) {
      try {
        var v = localStorage.getItem('lod.' + k);
        return v === null ? dflt : JSON.parse(v);
      } catch (e) { return dflt; }
    },
    set: function (k, v) {
      try { localStorage.setItem('lod.' + k, JSON.stringify(v)); return true; }
      catch (e) { return false; }
    }
  };

  /* ---- Haptics --------------------------------------------------------------
   * navigator.vibrate is Android-only; iOS Safari has no vibration API at all.
   * Silently no-ops there rather than pretending. */
  var hapticsOK = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
  function vibrate(pattern) {
    if (!hapticsOK || !Store.get('haptics', true)) return;
    try { navigator.vibrate(pattern); } catch (e) { /* some browsers throw on user-gesture rules */ }
  }

  /* ---- Canvas surface -------------------------------------------------------
   * Keeps the backing store in device pixels and the drawing API in CSS pixels
   * by pre-scaling the context. Game code only ever thinks in CSS pixels.
   */
  function Surface(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.w = 0; this.h = 0; this.dpr = 1;
    this.quality = 1;          // render-scale multiplier, dropped under load
    this.onResize = null;
    this._resize = this.resize.bind(this);
    var self = this;
    global.addEventListener('resize', this._resize, { passive: true });
    global.addEventListener('orientationchange', function () {
      // iOS reports stale dimensions during the rotation animation.
      setTimeout(self._resize, 80);
      setTimeout(self._resize, 350);
    }, { passive: true });
    if (global.visualViewport) {
      global.visualViewport.addEventListener('resize', this._resize, { passive: true });
    }
    // The window can stay the same size while our container changes (rotation
    // on some Androids, desktop devtools, dynamic toolbars).
    if (global.ResizeObserver) {
      this._ro = new ResizeObserver(this._resize);
      try { this._ro.observe(canvas); } catch (e) {}
    }
    this.resize();
  }
  Surface.prototype.resize = function () {
    var rect = this.canvas.getBoundingClientRect();
    var cssW = Math.max(1, Math.round(rect.width));
    var cssH = Math.max(1, Math.round(rect.height));
    var dpr = Math.min(MAX_DPR, global.devicePixelRatio || 1) * this.quality;
    if (cssW === this.w && cssH === this.h && dpr === this.dpr) return;
    this.w = cssW; this.h = cssH; this.dpr = dpr;
    this.canvas.width = Math.round(cssW * dpr);
    this.canvas.height = Math.round(cssH * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.imageSmoothingEnabled = true;
    if (this.onResize) this.onResize(cssW, cssH, dpr);
  };

  /** Drop the render scale when the GPU can't keep up. This game is entirely
   *  fill-rate bound (glow sprites composited with 'lighter'), so resolution is
   *  the only lever that matters, and it is invisible on a glow-heavy scene. */
  Surface.prototype.setQuality = function (q) {
    q = Math.max(0.5, Math.min(1, q));
    if (Math.abs(q - this.quality) < 0.01) return false;
    this.quality = q;
    this.dpr = -1;               // force resize() past its no-op guard
    this.resize();
    return true;
  };

  /* ---- Reduced motion -------------------------------------------------------- */
  var rmQuery = global.matchMedia ? global.matchMedia('(prefers-reduced-motion: reduce)') : null;
  function prefersReducedMotion() {
    if (Store.get('motion', null) !== null) return !Store.get('motion', true);
    return !!(rmQuery && rmQuery.matches);
  }

  /* ---- Lifecycle -------------------------------------------------------------
   * 'pagehide' + 'visibilitychange' is the pair that actually fires reliably on
   * iOS Safari; 'blur' alone misses the app-switcher and 'unload' never fires. */
  function onHidden(fn) {
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') fn();
    });
    global.addEventListener('pagehide', fn);
    global.addEventListener('blur', fn);
  }
  function onVisible(fn) {
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') fn();
    });
    global.addEventListener('pageshow', fn);
  }

  var isTouch = ('ontouchstart' in global) || (navigator.maxTouchPoints > 0);
  var isIOS = /iP(hone|ad|od)/.test(navigator.platform || '') ||
              (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) ||
              /iPhone|iPad|iPod/.test(navigator.userAgent);
  var isStandalone = !!(global.matchMedia && global.matchMedia('(display-mode: standalone)').matches) ||
                     navigator.standalone === true;

  global.Platform = {
    Surface: Surface,
    Store: Store,
    vibrate: vibrate,
    hasHaptics: hapticsOK,
    prefersReducedMotion: prefersReducedMotion,
    onHidden: onHidden,
    onVisible: onVisible,
    isTouch: isTouch,
    isIOS: isIOS,
    isStandalone: isStandalone,
    MAX_DPR: MAX_DPR
  };
})(typeof self !== 'undefined' ? self : this);
