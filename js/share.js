/* share.js — the part that actually spreads.
 *
 * THE BURNLINE: your run rendered as a strip of emoji blocks, one per 3 seconds
 * survived, coloured by how bright you burned in that window. It inverts
 * Wordle's grid on purpose — here a LONGER strip is a better run, and a great
 * run is almost entirely black, because staying dim is how you last. Two strips
 * side by side in a group chat teach the whole game with no words.
 *
 * The iOS trap this file is built around: transient user activation dies across
 * an `await`, so navigator.share() must be called synchronously from the click
 * handler with a payload that already exists. Everything is precomputed at death.
 */
(function (global) {
  'use strict';

  var Store = global.Platform.Store;

  var CELL_SECONDS = 3;
  var MAX_CELLS = 40;
  var ROW = 10;

  var GLYPH = {
    normal:   { low: '⬛', mid: '🟥', high: '🟨' },  // ⬛ 🟥 🟨
    contrast: { low: '⬛', mid: '🟦', high: '🟧' }   // ⬛ 🟦 🟧
  };
  var SKULL = '💀';

  /* ---- streaks ---------------------------------------------------------------
   * Deliberately non-punishing: playing the daily keeps the streak, losing does
   * not break it. The counter exists only so returning players have something
   * of their own to protect. */
  function loadProgress() {
    return Store.get('progress', { lastDay: 0, streak: 0, best: 0, wins: 0, plays: 0, bestRank: 99 });
  }
  /** Only the real, current daily moves the streak — not a challenge link for
   *  somebody else's day, and not an endless run. */
  function recordDaily(dayNum, result) {
    var p = loadProgress();
    if (result.mode !== 'daily' || dayNum !== global.RNG.dayNumber()) return p;
    if (p.lastDay !== dayNum) {
      p.streak = (p.lastDay === dayNum - 1) ? p.streak + 1 : 1;
      p.lastDay = dayNum;
    }
    p.plays++;
    if (result.won) p.wins++;
    if (result.rank < p.bestRank) p.bestRank = result.rank;
    if (p.streak > p.best) p.best = p.streak;
    Store.set('progress', p);
    return p;
  }

  /* ---- the burnline ---------------------------------------------------------- */
  function burnline(samples, deathTime, contrast) {
    var g = contrast ? GLYPH.contrast : GLYPH.normal;
    var cells = [];
    var total = Math.max(1, Math.ceil(deathTime / CELL_SECONDS));
    for (var i = 0; i < total && i < MAX_CELLS; i++) {
      var t0 = i * CELL_SECONDS, t1 = t0 + CELL_SECONDS;
      var peak = 0, seen = false;
      for (var j = 0; j < samples.length; j++) {
        var s = samples[j];
        if (s[0] >= t0 && s[0] < t1) { peak = Math.max(peak, s[1]); seen = true; }
      }
      if (!seen) peak = 0;
      var pct = peak / 100;
      cells.push(pct <= 0.33 ? g.low : pct <= 0.66 ? g.mid : g.high);
    }
    if (!cells.length) cells.push(g.low);
    cells[cells.length - 1] = SKULL;                 // the moment you went out
    var truncated = total > MAX_CELLS;

    var rows = [];
    for (var k = 0; k < cells.length; k += ROW) rows.push(cells.slice(k, k + ROW).join(''));
    if (truncated) rows[rows.length - 1] += '➕';
    return rows.join('\n');
  }

  function mmss(sec) {
    var m = Math.floor(sec / 60), s = Math.floor(sec % 60);
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  /* ---- link ------------------------------------------------------------------ */
  var CANONICAL = 'https://afkpreet.github.io/last-one-dead-alive-loda/';
  function baseUrl() {
    // Opened from the filesystem there is no shareable origin, so point people
    // at the hosted copy rather than at a path on the sharer's own machine.
    if (global.location.protocol === 'file:') return CANONICAL;
    var u = global.location.origin + global.location.pathname;
    return u.replace(/index\.html$/, '');
  }
  function challengeUrl(result, dayNum) {
    var q = [];
    if (result.mode === 'daily') q.push('d=' + dayNum);
    else q.push('s=' + encodeURIComponent(result.seed));
    q.push('p=' + result.rank);
    q.push('t=' + Math.round(result.time));
    var tag = Store.get('tag', '');
    if (tag) q.push('n=' + encodeURIComponent(tag));
    return baseUrl() + '?' + q.join('&');
  }

  /* ---- the message ------------------------------------------------------------ */
  function buildText(result, dayNum, progress, contrast, ghost) {
    var L = [];
    var head = result.mode === 'daily' ? 'LAST ONE DEAD · DAY ' + dayNum
                                       : 'LAST ONE DEAD · ' + global.RNG.seedToWords(global.RNG.hashString(result.seed));
    L.push(head);

    if (result.won) {
      L.push(SKULL + ' #1 / ' + result.total + ' — I died LAST');
    } else if (result.rank <= 3) {
      L.push('🔥 #' + result.rank + ' / ' + result.total + ' — so close to dying last');
    } else if (result.rank >= result.total - 2) {
      L.push('🔥 #' + result.rank + ' / ' + result.total + ' — burned out immediately');
    } else {
      L.push('🔥 #' + result.rank + ' / ' + result.total + ' — burned out early');
    }

    L.push('');
    L.push(burnline(result.samples, result.time, contrast));
    L.push('');

    var foot = mmss(result.time) + ' in the dark';
    if (ghost && ghost.name && ghost.time) {
      var diff = result.time - ghost.time;
      foot += diff >= 0 ? ' · outlived ' + ghost.name + ' by ' + mmss(Math.abs(diff))
                        : ' · ' + ghost.name + ' outlived me by ' + mmss(Math.abs(diff));
    } else if (progress && progress.streak > 1) {
      foot += ' · 🔥' + progress.streak;
    }
    L.push(foot);
    L.push(challengeUrl(result, dayNum));
    return L.join('\n');
  }

  /* ---- delivery ---------------------------------------------------------------
   * Tier 1 navigator.share (text only — a `title` or separate `url` gets dropped
   * unpredictably per target on iOS), tier 2 async clipboard, tier 3 execCommand,
   * tier 4 show it and let them copy by hand. */
  var sharing = false;

  function canShare(data) {
    if (!global.navigator || !navigator.share) return false;
    try { return !navigator.canShare || navigator.canShare(data); }
    catch (e) { return false; }
  }

  function legacyCopy(text) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, text.length);
      var ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (e) { return false; }
  }

  /** Must be called directly inside a click handler, with no await before it. */
  function share(text, cb) {
    cb = cb || function () {};
    if (sharing) return;
    var data = { text: text };
    if (canShare(data)) {
      sharing = true;
      navigator.share(data).then(function () {
        cb('shared');
      })['catch'](function (err) {
        if (err && err.name === 'AbortError') { cb('cancelled'); return; }
        copy(text, cb);
      })['finally'](function () { sharing = false; });
      return;
    }
    copy(text, cb);
  }

  function copy(text, cb) {
    cb = cb || function () {};
    if (global.navigator && navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { cb('copied'); })
        ['catch'](function () { cb(legacyCopy(text) ? 'copied' : 'manual'); });
      return;
    }
    cb(legacyCopy(text) ? 'copied' : 'manual');
  }

  /* Explicit intents — the desktop path, and the obvious affordance on mobile.
   * WhatsApp first: it is the default group chat for most of this game's audience. */
  function intents(text) {
    var e = encodeURIComponent(text);
    return {
      whatsapp: 'https://api.whatsapp.com/send?text=' + e,
      telegram: 'https://t.me/share/url?url=' + encodeURIComponent(challengeUrlCache || baseUrl()) + '&text=' + e,
      x: 'https://twitter.com/intent/tweet?text=' + e
    };
  }
  var challengeUrlCache = '';

  /* ---- inbound challenge link ------------------------------------------------- */
  function parseChallenge() {
    var q = {};
    var s = global.location.search.replace(/^\?/, '');
    if (!s) return null;
    s.split('&').forEach(function (kv) {
      var i = kv.indexOf('=');
      if (i < 0) return;
      // A stray '%' makes decodeURIComponent throw; an unparseable link must
      // not take the whole game down on boot.
      try {
        q[decodeURIComponent(kv.slice(0, i))] = decodeURIComponent(kv.slice(i + 1));
      } catch (e) { /* ignore this parameter */ }
    });
    if (!q.d && !q.s) return null;
    var name = (q.n || '').replace(/[^A-Za-z0-9_]/g, '').slice(0, 10).toUpperCase();
    // Everything here arrives from a stranger's URL. Anything that isn't a sane
    // finite number is dropped rather than propagated into the game state.
    var num = function (v, lo, hi) {
      var n = parseFloat(v);
      return (isFinite(n) && n >= lo && n <= hi) ? n : null;
    };
    var day = q.d != null ? num(q.d, 1, 100000) : null;
    return {
      day: day === null ? null : Math.floor(day),
      seed: q.s ? String(q.s).slice(0, 64) : null,
      rank: q.p != null ? num(q.p, 1, 99) : null,
      time: q.t != null ? num(q.t, 0, 86400) : null,
      name: name || null
    };
  }
  /** Drop the challenger's params so the player's own share links to THEIR run. */
  function clearChallengeParams() {
    try {
      if (global.history && history.replaceState) history.replaceState(null, '', baseUrl());
    } catch (e) {}
  }

  global.Share = {
    burnline: burnline,
    buildText: buildText,
    challengeUrl: function (r, d) { challengeUrlCache = challengeUrl(r, d); return challengeUrlCache; },
    share: share,
    copy: copy,
    intents: intents,
    mmss: mmss,
    loadProgress: loadProgress,
    recordDaily: recordDaily,
    parseChallenge: parseChallenge,
    clearChallengeParams: clearChallengeParams,
    CELL_SECONDS: CELL_SECONDS
  };
})(typeof self !== 'undefined' ? self : this);
