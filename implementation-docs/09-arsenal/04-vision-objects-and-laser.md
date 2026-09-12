# 9.04 — Vision: object detection, laser gesture, keyboard keys

## Purpose
Turn a real water bottle, tennis racket (was umbrella — a closed umbrella is undetectable by COCO models, owner swap 2026-09-12), backpack, banana or phone in the player's hand into `InputFrame.item`, and the
"beam" pose (both arms thrust forward together) into `InputFrame.special`. Keyboard gets the same two controls so
the camera is still additive.

## Files
Modify: `packages/client/src/vision/worker.ts`, `src/vision/workerClient.ts`, `src/vision/landmarkers.ts`,
`src/vision/thresholds.ts`, `src/vision/classify.ts`, `src/vision/VisionInputSource.ts`, `src/app/cameraPreview.ts`,
`src/harness/panel.ts` (object ms line), `src/input/KeyboardInputSource.ts`, `packages/client/package.json` (`vision:setup`),
`packages/client/vite.config.ts` only if the detector needs another `optimizeDeps` entry.
Create: `src/vision/objects.ts`, `src/vision/gestures/laser.ts`, `test/objects.test.ts`, `test/laserGesture.test.ts`,
extend `test/keyboard.test.ts`, `test/classify.test.ts`, `test/visionPipeline.test.ts`.
Owns the whole `src/vision/` tree, `src/input/KeyboardInputSource.ts`, `src/app/cameraPreview.ts`.

## Depends on
8.01.

## Exposes
`thresholds.ts` (add, one comment each): `OBJECT_MODEL_URL = "/models/efficientdet_lite0.tflite"`, `OBJECT_EVERY_N = 3`,
`OBJECT_SCORE = 0.4`, `HOLD_RADIUS = 0.35` (in S), `HOLD_ON = 3`, `HOLD_OFF_MS = 600`, `LASER_EXT = 0.55`, `LASER_GAP = 0.5`
(in S), `LASER_DEBOUNCE_ON = 2`, `LASER_DEBOUNCE_OFF = 3`.

`landmarkers.ts`: `createObjectDetector(delegate): Promise<ObjectDetector>` — `ObjectDetector.createFromOptions` with the
same wasm paths, `runningMode: "VIDEO"`, `scoreThreshold: OBJECT_SCORE`, `categoryAllowlist: Object.values(ITEMS).map(i => i.cocoLabel)`,
`maxResults: 5`. Failure to load the detector is **not** fatal: the worker posts `ready` with `objects: false` and
pose-only play continues.

`workerClient.ts`: `interface ObjectBox { label: string; score: number; x: number; y: number; w: number; h: number }`
(image-normalised, un-mirrored like the landmarks); `ResultMessage` gains `objects: ObjectBox[] | null` (null when the
detector did not run this frame) and `objectMs: number`; `ready` gains `objects: boolean`; `WorkerStats` gains
`objectMs` and `objects: boolean`.

`worker.ts`: runs the detector on every `OBJECT_EVERY_N`th frame that has a pose, reusing the same `ImageBitmap`
before closing it.

`objects.ts`:
- `cocoToItem(label: string): ItemId | null`
- `heldItem(objects: ObjectBox[], landmarks: Landmark[], S: number): ItemId | null` — the highest-score box whose centre
  is within `HOLD_RADIUS · S` of wrist 15 or 16 **or** which contains a wrist; ties → higher score.
- `class HoldTracker { update(candidate: ItemId | null, ts: number): ItemId | null; reset(): void }` — `HOLD_ON`
  consecutive equal candidates turn the item on; the item stays while any positive arrives within `HOLD_OFF_MS`; a
  different item needs its own `HOLD_ON` run.

`gestures/laser.ts`: `class Laser { update(m: Metrics, ts): boolean; reset(): void }` — on when `extL < LASER_EXT`,
`extR < LASER_EXT`, `atHeightL && atHeightR`, wrist gap (image distance between landmarks 15 and 16 over S) `< LASER_GAP`,
debounced `LASER_DEBOUNCE_ON` / `_OFF`. Needs the wrist gap: add `wristGap: number` to `Metrics` in `metrics.ts`
(this lane owns it).

`classify.ts`: `GestureFlags` gains `special: boolean` and `item: ItemId | null`. Priority: jump cancels everything but
walk; block cancels special and punches; special cancels punches; `item` passes through.

`VisionInputSource.ts` / `processLandmarks`: when `r.objects !== null` run `heldItem` + `HoldTracker`; when null, keep the
tracker's last value (it times out by itself). `DebugFrame` gains `objects: ObjectBox[] | null` and `item: ItemId | null`;
`RecorderSample` gains `item`.

`cameraPreview.ts`: draws each object box (mirrored) with its label; the dots row gains `SP` (special) and an item glyph
(`ITEMS[item].label`) when held; `previewModel` exposes `item` and `special`.

`KeyboardInputSource.ts`: `KeyQ → special`; `Digit1..Digit5 → item` molotov, sword, shield, banana, flash while held
(key up clears only if that digit is the current item). Legend string in the lobby is 11.03's.

`package.json`: `vision:setup` also downloads
`https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite`
to `public/models/efficientdet_lite0.tflite`. Run it once as part of this lane so the model is on this machine.

## Behaviour
1. `heldItem`: a "bottle" box centred on the left wrist → `molotov`; the same box 0.6 S away from both wrists → null; a
   box containing a wrist but centred far away → the item.
2. `HoldTracker`: candidates `[molotov, molotov, null, molotov]` → null, null, null, null (the null broke the run);
   `[molotov ×3]` → on at the third; then `null` for 500 ms keeps it, 700 ms drops it.
3. `Laser` gesture: metrics with both `ext` 0.4, both at height, gap 0.3 → on after 2 frames; one arm at `ext` 0.9 → off
   after 3 frames; a single-arm punch pose never sets it.
4. `classify`: `{special, punchL}` → `special` only; `{block, special}` → `block` only; `{jump, special}` → `jump` only.
5. Keyboard: holding `1` samples `item: "molotov"`; releasing → null; holding `1` then `3` → `shield`; releasing `1`
   while `3` is held keeps `shield`.
6. Pipeline: a synthetic result with a pose and a bottle box near the wrist for three consecutive results yields
   `frame.item === "molotov"`; a result with `objects: null` in between does not reset it.
7. Worker: with the detector failed to load, `ready.objects === false` and results carry `objects: null` forever;
   the harness panel shows "objects: off".
8. Recorder samples and the preview model carry `item` and `special`.

## Invariants
- Main thread never imports `@mediapipe/tasks-vision` (still only `landmarkers.ts`, worker-side).
- Object detection never blocks a pose result: the pose result for a frame is posted even if the detector throws
  (catch, log once, mark `objects: null`).
- A missing detector model never prevents calibration or play.

## Tests
`objects.test.ts` (1, 2), `laserGesture.test.ts` (3), `classify.test.ts` (4), `keyboard.test.ts` (5),
`visionPipeline.test.ts` (6, 8), `workerClient.test.ts` (7 with a fake worker).

## Done when
- [ ] tests pass, `pnpm test` and `pnpm typecheck` green
- [ ] `pnpm --filter @midnight/client vision:setup` run; `public/models/efficientdet_lite0.tflite` present (gitignored)
- [ ] headless check with the fake camera: `harness.html` loads, panel shows `objects: on` or `off` without errors
- [ ] committed on `feat/vision` with prefix `vision:`
