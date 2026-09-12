# 13.04 — Train art: the roof and the carriage body as pixel rasters

## Purpose
The stage layers are Phaser Graphics baked to textures — smooth vector shapes with hard edges — so the world and
the pixel fighters read as different games. This lane ports the two layers the fighters stand against, the roof
and the carriage body, to pixel art at the 2 px grid through 13.01's `makePixelTexture`. Scope set by the owner
on 2026-09-12: roof and body only; sky, stars, moon, clouds, tunnel wall, track, lamps and railing stay as they
are (listed for 13.07's notes). Lights, fog, god-rays, bloom and the moon's glow stay smooth.

## Files
Modify: `packages/client/src/game/backgrounds.ts` (`PIXEL_GENERATORS`, `drawRoofPx`, `drawBodyPx`, boot cost log,
stub-safe `makePixelTexture`), `test/stage.test.ts` (canvas-texture stub, new tests).
Owns the roof and body generators.

## Depends on
13.01 (`makePixelTexture`, `upscaleBlock`, `PIXEL`), 12.02 (`WINDOW_CENTRE`, the window spill pools).

## Exposes
`backgrounds.ts`: `renderPixelArt(key: "bg_train_roof" | "bg_train_body", seed?): PixelCanvas` — pure, the raster
at art resolution (`TEXTURE_SIZE / PIXEL`), for tests; `TEXTURE_BOOT_MS` — the last measured generation cost in
ms (0 when `performance` is unavailable), logged once as `[art] stage textures …`.

## Behaviour
1. `bg_train_roof` (1920 × 130 → 960 × 65 art px). Only art rows 0–14 show above the body layer (`ROOF_LIP`),
   so every feature lives in that band: a moonlit lip on rows 0–1 that runs unbroken over the seams, rivet pairs
   every 30 px under the lip (row 3) and under the ridge (row 11), the raised ridge (highlight row 6, shadow rows
   9–10), panel seams every 120 art px as a dark double line from row 2 with a rivet column, eight seeded tar
   patches with dithered edges between lip and ridge or under it, sixteen seeded rust streaks trailing screen-left
   from the rivet rows (the airflow), and pooled grime where each seam meets the gutter. A walkway tread was drawn
   and dropped: it sat under the body layer. Every x goes through a wrap so the tile is seamless by construction.
2. `bg_train_body` (1920 × 110 → 960 × 55 art px): rows 0–14 and 35–54 stay transparent (the roof lip and the
   11.02 wheel band); a dithered body gradient darker toward the bottom; a gutter highlight and dark edge on rows
   15–16 and a dark sill edge on row 34; seams every 120 px with rivet columns; two horizontal rivet rows; framed
   windows every 60 art px from x 15, 30 wide, glass rows 18–31 with a 1 px frame, mullion, a moon-tinted
   reflection dither in the top rows and a steel sill; one ladder per 240 px; a louvred vent per panel; a
   two-digit stencilled car number per panel in bone; two or three seeded weathering streaks under every window.
   `WINDOW_CENTRE` is unchanged, so the 12.02 spill pools still sit on the glass.
3. Both rasters come from one `Lcg` seed (`0xa47`) so both laptops draw the same car; `TEXTURE_SIZE`, tile widths,
   scroll speeds, depths and `applyTrainCar` are untouched.
4. `generateTextures` times the whole batch with `performance.now()` when present and logs it once.
5. `makePixelTexture` returns without registering when the scene's texture manager has no `createCanvas` (the
   node test stubs); production Phaser always has it.

## Invariants
- Zero per-frame cost change: the textures are baked once at boot.
- No seam at any scroll position (wrap-by-construction; asserted for every feature-bearing row).
- The 12.02 window spill pools and the 12.03 haze/foreground layers are untouched.

## Tests
`stage.test.ts`: the roof and body textures are created through `createCanvas` at exactly their `TEXTURE_SIZE`;
`renderPixelArt` is deterministic and has the declared art size; the roof lip row is `steel2` across the whole
width; glass pixels sit centred on every `WINDOW_CENTRE` position; every row's pixel at x = 0 continues the one
at x = w − 1 for the structural bands (lip, ridge, gutter, sill), and no seeded feature is cut at the edge (a
feature pixel at x = w − 1 implies its wrapped neighbour at x = 0 is a feature or structure pixel).

## Done when
- [ ] tests pass, `pnpm test` and `pnpm typecheck` green
- [ ] `.shots/art/04-stage-{standard,tunnel,final}.png` reviewed; boot cost reported
- [ ] committed with prefix `art:`
