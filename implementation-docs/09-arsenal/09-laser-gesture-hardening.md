# 9.09 — Laser gesture hardening (special vs block vs punch)

Owner feedback (2026-09-12, LAN test): "pose detection for the special attack isn't very good — it intersects with
block and punch." Today the laser fires when both arms are extended toward the camera at shoulder height with the
wrists close together (`gestures/laser.ts`, 9.04). Crossed arms (block) and a two-handed reach both satisfy that.
This file replaces the rule with a gated, exclusive one. Lane owner: whoever holds `src/vision/gestures/**`.

## Files
Modify: `packages/client/src/vision/gestures/laser.ts`, `src/vision/metrics.ts` (two new metrics), `src/vision/thresholds.ts`,
`src/vision/classify.ts` (exclusivity window), `src/vision/VisionInputSource.ts` (diag), `src/app/cameraPreview.ts` and
`src/harness/panel.ts` (laser gate row), `test/laserGesture.test.ts`, `test/classify.test.ts`, `test/visionPipeline.test.ts`.

## Exposes
`thresholds.ts` (replace the 9.04 laser block):
- `LASER_EXT = 0.6` — both arms' `ext` below this (pointing at the camera)
- `LASER_DEPTH = 0.22` — both wrists at least this far (m) ahead of the shoulders (`depthL`, `depthR`); crossed arms at the chest measure < 0.1
- `LASER_GAP = 0.45` — wrist-to-wrist image distance over S
- `LASER_MID = 0.35` — both wrists within this of the shoulder midline (in S); two separate punches are wider
- `LASER_THRUST_WINDOW_MS = 350` — both arms must have *thrust* (their `drop ≥ THRUST_DROP`) within this window of each other
- `LASER_ON = 3`, `LASER_OFF = 4` — debounce frames
- `LASER_HOLD_MS = 250` — the pose must be held this long after the double thrust before `special` turns on (a passing swing does not fire)
- `LASER_EXCLUSIVE_MS = 500` — once `special` turns on, `punchL`/`punchR` are suppressed for this long; while `block` has been on for ≥ 2 frames, `special` cannot start
- `LASER_REST_MS = 600` — after `special` turns off, it cannot restart until the arms have left the pose (`ext` above `LASER_EXT + 0.15`) for this long (no auto-repeat from resting hands)

`metrics.ts`: `wristGap` (exists), plus `midL`, `midR` (|xm(wrist) − midX| / S) and `lastThrustTsL/R` (ts of the last
frame `dropL/R ≥ THRUST_DROP`; kept in `MetricBuffers`).

`gestures/laser.ts`: `class Laser { update(m: Metrics, ts, blockOn: boolean): boolean; diag(): LaserDiag; reset() }` with
`LaserDiag = { ext: boolean; depth: boolean; gap: boolean; mid: boolean; thrust: boolean; held: boolean; blocked: boolean; rest: boolean }`.

`classify.ts`: takes `{ ..., specialSince: number | null, ts }` — when `special` is on and `ts − specialSince < LASER_EXCLUSIVE_MS`,
`punchL = punchR = false`. Block still cancels special (crossed arms win).

## Behaviour
1. **Rest pose** (hands clasped at chest, arms bent: `ext 0.5`, `depth 0.05`) → never `special` (depth gate).
2. **Crossed arms** (block metrics: `crossed = true`, `depth 0.08`) → `block`, never `special`, and while block is on,
   a subsequent double thrust within the same 2 frames does not start a laser.
3. **Single punch** (one arm `ext 0.3, depth 0.35`, other hanging `ext 0.95`) → `punchX` only.
4. **Two staggered punches** 600 ms apart, wrists 0.9 S apart → two punches, no `special` (gap + mid + thrust window all fail).
5. **Double thrust** (both arms drop ≥ `THRUST_DROP` within 200 ms, then both `ext 0.35, depth 0.3`, gap 0.2, mid 0.15, held
   ≥ 250 ms) → `special` on after `LASER_ON` frames past the hold; `punchL/R` suppressed for 500 ms even though each arm
   individually passed the punch gates.
6. **Passing swing** (the same pose but held only 120 ms) → no `special`.
7. **Release**: arms drop (`ext 0.9`) → `special` off after `LASER_OFF` frames; re-entering the pose within 600 ms
   without the arms having left it does not restart (`rest` gate); after 600 ms away it does.
8. `diag()` reports every gate; the preview and harness show a `laser` gate row (`ext depth gap mid thrust hold`)
   beside the punch rows, green/red like the punch gates.
9. Recorder samples include `laser: LaserDiag`.

## Invariants
- `special` and `block` are never both true in one frame; `special` and a punch are never both true in one frame.
- No gate reads the smoothed landmarks for velocity (thrust uses the raw ring buffers, as the punch does).

## Tests
`laserGesture.test.ts` rules 1–7 with synthetic `Metrics` sequences at 30 fps; `classify.test.ts` exclusivity;
`visionPipeline.test.ts` rule 8–9 through `processLandmarks`.

## Owner check (harness)
10 of 10 double thrusts fire the laser at 1 m and 2 m; 0 of 10 crossed-arm blocks fire it; 0 of 10 single punches
fire it; hands resting together for 10 s never fire it.
