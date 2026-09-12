# Phase 6 — Integration

## Purpose
Put the webcam into the game: the lobby's camera button starts the vision layer, calibration is rendered in the game's overlay, the merged source feeds the sender, and a local cosmetic punch hint hides the snapshot delay.

## Files
Modify: `packages/client/src/main.ts`, `src/app/lobby.ts`, `src/input/selectSource.ts`, `src/game/ArenaScene.ts`. Create: `src/app/calibrationOverlay.ts`.

## Depends on
Phases 3, 4, 5 complete.

## Exposes
- `class CalibrationOverlay { bind(source: VisionInputSource): void; show(); hide() }` rendering `calibrationState()` each frame into `#calibration`: prompt text, progress bar, small mirrored preview with skeleton from `onDebug` while calibrating, and a Recalibrate button visible during the match in the corner.
- `session.visionAvailable: boolean`; `session.localEdge: InputFrame` (rising edges of the local source this render frame, for the hint).

## Behaviour
1. Enable camera (lobby) → construct `VisionInputSource`, `start()`; on success add it to the `MergedInputSource`, set `visionAvailable`, re-render the lobby with "Camera on"; on `VisionInputError` show the banner with a plain-language message per code and keep keyboard.
2. The overlay shows during calibration and whenever the phase is `lost` or `calibrating` mid-match (top-left, small, non-blocking), so a lost player knows why their fighter stopped.
3. `?input=keyboard` skips the camera button entirely; `?input=vision` auto-clicks it after join (for the demo runbook).
4. Cosmetic hint: each render frame the scene computes rising edges of `session.localSource.sample()`; on `punchL`/`punchR` edge, if the local fighter in the newest snapshot is not punching, not in hitstun and not blocking, the scene draws the local rig in the punch `startup` pose (elapsed 0→3 over 4 frames) until a snapshot shows an `action`, or for at most 6 frames, then falls back to the snapshot. Never draws the active pose, never spawns effects.
5. `blur`/`visibilitychange` hidden: stop sending (sender pauses), send one all-false frame, show a "paused" banner; resume on focus.

## Invariants
- Keyboard remains merged in; camera failure never blocks Ready.
- The hint touches only the local fighter's pose, never state.

## Tests
- Vitest: `selectSource.test.ts` (`?input=` → keyboard / vision / auto), `calibrationOverlay.test.ts` (`overlayModel` phase → prompt, progress, preview, Recalibrate per mode), `inputSender.test.ts` "pause" (pause sends one all-false frame while running, nothing before start, resume sends the live frame).
- Owner gate on two laptops over LAN HTTPS: one player on webcam, one on keyboard, full best of 3; then swap. Camera denied on one laptop still allows a keyboard match. Cover the camera mid-match → overlay shows lost, fighter idles, uncover → recalibrates and play resumes.

## Done when
- [x] rules 1, 2, 3, 5 headless-checked with the fake camera (`tools/shot.mjs`, `fakeCamera: true`): overlay calibrating → lost, "Camera on", camera-vs-keyboard countdown into FIGHTING with keyboard still merged, `?input=keyboard` / `?input=vision`, blur → paused banner → focus clears
- [ ] two-laptop gate passed
