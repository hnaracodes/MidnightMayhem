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
5. `visibilitychange` → `hidden` only: stop sending (sender pauses), send one all-false frame, show a "paused" banner; resume when the document is visible again. Window `blur`/`focus` never pause: two windows on one laptop blur each other on every click, which froze the camera player in the first real test. `KeyboardInputSource` still clears its keys on blur, which is all a keyboard player needs. (integrator amendment)

6. Camera preview (integrator amendment, from the first real test: "I can't see what's being recorded"): `class CameraPreview { bind(source, feed?); show(); hide(); toggle(); readonly visible }` in `src/app/cameraPreview.ts` paints `#campreview`, a fixed 240 px 4:3 box 8 px from the bottom-left corner, pointer-events none, above the arena and the lobby but under the calibration overlay and the banner. It draws the source's own `<video>` mirrored onto a canvas (no second stream) with the harness skeleton (wrists red while punching or crossed), a row of six input dots `L R J PL PR B` lit in `amber-1` from the DebugFrame's `InputFrame`, a status line (calibration phase, fps) and, when `frame.punch` is present, one `ext/depth/thrust/jab` gate row per hand with green/red glyphs. Shown on the room screen as soon as the camera is live, at the start of every match when `visionAvailable`, hidden on `MATCH_END`; `V` toggles it at any time. `R` logs `JSON.stringify(source.dump?.() ?? [])` and copies it to the clipboard. `VisionInputSource.onDebug` holds a single callback, so `main.ts` subscribes once through `debugFanOut` and hands the feed to both the calibration overlay and the preview. While the preview is up, the compact calibration box drops its own 160 px picture so the two never overlap.

## Invariants
- Keyboard remains merged in; camera failure never blocks Ready.
- The hint touches only the local fighter's pose, never state.

## Tests
- Vitest: `cameraPreview.test.ts` (`previewModel` dots / status / gates, `debugFanOut`), `pause.test.ts` (hidden-only pause policy), `selectSource.test.ts` (`?input=` → keyboard / vision / auto), `calibrationOverlay.test.ts` (`overlayModel` phase → prompt, progress, preview, Recalibrate per mode), `inputSender.test.ts` "pause" (pause sends one all-false frame while running, nothing before start, resume sends the live frame).
- Owner gate on two laptops over LAN HTTPS: one player on webcam, one on keyboard, full best of 3; then swap. Camera denied on one laptop still allows a keyboard match. Cover the camera mid-match → overlay shows lost, fighter idles, uncover → recalibrates and play resumes.

## Done when
- [x] rules 1, 2, 3, 5 headless-checked with the fake camera (`tools/shot.mjs`, `fakeCamera: true`): overlay calibrating → lost, "Camera on", camera-vs-keyboard countdown into FIGHTING with keyboard still merged, `?input=keyboard` / `?input=vision`, hidden → paused banner → visible clears, and blur does not pause
- [x] rule 6 headless-checked with the fake camera: preview visible on the room screen and during FIGHTING (test pattern, dots row, bottom-left clear of the HUD and the compact calibration box), `V` hides and shows it, synthetic `punch` diagnostics render the gate rows
- [ ] two-laptop gate passed
