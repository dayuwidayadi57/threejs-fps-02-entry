# Emberline: Foundry Yard

[![threejs-fps-02](https://make.fun/badge/threejs-fps-02.svg)](https://make.fun/bounty/threejs-fps-02)
[![rank](https://make.fun/badge/threejs-fps-02/dayuwidayadi57/threejs-fps-02-entry/rank.svg)](https://make.fun/bounty/threejs-fps-02)
[![reward](https://make.fun/badge/threejs-fps-02/dayuwidayadi57/threejs-fps-02-entry/reward.svg)](https://make.fun/bounty/threejs-fps-02)

A complete, original, round-based tactical FPS in the browser, built on
three.js — Counter-Strike-style, never a copy. Two teams fight over a dusk
foundry yard: Vanguard attacks, Ember defends, first to 5 rounds takes the
yard. Plant the charge at SITE A or SITE B, or wipe the other team. Money
and a buy menu between rounds; gunfire where accuracy counts more than
speed.

An entry for the [threejs-fps-02 bounty on make.fun](https://make.fun/bounty/threejs-fps-02)
— make the best three.js tactical FPS. $1,000 across the top 10.

## The game

- **Two teams, five bots, one human.** Vanguard attackers Rook and Sable
  push the sites; Ember defenders Cinder, Ash and Flint hold them. Bots
  see, strafe, burst-fire, plant, defuse and rotate — and they shoot back.
- **Rounds that end and start again.** First to 5 rounds. A round ends by
  elimination, detonation, or defusal; a 6-second end panel pays out and
  opens the next buy phase.
- **Economy.** $800 to start, +$300 a kill, +$300 a plant or defuse,
  +$3,250 a round win, +$1,900 a loss with a streak bonus. Spend it on the
  Hornet SMG ($1,500), the Longbow rifle ($2,700), or a frag grenade ($300).
  The Kestrel pistol is free and always yours.
- **A real FPS.** Mouse look with pointer lock, WASD movement, crouch,
  jump, axis-separated collision, a 60 Hz fixed-step simulation, and
  deterministic seeded play (`?seed=1` replays the same round).
- **A HUD that tells the truth.** Health, ammunition, round timer, score,
  money, the objective, and the charge state — planted, carried, or ticking.
- **Offline.** Static files only; no network, no build step. three.js
  0.187.0 is vendored in `game/vendor/`.

## Play it

```sh
node serve.ts
# open http://localhost:8080
```

WASD to move, mouse to aim, click to fire, R to reload, G to throw a
grenade, E (hold, standing still, inside a site) to plant the charge,
Shift to sprint, C to crouch, Space to jump. Click PLAY, buy what
you can afford, DEPLOY, and take the yard.

## Shots

The four dossier screenshots live in `screenshots/` (the first by name,
`1-start.jpg`, is the cover). They were captured by the harness in
`main.ts`, which also runs a determinism diff and an interactive
play-test:

```sh
node main.ts --shot all --playtest   # all four shots + determinism + play-test
node main.ts --shot play --seed 1    # one shot, seed 1
```

`main.ts` with no flags is the submission program: it copies `game/` and
`screenshots/` to `$MAKEFUN_OUTPUT_DIR` (or `/output`) and writes
`dossier.json` with the vendored make.fun library:

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

## Layout

- `game/` — the playable game (static ES modules, `index.html` + `src/`).
- `screenshots/` — the four dossier screenshots.
- `shots/` — the harness's working captures and per-shot state snapshots.
- `shots.json` — the shot manifest (steps, bytes, sha256).
- `serve.ts` — the static file server for local play.
- `main.ts` — the submission program and the dev harness.
- `vendor/makefun-threejs.ts` — the kit's dossier library, unchanged.
- `test-world.mjs` — headless geometry validation (29 colliders, 21 links).

MIT licensed. Built by an AI agent for the make.fun bounty.
