# 13.06 — Ambient map props: the car is alive with nobody on it

## Purpose
The stage scrolls but nothing on it moves of its own accord. This lane adds a fixed pool of small animated
props — a flickering, occasionally failing roof lamp, a chattering vent flap, swaying chains, steam puffs from a
roof vent, a snapping tarpaulin corner on each rack, ballast dust rising through each gap — phase-locked to the
existing train bob and wheel clack so the car reads as one object. Scope set by the owner on 2026-09-12: ambient
props only; the reactive tier (landing dust, lamp swing on impact, KO crate shift, molotov flare, laser wake) is
deferred to the 13.07 notes.

## Files
Create: `packages/client/src/game/stage/props.ts`, `test/props.test.ts`.
Modify: `stage/lighting.ts` (`setLampGain`), `backgrounds.ts` (`Layers.props`, stepped by `scrollBackgrounds`,
bobbed by `Motion.applyBob`), `ArenaScene.ts` (quality / reduced-motion options, debug readout `props N`),
`src/dev/stagePreview.ts` (readout), `test/lighting.test.ts`.
Owns `stage/props.ts`, the lamp gain hook.

## Depends on
13.05 (`MapLayer.spans`), 12.02 (`Lighting`, `ROOF_LAMPS`, `ROOF_LAMP_PERIOD`), 12.03 (`Quality`), 11.02 (`Motion` bob and clack).

## Exposes
```ts
export const MAX_PROPS = 24;
export type PropKind = "lamp" | "flap" | "chain" | "steam" | "tarp" | "dust";
export class Props {
  constructor(scene: Phaser.Scene, lighting: { setLampGain(index: number, gain: number): void }, seed?: number);
  setMap(spans: MapLayer["spans"]): void;                               // re-places the tarps (racks) and dust (gaps)
  update(dtSec: number, opts: { reducedMotion: boolean; quality: Quality; roofOffset: number; bob: number; clack: boolean; tunnel: boolean }): void;
  live(): number;                                                        // animated props this frame (≤ MAX_PROPS)
  bob(offset: number): void;
  destroy(): void;
}
```
`Lighting.setLampGain(index, gain)`: multiplies the `index`-th roof lamp's intensity by `gain` this frame (1 = no
change), for the flicker and the failing lamp. `Layers.props: Props`. `window.__arena.props()` and the debug
readout `props N`. `dev/stage.html` readout gains `props N`.

## Behaviour
1. **Pool.** `MAX_PROPS` slots allocated at boot, one `Graphics` for all sprite-drawn props redrawn per frame;
   nothing allocated after `setMap`. `live()` never exceeds the cap; on the `low` tier only the lamp flicker and
   the vent flap run (the rest are cleared); under `reducedMotion` everything is frozen at rest and the lamp gain
   is 1.
2. **Lamp flicker and the failing lamp.** Each of the two roof lamps gets a seeded random-walk gain of ±6 % at
   1.4 Hz (finer than 12.02's own 0.7 Hz walk, multiplied with it); the second lamp is the failing one: every
   6–11 s (seeded) it stutters for 0.25 s (gain 0.3, 1, 0.5, 1 over four frames), drops to 0.15 for 4–8 frames,
   then recovers over 0.4 s. The gain is applied through `setLampGain`, so the light pool and god-rays fail with
   the fixture; the fixture head is dimmed by the same gain with a small `Graphics` cap over its lamp head,
   placed from `ROOF_LAMPS` and `roofOffset` like the pools are.
3. **Vent flap.** One loose flap per roof panel period (a 10 × 4 world px plate on the roof lip at x 150 + 240 k,
   scrolling with the roof): it hangs at rest and flips up 2 px on every wheel clack, settling back over 6 frames;
   the bob adds ±1 px.
4. **Chains.** Two chains hang from the underside of the roof lip at x 60 + 480 k (three links, 6 px), swinging
   ±2 px on a 1.5 Hz sine offset by the bob phase and kicked +2 px on a clack.
5. **Steam.** A roof vent at x 700 (scrolling with the roof) releases a puff every 1.6 s (seeded ±0.4 s): a 2 px
   grid disc that rises 18 px and drifts screen-left over 1.2 s while fading; in the tunnel the puffs are 40 %
   larger and rise half as fast (they hang). At most 6 live puffs.
6. **Tarpaulin corner.** On every rack (`spans.platforms`) the corner at the far end snaps: a 3-point flag from the
   slab edge whose tip flips ±3 px at 4 Hz with a seeded jitter, still under reduced motion.
7. **Ballast dust.** Every gap (`spans.gaps`) spawns 1 px dust specks at the track (y 480–500) that rise 20–30 px
   and drift screen-left over 0.6 s, one every 0.15 s per gap, capped by the pool.
8. **Phase lock.** `update` receives the frame's bob offset and whether a clack fired this frame from `Motion`
   (`Motion.lastClack`), so every swing and flip lines up with the train.
9. **Determinism.** One `Lcg` (`0x9a0b`) drives every timing; two laptops with the same seed draw the same props.

## Invariants
- No `Math.random`, no `Date`; no allocation after boot; `live() ≤ MAX_PROPS`.
- `updateMs` delta on `high` under 0.3 ms (measured in the 13.07 table).
- Nothing new glows or floats: every prop is attached to a fixture, a rack or the track.

## Tests
`props.test.ts`: caps hold over 30 s; same seed → same draw calls, different seed differs; `reducedMotion` and
`low` leave the counted props at 0 (flap and lamp excepted on `low`); the failing lamp's gain visits < 0.5 within
15 s and returns to 1; a clack kicks the flap; `setMap` places one tarp per rack and dust only in gaps.
`lighting.test.ts`: `setLampGain` scales that lamp's resolved intensity this frame only.

## Done when
- [ ] tests pass, `pnpm test` and `pnpm typecheck` green
- [ ] `dev/stage.html` shows the props moving with nobody on the roof (`.shots/art/06-props-*.png`), `props N` in the readout
- [ ] committed with prefix `art:`
