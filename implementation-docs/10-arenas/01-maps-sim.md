# 10.01 — Maps in the simulation: gaps, platforms, pits

## Purpose
Map geometry as physics: fighters walk off the edge of a gap and fall, land on floating platforms from below, and
fall into pits for damage and a respawn. Every number is in `MAPS` / `PIT` (8.01).

## Files
Modify: `packages/shared/src/sim/maps.ts` (replace stub), `src/sim/fighter.ts` (`applyPhysics` only).
Create: `packages/shared/test/maps.test.ts`.
Owns `maps.ts` and `fighter.ts`. Does not edit `combat.ts`, `rounds.ts`, `create.ts`.

## Depends on
8.01.

## Exposes
`maps.ts`:
- `onGround(map, x): boolean` — x inside any ground segment (inclusive).
- `platformAt(map, x, y): number | null` — index of a platform whose span contains x and whose `y` equals the feet y
  (±0.5).
- `groundYAt(map, x, y): number` — the highest surface at or below feet `y` for this x: candidates are platforms
  with `platform.y ≥ y − 0.5` and x in span, and the roof if `onGround`; returns the minimum y among candidates, else
  `PIT.Y`.
- `surfaceBelow(map, x, y): number` — same but strictly below `y` (used for one-way landing).
- `nearestGroundEdgeX(map, x): number` — the x on a ground segment nearest to x, moved `PIT.RESPAWN_INSET` inward.
- `applyPits(s, events): void` — for each fighter with `pitTicks > 0`: `pitTicks--`; at 0: `x = nearestGroundEdgeX`,
  `y = ROOF_Y`, `vy = 0`, `grounded = true`, `invuln = PIT.INVULN`, `onPlatform = null`, push `PIT_RESPAWN`.
  For each fighter with `pitTicks === 0 && y ≥ PIT.Y`: `applyDamage(PIT.DAMAGE, "pit")`, `pitTicks = PIT.TICKS`,
  `action = null`, `blocking = false`, `vx = 0`, `item` kept, push `PIT_FALL`.

`fighter.ts` — `applyPhysics(f, map)`:
1. `x += vx`; clamp to `[0, WIDTH]` as today.
2. If grounded: `const gy = groundYAt(map, x, y)`; if `gy > y + 0.5` (nothing under the feet any more) → `grounded = false`,
   `vy = 0`, `jumpTicks = 0`, `onPlatform = null`.
3. If not grounded: `prevY = y`; `vy += GRAVITY`; `y += vy`; `jumpTicks++`; if `vy > 0`: `const sy = surfaceBelow(map, x, prevY)`;
   if `y ≥ sy` → `y = sy`, `vy = 0`, `grounded = true`, `jumpTicks = 0`, `onPlatform = platformAt(map, x, sy)`, push `LAND { player: i }`
   (the signature `applyPhysics(f, i, map, events)` already exists from 8.01).
4. `y` is never clamped to `ROOF_Y` any more; the pit check in `applyPits` handles `y ≥ PIT.Y`.

## Behaviour
1. `roof`: a full `fullmatch` replay is unchanged (no gaps, no platforms; `groundYAt` is always `ROOF_Y`).
2. `gaps`: a fighter walking right from x 280 falls at x > 300 (`grounded` false on the first tick past the edge),
   reaches `PIT.Y` in a finite number of ticks, takes 8, `PIT_FALL`; 40 ticks later `PIT_RESPAWN` at x 260 (300 − 40),
   `invuln 30`, and he cannot be punched for those 30 ticks.
3. `gaps`: jumping from x 290 with `right` held clears the 80 px gap (lands on ground at x ≥ 380) — assert the jump
   arc covers it: 60 ticks airborne × 3 px = 180 px horizontal, apex 120.
4. `platforms`: jumping from x 240 lands on platform 0 at `y = 330` (feet), `onPlatform 0`, `LAND`; walking off its edge
   (x > 330) falls back to the roof and lands with `LAND`, `onPlatform null`.
5. `platforms`: jumping from directly under a platform passes through it on the way up and lands on top on the way
   down (one-way).
6. A fighter standing on a platform (feet 330, hurtbox 190–330) is clipped by a grounded opponent's punch directly
   below (hitbox 310–370 overlaps his shins by 20 px — assert the hit lands), so platforms are not a safe perch.
7. `chaos`: rule 2 and rule 4 both hold on the same map.
8. A fighter in a pit (`pitTicks > 0`) ignores input, cannot be hit, is not counted for OOB, and keeps his item.
9. Pit damage is never absorbed by a shield.
10. Spawn positions on every map are on ground (assert for all four maps and all player counts).

## Invariants
- `grounded` ⇒ `y === groundYAt(map, x, y)` (feet exactly on a surface) except during `pitTicks > 0`.
- No fighter has `y < 0`.
- `applyPhysics` reads nothing but the fighter, the map id and constants.

## Tests
`maps.test.ts`: rules 1–10.

## Done when
- [ ] tests pass, `pnpm test` and `pnpm typecheck` green (including `pose.test.ts` in the client if it stubs `applyPhysics`)
- [ ] committed on `feat/sim-maps` with prefix `sim:`
