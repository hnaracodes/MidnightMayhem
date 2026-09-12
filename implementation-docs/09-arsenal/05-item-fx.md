# 9.05 — Item and laser effects

## Purpose
Everything the arsenal draws: the materialise moment when an item appears in the hand, the laser charge and beam,
sword slash, shield bubble, molotov flight and fire, banana peel, and the flash whiteout. Event-driven, state-read,
never predicted. Item sprites in the hand are 11.01's; this file draws the *effects around* them.

## Files
Create: `packages/client/src/game/itemFx.ts`, `packages/client/dev/itemfx.html`, `src/dev/itemFxPreview.ts`,
`test/itemFx.test.ts`.
Owns nothing else. Does not edit `effects.ts` (shared with 11.05) or `ArenaScene.ts`.

## Depends on
8.01 (events, `Projectile`, `Hazard`, `laserHitbox` from 9.03 — import it; until 9.03 merges, import the 8.01 stub
which returns null, and compute the band locally for the preview).

## Exposes
```ts
interface HandPoint { x: number; y: number }
class ItemFx {
  constructor(scene: Phaser.Scene);
  /** Drain once per render frame with the newest snapshot (the one that carried the events). */
  consume(events: SimEvent[], newest: MatchState, hands: (i: PlayerIndex) => HandPoint): void;
  /** Draw state-driven visuals: projectiles, hazards, beams, shield bubble, charge ring. */
  draw(state: MatchState, hands: (i: PlayerIndex) => HandPoint, localIndex: PlayerIndex): void;
  update(dtSec: number): void;
  /** 0..1 whiteout strength for the local player's dazzle; the scene draws the overlay. */
  dazzleAlpha(state: MatchState, localIndex: PlayerIndex): number;
  /** True while a materialise animation is running for that fighter (11.01 hides the item sprite until it ends). */
  materialising(i: PlayerIndex): boolean;
  destroy(): void;
}
```
Depths: projectiles 4, hazards 0.5 (on the roof, under the rigs), beam 4.5, bubble/charge 4, flash overlay is the
scene's (depth 12) using `dazzleAlpha`.

## Behaviour
1. `ITEM_EQUIP`: materialise at the hand — 14 `amber-1` particles implode from a 40 px ring to the hand over 20 frames,
   a `moon` flash disc r 14 at frame 20 fading over 6; `materialising(i)` is true for 26 frames. Distinct accent per item:
   molotov `danger` particles, sword `moon`, shield `steel-2`, banana `amber-1`, flash `white`.
2. `LASER_CHARGE`: a charge ring around the hand grows r 6→22 with 3 orbiting `amber-1` dots, 30 frames, then
   `LASER_FIRE`: the beam from the hand to the world edge, 12 frames, `moon` core 8 px + `amber-1` edge 16 px at 60 %,
   then a 10-frame fade; camera shake 4 px for 8 frames; `LASER_HIT` → impact burst at the target's chest (reuse the
   `fx_impact` recipe from 4.06 rule 1, drawn here).
3. Sword: `PUNCH` from a fighter holding a sword → a 3-frame `moon` slash arc 130 px in front, 60° sweep; `PARRY` →
   a 6-frame `white` spark star at the parrier's hand and shake 2 px.
4. Shield: while `f.item?.kind === "shield"` draw a `steel-2` 30 % bubble ellipse 90 × 150 around the fighter with
   `3 − uses` crack lines; `SHIELD_ABSORB` → bubble flashes `moon` 2 frames; `ITEM_BREAK` for a shield → 8 shards
   flying out over 10 frames.
5. Projectiles: molotov = 8 px `steel-2` bottle with a 12 px `amber-1` flame tail and a 6-point trail; banana = 10 px
   `amber-1` crescent spinning 15°/frame. Fire hazard: 7 flame tongues along `w`, each a triangle animating height
   18–34 px at 8 Hz with `danger`/`amber-1` alternation, plus a `night0` 25 % scorch ellipse; fades out over the last
   30 ticks. Peel: a 14 px `amber-1` flat crescent on the roof with 2 `outline` stripes.
6. `HAZARD_HIT` with damage > 0: small `danger` flash at the target's feet; damage 0 (slip): a 6-frame spin of three
   `moon` stars over the head.
7. `FLASH`: `dazzleAlpha` for the local player = `min(1, dazzle / 30)` over the first 90 ticks, then linear to 0 by 120;
   non-dazzled fighters see a 6-frame white burst at the flasher's hand.
8. All Graphics are destroyed when their timers end; `destroy()` clears everything.

## Invariants
- Nothing here changes state; every visual is a reaction to an event or a state read.
- No effect is spawned twice for one event (the scene drains events once).
- `itemFx.ts` imports nothing from `rig/` or `sprites/`; hand positions come in through the `hands` callback.

## Tests
`itemFx.test.ts` against a stub scene (copy the stub pattern from `effects.test.ts`): materialise frame count per
item, laser ring→beam→fade timeline, bubble crack count follows `uses`, `dazzleAlpha` curve, projectile/hazard
Graphics created and destroyed, `destroy()` leaves nothing.

## Done when
- [ ] tests pass, `pnpm test` and `pnpm typecheck` green
- [ ] `dev/itemfx.html` shows every effect on a timeline (`window.__itemfx.play(name)`); screenshots taken with
  `tools/shot.mjs` into `.shots/itemfx-*.png` and reviewed by the agent against rules 1–7
- [ ] committed on `feat/item-fx` with prefix `design:`
