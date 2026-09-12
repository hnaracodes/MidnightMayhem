# 13.02 — The shading engine: lit cylinders, creases, occlusion, and a raster that pays for itself

## Purpose
Limbs are flat single-colour capsules, so nothing on a fighter reads as a volume. This lane replaces them with
tapered capsules shaded as cylinders from a real light direction in four steps with a 2×2 ordered dither, adds a
crease and dark wedge at bent joints, darkens where one body part overlaps another, and declares material ramps
so 13.03 can author against four steps instead of two. Because the 1 px grid made the raster 4.5× larger, the
same lane removes the per-frame allocations, fuses the finishing sweeps and skips rasterising a fighter whose
inputs did not change.

## Files
Create: `packages/client/src/game/sprites/shade.ts`, `test/shade.test.ts`.
Modify: `sprites/grid.ts` (part ids, in-place outline, scratch buffers, `occludeAndGloom`, `finishColor`, ramps),
`sprites/compose.ts` (tapered limbs, ids, light vector, `composeKey`), `sprites/SpriteFighter.ts` (compose cache,
Uint32 upload), `raster.ts` (`packForImageData`), `stage/lighting.ts` (`lightDirFor`, `RimChoice.dir`),
`ArenaScene.ts`, `src/dev/{stagePreview,ambiencePreview}.ts`, `src/spritePreview.ts`, `test/{sprites,lighting,raster}.test.ts`.
Owns `shade.ts`, the id and finishing passes of `grid.ts`, the light-vector plumbing.

## Depends on
13.01 (`SPRITE_SCALE = 1`, canvas geometry, standing-bounds contract), 12.02 (`Resolved`, `falloff`, `rimFor`).

## Exposes
`shade.ts`:
```ts
export type Ramp = readonly [highlight: number, base: number, shade: number, core: number];
export function rampFrom(base: number): Ramp;                       // 4 steps from one colour, luminance strictly falling
export interface LightDir { x: number; y: number }                  // unit vector toward the light, authored (facing-right) space
export function stepFor(s: number, x: number, y: number, dither?: boolean): 0 | 1 | 2 | 3;
export function taperedLimb(c: PixelCanvas, a: Pt, b: Pt, wa: number, wb: number, ramp: Ramp, light: LightDir | null, flat?: boolean): void;
export function jointCrease(c: PixelCanvas, joint: Pt, from: Pt, to: Pt, r: number, ramp: Ramp): void;
export const CREASE_MIN_DEG = 25;
```
`grid.ts`: `PixelCanvas.ids: Uint8Array` and `id: number` (the part id every `set` records; 255 = outline);
`occludeAndGloom(near, far, shadow, gloom, gloomColor)`, `finishColor(flash, flashAlpha, alpha)`, `outline` and
`mirror` allocation-free; `materialPalette(chars: string, ramp: Ramp): Record<string, number>` (four glyphs → four steps).
`compose.ts`: `ComposeOpts.lightDir?: LightDir | null` (screen space; the composer flips it for facing −1),
`ComposeOpts.flatLimbs?: boolean`; `PART_ID` (`pack 1, legB 2, armB 3, torso 4, head 5, legF 6, armF 7, item 8`);
`composeKey(joints, f, characterId, opts): string` — pure, every input quantised to what the raster can show.
`SpriteFighter.update` gains `lightDir` and `flatLimbs`; it re-rasterises only when `composeKey` changes.
`raster.ts`: `packForImageData(src: Uint32Array, out: Uint32Array, littleEndian: boolean)`.
`stage/lighting.ts`: `lightDirFor(lights, x, y): {x,y} | null` (pure) and `RimChoice.dir?: {x,y} | null`.

## Behaviour
1. **Tapered limbs.** Each arm and leg is two capsules with end widths (shoulder 8 → elbow 6, elbow 6 → wrist 5;
   hip 9 → knee 7, knee 7 → ankle 5 sprite px), sampled at pixel centres so a width-w capsule is w pixels across.
2. **Cylindrical shading.** With `p` the unit vector across the limb and `n ∈ [−1, 1]` the pixel's across position,
   the normal is `(n·p, √(1 − n²))` and the light `(0.8·dir, 0.6)`; `s = N·L` maps to highlight `> 0.78`, base
   `> 0.30`, shade `> −0.20`, else core, after adding `(bayer2 − 0.5) · 0.12` so each boundary dithers 2×2. The
   terminator therefore sits perpendicular to the light: a vertical limb lit from the left is highlight on its
   left column and core on its right; the same limb rotated moves the band with it. With no light vector the
   cylinder is lit from the camera (base in the middle, shade then core toward both edges, no highlight).
3. **A light vector, not a side.** `lightDirFor` sums, over every light reaching the point, the unit vector toward
   it weighted by `falloff` (cold lights at half weight) and normalises; under `0.03` it is `null` (tunnel: lamps
   on both walls cancel). `Lighting.rimFor` returns it as `dir`; `ArenaScene` passes `rim.dir` as `lightDir`.
   When `lightDir` is null the composer derives one from `rimSide` (`left` → (−0.8, −0.6), `right` → (0.8, −0.6),
   `both` → (0, −1)). `rimSide`, the 75 % floor and `MAX_GLOOM` are untouched.
4. **Joint definition.** When the angle between the two segments at an elbow or knee exceeds `CREASE_MIN_DEG`,
   `jointCrease` writes a one-pixel core-colour crease along the inner rim of the joint and mixes the limb pixels
   inside the bend (within the joint radius, on the concave side) halfway toward core.
5. **Ambient occlusion.** Every `set` records the current part id. `occludeAndGloom` darkens a pixel whose
   8-neighbourhood holds a higher id by `0.35` toward night1 and one whose 5×5 ring does by `0.18`; the gloom mix
   (12.02 rule 8) rides the same sweep. Outline pixels (id 255) are never a source or a target.
6. **Material ramps.** `rampFrom(base)` = `[mix(base, moon, 0.22), base, darken(base, 0.74), mix(darken(base, 0.52),
   night1, 0.3)]`. Limb ramps come from `limbColor`, `limbShade`, `legColor`; `materialPalette` lets a part file bind
   four glyphs to a ramp (13.03 uses it; the placeholder grids do not).
7. **Performance.** `outline` marks outline pixels with id 255 and expands only from part ids, so it needs no copy;
   `mirror` swaps through two scratch buffers owned by the canvas; gloom + occlusion is one sweep, flash + alpha
   another (`finishColor`). `SpriteFighter` keeps the last `composeKey` and skips `composeFrame` and the texture
   upload when it repeats (idle and block holds repeat between bob steps because joints are quantised to sprite
   px); the upload writes through a `Uint32Array` view over the `ImageData` buffer. On the `low` tier
   `flatLimbs` draws base-only limbs without dither and skips the crease.

## Invariants
- The 13.01 standing-bounds contract holds (±1 px); `sprites.test.ts` keeps every earlier rule.
- `composeFrame` is still pure and deterministic; `shade.ts` has no randomness at all.
- `?rig=vector` works unchanged (`RimChoice.dir` is optional).
- `updateMs` with four fighters on `high` stays inside the 12.03 budget (6 ms); target ≤ the 13.01 figure.

## Tests
`shade.test.ts`: ramp order; capsule end widths; terminator side for a vertical limb lit from the left and the
right, and for the rotated limb; flat mode is one colour; crease changes pixels only on the concave side;
`materialPalette`. `sprites.test.ts`: occlusion darkens only lower-id pixels next to a higher id; frames lit from
the left and right differ but both keep the standing bounds; `composeKey` is stable, changes on a 1 px joint move,
ignores a sub-pixel one; outline matches the reference 8-neighbourhood definition. `raster.test.ts`:
`packForImageData` byte order. `lighting.test.ts`: `lightDirFor` toward one lamp, null between two, null far away.

## Done when
- [ ] tests pass, `pnpm test` and `pnpm typecheck` green
- [ ] `sprites.html` and `dev/ambience.html` show limbs with visible volume; `dev/stage.html` stand-in shades from
  the lamp side as he walks (screenshot pair `.shots/art/02-lit-*.png`)
- [ ] `updateMs` for 1 / 2 / 4 fighters reported against 13.01
- [ ] committed with prefix `art:`
