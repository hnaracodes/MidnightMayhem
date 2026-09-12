# 9.10 — Mobile actions: charge and fire on the move

## Purpose
Until now any action froze a grounded fighter: the laser's 216 ticks (3 s charge, 16-tick beam, 20-tick recovery)
and a molotov or banana charge-and-release both planted the feet and refused a jump. That made the signature move a
commitment to standing still for three seconds. The owner's rule (2026-09-12) is the opposite: the special charges
while you move and fires while you move, the charged throw does the same, and **no future action is gated on
movement**. Only the punch and the block still pin a fighter.

## Files
Modify: `packages/shared/src/sim/fighter.ts`, `src/sim/laser.ts` (`startLaser` condition only),
`src/sim/projectiles.ts` (comment only), `packages/shared/test/laser.test.ts`, `test/throwables.test.ts`,
`packages/client/src/game/rig/pose.ts`, `packages/client/test/pose.test.ts`.
No constants, no protocol, no server, no `arenaGlue.ts`.

## Depends on
9.03 (laser), 9.08 lane A (throw charge), 12.04 (the laser and throw poses this borrows legs into).

## Exposes
`sim/fighter.ts`:
- `actionLocksMovement(f): boolean` (private) — `f.action?.kind === "punch"`. The one place the rule lives: a
  punch pins a grounded fighter, everything else is free, so **an action added later is mobile by default**.
  `lockedOnGround` and the jump edge both read it; `blocking` is a separate lock and unchanged.
- `aimLocked(f): boolean` — true for a punch, a laser in `beam` or `recover` (via `laserPhase`), and a throw in
  its `release` phase. `updateFacing` skips these, so a fighter *charging* a laser or a throw keeps turning toward
  its nearest opponent and the aim commits the instant the beam fires or the release begins.

`sim/laser.ts`:
- `startLaser` no longer requires `grounded`. Every other condition is unchanged (FIGHTING, no action, not
  blocking, no hitstun, cooldown 0, alive, not down a pit), and the cooldown is still never refunded.

`client/src/game/rig/pose.ts`:
- `withLocomotion(p, rig, f)` (private) — returns `p` untouched for a planted fighter; otherwise keeps the
  action's arms, torso, head and `punchingArm` and re-solves both legs with `legTo(p.t.hip, foot)` onto the feet
  of `walkPose` (walking) or `jumpPose` (airborne). Applied to the `"laser"` and `"throw"` cases of `computePose`.

## Behaviour
1. `Q` then A/D: the fighter walks at the full `WALK_SPEED` through charge, beam and recovery. `W` jumps.
2. The beam sweeps from wherever the attacker has walked to: `laserHitbox` reads the live `x`, `y` and `facing`
   every beam tick, so the muzzle follows and the 70 px band rides up with a jump.
3. `special` starts a laser in mid-air. A beam fired near the jump apex (feet ~150 px up) is a band-height above a
   grounded opponent and passes over it; fired two ticks after take-off it still lands. Jumping is aiming high.
4. A charging fighter re-aims at its nearest opponent, so walking past someone mid-charge turns the beam around.
   Once it fires, moving the opponent across does not turn the attacker.
5. Walking into a pit mid-charge cancels the laser (`applyPits` clears the action) with no `LASER_FIRE` and no
   cooldown refund. A hit still cancels it on the same terms.
6. A throw charges, releases and recovers on the move; the projectile leaves from the hand where the fighter is by
   then, not from where the charge began. Block and a second punch are still refused while the action runs.
7. The punch is unchanged: grounded, it still zeroes `vx` and refuses a jump; in the air it still keeps its
   horizontal motion (01-simulation/02 rule 4).
8. Drawing: a walking laser or throw keeps its cupped or wound-up arms and coiled torso and takes the walk cycle's
   feet, both on the ground; airborne, it takes the air pose's tucked legs. A stationary grounded stance is exactly
   what 12.04 authored.

## Invariants
- No action other than a punch ever writes `vx = 0` or refuses a jump edge.
- `special` and the throw charge never read the clock or `Math.random`; `aimLocked` is pure.
- A fighter still has at most one action, so a charge cannot be interrupted by a punch, a block or a second laser.

## Tests
`laser.test.ts`: rules 1–5 (walk and jump through the charge, the muzzle following, the apex miss and the
take-off hit, re-aiming then committing, the pit cancel), plus the airborne `startLaser`. Rule 3 (nothing behind
the muzzle) is stated mid-beam and again as a 3-player case, since a lone opponent can no longer stay behind a
fighter that re-aims. `throwables.test.ts` rule 4 for rule 6. `pose.test.ts` for rule 8.

## Done when
- [x] `pnpm test` (1064) and `pnpm typecheck` green
- [x] committed on `main` with prefixes `sim:` and `client:`
- [ ] owner plays it: charge on the move, fire from a jump, walk a molotov charge
