# 1.03 — Punch, hitboxes, damage, block, hitstun, i-frames

## Purpose
Punch lifecycle and hit resolution. A punch is a 15-tick action; during its 3 active ticks a hitbox in front of the fist is tested against the opponent's hurtbox. Same-tick trades both land.

## Files
Create: `packages/shared/src/sim/combat.ts`, `packages/shared/test/combat.test.ts`. Modify: `sim/step.ts` (`fightTick` calls `advancePunches` then `resolvePunches` after `updateFacing`), `sim/fighter.ts` (punch start in `controlFighter`).

## Depends on
1.02.

## Exposes
- `hurtbox(f): Rect` — `{ x: f.x - 36, y: f.y - 140, w: 72, h: 140 }`
- `isActivePunch(f): boolean` — `elapsed` in `[STARTUP, STARTUP + ACTIVE)`
- `punchHitbox(f): Rect | null` — null unless active; facing right: `x = f.x + 10`, facing left: `x = f.x - 10 - 70`; `y = f.y - 120`, `w = 70`, `h = 60`
- `isInvulnerable(f): boolean` — airborne and `jumpTicks` in `[3, 10]`
- `overlaps(a: Rect, b: Rect): boolean` — strict AABB
- `advancePunches(state): void` — `elapsed++`, clear at 15
- `resolvePunches(state, events): void` — two-pass collect then apply

## Behaviour
1. Punch start (in `controlFighter`): rising edge of `punchL` or `punchR` while `action === null`, not blocking, hitstun 0 → `action = { kind: "punch", arm, elapsed: 0, landed: false }`, emit `PUNCH`. `punchL` wins if both edge the same tick. Allowed in the air.
2. Holding the key does not repeat. A new rising edge after the punch ends is required.
3. `advancePunches` runs first in the tick, before control, so a punch started this tick ends the tick at `elapsed = 0`; it becomes active when `elapsed` reaches 4, on the 5th tick after the key edge (four startup ticks with no hitbox).
4. `resolvePunches`, pass 1: for each attacker with an active, un-landed punch whose hitbox overlaps the opponent's hurtbox and the opponent is not invulnerable → mark `landed = true`, queue `{ attacker, target, damage: target.blocking ? 3 : 12, blocked: target.blocking }`. Pass 2: apply all queued hits. Both fighters can be hit in the same tick.
5. Applying a clean hit: `hp = max(0, hp - 12)`, `action = null`, `blocking = false`, `hitstun = 12`, `knockbackVx = attacker.facing * 144 / 12`, `vx = 0`. Emit `HIT{blocked: false}`.
6. Applying a blocked hit: `hp = max(0, hp - 3)`, no stun, no knockback, target keeps blocking. Emit `HIT{blocked: true}`.
7. A fighter at 0 hp still resolves punches queued in the same tick (draw rounds are possible).
8. Invulnerable target: the punch simply misses this tick and may still connect on a later active tick.
9. A hit does not push the target through the clamp; physics next tick clamps as usual.

## Invariants
- One `HIT` per punch instance, ever (`landed` latch).
- The attacker is never tested against their own hurtbox.
- `punchHitbox` is null outside active ticks.

## Tests
- hurtbox geometry; hitbox geometry both facings; null outside active
- in-range punch lands once for 12; contact on tick STARTUP+1 after edge
- out of range misses
- blocked: 3 damage, no hitstun, `blocking` stays true
- hitstun: input ignored, total displacement = 144 · 11/12 over the stun (first stun tick has vx 0)
- hit cancels the target's punch
- same-tick trade: two HIT events, both hp reduced
- held punch does not repeat
- mid-air punch allowed
- i-frames: target on jumpTicks 3..10 is not hit; jumpTicks 2 and 11 are hit

## Done when
- [ ] tests pass, `index.ts` re-exports `sim/combat`
