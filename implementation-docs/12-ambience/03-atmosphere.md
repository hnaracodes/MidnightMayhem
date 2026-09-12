# 12.03 — Atmosphere and post-processing: haze, foreground, particulate, bloom, quality tiers

## Purpose
With the light rig in, the stage still reads as flat bands. This lane puts air between them — haze behind the far
layers, a near-black foreground sliding past the camera, dust and embers in the light — and lets the lamps and the
beam bleed through a soft bloom. Because pose inference already shares the laptop, every addition is budgeted, capped,
and switchable: a `low` tier keeps the light rig and drops the rest, automatically when the frame runs over.

## Files
Modify: `packages/client/src/game/backgrounds.ts` (haze strips, foreground layer), `session.ts` (`quality`),
`ArenaScene.ts` (post-FX, quality policy, particulate wiring, debug readout), `src/dev/stagePreview.ts`.
Create: `packages/client/src/game/stage/particulate.ts`, `stage/quality.ts`, `test/particulate.test.ts`,
`test/quality.test.ts`.
Owns `stage/particulate.ts`, `stage/quality.ts`, the haze/foreground rows of `backgrounds.ts`.

## Depends on
12.02 (`Lighting`, `P.haze`, `P.void0`, `Lcg`), 11.02 (`Layers`, `scrollBackgrounds`), 11.05 (`session`).

## Exposes
`stage/quality.ts`:
```ts
export type Quality = "high" | "low";
export const FRAME_BUDGET_MS = 6;         // update() EMA that trips the downgrade (compositing included)
export const OVER_BUDGET_FRAMES = 120;    // ~2 s
export function qualityFromQuery(search: string): Quality | "auto";       // `?quality=high|low`, else "auto"
export function resolveQuality(pref: Quality | "auto", webgl: boolean): Quality; // auto → high on WebGL, low otherwise
/** Pure downgrade policy: counts consecutive over-budget frames; returns the new tier and whether it changed. */
export function qualityStep(st: QualityState, updateMs: number): { state: QualityState; changed: boolean };
export interface QualityState { quality: Quality; over: number; locked: boolean }
```
`session.ts`: `quality: Quality | "auto"` from the URL (default `"auto"`).
`stage/particulate.ts`:
```ts
export const MAX_MOTES = 40;
export const MAX_EMBERS = 24;
export class Particulate {
  constructor(scene: Phaser.Scene, seed?: number);
  update(dtSec: number, opts: { reducedMotion: boolean; enabled: boolean; roofSpeed: number }): void;
  live(): { motes: number; embers: number };
  destroy(): void;
}
```
`backgrounds.ts`: `Layers.hazeFar`, `Layers.hazeNear` (Images), `Layers.foreground` (TileSprite, depth 0.3),
`FOREGROUND_SPEED = 1.4` (× roof speed).
`ArenaScene`: `window.__arena.particles()` → `{ motes, embers }`, `window.__arena.quality()` → `Quality`.

## Behaviour
1. Haze: two baked vertical gradient strips (`haze` → transparent, 1920 × 120) — `hazeFar` at depth −15.5 (between the
   cloud layers) and `hazeNear` at depth −12.6 (between clouds and roof, above the fixtures' background), alpha 0.35
   and 0.25 in the open, 0 in the tunnel (faded with the sky in `applyTrainCar`).
2. Foreground: a `void0` silhouette TileSprite (1920 × 540, depth 0.3, scrolling at `FOREGROUND_SPEED` × roof speed)
   of catenary cable sags across the top 40 px and pole stubs / railing edge in the bottom 60 px, transparent in the
   fighter band (y 100–470). Baked from a seeded `Lcg` so both laptops agree; still under `reducedMotion`.
3. Particulate: `Particulate` keeps a pool of `MAX_MOTES` dust motes (cold, `moon` at 0.18–0.35 alpha, 1–2 px, drifting
   left at 8–20 px/s with a 0.4 Hz sine bob, spread over the whole stage above the roof) and `MAX_EMBERS` embers
   (`amber1`/`lamp`, 2 px, born near the firebox edge (x 900–960, y 260–340), rising 30–60 px/s and drifting left at
   0.3 × roof speed, dying over 2–4 s). One `Graphics` each, redrawn per frame, depth 0.4 (motes) and 3.9 (embers,
   in front of fighters, behind item FX). Spawn is deterministic from the seed; a dead particle is recycled, never
   allocated; `live()` never exceeds the caps. `enabled: false` or `reducedMotion` clears both and draws nothing.
4. Bloom and vignette: Phaser's camera bloom has no threshold and softens every sprite and glyph, so bloom is
   per object instead — `Lighting.setQuality(true)` adds `postFX.addBloom(0xffffff, 1, 1, 1.2, 0.9, 4)` to the
   light cast and the god-rays, and `LightSink.glow(obj)` adds the same to the beam Graphics from `ItemFx`;
   WebGL and the high tier only, removed on `low`, a no-op on Canvas. The ambient vignette is not post-FX: a baked
   radial `void0` mask (`ambient_vignette`, clear inside 50 % of the half-diagonal, alpha 0.55 at the corners) as an
   Image at depth 9.5, under the HUD (10) so text and bars stay crisp, on both tiers and on Canvas. The `Effects`
   danger vignette keeps its `danger` tint and 2 Hz pulse and reads distinctly against it.
5. Quality: `session.quality` from `?quality=`; `resolveQuality("auto", webgl)`; `high` = everything, `low` = no
   bloom, no god-rays (`Lighting.update` `rays: false`), no particulate; haze, foreground, vignette and the light
   rig kept. *13.02 / 13.06:* `low` also draws the fighters' limbs flat (`flatLimbs`, no cylinder shading, dither or
   crease) and thins the ambient props to the lamp flicker and the vent flap.
   `qualityStep` counts frames with `updateMs > FRAME_BUDGET_MS`; at `OVER_BUDGET_FRAMES` it drops to `low` once
   (`locked`) and `ArenaScene` logs `console.info("[ambience] quality → low ...")` exactly once. A tier never goes
   back up during a session.
6. Debug readout gains `q high|low  motes N embers N`.
7. `dev/stage.html` runs `Particulate` and the two haze strips too; `?quality=low` is honoured there.

## Invariants
- No `Math.random`, no `Date`: particles come from the seeded `Lcg`; both laptops draw the same motes.
- Live particles never exceed `MAX_MOTES + MAX_EMBERS`; no per-frame allocation after the pool is built.
- Fighters, HUD text, hazards and projectiles are never bloomed: bloom lives only on the light layers and the beam.
- `update()` with four fighters, four fires, a beam and a flash stays ≤ 4 ms on `high` on the headless driver or
  the tier downgrades and says so.

## Tests
`quality.test.ts`: `qualityFromQuery`, `resolveQuality` (auto/WebGL matrix), `qualityStep` trips after exactly
`OVER_BUDGET_FRAMES` over-budget frames, resets on a good frame, never re-arms once locked. `particulate.test.ts`:
caps hold over 30 s of updates, two seeds differ, the same seed matches, `reducedMotion` and `enabled: false` give
zero live particles, embers rise and die.

## Done when
- [ ] tests pass, `pnpm test` and `pnpm typecheck` green
- [ ] `.shots/ambience-stage-*.png` show haze between bands and a foreground silhouette; arena 4P chaos shot shows
  motes and embers; `?quality=low` shots are plainer but whole; reviewed by the agent
- [ ] `window.__arena.updateMs()` reported before/after on 2P roof and 4P chaos, with `particles()` and `quality()`
- [ ] committed on `feat/graphics-enhancement` with prefix `ambience:`
