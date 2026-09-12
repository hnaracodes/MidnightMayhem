# Phase 11 — Look: sprites, stage, landing, HUD, integration

| Feature | File | Lane / branch | Owns |
|---|---|---|---|
| 11.01 | `01-pixel-sprites.md` | `feat/sprites` | `client/src/game/sprites/**`, `rig/characters.ts`, `palette.ts`, `sprites.html` |
| 11.02 | `02-stage-motion-and-maps.md` | `feat/stage` | `client/src/game/backgrounds.ts`, `game/stage/**`, `dev/stage.html` |
| 11.03 | `03-landing-and-lobby.md` | `feat/ui` | `client/index.html`, `src/app/**` (except cameraPreview/calibrationOverlay), screens block of `main.ts` |
| 11.04 | `04-hud.md` | `feat/hud` | `client/src/game/hud.ts`, `dev/hud.html` |
| 11.05 | `05-arena-integration.md` | `main` (integrator, alone, last) | `ArenaScene.ts`, `effects.ts`, `session.ts`, `config.ts`, rest of `main.ts` |

11.01–11.04 run in parallel after 8.01. 11.05 runs after every phase 9–11 lane has merged.
The `frontend-design` skill is mandatory for 11.03 and recommended for 11.01, 11.02, 11.04.
