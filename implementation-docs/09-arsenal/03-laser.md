# 9.03 — Laser beam

## Purpose
The one ability every fighter always has: a charged, full-width beam on a long cooldown, jumpable and blockable,
so it is a threat that rewards timing rather than spam.

## Files
Modify: `packages/shared/src/sim/laser.ts` (replace stub).
Create: `packages/shared/test/laser.test.ts`.
Owns nothing else.

## Depends on
8.01.

## Exposes
- `startLaser(s, i, events): boolean` — called by `controlFighter` on a `special` edge. Conditions: grounded, `action === null`,
  not blocking, `hitstun === 0`, `laserCooldown === 0`, `hp > 0`, `pitTicks === 0`, phase FIGHTING. On success:
  `f.action = { kind: "laser", elapsed: 0, hit: [] }`, `f.laserCooldown = LASER_COOLDOWN`, push `LASER_CHARGE`, return true.
- `laserPhase(f): "charge" | "beam" | "recover" | null` — from `elapsed`: `< LASER_CHARGE` charge; `< CHARGE + ACTIVE` beam;
  `< CHARGE + ACTIVE + RECOVERY` recover; the action is cleared by `advancePunches` at the end (8.01 already clears any
  action whose total elapses; the total for a laser is the sum of the three).
- `laserHitbox(f): Rect | null` — while `laserPhase === "beam"`: from `f.x` to the world edge in the facing direction
  (`x = facing === 1 ? f.x : 0`, `w = facing === 1 ? WIDTH − f.x : f.x`), `y = f.y − LASER_BAND_TOP`,
  `h = LASER_BAND_TOP − LASER_BAND_BOTTOM`.
- `resolveLaser(s, events): void` — for every fighter in the beam phase: on the first beam tick push `LASER_FIRE`; each
  beam tick, for every `opponentsOf` target not yet in `action.hit`, with `canBeHit`, not `isInvulnerable`, whose
  hurtbox overlaps the beam: push the index into `hit`; if blocking → `applyDamage(LASER_CHIP, "laser")`, else
  `applyDamage(LASER_DAMAGE, "laser")` and, if not absorbed, hitstun `HITSTUN_TICKS` with knockback away from the
  attacker; push `LASER_HIT { attacker, target, damage, blocked }`.
- Charging fighter: `controlFighter` already refuses movement/jump/punch while an action exists; being hit cancels the
  action (existing rule "a hit cancels the target's punch") — assert it applies to a laser too, and that the cooldown
  is **not** refunded.

## Behaviour
1. `special` edge on a ready fighter → `LASER_CHARGE` that tick, `LASER_FIRE` 30 ticks later, `laserCooldown` 720.
2. A grounded opponent anywhere in front of the beam within the band takes 10 once, even if the beam lasts 12 ticks.
3. An opponent behind the attacker takes nothing.
4. Blocking opponent: chip 4, no hitstun. Shield holder: absorbed (0 damage, `SHIELD_ABSORB`).
5. An opponent at jump apex (feet at `ROOF_Y − 120`) is above the band and takes nothing; an opponent in jump i-frames
   (jumpTicks 3–10) takes nothing.
6. During charge the attacker cannot walk or jump; a punch landing on him during charge cancels the laser, no
   `LASER_FIRE` follows, cooldown stays 720.
7. A second `special` edge while `laserCooldown > 0` does nothing (no event). After 720 ticks it works again.
8. Three players FFA: one beam hits both opponents (two `LASER_HIT`s) and never the attacker; 2v2: never the teammate.
9. `special` held continuously does not retrigger (edge only).

## Invariants
- `laserCooldown ≤ LASER_COOLDOWN` and never negative.
- A laser action's `hit` list never contains the attacker or a teammate.
- Nothing here reads `Math.random` or the clock.

## Tests
`laser.test.ts`: rules 1–9.

## Done when
- [ ] tests pass, `pnpm test` and `pnpm typecheck` green
- [ ] committed on `feat/sim-laser` with prefix `sim:`
