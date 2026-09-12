> **PARTIALLY SUPERSEDED 2026-09-12.** Gesture rules, thresholds, calibration and the harness in this file are still the spec. Changes: code is TypeScript inside `packages/client/src/vision`, not a separate plain-JS repo; the Hand Landmarker (phase 4) is deferred to `docs/superpowers/plans/2026-09-12-hands-stretch.md`; the InputFrame contract lives in `packages/shared`. See `DECISIONS_CHANGED.md` rows 25 to 29.

Read CLAUDE.md in full first. This is phase 1 of 5: project scaffold, camera, the inference Web Worker with the Pose Landmarker, skeleton overlay, performance readout. No gestures, no calibration yet.

Enter plan mode. Check the current `@mediapipe/tasks-vision` docs for `FilesetResolver.forVisionTasks`, `PoseLandmarker.createFromOptions` (including `baseOptions.delegate`), `detectForVideo`, running inside a Web Worker (ImageBitmap input, OffscreenCanvas / GPU availability in workers), and the lite pose model URL. Then ask me your questions in one batch. Things I expect you to ask about: how to serve the WASM files from the npm package through Vite (propose: copy them into `public/wasm/` with a small `pnpm` script, or point `forVisionTasks` at the package path Vite resolves), how the harness should look before any gesture exists, and how to structure the worker message protocol. Present the plan and wait for approval.

Build:

1. pnpm + Vite project, plain JavaScript ES modules, `tsconfig.json` with `allowJs`, `checkJs`, `strict`, `noEmit`, `lib: ["DOM", "ES2022"]` (the worker file gets `/// <reference lib="webworker" />` at the top). Scripts: `dev`, `build` (= `tsc --noEmit && vite build`), `models:fetch` (downloads the pose lite and hand model files into `public/models/`). `.gitignore`. The folder layout from CLAUDE.md with empty placeholder modules, and `src/input/InputFrame.js` containing exactly the contract (typedefs, `EMPTY_FRAME`, `VisionInputError`).
2. Vendor the models: run `models:fetch` once and commit the two `.task` files.
3. `camera.js`: request the webcam at 640×480, play it into a `<video>` that is CSS-mirrored, expose a frame loop using `requestVideoFrameCallback` with `requestAnimationFrame` fallback. Reject with `VisionInputError` codes `camera-denied` / `no-camera`.
4. `worker.js` + `landmarkers.js`: the worker creates the Pose Landmarker in VIDEO mode, `numPoses: 1`, GPU delegate falling back to CPU if creation fails, and reports `{ type: 'ready', delegate }`. On `{ type: 'frame', bitmap, ts }` it runs `detectForVideo` with a strictly increasing timestamp, closes the bitmap, and posts `{ type: 'result', ts, pose, poseMs, delegate }`. On model-load failure it posts `{ type: 'error', code: 'model-load' }`. Leave a stub for the Hand Landmarker (phase 4).
5. Main-thread worker client (in `VisionInputSource.js` or a small `workerClient.js`): sends one frame at a time with `createImageBitmap(video)` and transfer; drops frames while the worker is busy; rejects `start()` with `worker-failed` if the worker errors before `ready`.
6. `filters.js`: EMA over landmark arrays with `EMA_ALPHA` from `thresholds.js`.
7. `harness/overlay.js`: draw the smoothed skeleton on a canvas over the mirrored video (mirror the drawing to match) in the pose colour from `thresholds.js`, with wrists, shoulders, hips and nose visibly marked.
8. `harness/panel.js`: FPS (video frames actually processed, so dropped frames don't count), pose inference ms (rolling average), active delegate, and a tracking state (no person / tracking).
9. Error banner across the top of the page for any `VisionInputError`.
10. `thresholds.js` with `EMA_ALPHA`, the camera resolution, and the overlay colours, each commented.

`pnpm build` must be green. Commit.

Manual test gate — tell me to run this and report back before phase 2:

- Stand 1.5 m from the laptop in normal room light. The skeleton should follow me with no visible lag beyond a frame or two, and the wrist markers should stay on my wrists when I move my arms slowly and quickly.
- Check FPS, inference ms and delegate at 1 m, 1.5 m and 2.5 m. Pass: FPS at or near the camera's rate, pose inference under ~20 ms on GPU, page stays smooth. Note the dropped-frame count if the panel shows one.
- Step out of frame and back. Tracking state should go to "no person" and recover within a second.
- Deny the camera permission once and reload. Pass: banner with `camera-denied`, no console-only failure.
- Turn the room lights down and repeat the first test once. Note whether wrists still track.

What I can change by hand after this phase: `EMA_ALPHA` (jitter vs lag), camera resolution, model variant (lite vs full) in `landmarkers.js`, overlay colours.
