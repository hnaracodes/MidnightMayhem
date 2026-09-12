# 13.05 — Map art: cargo racks and gaps as pixel art

## Purpose
The gaps and racks are flat Graphics rectangles with a warning stripe. This lane redraws both as pixel art at the
2 px grid — torn roof edges, exposed ribs, buffers, a coupling with real linkage and brake hoses for the gaps;
stacked crates with slats, straps, labels and rust on a braced frame for the racks — with the geometry still read
from `MAPS`, so what you collide with is exactly what you see. Scope set by the owner on 2026-09-12: racks and
gaps; the per-map density pass (`chaos` most worn) is folded into the two drawings by span.

## Files
Modify: `packages/client/src/game/stage/mapDraw.ts`, `stage/motion.ts` (`applyBob` calls `map.bob`),
`test/stage.test.ts`.
Owns `mapDraw.ts`.

## Depends on
13.04 (`makePixelTexture`, `Painter`-style wrap not needed: map art does not tile), 10.01 (`MAPS`).

## Exposes
`mapDraw.ts`:
```ts
export function gapArt(x0: number, x1: number): { canvas: PixelCanvas; x: number; y: number };   // pure, art px
export function rackArt(x0: number, x1: number, y: number): { canvas: PixelCanvas; x: number; y: number }; // pure
export const GAP_ART = { reach: 8 /* world px the torn edge art extends onto each car */, ... };
export const RACK_ART = { slab: 12, ... };
```
`MapLayer` keeps `gaps` (the night0 mask), `platforms` (now only the underlight glow), `slices`, `spans`, `setMap`,
`update`, `destroy`, and gains `images: Phaser.GameObjects.Image[]` (one per gap and per rack, canvas textures
keyed by span) and `bob(offset: number): void` (moves every image with the train). `MAP_DEPTH` gains `gapArt`
(above the track slice) and `rackGlow` (under the rack image).

## Behaviour
1. **Gaps** (`gapArt`, world x0 − 8 .. x1 + 8, y ROOF_Y .. HEIGHT): the mask stays a Graphics rect over exactly
   `[x0, x1]`. The art draws, on each car end, a torn roof edge — a bright steel lip on the roof row with bent
   metal shards dropping 1–3 px into the gap, a dark drop shadow under the lip so the edge is legible — the car-end
   wall with exposed vertical ribs, a riveted buffer plate; between the cars a coupling with two hooks and a pin, a
   sagging brake hose with a red coupling head on each end, and a danger-striped bar under the knuckle. Nothing
   opaque is drawn inside `(x0, x1)` above world y 440 except the hoses and coupling, so the pit reads open.
2. **Racks** (`rackArt`, world x0 .. x1, y − 2 .. ROOF_Y): the standable surface is a plank row exactly at
   `platform.y` across `[x0, x1]` (art row 1; row 0 is its outline). Below it the 12 px slab is stacked cargo: crate
   fronts with slats and nail heads, two straps with buckles, a stencilled label per crate, rust dither at the
   corners, a tarpaulin corner hanging off the far end (inside the span); under the slab the braced frame — two
   legs with cross braces, rust at the feet — down to the roof. The underlight glow stays Graphics (alpha).
   No opaque pixel above row 0, none outside `[x0 − 1, x1 + 1]` (the outline).
3. Density by span: a span in `MAPS.chaos` (both gaps and racks present) draws extra wear — more rust, a second
   torn shard, a missing slat — decided from the map id passed to `setMap`, never randomly.
4. `bob(offset)` moves the mask, glow and every image by the train bob; `Motion.applyBob` calls it.
5. Textures are keyed by geometry (`map_gap_300_380`, `map_rack_150_330_330`) and created once per key.

## Invariants
- `spans` reports the same values as before; the `?debug=1` platform lines coincide with the plank row.
- No allocation per frame; `setMap` destroys the previous images.
- No pixel implies a ledge, step or handhold outside `MAPS` (tested: rack rows above the surface are empty;
  gap art inside the span is empty above y 440 apart from coupling and hoses).

## Tests
`stage.test.ts`: the gap mask rects still equal `MAPS.gaps`; `gapArt` and `rackArt` sizes and placements; rack row
1 opaque across the span, row 0 outline only, nothing outside the span ±1; gap art empty inside the span above
the coupling row; `setMap` creates one image per span and `bob` moves them; `chaos` draws more opaque wear pixels
than `platforms` for the same rack.

## Done when
- [ ] tests pass, `pnpm test` and `pnpm typecheck` green
- [ ] `.shots/art/05-map-{gaps,platforms,chaos}-debug.png` with `?debug=1` show the plank row on the collision line
- [ ] committed with prefix `art:`
