# Phase 12 — Ambience: light, air, weight

The look-and-feel overhaul from `docs/superpowers/specs/2026-09-12-ambience-overhaul.md`: keep the pixel-art
fighting-game identity, give the arena deep gloom, lit pools of warm light, layered atmospheric depth, soft bloom
and animation with real weight. Presentation only — `packages/shared`, `packages/server` and `constants.ts` do not
change, the sim stays frame-identical, and every new random value comes from a seeded `Lcg`.

| Feature | File | Lane / branch | Owns |
|---|---|---|---|
| 12.01 | `01-pixel-grid.md` | `main` | `client/src/game/pixel.ts`, `config.ts` render block |
| 12.02 | `02-light-rig.md` | `main` | `client/src/game/stage/lighting.ts`, rim options in `sprites/compose.ts` + `rig/draw.ts`, lamp data in `backgrounds.ts` |
| 12.03 | `03-atmosphere.md` | `main` | `client/src/game/stage/particulate.ts`, `stage/quality.ts`, camera post-FX in `ArenaScene.ts`, haze/foreground layers in `backgrounds.ts` |
| 12.04 | `04-action-animation.md` | `main` | laser/throw/punch/jump poses in `rig/pose.ts`, juice in `effects.ts` + `itemFx.ts`, `dev/ambience.html` |
| 12.05 | `05-hud.md` | `main` | chrome in `hud.ts`, `dev/hud.html` |
| 12.06 | `06-menus.md` | `main` | scrim/glow CSS in `client/index.html`, `src/app/wipe.ts`, rim in `src/app/sprites/portrait.ts` |

The phases run in order on `main`, one commit per phase at least, prefix `ambience:`. 12.02 and 12.04 touch each
other (light pulses from impacts and the beam); everything else is independent. Every phase ends with `pnpm test`,
`pnpm typecheck` and `node tools/shot.mjs` reports with zero page errors, and reports `window.__arena.updateMs()`
before and after. The `frontend-design` skill applies to 12.05 and 12.06 and to the palette additions in 12.02.

Baseline before any code: `.shots/ambience-before-*.png` from the existing `tools/e2e/{landing,match,match-4p,
arena-states}.json` plans plus `tools/e2e/ambience-dev.json` (HUD at 2/3/4 players, stage per car).
