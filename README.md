# LAST ONE DEAD

**Twelve souls. Everybody burns out. Win by being the last one to die.**

Play: **https://afkpreet.github.io/last-one-dead-alive-loda/**

A one-thumb browser arena game. The name promises a battle royale, and the game
opens by telling you the opposite: you are trying to *die*. Then it turns out
those were never two different things — the last soul to go out is the last one
alive. The game withholds that word until you win it.

---

## The rules, and why each one is backwards

Everything here is the inverse of what the genre trained you to do, and each
inversion keeps costing you something for the whole match:

| The genre | Here |
|---|---|
| Dodge the red spiky things | **Run into them.** They are the only fuel left. |
| Collect health, stay topped up | **Flame is time at a worse and worse rate.** Your first 10 flame buy ~7 seconds; your tenth 10 buy ~2. |
| The strongest player hunts | **The dim eat the bright.** Contact tears flame out of whoever is brighter, and a third of it is lost to the dark on the way. |
| Survive to the end | **Go out last.** The match ends when the final soul does. You cannot win without dying. |

Speed and body size both scale with flame, so burning bright makes you fast and
makes you a target. A shrinking ring of light punishes anyone who lingers in the
dark. Tapping dashes, and the dash costs flame — you spend life to move.

### The LET GO button

There is a button in the corner, for the whole match, that ends you instantly.
Hold it for six-tenths of a second and you are out.

It is not a trick and there is no confirmation dialog. The game says its goal is
to die, so it offers you death at all times and means it. Most people press it
once, go out ninth, and learn the entire design in a second: it never asked you
to die — it asked you to die **last**. Refusing that button is the game.

---

## Sharing

Every run encodes to a **burnline**: one emoji cell per three seconds survived,
coloured by how bright you burned in that window.

```
LAST ONE DEAD · DAY 249
💀 #1 / 12 — I died LAST

⬛⬛⬛🟥🟨🟥⬛⬛⬛⬛
⬛🟥⬛⬛💀

0:47 in the dark · 🔥4
afkpreet.github.io/last-one-dead-alive-loda/?d=249&p=1&t=47
```

It inverts Wordle's grid deliberately. There, a good result is a *short* grid.
Here a longer strip is a better run, and a great run is **almost entirely
black**, because staying dim is how you last. Two strips side by side in a group
chat teach the whole mechanic without a word of explanation — which is the
point, because "why is yours all black?" is the question that installs the game
on someone else's phone.

- **Daily** — one arena per local day, identical for everyone, so scores compare.
- **Endless** — a fresh random arena, unlimited retries.
- **Challenge links** — `?d=249&p=1&t=47&n=PRT` loads that exact arena, names one
  soul after the challenger, and tells you the moment you outlive their time.
  It never alters the simulation: a daily that differs between players is a
  daily whose scores mean nothing.

Sharing goes through `navigator.share` with a payload built at the moment of
death, never inside the click handler — iOS drops transient user activation
across an `await`, which is why so many share buttons silently do nothing on
real phones. It falls back to the async clipboard, then `execCommand`, then
showing you the text to copy by hand.

---

## Running it

No build step, no dependencies, no bundler. Open `index.html`.

```sh
python3 -m http.server 8000     # for the service worker and clipboard APIs
```

Everything is vanilla ES5-flavoured JavaScript in plain `<script>` tags, so it
also runs straight off the filesystem. All audio is synthesised at runtime with
WebAudio; the only binary assets are PNG icons, and those are generated from
code by `node tools/gen-assets.js`, so the repo ships nothing it cannot rebuild.

### Layout

| File | What it does |
|---|---|
| `js/rng.js` | Seeded PRNG, daily-seed derivation. `Math.random` is banned in gameplay. |
| `js/platform.js` | Canvas/DPR sizing, adaptive resolution, storage, haptics, lifecycle |
| `js/input.js` | Dynamic sticky virtual joystick, keyboard, tap-to-dash |
| `js/audio.js` | Procedural SFX and a scheduled soundtrack that tightens as souls die |
| `js/juice.js` | Trauma screenshake, hitstop, pooled particles, cached glow sprites |
| `js/render.js` | Canvas2D renderer and the camera that closes in with the ring |
| `js/game.js` | The simulation |
| `js/share.js` | Burnline encoding, share delivery, challenge links, streaks |
| `js/main.js` | Screens, frame loop, HUD, onboarding, the reveal |

### Tools

```sh
node tools/test.js            # 51 headless assertions: determinism, ranking, share encoding
node tools/verify.js          # 34 browser checks in Chromium: win reveal, LET GO, links, perf
node tools/sim.js 200         # play 200 AI-only matches, report pacing
node tools/tune.js 140 60     # search the pacing constants against a cost function
node tools/gen-assets.js      # regenerate icons and the Open Graph card
```

`tools/verify.js` needs `npm i playwright` and a server on `:8099`.

---

## On the tuning

The constants in `js/game.js` were searched, not guessed. `tools/tune.js` runs a
randomised sweep over fuel value, respawn rate, drain coefficients, entropy and
steal efficiency, scoring each configuration on match length, the longest stretch
with no elimination, whether deaths bunch into one window, peak flame reached,
and how evenly the five bot archetypes win.

The shipped numbers give, over 200 AI-only matches:

- **~48 second matches** — a full loop including the results screen is under a minute
- **first elimination at ~19s**, and no gap longer than ~10s without one
- **a guaranteed 3.0s final burnout**, so the win always has a held moment
- **archetypes winning within a few points of each other** — no dominant strategy

Two things the harness caught that playtesting would have taken much longer to
find: the arena was spawning fuel for a lone survivor, so the finale kept getting
topped up and lasted 0.1 seconds instead of three; and the ember *quota* was
decorative, because one spawn per timer tick meant the standing stock could never
exceed what the bots ate — the arena had roughly one ember visible at a time when
it was supposed to have nine.

### A correction worth recording

Earlier drafts of this design claimed that `drain = base + k·flame` punishes
hoarding — that carrying more flame gets you killed sooner. That is false, and it
is false for any drain function of current flame: time-to-zero is the integral of
`dF/drain(F)`, which strictly increases with starting flame. More life always buys
more time; it just buys less and less of it per point.

Brightness is genuinely dangerous here, but through **predation, not arithmetic**.
A bright soul is physically bigger, every dimmer soul can rob it, and the amount
robbed scales with the gap. The copy in the game says that now, because it is what
is actually true.

---

## Accessibility

Portrait-first and one-thumb throughout; every tap target clears 44px. Settings
cover sound, haptics, screen shake, a high-contrast mode that also swaps the share
glyphs to colourblind-safe ones, and soul name labels. `prefers-reduced-motion` is
honoured by default. Every audio cue has a visual twin, so the game is fully
playable muted — which is how most people will play it.

Render resolution drops automatically if the device cannot hold frame rate; the
game is entirely fill-rate bound, so pixels are the only lever that matters and it
is invisible on a scene made of glow.
