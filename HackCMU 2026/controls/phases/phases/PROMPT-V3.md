> **PARTIALLY SUPERSEDED 2026-09-12.** Gesture rules, thresholds, calibration and the harness in this file are still the spec. Changes: code is TypeScript inside `packages/client/src/vision`, not a separate plain-JS repo; the Hand Landmarker (phase 4) is deferred to `docs/superpowers/plans/2026-09-12-hands-stretch.md`; the InputFrame contract lives in `packages/shared`. See `DECISIONS_CHANGED.md` rows 25 to 29.

Read CLAUDE.md in full first. This is phase 3 of 5: the two pose-only gestures — jump (a physical hop) and the crossed-arms variant of block — plus the priority rule. The guard variant of block needs hands and comes in phase 4. Phases 1–2 are done and passed their test gates.

Enter plan mode. Read the code so far, then ask me your questions in one batch. Things I expect you to ask about: how to show `riseHip` / `riseShoulder` and `crossed` in the harness (propose: two small vertical gauges with the enter/land bands for the rises, a boolean for crossed, and a colour change on the wrist markers when crossed), how long the rise ring buffer should be (propose: 500 ms of samples), and whether stepping backward triggers hops in practice (we find out in the gate). Present the plan and wait for approval.

Build:

1. `metrics.js`: add `riseHip`, `riseShoulder`, `midX`, and the `crossed` condition, exactly as defined in CLAUDE.md. Keep a short ring buffer of `min(riseHip, riseShoulder)` with timestamps for the fast-rise check.
2. `gestures/jump.js`: enter when both rises exceed `JUMP_RISE` and the rise happened within `JUMP_WINDOW_MS`; exit when either rise falls below `JUMP_LAND`; debounce ON 1 / OFF 2; no minimum hold.
3. `gestures/block.js`: the crossed variant with the height and width constraints, exit when the crossing fails, debounce ON 3 / OFF 3. Leave a named slot for `guard` (phase 4) so `block = crossed || guard`.
4. `classify.js`: wire jump and block in and apply priority: `jump` suppresses `block` and both punches; `block` suppresses both punches. Walk stays independent.
5. Harness: `jump` and `block` indicators live; panel shows `riseHip`, `riseShoulder` gauges and the `crossed` boolean; overlay recolours wrist markers red when crossed.
6. New numbers into `thresholds.js` with comments.

`pnpm build` must be green. Commit.

Manual test gate — tell me to run this and report back before phase 4:

- Hop: do a small hop in place. `jump` should light during the hop and go off on landing. Repeat 5 times. Pass: 5 of 5, no double-trigger on landing. Watch the rise gauges: both should clear the enter band during the hop.
- Hop false positives: rise slowly onto my toes and hold. Pass: `jump` never lights (the speed gate). Crouch and stand back up quickly. Pass: nothing (never above rest). Shrug my shoulders hard. Pass: nothing (hips didn't rise). Take one quick step backward and one forward. Note whether `jump` lights; if it does, `JUMP_RISE` needs raising.
- Block: cross my forearms over my chest. `block` should light within a couple of frames and hold. Uncross. Repeat 5 times. Pass: 5 of 5.
- Block false positives: fold my arms low at my stomach, put my hands on my hips, put one hand on the opposite shoulder, clasp hands in front of my chest without crossing wrists. Pass: `block` never lights. If folded-arms-at-stomach triggers, the lower height bound (`hipY`) needs raising.
- Priority: cross my arms, then hop while still crossed. Pass: `block` turns off during the hop and `jump` turns on; never both at once. Lean while crossed. Pass: `block` and `left`/`right` both show together (walk is independent).
- Repeat the hop and block tests at 2.5 m and with the lights lower.

What I can change by hand after this phase: `JUMP_RISE`, `JUMP_LAND`, `JUMP_WINDOW_MS`, block's `CROSS_MARGIN`, `BLOCK_WIDTH`, `BLOCK_TOP`, and all four debounce counts.
