> **PARTIALLY SUPERSEDED 2026-09-12.** Gesture rules, thresholds, calibration and the harness in this file are still the spec. Changes: code is TypeScript inside `packages/client/src/vision`, not a separate plain-JS repo; the Hand Landmarker (phase 4) is deferred to `docs/superpowers/plans/2026-09-12-hands-stretch.md`; the InputFrame contract lives in `packages/shared`. See `DECISIONS_CHANGED.md` rows 25 to 29.

# Body Controls — MediaPipe input layer for a webcam-controlled fighting game

This repository contains only the motion-control layer of a future 2D fighting game: it turns a webcam feed into a stream of six boolean inputs (walk left/right, jump, left punch, right punch, block) with controls inspired by Nintendo's ARMS. There is no game here. The output of this repo is a `VisionInputSource` class plus a harness page used to test it by hand.

The game runs in a separate process and receives inputs over a WebSocket. The WebSocket sender is **not** part of this repo: an external wrapper (written later, elsewhere) polls `sample()` and forwards frames. This repo only has to make that easy: a synchronous `sample()`, a plain serialisable frame, and nothing that blocks.

This file is the project constitution. Read it fully before doing anything. Everything under "Decided" is settled; do not change it without asking the user. Anything not covered is yours to propose in plan mode.

## How to work in this repo

- Work is split into five phases, each with its own prompt file (`phases/PROMPT-V1.md` … `phases/PROMPT-V5.md`). Do exactly one phase per session. Each phase ends with a manual test gate the user runs in the harness; do not start the next phase's work early.
- Start every phase in plan mode: read this file, the phase prompt, and the code so far; ask your clarifying questions in one batch; present a plan; wait for approval.
- Ask before deciding anything the user would plausibly care about: gesture rules, thresholds outside the stated starting values, new dependencies, harness layout, file layout. Naming and internal helpers are yours.
- When you explain a choice to the user, use plain words first and the technical term second. The user has asked for this.
- There are no automated tests. The user tests manually in the harness. In return, `pnpm build` (JSDoc typecheck + Vite build) must stay green, every tunable number must live in `src/vision/thresholds.js`, and every gesture's raw metric must be visible live in the harness so the user can tune by watching numbers, not by guessing.
- Check the current `@mediapipe/tasks-vision` API and model URLs against the official docs (developers.google.com/edge/mediapipe) rather than from memory before writing the landmarker code.
- Commit small with clear messages. Do not push.
- Prefer boring, readable JavaScript. One person maintains this.

## Decided: stack and layout

Plain JavaScript (ES modules) with JSDoc type annotations, type-checked by `tsc` (`allowJs`, `checkJs`, `strict`, `noEmit`). No `.ts` files. Vite, pnpm, Node 20+. `@mediapipe/tasks-vision` for Pose Landmarker and Hand Landmarker, with the WASM runtime taken from the npm package and the two model files vendored into `public/models/` (downloaded once, committed). No framework for the harness — plain DOM and a `<canvas>` overlay. No other dependencies without asking.

`pnpm build` runs `tsc --noEmit` then `vite build`. Both must pass.

```
/
  CLAUDE.md
  phases/PROMPT-V1.md … PROMPT-V5.md
  index.html                 the harness page
  public/models/             vendored pose_landmarker_lite.task, hand_landmarker.task
  src/
    input/InputFrame.js      THE CONTRACT with the future game. Frozen. Never edit.
    vision/
      thresholds.js          every tunable number and colour, with a comment per value
      camera.js              getUserMedia, mirrored <video>, frame callback loop
      worker.js              Web Worker: owns both landmarkers, runs inference, posts landmarks
      landmarkers.js         PoseLandmarker + HandLandmarker setup (imported by worker.js)
      filters.js             EMA smoothing, debounce, hysteresis helpers
      calibration.js         explicit calibration: stability test, median capture, state
      metrics.js             per-frame derived numbers (lean, rise, extension, depth, …)
      gestures/
        walk.js  jump.js  block.js  fist.js  punch.js
      classify.js            combines gestures + priority into an InputFrame
      VisionInputSource.js   implements InputSource
    harness/
      main.js  overlay.js  panel.js  checklist.js  session.js
  tsconfig.json              allowJs + checkJs + strict + noEmit
```

## Decided: the input contract (`src/input/InputFrame.js`)

```js
/**
 * Held-state of the six controls, sampled once per game tick (60 Hz).
 * @typedef {Object} InputFrame
 * @property {boolean} left    move toward screen-left
 * @property {boolean} right   move toward screen-right
 * @property {boolean} jump
 * @property {boolean} punchL  player's left arm
 * @property {boolean} punchR  player's right arm
 * @property {boolean} block
 */

/** @type {Readonly<InputFrame>} */
export const EMPTY_FRAME = Object.freeze({
  left: false, right: false, jump: false, punchL: false, punchR: false, block: false,
});

/**
 * @typedef {'idle' | 'calibrating' | 'ready' | 'lost'} CalibrationPhase
 * @typedef {{ phase: CalibrationPhase, progress: number }} CalibrationState
 *   progress is 0–1 during 'calibrating', 1 when 'ready', 0 otherwise.
 */

/**
 * @typedef {'camera-denied' | 'no-camera' | 'model-load' | 'worker-failed'} VisionErrorCode
 */

/**
 * @typedef {Object} InputSource
 * @property {() => Promise<void>} start
 *   Opens the camera, loads the models, then runs calibrate(). Resolves when calibration is ready.
 *   Rejects with a VisionInputError carrying a VisionErrorCode.
 * @property {() => void} stop
 * @property {() => Promise<void>} calibrate
 *   Captures a fresh baseline. Resolves when ready. May be called at any time after start().
 * @property {() => CalibrationState} calibrationState
 * @property {() => Readonly<InputFrame>} sample
 *   Non-blocking. Returns the most recent classified frame as a frozen object that is
 *   shared until the next frame. Returns EMPTY_FRAME when tracking is lost or calibration
 *   is not ready.
 */
```

All six fields are level (held) signals. The game does edge detection itself: `jump`, `punchL`, `punchR` fire on the rising edge; `left`, `right`, `block` act while held. There is no push/callback API; the external wrapper polls `sample()`. `left`/`right` are screen directions in the mirrored view, so the player's physical left is screen-left. Several fields may be true at once except where the priority rule below forbids it.

`VisionInputError` is a subclass of `Error` with a `code` property (`VisionErrorCode`). GPU-delegate failure is not an error: the worker silently falls back to CPU and reports which delegate is active.

## Decided: coordinate conventions

- The webcam preview is mirrored. All horizontal maths uses mirrored x: `xm = 1 − landmark.x`. In mirrored space the player's left side has the smaller `xm`.
- MediaPipe's "left"/"right" landmark names are the person's anatomical sides. Pose indices used: 0 nose, 2 left eye, 5 right eye, 11 left shoulder, 12 right shoulder, 13/14 elbows, 15 left wrist, 16 right wrist, 23 left hip, 24 right hip. `punchL` is driven by landmark 15, `punchR` by 16.
- Two coordinate sets are used: normalised image landmarks (`landmarks`, 0–1, with `visibility`) for anything positional in the image, and `worldLandmarks` (metres, origin at hip midpoint) for depth toward the camera. Image `z` is not used; it is too noisy.
- Distances in image space are expressed in units of `S`, the calibrated shoulder width, so thresholds do not depend on how far the player stands from the camera. Image y grows downward; "higher" means smaller y.
- Hand landmarks (21 per hand): 0 wrist; 1–4 thumb (CMC, MCP, IP, TIP); 5–8 index (MCP, PIP, DIP, TIP); 9–12 middle; 13–16 ring; 17–20 pinky. Hand Landmarker's `handedness` is NOT trusted (it assumes a particular mirroring); each detected hand is assigned to whichever pose wrist (15 or 16) its own landmark 0 is nearest to, provided that distance is under `HAND_ASSIGN_RADIUS · S` (start 0.5); otherwise the hand is ignored.

## Decided: pipeline

- **Inference runs in a Web Worker (`worker.js`) from phase 1.** The worker owns both landmarkers. The main thread never imports `@mediapipe/tasks-vision`.
- Main thread: one `requestVideoFrameCallback` loop (fallback: `requestAnimationFrame`) on the mirrored `<video>`. Each new video frame: if the worker is idle, `createImageBitmap(video)` and `postMessage` it with transfer, along with a `performance.now()` timestamp. If the worker is still busy with the previous frame, **drop this frame**; never queue.
- Worker: on each received frame, run Pose Landmarker (`runningMode: "VIDEO"`, `numPoses: 1`, lite model, GPU delegate with CPU fallback), and Hand Landmarker (`numHands: 2`) on every `HAND_EVERY_N` frames (start 2), reusing the last hand result between runs. Timestamps passed to `detectForVideo` must be strictly increasing; the worker enforces this. Post back `{ ts, pose: { landmarks, worldLandmarks }, hands: { landmarks }[], poseMs, handMs, delegate }`. Close the bitmap after use.
- Main thread on each result: EMA smoothing (`EMA_ALPHA`, start 0.6; higher = less lag, more jitter) on landmark arrays, then calibration update, then metrics, then gestures, then classify. If jitter is a problem at tuning time, a One-Euro filter is the approved upgrade.
- Every gesture is a boolean produced by the same pattern: a raw condition on metrics with hysteresis (separate enter and exit thresholds), then a debounce (`raw` must hold for `ON_FRAMES` consecutive frames to switch on, and fail for `OFF_FRAMES` frames to switch off).
- `classify.js` applies priority: if `jump` then `block = punchL = punchR = false`; else if `block` then `punchL = punchR = false`. `left`/`right` are independent of the others and mutually exclusive.
- `VisionInputSource.sample()` returns the last classified frame as a frozen object; when tracking is lost or calibration is not ready it returns `EMPTY_FRAME`. It never awaits anything and allocates nothing.

## Decided: explicit calibration (`calibration.js`)

Calibration is explicit and prompted. `calibrate()` is a public method; `start()` calls it before resolving. The host (harness now, game later) renders the prompt from `calibrationState()`; `VisionInputSource` draws nothing. The harness has a **Calibrate** button that calls `calibrate()` at any time.

While calibrating, the prompt says "Stand still, arms at your sides". The layer accepts a frame as "stable" when: landmarks 0, 11, 12, 15, 16, 23, 24 all have `visibility > 0.5`; the shoulder midpoint moved less than `STABLE_MOVE` (start 0.02, normalised) since the previous frame; both wrists are below the hips (arms relaxed). A window of `CALIBRATION_MS` (start 1500 ms) of consecutive stable frames completes calibration. Any unstable frame restarts the window and resets `progress` to 0.

Captured values (medians over the window):

- `S` — shoulder width `|xm11 − xm12|`
- `leanZero` — `((xm11 + xm12)/2) − ((xm23 + xm24)/2)`, the player's natural shoulder-over-hip offset
- `hipY`, `shoulderY`, `noseY`, `eyeY` — the vertical positions at rest
- `armLen` — mean of `dist2D(P15, P11)` and `dist2D(P16, P12)` with arms hanging (this is the 2D arm length in image units)

Lost tracking: if the pose is absent (or the calibration landmarks have `visibility ≤ 0.5`) for more than `RELOST_MS` (start 1000 ms), state becomes `lost`, the baseline is discarded, and `sample()` returns `EMPTY_FRAME`. When a pose returns, the layer **automatically re-runs `calibrate()`**; state goes `lost → calibrating → ready` without any call from the host. A brief loss shorter than `RELOST_MS` keeps the baseline.

The harness shows the calibration state (idle / calibrating with progress bar / ready with captured values / lost) at all times.

## Decided: gesture definitions with starting values

All thresholds below are starting values and belong in `thresholds.js`. `dist2D` is Euclidean distance in normalised image space. Image-space lengths are divided by `S`.

Walk (`walk.js`):
`lean = (((xm11 + xm12)/2) − ((xm23 + xm24)/2) − leanZero) / S`
`right` enters when `lean > LEAN_ENTER` (0.25), exits when `lean < LEAN_EXIT` (0.15); `left` mirrors with negative values. Debounce ON 3 / OFF 3 frames.

Jump (`jump.js`) — **a physical hop**:
`riseHip = (hipY − (y23 + y24)/2) / S` and `riseShoulder = (shoulderY − (y11 + y12)/2) / S`, both positive when the player is higher than at rest. Enter when **both** `riseHip > JUMP_RISE` and `riseShoulder > JUMP_RISE` (start 0.12) **and** the rise was fast: `min(riseHip, riseShoulder)` increased by at least `JUMP_RISE` within the last `JUMP_WINDOW_MS` (start 250 ms; keep a short ring buffer). Exit when either `riseHip < JUMP_LAND` or `riseShoulder < JUMP_LAND` (start 0.05). Debounce ON 1 / OFF 2. No minimum hold: `jump` is true exactly while airborne. Measuring against the calibrated rest height means crouch-then-stand never counts. Requiring both points rejects shrugs and hip-only jitter.

Block (`block.js`) — **either** of two variants, evaluated independently, `block = crossed || guard`:

- Crossed: `midX = (xm11 + xm12)/2`. Crossed when `xm15 > midX + CROSS_MARGIN·S` and `xm16 < midX − CROSS_MARGIN·S` (0.10; left wrist on the right side and vice versa), both wrists have `shoulderY − BLOCK_TOP·S < y < hipY` (0.10), and both `|xm − midX| < BLOCK_WIDTH·S` (0.80). Enter when all hold; exit when the crossing condition fails.
- Guard (ARMS-style, both fists up in front of the face): both wrists have `eyeY < y < shoulderY` (above the shoulders, below the eyes), both `|xm − midX| < GUARD_WIDTH·S` (0.50), and `fistOk` for both arms (same rule as punch: the assigned hand is a fist, or no hand is assigned; `GUARD_REQUIRE_FIST` flag, start true). Enter when all hold; exit when the height or width condition fails. Guard is wired in phase 4, after hands exist.

Debounce ON 3 / OFF 3 on the combined `crossed || guard` raw value.

Fist (`fist.js`), per detected hand:
A finger is curled when `dist2D(TIP, WRIST) < dist2D(PIP, WRIST)`, evaluated for index, middle, ring and pinky (thumb ignored). Fist when at least `FIST_MIN_CURLED` (start **2**) of 4 are curled. No debounce here; punch and guard debounce.

Punch (`punch.js`), evaluated per arm with (shoulder, wrist) = (11, 15) for left and (12, 16) for right:

- `ext = dist2D(P_wrist, P_shoulder) / armLen` — about 1.0 with the arm hanging, falling toward 0.3–0.5 when the arm points at the camera (foreshortening)
- `depth = W_shoulder.z − W_wrist.z` in metres from world landmarks — positive when the wrist is nearer the camera than the shoulder
- `atHeight = |y_wrist − y_shoulder| < AT_HEIGHT·S` (0.60)
- `thrust = ext dropped by at least THRUST_DROP (0.25) within the last THRUST_WINDOW_MS (200)` (a velocity gate so a hand resting forward does not count; `THRUST_ENABLED` flag, start true)
- `fistOk = the hand assigned to this wrist is a fist, or no hand is assigned`

Enter when `ext < EXT_ENTER` (0.55) and `depth > DEPTH_ENTER` (0.30) and `atHeight` and `thrust` and `fistOk`; if no hand is assigned, require `depth > DEPTH_ENTER_NO_HAND` (0.40) instead. Exit when `ext > EXT_EXIT` (0.75) or `depth < DEPTH_EXIT` (0.15). Debounce ON 2 / OFF 3. Minimum hold once entered: `PUNCH_MIN_HOLD_MS` (100).

## Decided: the harness (`index.html`)

A single page with, left to right: the mirrored webcam with skeleton overlay (pose in cyan, hands in yellow, wrist markers turning red when crossed / in guard / punching, wrists assigned to arms labelled L/R in white; colours are named constants in `thresholds.js`); a live panel; and the test checklist. The calibration prompt and progress bar sit over the video while calibrating, and a **Calibrate** button sits under it.

The live panel always shows FPS (frames actually processed), pose and hand inference ms, active delegate (GPU/CPU), calibration state, the six `InputFrame` indicators, and the raw metrics behind them (`lean`, `riseHip`, `riseShoulder`, `extL`, `extR`, `depthL`, `depthR`, fist L/R, and the `crossed` / `guard` / `thrust` L/R booleans) so every threshold can be tuned by watching the number that drives it.

Errors from `start()` are shown as a banner across the top of the page with the error code and a plain-language message.

Checklist: six rows, one per input. Each row has a live indicator and a checkbox that ticks after the move has been detected on three separate occasions (a new occasion begins after the input has been false for at least 500 ms). A reset button clears all boxes.

Session mode (phase 5): a guided test run that prompts one move at a time, counts detections against the expected count, runs timed "stand still" and "walk only" false-positive windows, and prints a summary table at the end.

## Out of scope

Anything game-related; the WebSocket sender (lives outside this repo); recording or replaying landmark data; automated tests; multi-person tracking; dashes, crouches, or any input beyond the six in the contract.
