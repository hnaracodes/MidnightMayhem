# 9.02 — Throwables: molotov and banana peel

## Purpose
The two items that leave the hand: a throw action, projectiles under gravity, and the ground hazards they become
(fire patch, banana peel) with their damage and slip rules.

## Files
Modify: `packages/shared/src/sim/projectiles.ts`, `src/sim/hazards.ts` (replace stubs).
Create: `packages/shared/test/throwables.test.ts`.
Owns nothing else. Reads `groundYAt` from `maps.ts` (8.01 stub returns `ROOF_Y`; 10.01 makes it map-aware — write
tests on the `roof` map only so they hold either way).

## Depends on
8.01. Uses `consumeUse` from 9.01 if merged; until then implement `uses--` / `ITEM_USE` / `ITEM_BREAK` locally in
`projectiles.ts` under a private `spend(s, i, events)` — the integrator collapses the two after merge (note this in the
commit message).

## Exposes
`projectiles.ts`:
- `startThrow(s, i, arm, events): boolean` — if `f.item` is `molotov` or `banana`: `f.action = { kind: "throw", item, arm,
  elapsed: 0, released: false }`, return true; else false.
- `releaseThrows(s, events): void` — for every fighter whose throw action has `elapsed === THROW_STARTUP && !released`:
  spawn a `Projectile` `{ id: s.nextId++, kind, owner: i, x: f.x + facing·20, y: f.y − 100, vx: facing·V_X, vy: V_Y }`
  (molotov `MOLOTOV_VX/VY`, banana `BANANA_VX/VY`), `released = true`, push `PROJECTILE_SPAWN`, spend one use.
- `advanceProjectiles(s, events): void` — calls `releaseThrows` first, then for each projectile: `vy += GRAVITY`,
  `x += vx`, `y += vy`; when `y ≥ groundYAt(map, x, y)` or `x` outside `[0, WIDTH]`: remove it and spawn the hazard
  (`spawnHazard` below) at `x` clamped to `[w/2, WIDTH − w/2]`, `y = groundYAt(map, x, y)` (a projectile that falls
  into a pit spawns nothing).
- A throw action lasts `THROW_STARTUP + THROW_RECOVERY` ticks; `advancePunches` (8.01) already clears it. While
  throwing the fighter is grounded-locked like a punch (rule lives in `controlFighter`, already true for any action).

`hazards.ts`:
- `spawnHazard(s, kind: "fire" | "peel", owner, x, y, events): void` — fire `{ w: FIRE_W, ticks: FIRE_TICKS }`, peel
  `{ w: PEEL_W, ticks: PEEL_TICKS }`, `age = 0`, push `HAZARD_SPAWN { id, kind, x }`.
- `advanceHazards(s, events): void` — `age++`, `ticks--`, remove at 0. Fire: every `FIRE_EVERY` ticks of `age`, every
  fighter with `canBeHit` whose hurtbox overlaps the hazard rect `{ x − w/2, y − 20, w, 20 }` and is grounded takes
  `applyDamage(s, i, FIRE_DAMAGE, "hazard", owner, events)` (owner included; shield absorbs), push `HAZARD_HIT`; no
  hitstun. Peel: a fighter with `canBeHit`, grounded, `vx ≠ 0`, `hitstun === 0`, overlapping the same rect, and not
  (`owner` within `PEEL_OWNER_IMMUNE` ticks of `age`) → `hitstun = SLIP_STUN`, `knockbackVx = 0`, `vx = 0`,
  `action = null`, `blocking = false`, push `HAZARD_HIT { damage: 0 }`, remove the peel.
- `hazardRect(h): Rect` exported for the client's debug boxes.

## Behaviour
1. Punch edge with a molotov held → `PROJECTILE_SPAWN` exactly on the 7th tick after the edge (elapsed 6), from the
   hand position, moving in the facing direction.
2. The molotov lands on the roof between 70 and 130 px in front of the thrower on a flat map (assert the range) and
   becomes a fire hazard with `ticks === 240`.
3. A fighter standing in the fire takes 2 damage at ages 20, 40, … (12 ticks of damage over 240 → 24 hp total if he
   never leaves); the thrower standing in it takes it too; a fighter one jump above it takes none.
4. Second molotov throw → `ITEM_BREAK`; a third punch is a normal punch.
5. Banana lands, peel persists 900 ticks; a standing fighter on it is safe; walking onto it → `hitstun 36`, peel
   removed, `HAZARD_HIT` with damage 0. The owner walking through it within 30 ticks of the spawn is safe.
6. A projectile thrown off the world edge produces no hazard. With `map: "gaps"` and a landing x inside a gap, no hazard
   (this test may only be written after 10.01 merges; leave a `todo`).
7. Throw action: the fighter cannot move for 18 ticks, cannot start a punch, and blocks nothing (same locks as a punch).
8. A fighter hit during throw startup (before release) loses the throw (`action = null`) and the use is **not** spent.

## Invariants
- `s.nextId` only grows; no two live projectiles or hazards share an id.
- Hazards and projectiles are cleared by `resetForRound` (assert; 8.01's `resetForRound` must do it — if it does not,
  add it there and say so in the commit).
- Nothing here reads `Math.random` or the clock.

## Tests
`throwables.test.ts`: rules 1–8 on `map: "roof"`, `mode: "deathmatch"` (no timer interference).

## Done when
- [ ] tests pass, `pnpm test` and `pnpm typecheck` green
- [ ] committed on `feat/sim-throwables` with prefix `sim:`
