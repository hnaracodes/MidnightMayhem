# 4.07 — Arena scene assembly (OWNER SCREENSHOT GATE)

## Purpose
Replace the placeholder scene from 3.06 with the real one: stage, rigs, HUD, effects, debug overlay, reading the same `session`.

## Files
Modify: `packages/client/src/game/ArenaScene.ts`.

## Depends on
4.02, 4.04, 4.05, 4.06.

## Exposes
- `class ArenaScene` unchanged interface (`create`, `update`).

## Behaviour
1. `create`: `createBackgrounds`, one shadow Graphics (depth 1), two rig Graphics (depth 2, 3), a debug Graphics (depth 9), `Hud`, `Effects`.
2. `update(time, delta)`: scroll backgrounds; `sample(performance.now())` (or the KO-slowed clock); on `trainCar` change call `applyTrainCar`; drain `session.events` into `effects.consume`; for each fighter build its `Clock` (renderMs, koFrames, landFrames, win), `computePose(effects.frozen(i) ?? fighter, clock)`, clear and redraw with `drawFighter` using `effects.fillFor(i)`, `squashFor(i)`, `rim` per car (`amber-1` always; tunnel uses amber on both edges), `windSpeed = layers.roofSpeed`; draw shadow; if `session.debug` draw hurtboxes in `moon` and the active hitbox in `danger`; `effects.update`; `hud.update`.
3. Fighter draw order: player 1 is always drawn above player 0 (fixed depths 2 and 3).
4. Frame budget: the whole `update` under 4 ms on the demo laptops (check with the Performance tab once).

## Invariants
- The scene never imports from `net/` except `session`.

## Tests
- Owner gate: one screenshot per state (idle, walk, jump with ghosts, punch active, block, hit, ko, offbounds) and per train car, reviewed against the checklist in `design/00`; a keyboard match feels responsive (punch visibly starts within ~50 ms of the key).

## Done when
- [ ] owner approves the screenshot set
