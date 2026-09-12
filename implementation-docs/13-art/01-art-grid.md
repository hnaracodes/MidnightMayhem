# 13.01 — The art grid: one art pixel per world pixel, a 2 px grid for everything else

## Purpose
With the body at 105 px, a 2 or 3 world-px sprite grid leaves 35–53 art pixels of fighter — no room for a face.
This lane rasterises fighters at `SPRITE_SCALE = 1` (105 art px tall, a ~36 px head) and keeps a coarser 2 px
grid (`PIXEL`) for effects, shadows, particles and the background rasters so the world still reads as pixel art.
Part grids are scaled mechanically here to keep the game runnable; 13.03 re-authors them.

## Files
Modify: `packages/client/src/game/sprites/compose.ts`, `sprites/grid.ts` (`scalePart`), `sprites/SpriteFighter.ts`
(unchanged API), `pixel.ts`, `backgrounds.ts` (`makePixelTexture`), `app/sprites/portrait.ts`, `src/spritePreview.ts`,
`test/{sprites,pixel,portrait}.test.ts`, `implementation-docs/12-ambience/01-pixel-grid.md` (rule 1 note).
Create: `packages/client/src/game/raster.ts`, `test/raster.test.ts`.
Owns `SPRITE_SCALE`, `FRAME_*`, `ANCHOR`, `CANVAS`, `PIXEL`, `scalePart`, `makePixelTexture`, `upscaleBlock`.

## Depends on
13.00 (`BODY_SCALE`), 12.01 (`pixel.ts`), 12.02 (`makeTexture`).

## Exposes
`compose.ts`: `SPRITE_SCALE = 1`, `FRAME_W = 64`, `FRAME_H = 112`, `ANCHOR = { x: 32, y: 108 }`,
`CANVAS = { w: 176, h: 160, ox: 56, oy: 48 }` (set from the extents probe: x −80..+80, y −141..+2 about the feet,
plus the outline and a free ring; widened if anything clips). Limb widths in art px: thigh 8, shin 6, upper arm 8,
forearm 6; `ANKLE_LIFT = 4`.
`pixel.ts`: `PIXEL = 2` — the FX/background grid, no longer tied to `SPRITE_SCALE`.
`grid.ts`: `scalePart(part: Part, k: number): Part` — nearest-neighbour resample of a grid and its anchor
(`round(n · k)`), pure.
`raster.ts`: `upscaleBlock(src: Uint32Array, w, h, k): Uint8ClampedArray` — exact k× block copy to RGBA bytes,
pure. `backgrounds.ts`: `makePixelTexture(scene, key, draw: (c: PixelCanvas, w, h) => void, w, h)` — builds a
`PixelCanvas` at `w / PIXEL × h / PIXEL`, runs `draw`, block-copies ×`PIXEL` into a `CanvasTexture` of exactly
`w × h` with `NEAREST` filtering. Not used by any generator until 13.04.

## Behaviour
1. `jointToSprite` is unchanged; with `SPRITE_SCALE = 1` a sprite px is a world px, so a standing fighter is
   105 rows tall from the anchor row.
2. Placeholder art: `CHARACTER_PARTS` and `ITEM_PARTS` are the 11.01 grids through `scalePart(part, 2.1)`
   (3 world px per old art px × 0.7 body = 2.1 new art px per old one). Commit message says they are placeholders.
3. `PIXEL = 2`: `snap` and friends work on a 2 px grid; the `snap(4) === 3` family of examples is re-stated
   (`snap(3) === 4`, `snap(5) === 6`, `snap(-3) === -4`, `snapUp(3) === 4`). 12.01 rule 1 ("PIXEL === SPRITE_SCALE")
   is retired by this lane: the fighter grid is finer than the world grid by design.
4. Background textures keep their exact `TEXTURE_SIZE`; `upscaleBlock` is exact (every source pixel becomes a
   k × k block, no offset, no blending).
5. Portrait: `CELL = PORTRAIT_SIZE` (1 art px per canvas px) so the 36 px head fits; `portraitPixels` still
   composes head over torso with the arena's outline, rim and dither.
6. `sprites.html`: the hero row is 3× (a 6× 105 px fighter would not fit); `HERO_H` follows `FRAME_H`.
7. **Bounds contract for 13.02–13.07:** the standing world bounds per character recorded by the new test
   (width, height, top offset from the feet, feet row = anchor) must hold through every later lane within ±1 px.

## Invariants
- No gameplay coordinate is snapped; the sim is read as-is.
- `SpriteFighter`'s public API and `ComposeOpts` are unchanged in this lane.
- Every `tools/e2e/*.json` plan and every `dev/*.html` page runs with zero page errors.

## Tests
`pixel.test.ts` re-stated for 2. `sprites.test.ts`: minimum part sizes × 2.1 (hands 11 × 11, feet 15 × 8, head
≥ 29, torso ≥ 25 × 38, items 21–29 px), idle ≥ 92 rows, KO frame < 63 rows and > 63 columns, hand centre within
4 px of the fist, blink torso differs in ≤ 14 pixels, the character × state × facing × item matrix still clears
the raster border, plus the standing-bounds table (rule 7). `raster.test.ts`: `upscaleBlock` exactness and
`scalePart` sizes/anchors. `portrait.test.ts` unchanged expectations.

## Done when
- [ ] tests pass, `pnpm test` and `pnpm typecheck` green
- [ ] `sprites.html`, `dev/stage.html`, `dev/ambience.html`, `?debug=1` attract shots taken; `updateMs` for 4
  fighters reported against the 1.06–1.36 ms baseline
- [ ] committed with 13.00: `art: 13.00 body 70 % + 13.01 art grid 1 px (placeholder part grids)`
