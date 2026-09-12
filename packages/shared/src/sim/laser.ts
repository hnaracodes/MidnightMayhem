import { ARSENAL, BALANCE, WORLD } from "../constants";
import { applyDamage, canBeHit, hurtbox, isInvulnerable, opponentsOf, overlaps } from "./combat";
import { playerIndices } from "./create";
import type { FighterState, MatchState, PlayerIndex, Rect, SimEvent } from "./types";

const { LASER_CHARGE, LASER_ACTIVE, LASER_RECOVERY, LASER_COOLDOWN, LASER_DAMAGE, LASER_CHIP, LASER_BAND_TOP, LASER_BAND_BOTTOM, LASER_SPEED } = ARSENAL;
const BEAM_START = LASER_CHARGE;
const BEAM_END = LASER_CHARGE + LASER_ACTIVE;            // exclusive
const LASER_TOTAL = BEAM_END + LASER_RECOVERY;           // exclusive; advancePunches clears the action here

/**
 * Starts a laser action on the `special` edge; true when it consumed the edge. Conditions: FIGHTING, no action,
 * not blocking, no hitstun, cooldown 0, alive, not down a pit. Being airborne is *not* a bar (9.10): the laser
 * charges, fires and sweeps from wherever the fighter is, and a beam fired off the ground rides the body band
 * upward. The cooldown starts now and is never refunded, even if the charge is cancelled by a hit or a pit fall.
 */
export function startLaser(s: MatchState, i: PlayerIndex, events: SimEvent[]): boolean {
  const f = s.fighters[i];
  if (!f || s.phase !== "FIGHTING") return false;
  if (f.action !== null || f.blocking || f.hitstun !== 0) return false;
  if (f.laserCooldown !== 0 || f.hp <= 0 || f.pitTicks !== 0) return false;
  f.action = { kind: "laser", elapsed: 0, hit: [] };
  f.laserCooldown = LASER_COOLDOWN;
  events.push({ type: "LASER_CHARGE", player: i });
  return true;
}

/** Which part of the laser the fighter is in, or null when not lasering. */
export function laserPhase(f: FighterState): "charge" | "beam" | "recover" | null {
  if (!f.action || f.action.kind !== "laser") return null;
  const e = f.action.elapsed;
  if (e < BEAM_START) return "charge";
  if (e < BEAM_END) return "beam";
  if (e < LASER_TOTAL) return "recover";
  return null;
}

/** The body band a beam sweeps, centred on the sprite's middle: `[feet − BAND_TOP, feet − BAND_BOTTOM)` for feet at `y`. */
function bandAt(y: number): { y: number; h: number } {
  return { y: y - LASER_BAND_TOP, h: LASER_BAND_TOP - LASER_BAND_BOTTOM };
}

/** How far the beam front has travelled from the fighter on beam tick `k` (0-based): `LASER_SPEED` px per tick, from the first tick. */
export function laserReach(k: number): number {
  return LASER_SPEED * (k + 1);
}

/**
 * Beam rectangle: from the fighter's centre toward the world edge in the facing direction, in the body band, its front
 * advancing `LASER_SPEED` px per beam tick until it reaches the edge; null unless in the beam phase. Read from the
 * live `x`, `y` and `facing`, so the muzzle follows a walking or jumping attacker for the whole sweep (9.10).
 */
export function laserHitbox(f: FighterState): Rect | null {
  if (laserPhase(f) !== "beam") return null;
  const reach = laserReach(f.action!.elapsed - BEAM_START);
  const w = Math.min(reach, f.facing === 1 ? WORLD.WIDTH - f.x : f.x);
  const x = f.facing === 1 ? f.x : f.x - w;
  return { x, w, ...bandAt(f.y) };
}

/**
 * The part of a target the beam can touch: its hurtbox trimmed to its own body band. A grounded target's band is
 * the beam's band, so it is always inside; a target whose feet have risen more than the band height (70 px) is
 * above it. This is what makes the beam jumpable: the full 140 px hurtbox would still clip the band at a ~151 px apex.
 */
function laserHurtbox(f: FighterState): Rect {
  const hb = hurtbox(f);
  return { x: hb.x, w: hb.w, ...bandAt(f.y) };
}

interface PendingLaserHit { attacker: PlayerIndex; target: PlayerIndex; damage: number; blocked: boolean }

/**
 * Applies active beams. LASER_FIRE on the first beam tick; each beam tick every living opponent not yet in
 * `action.hit` that can be hit, is not invulnerable and whose chest band overlaps the beam is hit once: chip through
 * block (no hitstun), otherwise full damage with hitstun and knockback away from the attacker unless absorbed.
 * Two passes like `resolvePunches`: every beam is checked against the state at the start of the tick, then the hits
 * are applied, so two lasers fired on the same tick both land instead of the lower index cancelling the other.
 */
export function resolveLaser(s: MatchState, events: SimEvent[]): void {
  const pending: PendingLaserHit[] = [];
  for (const i of playerIndices(s)) {
    const attacker = s.fighters[i]!;
    const action = attacker.action;
    if (!action || action.kind !== "laser" || attacker.hp <= 0) continue;
    const box = laserHitbox(attacker);
    if (!box) continue;
    if (action.elapsed === BEAM_START) events.push({ type: "LASER_FIRE", player: i });
    for (const t of opponentsOf(s, i)) {
      if (action.hit.includes(t)) continue;
      const target = s.fighters[t]!;
      if (!canBeHit(target) || isInvulnerable(target)) continue;
      if (!overlaps(box, laserHurtbox(target))) continue;
      action.hit.push(t);
      const blocked = target.blocking;
      pending.push({ attacker: i, target: t, damage: blocked ? LASER_CHIP : LASER_DAMAGE, blocked });
    }
  }
  for (const h of pending) {
    const target = s.fighters[h.target]!;
    const attacker = s.fighters[h.attacker]!;
    const { absorbed } = applyDamage(s, h.target, h.damage, "laser", h.attacker, events);
    if (!h.blocked && !absorbed) {
      target.action = null;
      target.blocking = false;
      target.hitstun = BALANCE.HITSTUN_TICKS;
      target.knockbackVx = attacker.facing * (BALANCE.KNOCKBACK_PX / BALANCE.HITSTUN_TICKS);
      target.vx = 0;
    }
    events.push({ type: "LASER_HIT", attacker: h.attacker, target: h.target, damage: absorbed ? 0 : h.damage, blocked: h.blocked });
  }
}
