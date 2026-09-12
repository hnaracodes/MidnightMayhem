# 5.05 — Harness page (OWNER GATE)

## Purpose
The page the owner uses to tune thresholds by watching numbers: mirrored camera with skeleton overlay, live metrics with their bands, six input indicators, calibration state, performance readout, and a three-detections checklist.

## Files
Create: `packages/client/harness.html`, `src/harness/main.ts`, `overlay.ts`, `panel.ts`, `checklist.ts`.

## Depends on
5.04.

## Exposes
- URL `/harness.html`.

## Behaviour
1. Layout left to right: mirrored video with a canvas overlay; live panel; checklist. Calibrate button under the video; calibration prompt and progress bar over the video while calibrating; error banner on top.
2. Overlay: smoothed skeleton in pose colour, wrists/shoulders/hips/nose marked; wrist markers turn red while crossed or punching.
3. Panel: FPS (frames processed), pose ms, delegate, dropped frames, calibration phase and captured values, the six indicators, and each metric with its enter/exit bands drawn as small gauges: `lean`, `riseHip`, `riseShoulder`, `extL/R`, `depthL/R`, `thrustL/R`, `crossed`.
4. Checklist: six rows, checkbox ticks after three separate detections (a new occasion after 500 ms false); reset button.
5. Everything comes from `VisionInputSource.onDebug` and `sample()`; the harness has no vision logic.

## Invariants
- Harness and game import the same `VisionInputSource`.

## Tests
- Owner gate (Controls doc phases 1–3 gates, pose-only punch): calibration reaches ready in ~1.5 s and resets on fidget; lean gauge stays inside the dead zone for 30 s standing still; lean right/left lights within a few frames without flicker; foot shuffles do not trigger walk; 5/5 hops with no landing double-trigger, slow rise onto toes never jumps; 5/5 crossed-arm blocks, hands-on-hips never blocks; jump suppresses block; 10 straight punches per arm at 1.5 m with at most 2 misses and zero cross-arm misfires; slow push never punches; overhead never punches; hook never punches. Repeat the punch test at 1 m and 2.5 m and note results.

## Done when
- [ ] owner reports the gate results; thresholds adjusted in `thresholds.ts` only
