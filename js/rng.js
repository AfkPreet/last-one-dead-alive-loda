/* rng.js — deterministic pseudo-randomness.
 * Every gameplay-relevant random number in this game comes from here so that a given
 * seed always replays the exact same match. Math.random() is banned in gameplay code
 * (see tools/check-determinism.sh).
 */
(function (global) {
  'use strict';

  /* mulberry32: tiny, fast, statistically fine for a game. */
  function mulberry32(a) {
    return function () {
      a |= 0;
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* xmur3 string hash -> 32-bit seed. Lets us seed from arbitrary text ("2026-09-05"). */
  function hashString(str) {
    var h = 1779033703 ^ str.length;
    for (var i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^ (h >>> 16)) >>> 0;
  }

  function Rng(seed) {
    if (typeof seed === 'string') seed = hashString(seed);
    this.seed = seed >>> 0;
    this._next = mulberry32(this.seed);
  }

  Rng.prototype.float = function () { return this._next(); };
  Rng.prototype.range = function (lo, hi) { return lo + this._next() * (hi - lo); };
  Rng.prototype.int = function (lo, hi) { return Math.floor(lo + this._next() * (hi - lo + 1)); };
  Rng.prototype.bool = function (p) { return this._next() < (p === undefined ? 0.5 : p); };
  Rng.prototype.pick = function (arr) { return arr[Math.floor(this._next() * arr.length)]; };
  Rng.prototype.angle = function () { return this._next() * Math.PI * 2; };
  Rng.prototype.sign = function () { return this._next() < 0.5 ? -1 : 1; };
  Rng.prototype.shuffle = function (arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(this._next() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  };
  /* Fork a child stream so adding a new consumer never shifts an existing one's sequence. */
  Rng.prototype.fork = function (tag) {
    return new Rng((hashString(tag) ^ Math.imul(this.seed, 2654435761)) >>> 0);
  };

  /* ---- Seed words: short, memorable, URL-safe seed strings -------------------- */
  var W1 = ['ash', 'dusk', 'void', 'ember', 'grim', 'null', 'pale', 'rust', 'sable', 'bleak',
            'hush', 'coil', 'wisp', 'murk', 'char', 'gloam'];
  var W2 = ['moth', 'wick', 'husk', 'bone', 'lamp', 'iris', 'gale', 'reef', 'thorn', 'quill',
            'vein', 'pyre', 'kiln', 'drift', 'omen', 'spur'];

  function seedToWords(seed) {
    seed = seed >>> 0;
    return W1[seed % W1.length] + '-' + W2[(seed >>> 8) % W2.length] + '-' + ((seed >>> 16) % 100);
  }

  /* ---- Daily seed -------------------------------------------------------------
   * Local-date based (not UTC) so "today's run" matches the player's actual today.
   * Day 1 = 2026-01-01. */
  var EPOCH = Date.UTC(2026, 0, 1);

  function localDateKey(d) {
    d = d || new Date();
    var m = d.getMonth() + 1, day = d.getDate();
    return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
  }

  function dayNumber(d) {
    d = d || new Date();
    var local = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
    return Math.floor((local - EPOCH) / 86400000) + 1;
  }

  function msUntilNextLocalMidnight(d) {
    d = d || new Date();
    var next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 0, 0);
    return next.getTime() - d.getTime();
  }

  global.RNG = {
    Rng: Rng,
    mulberry32: mulberry32,
    hashString: hashString,
    seedToWords: seedToWords,
    localDateKey: localDateKey,
    dayNumber: dayNumber,
    msUntilNextLocalMidnight: msUntilNextLocalMidnight,
    /* Keyed on the day NUMBER, not the date string, so seedForDay(n) below can
     * reproduce it exactly from a shared ?d=n link. These two must never drift
     * apart: if they do, a challenge link silently plays a different arena than
     * the daily it claims to be. */
    dailySeedString: function (d) { return 'LOD-D' + dayNumber(d); },
    seedForDay: function (n) { return 'LOD-D' + n; }
  };
})(typeof self !== "undefined" ? self : this);
