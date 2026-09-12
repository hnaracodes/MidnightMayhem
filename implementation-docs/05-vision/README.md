# Phase 5 — Vision (`packages/client/src/vision`)

TypeScript port of `HackCMU 2026/controls/phases/CLAUDE.md`, pose only. Output is a `VisionInputSource implements InputSource` that the game merges with the keyboard. Verified on a harness page before it touches the game. Hands are deferred to `docs/superpowers/plans/2026-09-12-hands-stretch.md`; `hands.ts` is a stub so that plan slots in without restructuring.

| # | Feature | File |
|---|---|---|
| 01 | Thresholds, camera, worker, worker client | `01-camera-and-worker.md` |
| 02 | Filters and calibration | `02-filters-and-calibration.md` |
| 03 | Metrics and gestures | `03-metrics-and-gestures.md` |
| 04 | Classify and VisionInputSource | `04-vision-input-source.md` |
| 05 | Harness page | `05-harness.md` |

Module layout:
```
packages/client/src/vision/
  thresholds.ts      01 — every tunable number and colour, one comment each
  camera.ts          01
  landmarkers.ts     01 — PoseLandmarker creation; hand stub
  worker.ts          01 — Web Worker entry
  workerClient.ts    01 — main-thread one-in-flight sender
  filters.ts         02 — ema, Hysteresis, Debounce, RingBuffer
  calibration.ts     02
  metrics.ts         03
  gestures/{walk,jump,block,punch}.ts   03
  hands.ts           03 — stub: fistFor(arm) => undefined
  classify.ts        04
  VisionInputSource.ts   04
packages/client/src/harness/{main,overlay,panel,checklist}.ts   05
packages/client/harness.html
```

Pipeline per camera frame: `requestVideoFrameCallback` → if worker idle, `createImageBitmap` + transfer → worker `detectForVideo` → post landmarks → main thread EMA → calibration update → metrics → gestures → classify → frozen `InputFrame`. Frames arriving while the worker is busy are dropped, never queued.

Coordinate conventions (from the Controls doc): mirrored x `xm = 1 - landmark.x`; the player's physical left is screen-left; all image distances divided by calibrated shoulder width `S`; `worldLandmarks` z (metres) for depth; image z unused. Landmark indices: 0 nose, 2/5 eyes, 11/12 shoulders, 13/14 elbows, 15/16 wrists, 23/24 hips.
