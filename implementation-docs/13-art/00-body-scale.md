# 13.00 — Body scale: fighters at 70 %

## Purpose
A 150 px fighter on a 540 px stage is a quarter of the screen; the owner wants the roof to feel like a Smash
stage, with room around the bodies. This lane shrinks the fighter to 105 px everywhere the fighter's size is
encoded — hurtbox, punch and sword reach, laser band, throw release point, the drawn skeleton, the vector rig,
and the FX that aim at chest and head height — while leaving every motion number (walk speed, jump, gravity,
knockback), every world-sized thing (fire and peel widths, platforms, pits, edges) and every timing untouched.

## Files
Modify: `packages/shared/src/constants.ts` (`WORLD.HURTBOX_*`, `BALANCE.PUNCH_GAP/REACH/HITBOX_TOP/HITBOX_H`,
`ARSENAL.SWORD_REACH/LASER_BAND_TOP/LASER_BAND_BOTTOM`), `packages/shared/src/sim/projectiles.ts`
(`THROW_RELEASE_H`, `HAND_X`), `packages/shared/test/{combat,laser}.test.ts`; `packages/client/src/game/rig/characters.ts`
(`BODY_SCALE`), `rig/pose.ts` (world mapping only), `rig/draw.ts` (widths and signature offsets), `effects.ts`,
`itemFx.ts`, `ArenaScene.ts`, `src/dev/{fxPreview,itemFxPreview,ambiencePreview,stagePreview}.ts`,
`test/{pose,itemFx,lighting}.test.ts`; `implementation-docs/01-simulation/{01,03}`, `09-arsenal/03`.
Owns the body-relative numbers listed above.

## Depends on
9.10 (mobile actions: the current `pose.ts`), 12.04 (action poses).

## Exposes
`rig/characters.ts`: `export const BODY_SCALE = 0.7` — drawn body height as a fraction of the 150 px author
space; `RIG` stays in author px. `rig/pose.ts`: unchanged API; `computePose` maps every local offset through
`BODY_SCALE`. `rig/draw.ts`: `shadowPool` widths 45 → 77 px.

## Behaviour
1. `shared/constants.ts`: `HURTBOX_W 72 → 50`, `HURTBOX_H 140 → 98`; `PUNCH_GAP 10 → 7`, `PUNCH_REACH 70 → 49`,
   `PUNCH_HITBOX_TOP 120 → 84`, `PUNCH_HITBOX_H 60 → 42`; `SWORD_REACH 130 → 91`; `LASER_BAND_TOP 105 → 74`,
   `LASER_BAND_BOTTOM 35 → 25` (band 49 = half the hurtbox, centred within ½ px of the body's middle). Every
   value is the old one × 0.7, rounded to a whole pixel.
2. `sim/projectiles.ts`: `THROW_RELEASE_H 100 → 70`, `HAND_X 20 → 14`; `throwVelocity` keeps landing
   `MIN_RANGE`–`MAX_RANGE` from the release point (the formula reads the new height).
3. Unchanged on purpose: `WALK_SPEED`, `JUMP_VELOCITY`, `GRAVITY`, `KNOCKBACK_PX`, `FIRE_W`, `PEEL_W`, hazard
   height, `MAPS`, `PIT`, `SOFT_EDGE_*`, `SPAWN_X`, `LASER_SPEED`, every tick count and damage. A jump is now
   ~1.4 body heights and a knockback ~1.4 body widths; the owner can retune those separately.
4. `pose.ts` keeps its 150 px author space (every constant unchanged); `computePose` multiplies each local
   offset by `BODY_SCALE` when mapping to world (`x: f.x + facing · lx · BODY_SCALE`, `y: f.y + ly · BODY_SCALE`),
   the ghost offsets included. Relative facts (feet on the ground, fist inside the hitbox, laser palms inside the
   band, guard restored after recovery) hold because the sim geometry scaled by the same factor.
5. `rig/draw.ts` (the `?rig=vector` fallback) multiplies every RIG width, radius and signature offset by
   `BODY_SCALE`; outline and rim strokes stay 3 px. `shadowPool` runs 45 → 77 px (was 64 → 110); `SHADOW_APEX`
   stays 150 because the jump did not change.
6. Client heights: `ArenaScene.CHEST_ABOVE_FEET 60 → 42` and the hand fallback `(20, −90) → (14, −63)`;
   `effects.ts` / `itemFx.ts` `CHEST_ABOVE_FEET 90 → 63`, `IMPACT_OFFSET 20 → 14`; the shield barrier
   70 × 150 → 49 × 105, `BARRIER_OFFSET 30 → 21`; the dev previews' stand-in heights scale the same way.

## Invariants
- `pnpm test` in `shared`, `server` and `client` green; no server file changes.
- No motion or timing number changes; `DECISIONS_CHANGED.md` is not edited (rows proposed in the summary).
- The vision, net and input packages are untouched.

## Tests
`shared/test/combat.test.ts` literal boxes re-stated; `laser.test.ts` band centre within ½ px of
`HURTBOX_H / 2`. `client/test/pose.test.ts` absolute thresholds × `BODY_SCALE` (rest hip, ghost distances, ankle
lift, leg length, block spacing, laser thrust, sword height, KO hip); `itemFx.test.ts` barrier size;
`lighting.test.ts` shadow widths.

## Done when
- [ ] tests pass, `pnpm test` and `pnpm typecheck` green
- [ ] `?debug=1` shows the hurtbox hugging the smaller body and the punch box ending at the fist
- [ ] committed with 13.01 (`art:` prefix)
