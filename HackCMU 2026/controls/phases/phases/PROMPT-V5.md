> **PARTIALLY SUPERSEDED 2026-09-12.** Gesture rules, thresholds, calibration and the harness in this file are still the spec. Changes: code is TypeScript inside `packages/client/src/vision`, not a separate plain-JS repo; the Hand Landmarker (phase 4) is deferred to `docs/superpowers/plans/2026-09-12-hands-stretch.md`; the InputFrame contract lives in `packages/shared`. See `DECISIONS_CHANGED.md` rows 25 to 29.

Read CLAUDE.md in full first. This is phase 5 of 5: finishing `VisionInputSource`, the move checklist, the guided test session, the README for the external WebSocket wrapper, and the final acceptance test. Phases 1–4 are done and passed their test gates. No new gestures and no rule changes in this phase; if a test below exposes a problem, report it and we decide whether to reopen the relevant phase.

Enter plan mode. Read the code so far, then ask me your questions in one batch. Things I expect you to ask about: the exact move sequence and counts for the guided session (propose the one below), how the summary should be presented (propose: a table on the page plus the same table logged to the console as text I can paste into a message), and what the README's polling example should look like for the wrapper (propose: a 60 Hz `setInterval` calling `sample()` and `JSON.stringify` on the result). Present the plan and wait for approval.

Build:

1. `VisionInputSource.js` finished against the contract in `src/input`: `start()` opens the camera, spins up the worker, waits for both landmarkers, runs `calibrate()`, and resolves when ready, rejecting with `VisionInputError`; `stop()` stops the loop, releases the camera tracks, and terminates the worker; `calibrate()` / `calibrationState()` as in phase 2; `sample()` returns the latest classified frozen `InputFrame` synchronously, or `EMPTY_FRAME` when tracking is lost or calibration is not ready. Nothing in this class touches the DOM except the hidden `<video>` it owns. The harness must now consume the source through this class only, so that what I test is exactly what the wrapper will import.
2. `harness/checklist.js`: six rows (left, right, jump, punchL, punchR, block), each with the live indicator and a checkbox that ticks after three separate occasions, where a new occasion starts after the input has been false for at least 500 ms. Reset button.
3. `harness/session.js`: a guided test run with a Start button. Steps, each shown as a large prompt with a countdown and a live detected-count:
   - Stand still, arms relaxed — 30 s. Any input firing is a false positive; count each by input.
   - Lean right ×5, lean left ×5 (each held ~1 s).
   - Hop ×5.
   - Block ×5 (crossed arms or guard, my choice each time).
   - Left punch ×5, right punch ×5.
   - Alternate left and right punches as fast as comfortable for 10 s — record the count and the shortest interval between two punches on the same arm.
   - Walk only: lean left and right continuously for 20 s. Any jump, block or punch is a false positive.
   - Free play — 30 s of doing whatever I like, with all six indicators visible, ending the session.
   Summary table per input: expected, detected, extra (detections beyond expected during that input's own step), false positives during the still and walk-only windows. Also report average FPS, inference ms, dropped frames and delegate over the session.
4. A `README.md` for the WebSocket wrapper and the future game: how to instantiate `VisionInputSource`, that `start()` needs a user gesture for camera permission, takes a few seconds to load models, and includes the calibration prompt the host must render from `calibrationState()`; the error codes; that `sample()` is safe to call at 60 Hz and returns a frozen object that can be passed straight to `JSON.stringify`; that the game must do its own edge detection; and the list of tunables in `thresholds.js`.

`pnpm build` must be green. Commit.

Manual test gate — the acceptance test. Tell me to run this and report the summary tables:

- Checklist: from a cold page load, calibrate, then tick all six boxes. Pass: under one minute, no box ticked by a move I didn't intend.
- Guided session, three times: at 1.5 m in normal light, at 2.5 m, and at 1.5 m in low light. Pass for each: every move detected at least 4 of 5; zero false positives in the 30 s still window; at most one false positive in the walk-only window; punches per 10 s of alternating at least 8.
- One other person of a noticeably different height calibrates and runs the checklist and one session at 1.5 m. Pass: same criteria. This is what calibration is meant to make work; if it fails, note which metric was off.
- Endurance: play freely for 3 minutes. Pass: FPS stays steady, dropped frames stay low, no memory growth visible in devtools (watch for leaked ImageBitmaps), no drift in calibration-relative values (the `lean` gauge and rise gauges still centre at rest at the end).

Paste me each summary table. When all four pass, this repository is done and `VisionInputSource` is ready for the WebSocket wrapper.
