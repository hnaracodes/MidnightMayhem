# 11.02 — Stage motion and map drawing

## Purpose
Make the train visibly move and the world breathe — wheels, sparks, smoke, poles, bob, lightning, tunnel whoosh —
and draw the four maps (gaps as broken roof with couplings, platforms as cargo racks) so the geometry the sim uses
is exactly what the player sees.

## Files
Modify: `packages/client/src/game/backgrounds.ts`, `packages/client/dev/stage.html`, `src/dev/stagePreview.ts`.
Create: `packages/client/src/game/stage/motion.ts`, `src/game/stage/mapDraw.ts`, `test/stage.test.ts`.
Owns `backgrounds.ts`, `src/game/stage/**`, `dev/stage.html`, `src/dev/stagePreview.ts`.

## Depends on
8.01 (`MAPS`, `MapId`).

## Exposes
`backgrounds.ts` (existing API kept): `createBackgrounds(scene, map: MapId = "roof"): Layers`, `scrollBackgrounds(layers, dt)`,
`applyTrainCar(scene, layers, car)`. `Layers` gains `motion: Motion` and `map: MapLayer`.

`stage/motion.ts`:
```ts
class Motion {
  constructor(scene: Phaser.Scene, layers: Layers);
  update(dtSec: number, roofSpeed: number, car: TrainCar): void;
  /** Deterministic per-frame RNG seeded at boot so both laptops draw the same sky (LCG from backgrounds.ts). */
  destroy(): void;
}
```
Elements (all Graphics / generated textures, depths between the existing ones):
1. **Wheels and bogies** at the bottom edge (`y 500–540`, depth `body + 0.5`): four wheel pairs per 960 px, r 14, spokes
   rotating at `roofSpeed / (2π·14)` rad/s, a dark bogie frame, the rail line under them with sleepers scrolling at
   roof speed (the body texture is shortened to leave the bottom 40 px to this layer — adjust `drawBody`).
2. **Sparks**: from the rear wheel every 0.4 s ± LCG, 3–5 `amber-1` 2 px particles flying screen-left and down for 0.4 s.
3. **Smoke**: an engine plume from off-screen right at `y 300`, puffs r 10→40 drifting screen-left at 0.6·roofSpeed and up
   12 px/s, `steel-2` 35 % → 0 over 4 s, a new puff every 0.5 s; in the tunnel they are `night-2` and thinner.
4. **Telegraph poles**: between clouds-near and roof, a pole (4 × 220 px `outline` + `steel-0` crossbar with 3 insulator
   dots) every 480 px scrolling at 300 px/s, with a sagging 1 px wire between poles.
5. **Bob**: roof, body, glow, wheels and railing layers translate `y` by `sin(t · 2π · 1.5) · 1` px; every 6 s one 2 px
   "joint clack" downward jolt over 100 ms.
6. **Lightning**: in `STANDARD` and `FINAL_CAR`, every 9–14 s (LCG), a 2-frame `moon` 18 % full-sky flash plus a jagged
   6-segment bolt from the top to `y 200` at an LCG x; never in the tunnel.
7. **Tunnel whoosh**: on the transition into `TUNNEL`, a `night-0` sweep from the right over 300 ms ahead of the existing
   fade; out of it, a `moon` 10 % flash.
8. **Star twinkle** already exists; add a slow 40 s moon drift of 6 px.

`stage/mapDraw.ts`:
```ts
interface MapLayer { gaps: Phaser.GameObjects.Graphics; platforms: Phaser.GameObjects.Graphics; setMap(map: MapId): void }
function createMapLayer(scene, layers): MapLayer
```
- Gaps: the roof and body tiles are masked out over each gap (`Graphics` geometry mask or a `night-0` rect at
  `body + 0.6` plus roof-edge lips): draw both car ends with an `outline` edge, two `steel-2` buffers, a `steel-0`
  coupling bar with a `danger` warning stripe, and the track visible in the gap (a 60 px `track` texture slice)
  scrolling at roof speed.
- Platforms: a cargo rack per entry — `steel-1` slab 12 px tall across the span at `y − 12..y`, `steel-2` top lip with
  rivets every 24 px, two `outline` legs down to the roof with cross-bracing, an `amber-1` 20 % underlight strip on the
  roof beneath. The slab top is exactly `platform.y` so feet sit on it.
- Roof scroll continues under the platforms (they ride with the train, so they do not scroll).

## Behaviour
1. `createBackgrounds(scene, "gaps")` produces a `MapLayer` with two gap masks whose x ranges equal `MAPS.gaps` gaps
   (300–380, 580–660) and no platforms; `"platforms"` two racks at `MAPS.platforms.platforms`; `"chaos"` both.
2. `Motion.update` advances the wheel angle by `roofSpeed · dt / 14` rad and emits a spark within any 0.6 s window at
   240 px/s; no sparks at roof speed 0.
3. Lightning never fires while `car === "TUNNEL"`.
4. Bob offset is applied to roof, body, glow, wheels; not to sky, stars, moon, clouds.
5. Smoke puffs and sparks are destroyed after their lifetime; the count of live Graphics is bounded (≤ 60) after
   60 s of updates.
6. `applyTrainCar` still performs the 4.04 transitions; the whoosh is additive.
7. All motion is deterministic given the seed: two `Motion` instances stepped with the same `dt` sequence produce the
   same spark/lightning timeline (assert via an exposed `timeline()` in tests).

## Invariants
- No image files; every visual is Graphics or a generated texture.
- `Layers.roofSpeed` semantics unchanged (rigs use it as wind).
- Frame cost of `Motion.update` + `scrollBackgrounds` under 1 ms on the headless driver (log it in the preview).

## Tests
`stage.test.ts` with a stub scene (pattern from `effects.test.ts`): rules 1–5, 7.

## Done when
- [ ] tests pass, `pnpm test` and `pnpm typecheck` green
- [ ] `dev/stage.html` takes `?map=` and `?car=`; screenshots `.shots/stage-{roof,gaps,platforms,chaos}.png` and
  `stage-tunnel.png` taken with `tools/shot.mjs` and reviewed by the agent: wheels, poles, smoke, a gap with coupling,
  a rack with underlight all visible
- [ ] committed on `feat/stage` with prefix `design:`
