> **PARTIALLY SUPERSEDED 2026-09-12.** Gesture rules, thresholds, calibration and the harness in this file are still the spec. Changes: code is TypeScript inside `packages/client/src/vision`, not a separate plain-JS repo; the Hand Landmarker (phase 4) is deferred to `docs/superpowers/plans/2026-09-12-hands-stretch.md`; the InputFrame contract lives in `packages/shared`. See `DECISIONS_CHANGED.md` rows 25 to 29.

Read CLAUDE.md in full first. This is phase 4 of 5: the Hand Landmarker in the worker, hand-to-arm assignment, fist detection, the left and right punch gestures, and the guard variant of block. Phases 1–3 are done and passed their test gates. This is the hardest phase; expect to tune.

Enter plan mode. Check the current Hand Landmarker web docs (`createFromOptions`, `numHands`, `detectForVideo`, the model URL, worker support) and confirm the Pose Landmarker's `worldLandmarks` z convention (metres, origin at hip midpoint, smaller = nearer the camera). Then ask me your questions in one batch. Things I expect you to ask about: whether to run hands every 2nd frame or every 3rd given phase 1's timings, whether the velocity gate (`thrust`) should start enabled (propose: yes), how to display the per-arm punch metrics, and whether guard should require fists when hands are detected (propose: yes, `GUARD_REQUIRE_FIST` true). Present the plan and wait for approval.

Build:

1. `worker.js` / `landmarkers.js`: create the Hand Landmarker in VIDEO mode with `numHands: 2`, same delegate policy as pose, run it every `HAND_EVERY_N` frames and keep the last result between runs. Include `hands` and `handMs` in the result message.
2. Hand assignment (in `metrics.js` or a small `hands.js`): for each detected hand, find the nearest pose wrist (15 or 16) by `dist2D(handLandmark0, poseWrist)`; assign if under `HAND_ASSIGN_RADIUS·S`, else ignore. Never use `handedness`.
3. `gestures/fist.js`: the curled-finger rule from CLAUDE.md with `FIST_MIN_CURLED` (start 2), per assigned hand. Output `fistL`, `fistR`, each `true | false | undefined` (undefined = no hand assigned).
4. `metrics.js`: per arm, `ext` (2D wrist–shoulder distance over `armLen`), `depth` (world `shoulder.z − wrist.z` in metres), `atHeight`, and `thrust` (ext fell by at least `THRUST_DROP` within `THRUST_WINDOW_MS`; keep a short ring buffer of `ext` with timestamps). Add the `guard` condition.
5. `gestures/punch.js`: one instance per arm, using the enter/exit rules and the no-hand fallback from CLAUDE.md, debounce ON 2 / OFF 3, minimum hold `PUNCH_MIN_HOLD_MS`.
6. `gestures/block.js`: fill the `guard` slot; `block = crossed || guard` before the shared debounce.
7. `classify.js`: wire `punchL`/`punchR` under the existing priority rule.
8. Harness: hand skeletons drawn in the hand colour with an L/R label at the assigned wrist; panel shows `extL`, `extR`, `depthL`, `depthR` as live numbers with their enter/exit bands, `fistL`/`fistR` as three-state indicators, `thrustL`/`thrustR` flashing when the velocity gate opens, and the `guard` boolean; wrist markers red while in guard or punching; hand inference ms added to the performance readout.
9. New numbers into `thresholds.js` with comments.

`pnpm build` must be green. Commit.

Manual test gate — tell me to run this and report back before phase 5:

- Hands: hold both hands up open, then make fists. `fistL`/`fistR` should follow within a frame or two of the hand result. Turn my hands palm-in, palm-out, and sideways. Pass: fist state is correct in all orientations at 1.5 m. Half-close my hands: note whether 2-of-4 reads them as fists. Note the distance at which hands stop being detected at all; that is the practical range limit.
- Assignment: cross my hands over (left hand on the right side). Pass: labels stay L and R correctly because assignment follows pose wrists, not handedness.
- Punch: throw 10 straight left punches at the camera with a fist, returning to guard between each. Pass: 10 `punchL`, 0 `punchR`. Repeat right. Watch `ext` drop toward ~0.4 and `depth` rise past 0.3 on each punch; if the numbers don't cross the bands even though the gesture is obvious, that is a threshold problem and we adjust before touching the rule.
- Slow push: extend my arm forward slowly over two seconds. Pass: no punch (the `thrust` gate should hold it). Then leave the arm extended for 5 s. Pass: still no punch.
- Open-hand thrust: punch at the camera with an open palm. Pass: no punch while the hand is detected. Then repeat with the hand outside detection range (far away or partially out of frame): the pose-only fallback may fire; note whether it does.
- Guard: bring both fists up in front of my face. `block` should light and hold. Repeat 5 times. Pass: 5 of 5. Open my hands in the same position. Pass: `block` goes off (fist required). Raise one fist only. Pass: nothing.
- Guard vs punch: from guard, throw a punch. Pass: `block` drops and `punchL`/`punchR` fires; if block's OFF debounce is swallowing the punch under priority, report the frame counts and we tune.
- Punch during other gestures: punch while leaning. Pass: `punchL` and `left`/`right` both show. Punch while crossed. Pass: no punch. Punch upward above my head. Pass: no punch (`atHeight` blocks it).
- Hook/sideways: swing an arm across my body at shoulder height. Pass: no punch (`ext` stays high since the arm stays in the image plane).
- Repeat the 10-punch test at 1 m and 2.5 m, and once with long sleeves.

What I can change by hand after this phase: `EXT_ENTER` (0.55), `EXT_EXIT` (0.75), `DEPTH_ENTER` (0.30), `DEPTH_ENTER_NO_HAND` (0.40), `DEPTH_EXIT` (0.15), `AT_HEIGHT` (0.60), `THRUST_DROP`, `THRUST_WINDOW_MS`, `THRUST_ENABLED`, `HAND_EVERY_N`, `HAND_ASSIGN_RADIUS` (0.5), `FIST_MIN_CURLED` (2), `GUARD_WIDTH` (0.50), `GUARD_REQUIRE_FIST`, the punch debounce and `PUNCH_MIN_HOLD_MS`.
