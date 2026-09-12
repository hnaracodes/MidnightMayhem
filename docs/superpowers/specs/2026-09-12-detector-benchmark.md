# Detector benchmark: MediaPipe EfficientDet-Lite0 vs YOLO (yolov10n on onnxruntime-web)

Feature `implementation-docs/09-arsenal/07-yolo-track.md`, rule 5. Decision 34 in `DECISIONS_CHANGED.md`.
Measured 2026-09-12 on the integrator's laptop, headless, by `node tools/shot.mjs` driving `bench.html`.

## Verdict

**MediaPipe stays the default** (`DETECTOR_DEFAULT = "mediapipe"` in `packages/client/src/vision/thresholds.ts`).
YOLO remains selectable with `?detector=yolo` on the game and the harness.

Rule 5 asks for all three bars on the wasm/CPU figures:

| bar | YOLO (wasm / CPU) | result |
|---|---|---|
| median inference ≤ 45 ms on CPU/wasm | 42.1 ms median (p90 45.6, mean 42.7) | **met** (by 3 ms; the p90 sits on the line) |
| higher hit rate on the fixture set than MediaPipe | YOLO 0/40, MediaPipe 8/40 | **missed** |
| zero page errors in a full headless 2-player match with `?detector=yolo` | 0 page errors, both pages | **met** |

The bar YOLO missed is the fixture hit rate. That set is 40 procedurally drawn silhouettes (a smoke set, not
ground truth, see below); EfficientDet fires on the cartoon banana and phone, yolov10n fires on none of them. On
the 20 real photos the order flips: **YOLO 9/20 vs MediaPipe 7/20 (CPU) / 8/20 (GPU)**. Per label on the real set
(YOLO / MediaPipe CPU): bottle 2/4 / 1/4, tennis racket 3/4 / 3/4, backpack 0/4 / 0/4, banana 2/4 / 2/4, cell phone
2/4 / 1/4 (three of the four banana photos are bunches or a fruit salad; both miss every backpack). So the rule-5
bar is the fixture set and YOLO fails it, but the number that matters for the owner's directive ("I do want to use
YOLO if we can because of accuracy") is the real-object gate in STATUS.md: hold the five real objects up under
`?detector=mediapipe` and `?detector=yolo` and compare. If YOLO wins that, flip `DETECTOR_DEFAULT` and note it in
decision 34; the code needs no other change. On WebGPU (real GPU, see caveat) YOLO runs at ~10 ms median, four
times faster than MediaPipe's GPU delegate, which is the case to make on the demo laptops if they have WebGPU.

## Numbers (vite dev, headless/swiftshader)

Chrome 152.0.7977.83 headless via Playwright, `--ignore-gpu-blocklist --enable-unsafe-swiftshader`, fake camera
device. Apple M5 Pro, 18 cores, 24 GB, macOS 26.5.1, Node 22.23.2. `@mediapipe/tasks-vision` 0.10.35,
`onnxruntime-web` 1.29.0 (wasm: SIMD + 4 threads; webgpu: JSEP build). Frame set: 10 fake-camera frames,
40 fixtures, 20 real photos (70 frames per run, after 2 warm-up frames). The "GPU" rows are labelled
**headless/swiftshader**: headless Chrome's WebGL runs on the software rasteriser, and the WebGPU adapter it picked
is not verifiable from the page, so per the plan the rule-5 bars are applied to the wasm/CPU rows only. Game
cadence = 30 pose fps / `EVERY_N` (`OBJECT_EVERY_N 3` for MediaPipe, `YOLO_EVERY_N 4` for YOLO); effective fps
= min(inference fps, game cadence).

| backend | delegate | provider | load ms | median ms | p90 ms | mean ms | inference fps | game cadence | effective fps | det / frame | fixtures hit | real hit | camera det |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| mediapipe | CPU | CPU | 134 | 41.5 | 65.3 | 47.0 | 24.1 | 10.0 (1/3) | 10.0 | 0.30 | 8/40 | 7/20 | 0 |
| mediapipe | GPU | GPU | 53 | 26.3 | 28.0 | 26.6 | 38.1 | 10.0 (1/3) | 10.0 | 0.31 | 8/40 | 8/20 | 0 |
| yolo | CPU | wasm | 295 | 42.1 | 45.6 | 42.7 | 23.7 | 7.5 (1/4) | 7.5 | 0.21 | 0/40 | 9/20 | 0 |
| yolo | GPU | webgpu | 84 | 10.1 | 13.7 | 10.9 | 99.1 | 7.5 (1/4) | 7.5 | 0.21 | 0/40 | 9/20 | 0 |

Per label (hits / labelled frames, fixtures + real):

| run | bottle | tennis racket | backpack | banana | cell phone |
|---|---|---|---|---|---|
| mediapipe / CPU | 1/12 | 3/12 | 0/12 | 8/12 | 3/12 |
| mediapipe / GPU | 1/12 | 3/12 | 1/12 | 8/12 | 3/12 |
| yolo / CPU | 2/12 | 3/12 | 0/12 | 2/12 | 2/12 |
| yolo / GPU | 2/12 | 3/12 | 0/12 | 2/12 | 2/12 |

Same page served from `packages/client/dist/` by `packages/server` (`pnpm build`, `PORT=8083 pnpm --filter
@midnight/server start`, rule 6), zero page errors:

| backend | delegate | provider | load ms | median ms | p90 ms | mean ms | inference fps | game cadence | effective fps | det / frame | fixtures hit | real hit | camera det |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| mediapipe | CPU | CPU | 95 | 41.8 | 66.8 | 47.3 | 23.9 | 10.0 (1/3) | 10.0 | 0.30 | 8/40 | 7/20 | 0 |
| mediapipe | GPU | GPU | 46 | 26.8 | 28.1 | 27.0 | 37.3 | 10.0 (1/3) | 10.0 | 0.31 | 8/40 | 8/20 | 0 |
| yolo | CPU | wasm | 249 | 43.6 | 44.6 | 43.8 | 23.0 | 7.5 (1/4) | 7.5 | 0.21 | 0/40 | 9/20 | 0 |
| yolo | GPU | webgpu | 83 | 11.6 | 12.3 | 11.7 | 86.1 | 7.5 (1/4) | 7.5 | 0.21 | 0/40 | 9/20 | 0 |

Raw JSON for both runs is what `window.__bench.results` held; the dev run is the one quoted above.

## Frame sets

- **Camera** (10 frames): headless Chrome's fake device pattern (a rotating green pie on green). Expected zero
  detections; both detectors report zero.
- **Fixtures** (40 frames): `src/bench/fixtures.ts`, five coloured silhouettes (bottle, tennis racket, backpack,
  banana, phone) at three sizes over eight positions on a dark room. A smoke set for timing and coordinate
  sanity. Neither detector was trained on cartoons; a hit here is not evidence about real objects and a miss is
  not evidence against them.
- **Real** (20 frames): photos in `packages/client/public/bench/` (gitignored), four per label, fetched as 640 px
  thumbnails from Wikimedia Commons by filename search (`provenance.txt` beside them lists the source file per
  image). Not held-in-hand-at-2-m webcam frames; the owner can drop their own `<label>-NN.jpg|png` in the same
  folder and re-run. The tennis racket photos are staged studio shots; three of the banana photos are bunches.

## Model provenance

- **Shipped**: `packages/client/public/models/yolo.onnx` = yolov10n, COCO-80, fp32, fixed `[1, 3, 640, 640]`
  input, NMS-free `[1, 300, 6]` output (x1, y1, x2, y2, score, class). Source (1) in the feature file:
  `https://huggingface.co/onnx-community/yolov10n/resolve/main/onnx/model.onnx`, repo commit
  `57657320425ee34056408a57ad9d29c4d4815bd8`, 9,386,116 bytes, sha256
  `a77dd863933f184a19e84361c64b788228a7c7dacc2c78939239a96ad3efca3b`. Downloaded by `vision:setup`.
  Verified: protobuf header (ir_version 7, producer pytorch 2.3), `ort.InferenceSession.create` in Node, and raw
  output on Ultralytics' `bus.jpg` (bus 0.94, three persons ≥ 0.83 at the right places).
- Sources (2): `onnx-community/yolov8n`, `onnx-community/yolo11n`, `Xenova/yolov8n` all answer 401 without
  credentials. Source (3) not attempted: source (1) worked, and `ultralytics` is not installed.
- Consequence: `YOLO_INPUT` is **640**, not the plan's 320, because this export has a fixed input shape (a 320
  tensor is rejected). `createYoloBackend` still takes `inputSize: 640 | 416 | 320` for a dynamic-shape export.
  A 320 export would roughly quarter the wasm time; if the owner wants it, `yolo export model=yolov10n.pt
  format=onnx imgsz=320` and drop it in as `yolo.onnx`.

## Caveats

- WebGPU numbers: onnxruntime-web logged "some nodes were not assigned to the preferred execution provider"
  (shape ops on CPU, normal). The ~10 ms median is far below what SwiftShader could do, so headless Chrome most
  likely handed WebGPU the real Metal adapter; still labelled headless because that cannot be confirmed from the page.
- MediaPipe CPU p90 (65 ms) is XNNPACK warming up its thread pool on the first real photos; the median is stable.
- Both detectors ran in the bench's main thread; in the game each runs in the pose worker, one frame in flight,
  after the pose on that frame, so inference time adds to that frame's latency on every `EVERY_N`th frame.

## How to re-run

```bash
MM_HTTP=1 MM_SERVER_PORT=8081 pnpm --filter @midnight/client dev --port 5181   # terminal 1
node tools/shot.mjs --url http://localhost:5181/bench.html --wait 60000 --out .shots/yolo-bench.png
```
Or open `https://localhost:5173/bench.html` in Chrome on the demo laptop; the table renders and the JSON is on
the clipboard and at `window.__bench.results`.
