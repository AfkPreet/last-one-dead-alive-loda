/* story.js — the narrative layer.
 *
 * The premise is a re-reading of a constant that was already there: every soul
 * enters the arena at FLAME_START, so every soul was handed the same forty by
 * somebody who is no longer in it. You are the twelfth lamp. The oil in you is
 * not yours. The night ends when the last lamp goes out, and only that lamp is
 * still burning when it does — so being last is not a score, it is the only
 * position from which the thing you were handed arrives anywhere.
 *
 * All shipped prose lives in the tables at the top of this file; the machinery
 * below is a persistent ledger, an opening beat player, and an ending selector.
 * Nothing here touches the simulation.
 */
(function (global) {
  'use strict';

  var Store = global.Platform.Store;

  /* ------------------------------------------------------------- THE LEDGER
   * Who you are, who you are carrying, and everyone you have met. The eleven
   * other lamps are drawn from your own history, so night one is a field of
   * strangers and night ten is a room full of people you have failed. */

  var STRANGERS = [
    'MARA', 'SOOT', 'WICK', 'CINDER', 'ASHFALL', 'GLIM', 'TALLOW', 'PYRE',
    'FLICKER', 'DUSK', 'CHAR', 'GLOAM', 'MURK', 'EMBERLY', 'KINDLE', 'SMOLDER',
    'RUSHLIGHT', 'TAPER', 'SPARK', 'BRAND', 'LANTERN', 'HOLLOW'
  ];

  var BLANK = {
    you: null,          // your name, earned by carrying a night to its end
    carrying: null,     // { name, time } — whose oil you hold tonight
    met: [],            // [{ name, fate }] fate: 'outlasted' | 'beat' | 'dropped'
    chain: 0,           // nights carried unbroken
    lastDropped: null,  // who went out in your hands, for tomorrow's opening
    bestChain: 0,
    nights: 0,
    carried: 0,         // nights you got them to the end
    dropped: 0
  };

  function load() {
    var l = Store.get('ledger', null);
    if (!l) return JSON.parse(JSON.stringify(BLANK));
    for (var k in BLANK) if (!(k in l)) l[k] = BLANK[k];
    if (!Array.isArray(l.met)) l.met = [];
    return l;
  }
  function save(l) { Store.set('ledger', l); return l; }

  /** Everyone whose name can appear in the field tonight, yours included once
   *  you have one — play long enough and you walk in and find yourself there. */
  function namePool(ledger, rng, count) {
    var pool = [];
    for (var i = 0; i < ledger.met.length; i++) pool.push(ledger.met[i].name);
    if (ledger.you) pool.push(ledger.you);
    if (ledger.carrying && ledger.carrying.name) pool.push(ledger.carrying.name);
    // Deduplicate, keeping the most recent mention of each name.
    var seen = Object.create(null), uniq = [];
    for (var j = pool.length - 1; j >= 0; j--) {
      if (!seen[pool[j]]) { seen[pool[j]] = 1; uniq.unshift(pool[j]); }
    }
    var strangers = STRANGERS.filter(function (n) { return !seen[n]; });
    rng.shuffle(strangers);
    var out = uniq.slice(-count);
    while (out.length < count && strangers.length) out.push(strangers.pop());
    while (out.length < count) out.push('LAMP ' + (out.length + 1));
    return rng.shuffle(out).slice(0, count);
  }

  /* -------------------------------------------------------------- THE NIGHT
   * Called once a run resolves. Returns what the results screen should say and
   * updates the ledger for the next night. */
  function resolveNight(ledger, res, standings) {
    var carried = ledger.carrying;
    var won = res.rank === 1;
    var outcome = {
      won: won,
      carriedName: carried ? carried.name : null,
      askName: false,
      chainBroken: false,
      newCarrying: null
    };

    ledger.nights++;

    if (won) {
      ledger.carried++;
      ledger.lastDropped = null;
      ledger.chain++;
      if (ledger.chain > ledger.bestChain) ledger.bestChain = ledger.chain;
      // You reached the end of the night, so the next night you hand on your own.
      if (!ledger.you) outcome.askName = true;
      outcome.newCarrying = { name: ledger.you || null, time: Math.round(res.time) };
    } else {
      ledger.dropped++;
      ledger.chain = 0;
      outcome.chainBroken = true;
      // Who you dropped and who fills you next are two different people: one
      // went out in your hands, the other reached the end without you.
      ledger.lastDropped = carried ? (carried.name || null) : null;
      // Whoever did reach the end is who fills you tomorrow.
      var last = standings && standings[0] ? standings[0] : null;
      outcome.newCarrying = last ? { name: last.name, time: Math.round(last.t) } : null;
    }

    // Remember everyone from tonight and what they did to you.
    if (standings) {
      for (var i = 0; i < standings.length; i++) {
        var s = standings[i];
        if (s.player) continue;
        remember(ledger, s.name, s.rank < res.rank ? 'beat' : 'outlasted');
      }
    }
    ledger.carrying = outcome.newCarrying;
    save(ledger);
    return outcome;
  }

  function remember(ledger, name, fate) {
    if (!name) return;
    for (var i = 0; i < ledger.met.length; i++) {
      if (ledger.met[i].name === name) { ledger.met[i].fate = fate; return; }
    }
    ledger.met.push({ name: name, fate: fate });
    if (ledger.met.length > 40) ledger.met.shift();
  }

  function nameYourself(ledger, name) {
    name = String(name || '').toUpperCase().replace(/[^A-Z0-9 '\-]/g, '').trim().slice(0, 12);
    if (!name) return null;
    ledger.you = name;
    if (ledger.carrying && !ledger.carrying.name) ledger.carrying.name = name;
    save(ledger);
    return name;
  }

  /* ------------------------------------------------------------- THE OPENING
   * Rides the existing 3-2-1 countdown: one line per beat, ~2.2s each, tap to
   * skip. After the third night it collapses to the middle line alone. */
  function opening(ledger) {
    var c = ledger.carrying;
    if (!c) {
      return ['SOMEONE WENT OUT HERE BEFORE YOU.',
              'THEY LEFT YOU FORTY.',
              'CARRY IT TO THE END OF THE NIGHT.'];
    }
    if (ledger.chain === 0 && ledger.nights > 0) {
      var lost = ledger.lastDropped;
      var giver = c.name || 'SOMEONE';
      return [(lost ? lost + ' WENT OUT IN YOUR HANDS.'
                    : 'IT WENT OUT IN YOUR HANDS.'),
              giver + ' LEFT YOU WHAT ' + giver + ' HAD.',
              "DON'T DO IT TWICE."];
    }
    return [(c.name || 'SOMEONE') + ' CARRIED IT ' + mmss(c.time) + '.',
            'NOW YOU DO.',
            'TO THE END OF THE NIGHT.'];
  }

  function mmss(sec) {
    var m = Math.floor(sec / 60), s = Math.floor(sec % 60);
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  global.Story = {
    load: load, save: save,
    namePool: namePool,
    resolveNight: resolveNight,
    nameYourself: nameYourself,
    opening: opening,
    STRANGERS: STRANGERS
  };
})(typeof self !== 'undefined' ? self : this);
