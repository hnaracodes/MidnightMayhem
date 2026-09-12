import { ARSENAL, BALANCE, WORLD } from "../constants";
import { playerIndices } from "./create";
import type { FighterState, MatchState, PlayerIndex, Rect, SimEvent } from "./types";

export function hurtbox(f: FighterState): Rect {
  return { x: f.x - WORLD.HURTBOX_W / 2, y: f.y - WORLD.HURTBOX_H, w: WORLD.HURTBOX_W, h: WORLD.HURTBOX_H };
}

/** A fighter that can still take a hit: alive and not down a pit. Every hit path checks this. */
export function canBeHit(f: FighterState): boolean {
  return f.hp > 0 && f.pitTicks === 0;
}

export function isActivePunch(f: FighterState): boolean {
  if (!f.action || f.action.kind !== "punch") return false;
  const e = f.action.elapsed;
  return e >= BALANCE.PUNCH_STARTUP && e < BALANCE.PUNCH_STARTUP + BALANCE.PUNCH_ACTIVE;
}

export function punchHitbox(f: FighterState): Rect | null {
  if (!isActivePunch(f)) return null;
  const x = f.facing === 1 ? f.x + BALANCE.PUNCH_GAP : f.x - BALANCE.PUNCH_GAP - BALANCE.PUNCH_REACH;
  return { x, y: f.y - BALANCE.PUNCH_HITBOX_TOP, w: BALANCE.PUNCH_REACH, h: BALANCE.PUNCH_HITBOX_H };
}

/** Jump i-frames (airborne, jumpTicks within the window, inclusive) or respawn i-frames after a pit. */
export function isInvulnerable(f: FighterState): boolean {
  if (f.invuln > 0) return true;
  return !f.grounded && f.jumpTicks >= BALANCE.JUMP_IFRAME_START && f.jumpTicks <= BALANCE.JUMP_IFRAME_END;
}

export function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** Living fighters on another team than `i`. */
export function opponentsOf(s: MatchState, i: PlayerIndex): PlayerIndex[] {
  const me = s.fighters[i];
  if (!me) return [];
  return playerIndices(s).filter((j) => j !== i && s.fighters[j]!.team !== me.team && s.fighters[j]!.hp > 0);
}

const PUNCH_TOTAL = BALANCE.PUNCH_STARTUP + BALANCE.PUNCH_ACTIVE + BALANCE.PUNCH_RECOVERY;
const THROW_TOTAL = ARSENAL.THROW_STARTUP + ARSENAL.THROW_RECOVERY;
const LASER_TOTAL = ARSENAL.LASER_CHARGE + ARSENAL.LASER_ACTIVE + ARSENAL.LASER_RECOVERY;

function actionTotal(kind: NonNullable<FighterState["action"]>["kind"]): number {
  return kind === "punch" ? PUNCH_TOTAL : kind === "throw" ? THROW_TOTAL : LASER_TOTAL;
}

/** Advances every action (punch, throw, laser) and clears finished ones. */
export function advancePunches(s: MatchState): void {
  for (const f of s.fighters) {
    if (!f.action) continue;
    f.action.elapsed++;
    if (f.action.elapsed >= actionTotal(f.action.kind)) f.action = null;
  }
}

export type DamageSource = "punch" | "laser" | "hazard" | "oob" | "pit";

/**
 * The single place hp goes down. Shield absorption is wired here by 09.01; until then it just subtracts and
 * reports `absorbed: false`.
 */
export function applyDamage(
  s: MatchState, target: PlayerIndex, damage: number, _source: DamageSource, _attacker: PlayerIndex | null, _events: SimEvent[],
): { absorbed: boolean } {
  const f = s.fighters[target];
  if (!f) return { absorbed: false };
  f.hp = Math.max(0, f.hp - damage);
  return { absorbed: false };
}

interface PendingHit { attacker: PlayerIndex; target: PlayerIndex; damage: number; blocked: boolean }

/**
 * Two passes: collect every hit this tick, then apply. Same-tick trades land for both. Every attacker is tried
 * against every living opponent; one landed hit per punch (first overlap wins, lowest index).
 */
export function resolvePunches(s: MatchState, events: SimEvent[]): void {
  const pending: PendingHit[] = [];
  for (const i of playerIndices(s)) {
    const attacker = s.fighters[i]!;
    const box = punchHitbox(attacker);
    if (!box || !attacker.action || attacker.action.kind !== "punch" || attacker.action.landed) continue;
    for (const t of opponentsOf(s, i)) {
      const target = s.fighters[t]!;
      if (!canBeHit(target) || isInvulnerable(target)) continue;
      if (!overlaps(box, hurtbox(target))) continue;
      attacker.action.landed = true;
      const blocked = target.blocking;
      pending.push({ attacker: i, target: t, damage: blocked ? BALANCE.CHIP_DAMAGE : BALANCE.PUNCH_DAMAGE, blocked });
      break;
    }
  }
  for (const h of pending) {
    const target = s.fighters[h.target]!;
    const attacker = s.fighters[h.attacker]!;
    const { absorbed } = applyDamage(s, h.target, h.damage, "punch", h.attacker, events);
    if (!h.blocked && !absorbed) {
      target.action = null;
      target.blocking = false;
      target.hitstun = BALANCE.HITSTUN_TICKS;
      target.knockbackVx = attacker.facing * (BALANCE.KNOCKBACK_PX / BALANCE.HITSTUN_TICKS);
      target.vx = 0;
    }
    events.push({ type: "HIT", attacker: h.attacker, target: h.target, damage: h.damage, blocked: h.blocked });
  }
}
