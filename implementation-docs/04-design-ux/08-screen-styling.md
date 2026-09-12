# 4.08 — Screen styling

## Purpose
Make the lobby, calibration, result and error screens look like part of the same game: palette, typography, layout readable at 1080p from 2 m.

## Files
Modify: `packages/client/index.html` (stylesheet), `src/app/lobby.ts`, `result.ts`, `banner.ts`, and the calibration overlay from 5.05 when it exists.

## Depends on
3.05, 4.01.

## Exposes
- CSS classes: `.overlay`, `.title`, `.room-code`, `.player-row`, `.btn`, `.btn-primary`, `.banner`, `.calib`, `.progress`.

## Behaviour
1. Background of every overlay: `night-0` at 92 % over the arena so the moving roof is faintly visible behind (the game is alive even in menus).
2. Title `MIDNIGHT MAYHEM` in 64 px extra-bold `moon` with a 6 px `outline` text-shadow; subtitle "on the roof of the Midnight Express" 16 px `steel-2`.
3. Room code 56 px letter-spaced `amber-1`; player rows 20 px with a coloured dot (`drifter-key` / `conductor-key`) and a ready check in `amber-1`.
4. Buttons 18 px, 12 px padding, `night-1` fill, 2 px `amber-1` border, `amber-1` fill on hover; primary action (Join, Ready, Rematch) is larger.
5. Result: winner name 72 px, `YOU WIN` in `amber-1` or `YOU LOSE` in `danger`, `MUTUAL DERAILMENT` in `moon`.
6. Error banner: `danger` strip, 16 px, never covers the HUD bars (offset below y 60 during a match).
7. Calibration overlay: centred prompt "Stand still, arms at your sides", a 360 px progress bar in `amber-1`, and the camera preview with skeleton at 320 px wide in the bottom-left corner during calibration only.

## Invariants
- No third-party CSS or fonts.

## Tests
- Owner gate: screenshots of join, room, calibration, result, error; legible from 2 m on the demo laptop.

## Done when
- [ ] owner approves
