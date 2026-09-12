# 9.07 — Second detector track: YOLO via onnxruntime-web, and a head-to-head benchmark

## Purpose
Owner directive (2026-09-12): "try both MediaPipe and YOLO to evaluate overall efficiency, two tracks for testing
and validation; I do want to use YOLO if we can because of accuracy." This feature adds a YOLO backend behind the
same object-detection interface 9.04 built, a switch to pick either at runtime, and a benchmark page that measures
both on the same frames so the choice is made on numbers, not taste. Runs **after 9.04 has merged**.

## Files
Modify: `packages/client/src/vision/worker.ts`, `src/vision/workerClient.ts` (backend field in `ready`/stats),
`src/vision/landmarkers.ts` (backend factory), `src/vision/thresholds.ts`, `src/input/selectSource.ts` (or a new
`src/vision/selectDetector.ts`), `src/harness/panel.ts`, `packages/client/package.json` (dependency + `vision:setup`),
`packages/client/vite.config.ts` (onnxruntime wasm assets), `implementation-docs/STATUS.md` (benchmark result).
Create: `src/vision/backends/ObjectBackend.ts` (interface), `src/vision/backends/mediapipe.ts` (wraps 9.04's detector),
`src/vision/backends/yolo.ts`, `src/vision/backends/nms.ts` (pure; tested), `packages/client/bench.html`,
`src/bench/main.ts`, `src/bench/fixtures.ts`, `test/nms.test.ts`, `test/backends.test.ts`,
`docs/superpowers/specs/2026-09-12-detector-benchmark.md` (the result).
Owns `src/vision/**`, `src/bench/**`, `bench.html`, `harness/panel.ts`.

## Depends on
9.04 merged on `main`. 11.05 merged (so the game runs end to end with a detector switch).

## Exposes
`backends/ObjectBackend.ts`:
```ts
type DetectorId = "mediapipe" | "yolo";
interface ObjectBackend {
  readonly id: DetectorId;
  /** Resolves when the model is loaded; rejects with VisionInputError("model-load") otherwise. */
  init(delegate: "GPU" | "CPU"): Promise<void>;
  /** Same ObjectBox contract as 9.04: image-normalised, un-mirrored, filtered to the five COCO labels. */
  detect(bitmap: ImageBitmap, ts: number): ObjectBox[];
  /** Inference time of the last detect(), ms. */
  readonly lastMs: number;
  dispose(): void;
}
```
`backends/mediapipe.ts`: `createMediapipeBackend()` — moves 9.04's `createObjectDetector` call behind the interface.
`backends/yolo.ts`: `createYoloBackend(opts: { modelUrl: string; inputSize: 640 | 416 | 320 })` on `onnxruntime-web`
(`ort.InferenceSession`, execution providers `["webgpu", "wasm"]` with fallback), letterbox preprocessing into a
`Float32Array` NCHW tensor via an `OffscreenCanvas`, output decoding for the Ultralytics YOLOv8/YOLO11 layout
`[1, 84, N]` (4 box + 80 class scores), class filter to the five labels **before** NMS, then `nms.ts`.
`backends/nms.ts`: `nms(boxes: Candidate[], iou: number): Candidate[]`, `iou(a, b): number`, `letterbox(w, h, size)`
→ `{ scale, dx, dy }` and `unletterbox(box, lb)`; pure, no DOM.
`thresholds.ts`: `DETECTOR_DEFAULT: DetectorId = "mediapipe"` (flipped by the benchmark verdict if YOLO wins),
`YOLO_MODEL_URL = "/models/yolo.onnx"`, `YOLO_INPUT = 320`, `YOLO_SCORE = 0.35`, `YOLO_IOU = 0.5`, `YOLO_EVERY_N = 4`.
Detector choice: `?detector=yolo|mediapipe` URL param → `session`, passed to the worker in `init`; the lobby camera
button label shows which one is active; the worker's `ready` message carries `backend: DetectorId`.
`package.json` `vision:setup`: downloads the YOLO ONNX model into `public/models/yolo.onnx`. Model source, in order
of preference: (1) `https://huggingface.co/onnx-community/yolov10n/resolve/main/onnx/model.onnx` (COCO, NMS-free;
if this layout is used, decode `[1, 300, 6]` = xyxy, score, class instead and skip NMS), (2) any Ultralytics
YOLOv8n/YOLO11n ONNX export reachable without credentials, (3) export locally with `pip install ultralytics && yolo
export model=yolov8n.pt format=onnx imgsz=320` if Python is available. Record which one shipped in the benchmark doc.
`vite.config.ts`: serve `onnxruntime-web`'s `.wasm`/`.mjs` files (copy via `?url` imports like the MediaPipe wasm, or
`optimizeDeps.exclude` + `assetsInclude`) so it works under `vite dev` and under the server serving `dist/`. The COOP/COEP
headers already set enable threads.

`bench.html` / `src/bench/main.ts`: loads both backends in the main thread (bench only; the game keeps the worker),
runs each over the same frame set and reports per backend: model load ms, median / p90 inference ms, effective fps
at the game's `EVERY_N`, detections per frame, per-label hit rate on the fixtures, and CPU vs GPU/WebGPU. Frame
sets: (a) the fake camera pattern (sanity, expected zero detections), (b) `src/bench/fixtures.ts`: a procedurally
drawn set of 40 frames — simple coloured silhouettes of a bottle, umbrella, backpack, banana and phone on a dark
background at three sizes (this is a smoke set, not ground truth; the doc says so), (c) an optional real set: any
`.png`/`.jpg` files the owner drops into `public/bench/` (gitignored) with the label in the filename, e.g.
`bottle-01.jpg`. Results render as a table and are copied to the clipboard as JSON (`window.__bench.results`).

## Behaviour
1. `?detector=yolo` runs the game with YOLO in the worker; `?detector=mediapipe` (and the default) with MediaPipe; a
   YOLO load failure (missing model, no wasm) falls back to MediaPipe with one console warning and the harness shows
   `objects: mediapipe (yolo failed)`; both failing → `objects: off`, pose play continues.
2. `nms`: two boxes with IoU 0.6 keep the higher score; IoU 0.3 keep both; `letterbox`/`unletterbox` round-trip a box
   within 0.5 px for 640×480 → 320.
3. YOLO output decoding on a synthetic `[1, 84, 3]` tensor yields the expected two boxes after class filtering and
   NMS; the yolov10 `[1, 300, 6]` layout decodes without NMS.
4. Both backends produce `ObjectBox` in the same coordinate convention (assert on a synthetic frame that the
   mediapipe wrapper and the yolo decoder agree on a hand-placed box within 2 %).
5. The bench page runs to completion headless (`tools/shot.mjs --url http://localhost:5181/bench.html --wait 20000`)
   with zero page errors and writes the JSON to the console; the agent pastes the numbers into
   `docs/superpowers/specs/2026-09-12-detector-benchmark.md` with a verdict and flips `DETECTOR_DEFAULT` **only** if
   YOLO meets all of: median inference ≤ 45 ms on CPU/wasm or ≤ 20 ms on WebGPU on this machine, higher hit rate on
   the fixture set than MediaPipe, and no page errors in a full headless 2-player match with `?detector=yolo`.
   Otherwise MediaPipe stays the default and the doc says exactly which bar YOLO missed; YOLO remains selectable.
6. `pnpm build` output serves both backends from `dist/` (the server-hosted path, not only `vite dev`).
7. Worker protocol: `init` carries `{ detector: DetectorId }`; a result carries `backend` so the preview can show it.

## Invariants
- Main thread still never imports `@mediapipe/tasks-vision`; `onnxruntime-web` is imported only in
  `backends/yolo.ts` (worker) and `src/bench/**` (bench page).
- Detection never blocks a pose result; a backend that throws is disabled for the session after 3 consecutive throws.
- Keyboard and pose play are unaffected by either backend's absence.
- Bundle: the YOLO runtime is lazy-loaded (`import()`) so a MediaPipe session never downloads it.

## Tests
`nms.test.ts` (rule 2), `backends.test.ts` (rules 3, 4, 7 with fake sessions), `workerClient.test.ts` extension
(rule 1 fallback states). Headless: rule 5, rule 6, plus `harness.html` with `?detector=yolo`.

## Done when
- [ ] tests pass, `pnpm test`, `pnpm typecheck`, `pnpm build` green
- [ ] `vision:setup` run; `public/models/yolo.onnx` present (gitignored) and its provenance in the doc
- [ ] benchmark doc written with real numbers from this machine and a clear verdict; `STATUS.md` links it and
  lists the owner's remaining check: hold the five real objects up under each detector (`?detector=`) and compare
- [ ] committed on `feat/yolo` with prefix `vision:`, merged to `main` by the integrator
