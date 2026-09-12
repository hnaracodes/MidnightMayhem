# Phase 9 — Arsenal

Laser beam, five detectable items, object detection, the effects and sounds for them.
Spec: `docs/superpowers/specs/2026-09-12-mayhem-expansion-design.md` §4–6.

| Feature | File | Lane / branch | Owns |
|---|---|---|---|
| 9.01 | `01-items-core.md` | `feat/sim-items` | `shared/src/sim/items.ts`, `combat.ts` |
| 9.02 | `02-throwables.md` | `feat/sim-throwables` | `shared/src/sim/projectiles.ts`, `hazards.ts` |
| 9.03 | `03-laser.md` | `feat/sim-laser` | `shared/src/sim/laser.ts` |
| 9.04 | `04-vision-objects-and-laser.md` | `feat/vision` | `client/src/vision/**`, `input/KeyboardInputSource.ts`, `app/cameraPreview.ts` |
| 9.05 | `05-item-fx.md` | `feat/item-fx` | `client/src/game/itemFx.ts`, `dev/itemfx.html` |
| 9.06 | `06-sfx.md` | `feat/sfx` | `client/src/game/sfx.ts`, `dev/sfx.html` |
| 9.07 | `07-yolo-track.md` | `feat/yolo` (after 9.04 and 11.05 merge) | `client/src/vision/**`, `src/bench/**`, `bench.html` |
| 9.10 | `10-mobile-actions.md` | on `main` | `shared/src/sim/fighter.ts` (the movement lock), `laser.ts` start condition, `client/src/game/rig/pose.ts` |

9.01–9.06 run in parallel after 8.01; 9.07 runs alone afterwards. None edits another lane's files. Shared test helpers may be duplicated inside
each lane's test file; the integrator dedups.
