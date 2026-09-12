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

## Integrator amendments

- `packages/client/src/game/punchHint.ts` holds the pure parts of the scene: `advanceHint` / `hintedFighter`
  (06-integration rule 4, drawn on the local fighter only, never the active pose) and `RenderClock` (wall time
  scaled by `effects.timeScale()`, catching up at 2× after the KO slowdown so the six-entry snapshot buffer never
  stays pinned to its oldest snapshot). Tested in `test/punchHint.test.ts`. (integrator amendment)
- `session.localEdge: InputFrame` and `session.playerNames: [string, string]` (defaults `THE DRIFTER` /
  `THE CONDUCTOR`, set from the LOBBY message in `main.ts`); the scene calls `hud.setNames` when they change.
  (integrator amendment)
- `window.__arena = { updateMs(), hint(), latest() }` dev hook for the headless driver: rolling `update()` cost,
  the current punch hint, the newest snapshot. (integrator amendment)
- Debug text (`?debug=1`): tick, snapshot age (render frames since the newest tick changed; the buffer does not
  expose arrival times), render-clock lag, rolling `update()` cost, RTT. RTT comes from `session.rtt`, fed by
  `WsClient.startPing` (a PING every 2 s while the socket is open, `now - t` on each PONG, EMA over 4), which
  `main.ts` starts only when `session.debug` is true; without `?debug=1` nothing is sent and the readout stays
  `n/a`. (integrator amendment; polish amendment)
- Owner screenshot gate script: `tools/e2e/arena-states.json` (server on 8087, client on 5187, captures into
  `.shots/arena/`), a full keyboard match through all three cars. Taps are 80 ms holds because the headless
  input pump samples at 16 ms and a zero-length press can fall between samples. (integrator amendment)
