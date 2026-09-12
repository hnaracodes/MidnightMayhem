# 12.02 — The light rig: darkness, pools, sources, rim

## Purpose
The stage is lit evenly from nowhere. This lane makes light come from things you can point at — the carriage
windows, roof lamps, the red tail lamp, the moon, the firebox, a burning molotov, the beam — and puts the rest of the
world in gloom. Fighters stay the most readable thing on screen: they are never darkened below three quarters and
carry a rim light whose colour and side follow the nearest source.

## Files
Modify: `packages/client/src/game/palette.ts` (five tokens), `backgrounds.ts` (roof lamp data + heads, contrast pass,
tint retired), `sprites/compose.ts` + `sprites/grid.ts` (rim side/colour, gloom), `rig/draw.ts` (rim side/colour,
gloom, shadow pool), `ArenaScene.ts` (owns `Lighting`), `effects.ts` + `itemFx.ts` (light pulses), `hud.ts` (no
change), `src/dev/stagePreview.ts` + `dev/stage.html` (walking stand-in under the lamps, a fire pool).
Create: `packages/client/src/game/stage/lighting.ts`, `test/lighting.test.ts`.
Owns `stage/lighting.ts`, the rim options of `compose.ts`/`draw.ts`, `ROOF_LAMPS` in `backgrounds.ts`.

## Depends on
12.01 (`PIXEL`, `snap`), 11.02 (`Layers`, `Lcg`, `applyTrainCar`), 11.01 (`PixelCanvas.rim`, `edgeDither`),
11.05 (`ArenaScene`, `Effects`, `ItemFx`).

## Exposes
`palette.ts`: `P.void0 0x03050C`, `P.haze 0x34426A`, `P.bone 0xE9E2CF`, `P.glow1 0x7FE7F0`, `P.lamp 0xF7C77A` and
the same five in `CSS_P`. Existing tokens untouched.

`stage/lighting.ts`:
```ts
export interface Light { x: number; y: number; r: number; color: number; intensity: number; flickerHz?: number }
export interface LightHandle { readonly id: number }
export interface RimChoice { color: number; side: "left" | "right" | "both"; gloom: number }
/** What `Effects` and `ItemFx` need: transient lights without owning the rig. */
export interface LightSink {
  addLight(l: Light): LightHandle; moveLight(h: LightHandle, x: number, y: number, intensity?: number): void;
  removeLight(h: LightHandle): void; pulse(l: Light, frames: number): void;
}
export const DARK_ALPHA: Record<TrainCar, number>;      // STANDARD 0.35, FINAL_CAR 0.45, TUNNEL 0.7
export const FIGHTER_MIN_BRIGHTNESS = 0.75;             // gloom mix weight never exceeds 1 − this
export interface LightSpec extends Light { scroll?: "roof" | "tunnel"; every?: number; kind: "lamp" | "window" | "tunnel" | "tail" | "moon" | "firebox" }
export interface Resolved { x; y; rx; ry; color; intensity; cold: boolean; kind: LightSpec["kind"] | "transient" } // a light placed this frame
export function carLights(car: TrainCar): LightSpec[];   // the static sources of a car, pure
export function placeRepeating(spec: LightSpec, offset: number): number[]; // instances of a repeating source on screen, pure
export function lightLevel(lights: readonly Resolved[], x: number, y: number): number; // 0..1+, pure
export function gloomFor(level: number, darkAlpha: number): number; // pure
export function rimFor(lights: readonly Resolved[], darkAlpha: number, x: number, y: number, tunnel?: boolean): RimChoice; // pure
export function flicker(rng: Lcg, st: FlickerState, hz: number, amp: number, dtSec: number): number; // seeded random walk, pure
export class Lighting implements LightSink {
  constructor(scene: Phaser.Scene, seed?: number);
  setCar(car: TrainCar, opts?: { immediate?: boolean }): void; // tweens the darkness alpha over 400 ms, swaps static sources
  update(dtSec: number, offsets: { roof: number; tunnel: number }, opts: { reducedMotion: boolean; rays: boolean }): void;
  rimFor(x: number, y: number): RimChoice;
  lights(): readonly Resolved[];                          // live static + transient, for tests and the debug readout
  destroy(): void;
}
```
`sprites/compose.ts` `ComposeOpts` gains `rimColor: number`, `rimSide: "left" | "right" | "both"`, `gloom: number`
(`rimBoth` removed; `rimSide: "both"` replaces it). `grid.ts` `PixelCanvas.rim(color, side, outlineColor)`.
`rig/draw.ts` `DrawOpts` gains `rimSide`, `gloom` (`rimBoth` removed); `drawShadow(g, x, groundY, height)` keeps its
signature and draws the soft pool.
`backgrounds.ts`: `makeTexture` exported; `ROOF_LAMPS`, `ROOF_LAMP_PERIOD`, `WINDOW_CENTRE`, `TUNNEL_LAMP` as data;
`Layers.lamps` (the fixture TileSprite, depth −12.2, scrolls with the roof).
`rig/draw.ts`: `shadowPool(height): { w, alpha }` — pure, used by `drawShadow`.
`ArenaScene`: `window.__arena.lights()`; `dev/stage.html`: `window.__stage.rim() / park(x) / walk() / fire(on)`.

## Behaviour
1. Darkness: one full-screen `P.void0` rectangle at depth 0 (above every stage layer, below hazards at 0.5 and
   fighters at 2) at `DARK_ALPHA[car]`, tweened over 400 ms on `setCar`, like `applyTrainCar`. `layers.tint` stays
   at alpha 0 in every car (the red wash is retired; the red tail lamp is a light now).
2. Pools: a 256 px radial texture (`light_pool`, 128 white rings with a cubic ease-out falloff) generated once at
   boot through `makeTexture`. Each light is stamped twice per frame: with `ERASE` into the `RenderTexture` that
   carries the darkness (so the pool punches through the gloom, scale `r / 128`, alpha `intensity`) and with tint
   `color` and alpha `0.35 · intensity` into a second `RenderTexture` blended `ADD` at depth 0.1 (the warm cast).
   Pools are the smooth layer: never snapped.
3. Static sources per car (`carLights`), all diegetic, repeating ones placed by `placeRepeating` against the
   roof / tunnel tile offsets so they sit on their fixtures:
   STANDARD — window spill: one flat `lamp` pool per window (every 120 px, centred on each window, y = ROOF_Y + 8,
   r 80 × 34, intensity 0.4), scrolling with the roof; two roof lamps (`ROOF_LAMPS` at roof-texture x 300 and
   1260, period 1920, so one is always on screen; heads at ROOF_Y − 46, r 210, intensity 0.85, `flickerHz` 0.7);
   the moon (x 740, y 110, r 520, `glow1`, intensity 0.25, cold, no flicker); the firebox (x 1000, y 300, `amber1`,
   r 260, intensity 0.5, flickerHz 2, amplitude 12 %).
   TUNNEL — the same windows and roof lamps plus the wall lamps of `drawTunnelWall` (every 320 px at y 150,
   `amber1`, r 170, intensity 0.7, scrolling with the tunnel tile); no moon.
   FINAL_CAR — STANDARD's sources plus the red tail lamp (`LAMP`, `danger`, r 120, intensity 0.6, pulsing at 1 Hz
   between 40 % and 100 % like the lamp graphic).
4. Roof lamps are drawn in `backgrounds.ts` as a steel bracket and a `lamp`-coloured head with a `white` specular dot
   on the roof texture, so the light has a fixture; `ROOF_LAMPS` is the single source of their positions.
5. Flicker: `flicker` is a seeded random walk toward a new target within ±`flickerAmp` (default 5 %) every
   `1 / flickerHz` seconds, eased between targets; the same seed gives the same sequence on both laptops. Transient
   lights flicker the same way (a fire at 8 Hz, ±30 %). Under `reducedMotion` every flicker is frozen at 1.
6. God-rays: three additive `Graphics` wedges per roof lamp (alpha ≤ 0.06, `lamp`), 20–30° wide, 1.6 r long,
   drifting ±2° on a 9 s sine; still under `reducedMotion`, hidden when `opts.rays` is false (quality low).
7. Transients through `LightSink`: `ItemFx` adds a light per burning fire hazard (`amber1`, r 160 × 110, intensity
   0.8 × the hazard's fade, flicker 8 Hz ±30 %, moved with the hazard, removed when it expires); on `LASER_FIRE` it
   pulses a wide `glow1` light along the beam (r 520 × 110 at the beam's mid-point, over the beam + fade frames) and
   a `lamp` light at the palms (r 120); `FLASH` pulses `white` (r 400, 6 frames); `ITEM_EQUIP` pulses the item's
   accent at the hand for the materialise (r 120, intensity 0.5); the 9.08 shield barrier keeps a faint cold
   `glow1` light (r 90 × 120, intensity 0.25, doubled during the absorb flash) while it stands. `Effects` pulses
   `amber1` (r 90, 4 frames) at each clean-hit impact point. A pulse decays linearly to 0 over `frames` then
   removes itself.
8. Fighter rim: `rimFor(x, y)` (sampled 60 px above the feet) picks the strongest warm light against the moon at
   the fighter. `color` is that light's colour (`lamp`, `amber1`, `danger`, the transient's own) when a warm light
   dominates, `glow1` when the moon does or nothing reaches; `side` is `"left"` when the light is left of x,
   `"right"` otherwise (the moon lights from the right for x < 740), `"both"` in the tunnel or when the two
   strongest warm lights straddle the fighter within 20 % of each other. `gloom = gloomFor(lightLevel, darkAlpha)`
   is `clamp((darkAlpha − 0.6·level) · 0.5, 0, 1 − FIGHTER_MIN_BRIGHTNESS)`: a fighter in a pool has gloom 0, one in
   the tunnel dark has 0.25 — the sprite's fills mix toward `night1` by `gloom` before the outline pass, so outline
   pixels (including in-part detail) and the rim are untouched. Same in `draw.ts` for the vector rig.
9. `compose.ts` draws the rim on `rimSide` and the `edgeDither` on the opposite side (none when `"both"`); the
   sprite stays fully opaque. No per-pixel light math beyond the two existing passes.
10. Contact shadow: three stacked ellipses (`outline` at 0.32, 0.18, 0.08 alpha) whose width goes from 64 px on the
    ground to 110 px at 150 px up while the alpha goes 1 → 0.3, centre snapped to `PIXEL`; a fighter mid-jump reads
    as floating above a fading pool, a landing fighter as planted.
11. Contrast pass: sky gradient bottom moves toward `haze`, stars lose 20 % alpha, far clouds are drawn 60 % toward
    `haze`, near clouds 30 %; the carriage body below the roof lip is darkened 25 % toward `void0`. The fighter band
    (ROOF_Y − 160 … ROOF_Y) keeps today's contrast.
12. `dev/stage.html` gains a `SpriteFighter` walking left and right across the roof (120–840 px at 120 px/s) and a
    fire light at x 600 (key F toggles it); `window.__stage.rim()` returns the current `RimChoice` and x,
    `park(x)` / `walk()` hold or release him, `fire(on)` sets the fire light.

## Invariants
- Presentation only: no sim number, no snapshot field written; the light rig reads `MatchState` only through
  `ItemFx.draw` (hazards) and `ArenaScene.drawOne` (positions).
- Every random value in this lane comes from `Lcg`; `Lighting` takes a seed and defaults to `0x11a7`.
- Fighter brightness never drops below `FIGHTER_MIN_BRIGHTNESS`; darkness sits below fighters, never over them.
- `update()` with four fighters, four fire lights and a beam stays under the 4 ms budget in the headless driver.
- `?rig=vector` keeps working with the same rim choice.

## Tests
`lighting.test.ts`: rule 3 source kinds and colours per car, `placeRepeating` follows the offset; rule 5 flicker
bounds and determinism (two rngs with the same seed agree; `reducedMotion` holds the lamps at nominal); rule 7 a
pulse decays linearly and is gone after `frames`, a moved light reports its new place; rule 8 `rimFor` side flips
across a lamp, `glow1` far from every lamp, `"both"` in the tunnel and between two lamps, gloom 0 under a lamp and
≤ 0.25 anywhere; rules 1–2 the darkness fill and one erase + one cast stamp per light, `setCar` tweens the alpha;
rule 10 the shadow pool widens and fades with height on the pixel grid. `sprites.test.ts`: rim on the chosen side
only, the rim colour follows the light, `gloom` 0.25 leaves the outline pixels untouched.

## Done when
- [ ] tests pass, `pnpm test` and `pnpm typecheck` green
- [ ] `.shots/ambience-stage-{standard,tunnel,final}.png` and the arena shots: lamps are the brightest thing on the
  stage, the tunnel is near-black with lamps and rim only, a molotov fire casts a moving pool, a fighter walking
  from a lamp into the dark changes rim side and gloom while staying readable; reviewed by the agent
- [ ] `window.__arena.updateMs()` reported before/after on 2P roof and 4P chaos
- [ ] committed on `main` with prefix `ambience:`
