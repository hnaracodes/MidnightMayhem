# 5.01 — Thresholds, camera, worker, worker client

## Purpose
Get pose landmarks off the main thread at camera rate with at most one inference in flight, with timing and delegate reported.

## Files
Create: `packages/client/src/vision/thresholds.ts`, `camera.ts`, `landmarkers.ts`, `worker.ts`, `workerClient.ts`. Run `pnpm --filter @midnight/client vision:setup` once per checkout: it downloads only the model into `public/models/` (gitignored). The wasm runtime is not copied anywhere; `landmarkers.ts` imports it from the npm package.

## Depends on
3.01.

## Exposes
`thresholds.ts`: `CAMERA = { width: 640, height: 480, fps: 30 }`, `EMA_ALPHA = 0.6`, `MODEL_URL = "/models/pose_landmarker_lite.task"`, plus every number named in 5.02–5.03 and the overlay colours (pose cyan `#4FE3F5`, marker red `#E8434F`, label white).

(integrator amendment) `WASM_URL` is removed. `landmarkers.ts` imports `@mediapipe/tasks-vision/vision_wasm_module_internal.js?url` and `...wasm?url` and passes `{ wasmLoaderPath, wasmBinaryPath }` to `PoseLandmarker.createFromOptions` instead of calling `FilesetResolver.forVisionTasks`. Reason: Vite refuses `import()` of files under `public/`, and MediaPipe loads its loader script with `import()` inside a module worker; the `?url` imports work under `vite dev` and are emitted as hashed assets in `dist/` for `packages/server`. The `_module_` variant is required because module workers have no working `importScripts`.

`camera.ts`: `openCamera(): Promise<{ video: HTMLVideoElement; stream: MediaStream }>` rejecting `VisionInputError("camera-denied" | "no-camera")`; `frameLoop(video, cb: (ts: number) => void): () => void` using `requestVideoFrameCallback` with `requestAnimationFrame` fallback.

`landmarkers.ts` (worker side): `createPose(delegate: "GPU" | "CPU"): Promise<PoseLandmarker>` in `VIDEO` mode, `numPoses: 1`, lite model; `createHands` stub returning null.

`worker.ts` protocol: inbound `{ type: "init" }`, `{ type: "frame", bitmap: ImageBitmap, ts: number }`; outbound `{ type: "ready", delegate }`, `{ type: "result", ts, pose: { landmarks, worldLandmarks } | null, poseMs, delegate }`, `{ type: "error", code: "model-load" }`.

`workerClient.ts`: `class WorkerClient { start(): Promise<{ delegate }>; sendFrame(video, ts): boolean /* false = dropped */; onResult(cb): void; stop(): void; stats: { fps, poseMs, dropped, delegate } }`.

`errors`: `class VisionInputError extends Error { code: VisionErrorCode }`, `type VisionErrorCode = "camera-denied" | "no-camera" | "model-load" | "worker-failed"`.

## Behaviour
1. Camera at 640 × 480, 30 fps requested; the `<video>` is CSS-mirrored; the actual track settings are read and logged.
2. Worker creates the Pose Landmarker with the GPU delegate, falling back to CPU if creation throws; reports which.
3. `detectForVideo` timestamps must strictly increase; the worker clamps `ts` to `last + 1` if needed.
4. `sendFrame` returns false without doing anything when a result is outstanding; the client counts drops.
5. The bitmap is transferred, closed in the worker after inference.
6. `start` rejects with `worker-failed` if the worker errors before `ready`, `model-load` if the model fails.
7. Check `@mediapipe/tasks-vision` docs for current API names before writing `landmarkers.ts` (`PoseLandmarker.createFromOptions`, `baseOptions.delegate`; the `WasmFileset` shape `{ wasmLoaderPath, wasmBinaryPath }`).

## Invariants
- The main thread never imports `@mediapipe/tasks-vision`.
- Never more than one frame in flight.

## Tests
- Manual on the harness (5.05) at 1 m, 1.5 m, 2.5 m: skeleton follows with no visible lag beyond a frame or two; FPS near camera rate; pose inference under ~20 ms on GPU; step out and back recovers within a second; deny permission shows the `camera-denied` banner.

## Done when
- [ ] harness shows a live skeleton with FPS, ms and delegate
