# 5.03 — Metrics and gestures

## Purpose
Turn smoothed landmarks plus the baseline into named numbers, and those numbers into the six booleans with hysteresis and debounce. Pose only; the punch uses the no-hand depth rule.

## Files
Create: `packages/client/src/vision/metrics.ts`, `gestures/walk.ts`, `gestures/jump.ts`, `gestures/block.ts`, `gestures/punch.ts`, `hands.ts` (stub), `test/gestures.test.ts`.

## Depends on
5.02.

## Exposes
`metrics.ts`: `interface Metrics { lean; riseHip; riseShoulder; midX; crossed: boolean; extL; extR; depthL; depthR; atHeightL; atHeightR; thrustL; thrustR; guard: false }`, `computeMetrics(landmarks, world, baseline, ts, buffers): Metrics`.

`hands.ts`: `fistFor(arm: "L" | "R"): true | false | undefined` returning `undefined` always (reserved).

Gestures, each a class with `update(m: Metrics, ts): boolean` and `reset()`:
- `Walk` → `{ left, right }`; `Jump` → `jump`; `Block` → `block`; `Punch(arm)` → `punchL` / `punchR`.

Thresholds (starting values, all in `thresholds.ts`): `LEAN_ENTER 0.25`, `LEAN_EXIT 0.15`, walk debounce 3/3; `JUMP_RISE 0.12`, `JUMP_LAND 0.05`, `JUMP_WINDOW_MS 250`, jump debounce 1/2; `CROSS_MARGIN 0.10`, `BLOCK_TOP 0.10`, `BLOCK_WIDTH 0.80`, block debounce 3/3; `EXT_ENTER 0.55`, `EXT_EXIT 0.75`, `DEPTH_ENTER_NO_HAND 0.40`, `DEPTH_EXIT 0.15`, `AT_HEIGHT 0.60`, `THRUST_DROP 0.25`, `THRUST_WINDOW_MS 200`, `THRUST_ENABLED true`, punch debounce 2/3, `PUNCH_MIN_HOLD_MS 100`.

## Behaviour
1. `lean = (shoulderMidX - hipMidX - leanZero) / S`. `right` when lean crosses `+LEAN_ENTER` (exit `+LEAN_EXIT`), `left` mirrors negative. Mutually exclusive.
2. `riseHip = (hipY - currentHipMidY) / S`, `riseShoulder` likewise. Jump enters when both exceed `JUMP_RISE` and `min(riseHip, riseShoulder)` increased by at least `JUMP_RISE` within the last 250 ms (ring buffer); exits when either falls below `JUMP_LAND`. No minimum hold; `jump` is true exactly while airborne.
3. `crossed`: left wrist right of `midX + CROSS_MARGIN·S` and right wrist left of `midX - CROSS_MARGIN·S`, both wrists between `shoulderY - BLOCK_TOP·S` and `hipY`, both within `BLOCK_WIDTH·S` of `midX`. `block = crossed || guard` with `guard` always false until the hands plan.
4. Per arm: `ext = dist2D(wrist, shoulder) / armLen`; `depth = worldShoulder.z - worldWrist.z` (metres, positive toward camera); `atHeight = |wristY - shoulderY| < AT_HEIGHT·S`; `thrust = ext dropped by ≥ THRUST_DROP within THRUST_WINDOW_MS`. Punch enters when `ext < EXT_ENTER` and `depth > DEPTH_ENTER_NO_HAND` and `atHeight` and (`thrust` or thrust disabled) and `fistFor(arm) !== false`; exits when `ext > EXT_EXIT` or `depth < DEPTH_EXIT`; minimum hold 100 ms once entered.
5. Every gesture resets its counters and buffers when calibration is not `ready`.
6. `Metrics` computation is a pure function of its inputs plus the ring buffers passed in.

## Integrator amendments (2026-09-12, first real punch test: zero punches tracked)
- (integrator amendment) `Metrics` gains `dropL/R` (the raw-extension drop behind `thrustL/R`), `sideL/R` (the wrist's horizontal offset away from the body past its own shoulder over `armLen`; ~1 straight out, negative when crossed) and `jabRiseL/R` (largest rise of raw `side` within `JAB_WINDOW_MS`). `MetricBuffers` gains `sideL/R`.
- (integrator amendment) `computeMetrics(landmarks, world, baseline, ts, buffers, raw = landmarks)`: the thrust drop and the jab rise are measured on the RAW (unsmoothed) landmarks so the EMA cannot blunt a fast move; every level gate still reads the smoothed set.
- (integrator amendment) `Punch` gains `diag(): PunchDiag` — `{ ext, depth, drop, atHeight, extOk, depthOk, thrustOk, jabOk, active, out, side, jabRise, path }` for the last `update()`; the first ten fields are the contract shared with the game's preview lane.
- (integrator amendment) Side-jab entry behind `SIDE_JAB_ENABLED` (owner decision, start true): `jabOk = atHeight && side > JAB_EXT (0.90) && side rose by ≥ JAB_RISE (0.30) within JAB_WINDOW_MS (250)`. Enter when the thrust rule holds OR (`SIDE_JAB_ENABLED && jabOk`). A jab-entered punch exits when `side < JAB_EXIT (JAB_EXT − 0.15)`; a thrust-entered punch exits as before. Crossed arms (negative `side`), an arm swung up (off height, no sideways reach) and a slow raise (no rise) never enter; tested at gesture and pipeline level.
- (integrator amendment) First tuning pass, reasons next to each number in `thresholds.ts`: `EXT_ENTER 0.55 → 0.62`, `DEPTH_ENTER_NO_HAND 0.40 → 0.22`, `DEPTH_EXIT 0.15 → 0.08`, `THRUST_DROP 0.25 → 0.15`, `THRUST_WINDOW_MS 200 → 320`. Walk, jump and block untouched.

## Invariants
- No gesture reads raw landmark indices; only `Metrics`.
- Thresholds are imported, never inlined.

## Tests
- Synthetic metric sequences: lean 0.3 for 3 frames → right; 0.2 sustained keeps right; 0.1 → off. Rise both 0.15 within 250 ms → jump; slow rise → no jump; hip-only → no jump. Crossed geometry → block; hands on hips → no block. Punch: ext 0.4 with depth 0.5 after a fast drop → punch; slow extension → no punch; overhead → no punch; hook (ext stays 0.9) → no punch.

## Done when
- [ ] unit tests pass; harness shows every metric live with its bands
