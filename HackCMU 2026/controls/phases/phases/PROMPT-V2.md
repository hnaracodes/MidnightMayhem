> **PARTIALLY SUPERSEDED 2026-09-12.** Gesture rules, thresholds, calibration and the harness in this file are still the spec. Changes: code is TypeScript inside `packages/client/src/vision`, not a separate plain-JS repo; the Hand Landmarker (phase 4) is deferred to `docs/superpowers/plans/2026-09-12-hands-stretch.md`; the InputFrame contract lives in `packages/shared`. See `DECISIONS_CHANGED.md` rows 25 to 29.

Read CLAUDE.md in full first. This is phase 2 of 5: explicit calibration, the metrics module, the debounce/hysteresis helpers, and the first gesture — walk by leaning. Phase 1 is done and passed its test gate.

Enter plan mode. Read the phase 1 code, then ask me your questions in one batch. Things I expect you to ask about: how the calibration prompt and progress bar should look over the video, where the Calibrate button goes, whether `left`/`right` should show as arrows or lights, and whether the automatic re-calibration after lost tracking should show the same prompt as a manual one (propose: yes, identical). Present the plan and wait for approval.

Build:

1. `calibration.js` exactly as specified in CLAUDE.md: the stability test per frame, the `CALIBRATION_MS` window that restarts on an unstable frame with `progress` reset, medians for `S`, `leanZero`, `hipY`, `shoulderY`, `noseY`, `eyeY`, `armLen`, lost detection after `RELOST_MS`, and automatic re-run on recovery. Expose `calibrate()` returning a promise and `calibrationState()` returning `{ phase, progress }` with phases `idle | calibrating | ready | lost`.
2. `VisionInputSource.js`: `start()` now opens the camera, waits for the worker's `ready`, then calls `calibrate()` and resolves when ready. `calibrate()` and `calibrationState()` are public. `sample()` returns `EMPTY_FRAME` unless phase is `ready`.
3. `metrics.js`: a pure function from (smoothed pose landmarks, baseline, timestamp) to a metrics object. Add `lean` now; leave named slots for `riseHip/riseShoulder`, `extL/extR`, `depthL/depthR`, `crossed`, `guard`, filled in later phases. Everything positional in mirrored x and in units of `S`.
4. `filters.js`: add `Hysteresis(enter, exit)` and `Debounce(onFrames, offFrames)` helpers that are reusable by every gesture.
5. `gestures/walk.js`: `lean` → `left`/`right` with the starting thresholds from CLAUDE.md, mutually exclusive.
6. `classify.js`: produce an `InputFrame` from gestures (only walk is wired now; the rest are false). Output a frozen object, reused until the next frame.
7. Harness: calibration prompt ("Stand still, arms at your sides") with a progress bar over the video while calibrating; the Calibrate button under the video; captured values shown once ready; `lost` shown clearly; live `lean` value with the enter/exit bands drawn as a small horizontal gauge; the six `InputFrame` indicators (only left/right live yet).
8. Add all new numbers to `thresholds.js` with comments.

`pnpm build` must be green. Commit.

Manual test gate — tell me to run this and report back before phase 3:

- Start the page, stand relaxed with arms at my sides when prompted. Calibration should reach "ready" in about 1.5 s. Fidget during the countdown: the bar should reset. Walk out and back in: it should show "lost", then the prompt again, then "ready" without me pressing anything. Press Calibrate while ready: it should re-run.
- Watch the `lean` gauge while standing still for 30 s. Pass: it stays inside the dead zone (|lean| < 0.15) the whole time; `left`/`right` never light up.
- Lean right until `right` lights, hold 3 s, return to neutral. Repeat left. Pass: each lights within a few frames of crossing the band and turns off as I return, with no flicker at the edge.
- Shuffle my feet and shift my weight side to side without leaning my shoulders. Pass: no `left`/`right` triggers. If this fails, the lean formula is picking up hip motion and we adjust `leanZero`/dead zone.
- Repeat the lean test at 1 m and 2.5 m. Pass: the same amount of lean produces the same result (that is what dividing by `S` is for).

What I can change by hand after this phase: `LEAN_ENTER`, `LEAN_EXIT`, `WALK_ON_FRAMES`, `WALK_OFF_FRAMES`, `CALIBRATION_MS`, `RELOST_MS`, `STABLE_MOVE`.
