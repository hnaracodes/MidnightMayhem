# 5.02 — Filters and calibration

## Purpose
Smoothing and debounce helpers used by every gesture, and the explicit prompted calibration that captures the player's resting baseline.

## Files
Create: `packages/client/src/vision/filters.ts`, `calibration.ts`, `test/filters.test.ts`, `test/calibration.test.ts`.

## Depends on
5.01 (types only).

## Exposes
`filters.ts`: `emaLandmarks(prev, next, alpha)`, `class Hysteresis { constructor(enter, exit); update(value): boolean }`, `class Debounce { constructor(onFrames, offFrames); update(raw): boolean }`, `class RingBuffer<T> { constructor(maxAgeMs); push(t, v); oldestWithin(ms); maxDropWithin(ms) }`.

`calibration.ts`: `type CalibrationPhase = "idle" | "calibrating" | "ready" | "lost"`, `interface Baseline { S; leanZero; hipY; shoulderY; noseY; eyeY; armLen }`, `class Calibration { state(): { phase, progress }; baseline: Baseline | null; begin(): Promise<void>; update(landmarks | null, ts): void }`.

Thresholds: `CALIBRATION_MS 1500`, `STABLE_MOVE 0.02`, `RELOST_MS 1000`, `MIN_VIS 0.5`.

## Behaviour
1. EMA per landmark coordinate with `EMA_ALPHA` (higher = less lag).
2. Hysteresis: on when `value > enter`, stays on until `value < exit`.
3. Debounce: output switches on after `onFrames` consecutive true raws, off after `offFrames` consecutive false.
4. Calibration stable frame: landmarks 0, 11, 12, 15, 16, 23, 24 visible above 0.5; shoulder midpoint moved less than 0.02 since the last frame; both wrists below the hips. A window of 1500 ms of consecutive stable frames completes; any unstable frame resets progress to 0.
5. Captured medians over the window: `S = |xm11 - xm12|`, `leanZero = shoulderMidX - hipMidX`, `hipY`, `shoulderY`, `noseY`, `eyeY`, `armLen = mean(dist(P15,P11), dist(P16,P12))`.
6. Lost: pose absent or calibration landmarks below 0.5 for more than 1000 ms → `lost`, baseline discarded. On return the layer automatically re-runs calibration (`lost → calibrating → ready`) with no host call. Shorter gaps keep the baseline.
7. `begin()` may be called at any time (the Calibrate button) and resolves when `ready`.

## Invariants
- No gesture reads landmarks when phase is not `ready`.

## Tests
- Hysteresis and Debounce truth tables.
- Calibration with synthetic landmark sequences: completes after 1500 ms of stable frames; a fidget resets progress; absence over 1000 ms → lost; return → calibrating again.

## Done when
- [ ] unit tests pass; harness shows the prompt, progress bar, captured values, and lost state
