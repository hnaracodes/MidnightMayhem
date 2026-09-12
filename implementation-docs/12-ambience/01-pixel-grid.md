# 12.01 — Pixel grid discipline

## Purpose
Fighters sit on a 3-world-px grid while the stage, HUD and effects are smooth vector shapes at fractional positions,
so the picture never reads as one image and a walking sprite's edges crawl between pixels. This lane names the grid
once and makes the camera respect it, so everything drawn from here on can land on the same grid.

## Files
Modify: `packages/client/src/game/config.ts`, `packages/client/src/game/effects.ts` (dust and impact positions).
Create: `packages/client/src/game/pixel.ts`, `test/pixel.test.ts`.
Owns `pixel.ts`, the `render` block of `config.ts`.

## Depends on
11.01 (`SPRITE_SCALE` in `sprites/compose.ts`), 11.05 (`ArenaScene`, `Effects`).

## Exposes
`pixel.ts`:
- `export const PIXEL: number` — the quantisation unit for new art, equal to `SPRITE_SCALE` (3 world px).
- `export function snap(v: number): number` — nearest multiple of `PIXEL`.
- `export function snapPt<T extends { x: number; y: number }>(p: T): T` — both coordinates snapped, other fields kept.
- `export function snapUp(v: number): number` — next multiple of `PIXEL` at or above `v` (sizes that must not shrink).

## Behaviour
1. ~~`PIXEL === SPRITE_SCALE`; `pixel.ts` imports it rather than redeclaring 3.~~ **Superseded by 13.01:** `PIXEL = 2`
   is the grid for effects, shadows, particles and background rasters; fighters rasterise at `SPRITE_SCALE = 1`
   (a 105 px body needs a face). `PIXEL` no longer imports `SPRITE_SCALE`.
2. `snap(v)` rounds to the nearest multiple (`snap(4) === 3`, `snap(5) === 6`, `snap(-4) === -3`); half-way rounds up
   (`snap(4.5) === 6`). `snapUp(4) === 6`, `snapUp(6) === 6`.
3. `gameConfig.render.roundPixels` is `true`, so camera and game-object positions are rounded to whole pixels at
   render time; `Scale.FIT` stays (the demo laptops differ; no 320×180 render target).
4. New effect geometry is snapped: the dust puff centre and impact-ring centre in `Effects` use `snapPt`; the shadow,
   sparks and rings that later lanes add go through `snap`. Existing draw calls elsewhere are not retrofitted.
5. Lights, fog, bloom and gradients are exempt: they are the smooth layer of the hybrid look and must never snap.

## Invariants
- No gameplay coordinate is snapped: the sim's `x`, `y` and hitboxes are read as-is; snapping happens only on values
  handed to Graphics.
- `sprites.html`, `dev/stage.html` and `dev/hud.html` keep their layouts pixel-for-pixel apart from the rounding of
  sub-pixel positions.

## Tests
`pixel.test.ts`: rule 1 identity with `SPRITE_SCALE`; rule 2 the listed values plus `snap(snap(v)) === snap(v)` for
a sweep; `snapPt` keeps extra fields. `effects.test.ts`: dust and impact centres are multiples of `PIXEL`.

## Done when
- [ ] tests pass, `pnpm test` and `pnpm typecheck` green
- [ ] a walking fighter on `dev/stage.html` no longer crawls (compared in `.shots/ambience-stage-standard.png`)
- [ ] committed on `main` with prefix `ambience:`
