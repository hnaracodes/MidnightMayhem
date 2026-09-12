# Hand Landmarker Stretch Plan

Only after Phase 7 of the MVP plan is green. Adds fist detection and the fists-up guard block from `controls/phases/CLAUDE.md`.

1. **Worker:** create Hand Landmarker (`numHands: 2`, VIDEO mode, same delegate policy) beside Pose; run it every `HAND_EVERY_N` frames (start 2) and reuse the last result between runs. Include `hands` and `handMs` in the result message.
2. **Assignment:** map each detected hand to the nearest pose wrist by 2D distance under `HAND_ASSIGN_RADIUS · S` (0.5). Never trust `handedness`.
3. **Fist:** finger curled when tip is nearer the wrist than the PIP joint; fist when at least 2 of 4 curled. Output `fistL`, `fistR` as `true | false | undefined`.
4. **Punch gate:** replace the no-hand depth rule with `fistOk` (fist, or no hand assigned) and the lower `DEPTH_ENTER` (0.30).
5. **Guard block:** both wrists between eye and shoulder height, within `GUARD_WIDTH · S` of the midline, both fists; `block = crossed || guard`.
6. **Harness:** hand skeletons in yellow, L/R labels, fist three-state indicators, hand inference ms.

**Gate:** Controls doc phase 4 manual test: 10 of 10 punches per arm with fists, open-palm thrust does not punch, guard 5 of 5, slow push never punches, at 1 m, 1.5 m and 2.5 m.

Risk: hands roughly double inference cost. If pose FPS drops under 15, raise `HAND_EVERY_N` to 3 before anything else.
