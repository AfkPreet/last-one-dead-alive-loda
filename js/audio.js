/* audio.js — every sound in this game is synthesised at runtime.
 * No audio files means no loading screen, no CORS, and the whole game still
 * works opened straight off the filesystem.
 */
(function (global) {
  'use strict';

  var ctx = null, master = null, musicBus = null, sfxBus = null;
  var unlocked = false, enabled = true;
  var noiseBuf = null;
  var music = { on: false, next: 0, step: 0, intensity: 0, timer: null };

  function now() { return ctx ? ctx.currentTime : 0; }

  function init() {
    if (ctx) return ctx;
    var AC = global.AudioContext || global.webkitAudioContext;
    if (!AC) return null;
    try { ctx = new AC(); } catch (e) { return null; }

    master = ctx.createGain();
    master.gain.value = 0.85;
    master.connect(ctx.destination);

    sfxBus = ctx.createGain(); sfxBus.gain.value = 1.0; sfxBus.connect(master);
    musicBus = ctx.createGain(); musicBus.gain.value = 0.0; musicBus.connect(master);

    // One second of white noise, reused for every percussive/breath sound.
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    var d = noiseBuf.getChannelData(0);
    var s = 123456789;
    for (var i = 0; i < d.length; i++) {           // xorshift so the buffer is identical every load
      s ^= s << 13; s ^= s >>> 17; s ^= s << 5; s |= 0;
      d[i] = (s / 2147483648) % 1;
    }
    return ctx;
  }

  /* Browsers only let audio start inside a user gesture. Call from the first tap. */
  function unlock() {
    if (!init()) return;
    if (ctx.state === 'suspended') ctx.resume();
    if (unlocked) return;
    unlocked = true;
    var o = ctx.createOscillator(), g = ctx.createGain();
    g.gain.value = 0.0001;
    o.connect(g); g.connect(master);
    o.start(); o.stop(now() + 0.02);
  }

  /* ---- primitives ----------------------------------------------------------- */

  /** A pitched blip: waveform, freq glide f0->f1, gain envelope. */
  function tone(o) {
    if (!ctx || !enabled) return;
    var t = now() + (o.delay || 0);
    var osc = ctx.createOscillator();
    var g = ctx.createGain();
    osc.type = o.type || 'square';
    osc.frequency.setValueAtTime(o.f0, t);
    if (o.f1 && o.f1 !== o.f0) {
      if (o.glide === 'lin') osc.frequency.linearRampToValueAtTime(o.f1, t + o.dur);
      else osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f1), t + o.dur);
    }
    var peak = (o.gain === undefined ? 0.22 : o.gain);
    var atk = o.attack === undefined ? 0.006 : o.attack;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);

    var node = osc;
    if (o.filter) {
      var f = ctx.createBiquadFilter();
      f.type = o.filter;
      f.frequency.setValueAtTime(o.fc0 || 900, t);
      if (o.fc1) f.frequency.exponentialRampToValueAtTime(Math.max(40, o.fc1), t + o.dur);
      f.Q.value = o.q || 1;
      node.connect(f); f.connect(g);
    } else {
      node.connect(g);
    }
    g.connect(o.bus || sfxBus);
    osc.start(t); osc.stop(t + o.dur + 0.02);
  }

  /** A noise burst through a filter — impacts, breath, static. */
  function noise(o) {
    if (!ctx || !enabled || !noiseBuf) return;
    var t = now() + (o.delay || 0);
    var src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    var f = ctx.createBiquadFilter();
    f.type = o.filter || 'bandpass';
    f.frequency.setValueAtTime(o.fc0 || 1200, t);
    if (o.fc1) f.frequency.exponentialRampToValueAtTime(Math.max(40, o.fc1), t + o.dur);
    f.Q.value = o.q === undefined ? 1.2 : o.q;
    var g = ctx.createGain();
    var peak = o.gain === undefined ? 0.18 : o.gain;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + (o.attack || 0.004));
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    src.connect(f); f.connect(g); g.connect(o.bus || sfxBus);
    src.start(t); src.stop(t + o.dur + 0.02);
  }

  /* ---- the sound palette ----------------------------------------------------- */
  var SFX = {
    /* Eating an ember: a short rising two-step chime. Deliberately *rewarding*,
       because the whole game hinges on the player believing spikes are good. */
    pickup: function (pitch) {
      var p = 1 + (pitch || 0) * 0.06;
      tone({ type: 'square', f0: 520 * p, f1: 900 * p, dur: 0.085, gain: 0.17, attack: 0.004 });
      tone({ type: 'triangle', f0: 1040 * p, f1: 1560 * p, dur: 0.12, gain: 0.1, delay: 0.045 });
    },
    /* You tore flame out of a brighter soul. Meaty. */
    steal: function () {
      noise({ filter: 'lowpass', fc0: 2400, fc1: 220, dur: 0.22, gain: 0.3, q: 0.8 });
      tone({ type: 'sawtooth', f0: 180, f1: 60, dur: 0.26, gain: 0.22, filter: 'lowpass', fc0: 1400, fc1: 300 });
      tone({ type: 'square', f0: 880, f1: 1320, dur: 0.1, gain: 0.09, delay: 0.03 });
    },
    /* A dimmer soul tore flame out of YOU. Same impact, inverted pitch move. */
    drained: function () {
      noise({ filter: 'bandpass', fc0: 900, fc1: 160, dur: 0.3, gain: 0.34, q: 0.6 });
      tone({ type: 'sawtooth', f0: 300, f1: 42, dur: 0.36, gain: 0.26, filter: 'lowpass', fc0: 1800, fc1: 180 });
    },
    /* Somebody else went out. A distant, hollow bell. */
    soulOut: function (n) {
      var f = 300 - (n || 0) * 10;
      tone({ type: 'sine', f0: f, f1: f * 0.5, dur: 0.5, gain: 0.11 });
      noise({ filter: 'highpass', fc0: 3200, fc1: 900, dur: 0.3, gain: 0.05 });
    },
    /* You went out. The long fall. */
    death: function () {
      tone({ type: 'sine', f0: 420, f1: 40, dur: 1.5, gain: 0.3, filter: 'lowpass', fc0: 2200, fc1: 120 });
      tone({ type: 'sawtooth', f0: 210, f1: 26, dur: 1.7, gain: 0.14, filter: 'lowpass', fc0: 1400, fc1: 90 });
      noise({ filter: 'lowpass', fc0: 1800, fc1: 90, dur: 1.4, gain: 0.16 });
    },
    /* The light is about to close in. */
    ringWarn: function () {
      tone({ type: 'triangle', f0: 660, f1: 660, dur: 0.09, gain: 0.13 });
      tone({ type: 'triangle', f0: 880, f1: 880, dur: 0.11, gain: 0.11, delay: 0.13 });
    },
    ringMove: function () {
      noise({ filter: 'bandpass', fc0: 260, fc1: 90, dur: 1.1, gain: 0.1, q: 0.5, attack: 0.3 });
    },
    /* Burning in the void. Loops as a one-shot re-triggered by the game. */
    voidBurn: function () {
      noise({ filter: 'highpass', fc0: 1800, fc1: 4200, dur: 0.4, gain: 0.055, q: 0.4, attack: 0.15 });
    },
    count: function (n) {
      tone({ type: 'square', f0: 300 + n * 90, f1: 300 + n * 90, dur: 0.11, gain: 0.16 });
    },
    /* The reveal. Rising minor-to-major arpeggio: the twist, in music. */
    win: function () {
      var seq = [261.63, 311.13, 392.00, 523.25, 622.25, 783.99];
      for (var i = 0; i < seq.length; i++) {
        tone({ type: 'square', f0: seq[i], f1: seq[i], dur: 0.34, gain: 0.13, delay: i * 0.11 });
        tone({ type: 'triangle', f0: seq[i] * 2, f1: seq[i] * 2, dur: 0.2, gain: 0.06, delay: i * 0.11 + 0.02 });
      }
      tone({ type: 'sine', f0: 65.4, f1: 65.4, dur: 1.9, gain: 0.2, delay: 0.05 });
    },
    lose: function () {
      tone({ type: 'square', f0: 330, f1: 330, dur: 0.2, gain: 0.11 });
      tone({ type: 'square', f0: 247, f1: 247, dur: 0.34, gain: 0.11, delay: 0.16 });
      tone({ type: 'sine', f0: 82, f1: 62, dur: 1.1, gain: 0.16, delay: 0.16 });
    },
    ui: function () { tone({ type: 'square', f0: 700, f1: 940, dur: 0.05, gain: 0.08 }); },
    danger: function () { tone({ type: 'sawtooth', f0: 140, f1: 90, dur: 0.3, gain: 0.1, filter: 'lowpass', fc0: 600 }); }
  };

  function play(name, arg) {
    if (!ctx || !enabled) return;
    if (ctx.state === 'suspended') ctx.resume();
    var fn = SFX[name];
    if (fn) { try { fn(arg); } catch (e) {} }
  }

  /* ---- music -----------------------------------------------------------------
   * A four-on-the-floor heartbeat with a bassline that climbs as the arena
   * empties. Scheduled ahead in small chunks so tab throttling can't shred it. */
  var ROOT = [55.00, 58.27, 49.00, 43.65];        // A1, Bb1, G1, F1 — a slow descending dread loop
  var LOOKAHEAD = 0.12, SCHEDULE_MS = 45;

  function scheduler() {
    if (!music.on || !ctx) return;
    var t = now();
    var beat = 60 / (78 + music.intensity * 34);  // 78bpm calm -> 112bpm frantic
    while (music.next < t + LOOKAHEAD) {
      var s = music.step, bar = Math.floor(s / 4) % 4, at = music.next;
      var root = ROOT[bar];

      // Kick: the heartbeat. Always there.
      tone({ type: 'sine', f0: 120, f1: 42, dur: 0.2, gain: 0.5, bus: musicBus, delay: at - t });
      // Bass note on every beat, octave-jumping when the arena gets tense.
      var bf = root * (s % 4 === 2 && music.intensity > 0.45 ? 2 : 1);
      tone({ type: 'sawtooth', f0: bf, f1: bf, dur: beat * 0.82, gain: 0.16,
             filter: 'lowpass', fc0: 300 + music.intensity * 1500, q: 6, bus: musicBus, delay: at - t });
      // Hat on the off-beat once things heat up.
      if (music.intensity > 0.25 && s % 2 === 1) {
        noise({ filter: 'highpass', fc0: 7000, dur: 0.05, gain: 0.05 * music.intensity, bus: musicBus, delay: at - t });
      }
      // A fifth stab every other bar at high intensity — the "someone is hunting you" motif.
      if (music.intensity > 0.6 && s % 8 === 6) {
        tone({ type: 'square', f0: root * 6, f1: root * 4, dur: 0.18, gain: 0.05, bus: musicBus, delay: at - t });
      }
      music.next += beat;
      music.step = (s + 1) % 16;
    }
    music.timer = setTimeout(scheduler, SCHEDULE_MS);
  }

  function startMusic() {
    if (!ctx || !enabled || music.on) return;
    music.on = true; music.step = 0; music.next = now() + 0.08;
    musicBus.gain.cancelScheduledValues(now());
    musicBus.gain.setValueAtTime(0.0001, now());
    musicBus.gain.linearRampToValueAtTime(0.5, now() + 1.2);
    scheduler();
  }
  function stopMusic(fade) {
    if (!ctx || !music.on) return;
    music.on = false;
    if (music.timer) { clearTimeout(music.timer); music.timer = null; }
    musicBus.gain.cancelScheduledValues(now());
    musicBus.gain.setValueAtTime(musicBus.gain.value, now());
    musicBus.gain.linearRampToValueAtTime(0.0001, now() + (fade === undefined ? 0.5 : fade));
  }
  function setIntensity(v) { music.intensity = Math.max(0, Math.min(1, v)); }

  function setEnabled(v) {
    enabled = !!v;
    if (master) master.gain.value = enabled ? 0.85 : 0;
    if (!enabled) stopMusic(0.1);
  }
  function suspend() { if (ctx && ctx.state === 'running') { stopMusic(0.1); ctx.suspend(); } }
  function resume() { if (ctx && ctx.state === 'suspended' && enabled) ctx.resume(); }

  global.Audio2 = {
    init: init, unlock: unlock, play: play,
    startMusic: startMusic, stopMusic: stopMusic, setIntensity: setIntensity,
    setEnabled: setEnabled, isEnabled: function () { return enabled; },
    suspend: suspend, resume: resume
  };
})(typeof self !== 'undefined' ? self : this);
