# Phase 13 — Art overhaul: smaller fighters, a 1 px art grid, shaded characters, pixel-art world

The owner's brief (`docs/superpowers/specs/2026-09-12-art-overhaul.md`) plus two decisions taken at the plan
review on 2026-09-12: fighters shrink to **70 %** of their drawn height (a true shrink through sim and pose, not a
drawn-only one), and the sprite grid moves to **one art pixel per world pixel** so the smaller body keeps a
detailed face. Everything else is presentation: `packages/server`, `src/vision`, `src/net`, `src/input` do not
change, and every random value comes from the seeded `Lcg`.

| Feature | File | Owns |
|---|---|---|
| 13.00 | `00-body-scale.md` | body-relative numbers in `shared/src/constants.ts` and `sim/projectiles.ts`, `BODY_SCALE` in `rig/characters.ts`, the world mapping in `rig/pose.ts`, body heights in `effects.ts` / `itemFx.ts` / `ArenaScene.ts` / `rig/draw.ts` / dev previews |
| 13.01 | `01-art-grid.md` | `SPRITE_SCALE`, frame and canvas geometry in `sprites/compose.ts`, `PIXEL` in `pixel.ts`, `scalePart` in `sprites/grid.ts`, `makePixelTexture` in `backgrounds.ts`, `src/game/raster.ts`, `app/sprites/portrait.ts` cell |
| 13.02 | `02-shading.md` | `sprites/shade.ts`, material ramps in `grid.ts`, `lightDir` in `stage/lighting.ts` and `ComposeOpts`, the compose cache and raster perf in `SpriteFighter.ts` |
| 13.03 | `03-characters.md` | `sprites/parts/*.ts`, `sprites/secondary.ts`, Claude's screen light |
| 13.04 | `04-train-sky.md` | every generator in `backgrounds.ts` |
| 13.05 | `05-maps.md` | `stage/mapDraw.ts` |
| 13.06 | `06-props.md` | `stage/props.ts`, lamp gain hook in `stage/lighting.ts`, prop triggers in `ArenaScene.ts` |
| 13.07 | `07-consistency.md` | FX grid pass in `effects.ts` / `itemFx.ts`, 12.x spec annotations, the screenshot set |

One commit per feature, prefix `art:`, `pnpm test` and `pnpm typecheck` green at each, every `tools/e2e/*.json`
plan with zero page errors, `window.__arena.updateMs()` reported for 1 / 2 / 4 fighters. 13.00 and 13.01 ship
in one commit because a 105 px body drawn on the 3 px grid with the 150 px part grids is not a runnable state.

Baseline before any code (branch `feat/artstyle-rework` at 22c62b9): `updateMs` 1.06–1.36 ms with four attract
fighters on `high`, 0.82 / 0.54 ms in a 2P match, `SpriteFighter.update` 0.109 ms per fighter, `dev/stage.html`
0.60 ms per frame. Shots in `.shots/art-before-*.png`.
