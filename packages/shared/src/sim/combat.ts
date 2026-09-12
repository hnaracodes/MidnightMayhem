import { BALANCE, WORLD } from "../constants";
import type { FighterState, MatchState, PlayerIndex, Rect, SimEvent } from "./types";

export function hurtbox(f: FighterState): Rect {
  return { x: f.x - WORLD.HURTBOX_W / 2, y: f.y - WORLD.HURTBOX_H, w: WORLD.HURTBOX_W, h: WORLD.HURTBOX_H };
}

export function isActivePunch(f: FighterState): boolean {
  if (!f.action) return false;
  const e = f.action.elapsed;
  return e >= BALANCE.PUNCH_STARTUP && e < BALANCE.PUNCH_STARTUP + BALANCE.PUNCH_ACTIVE;
}

export function punchHitbox(f: FighterState): Rect | null {
  if (!isActivePunch(f)) return null;
  const x = f.facing === 1 ? f.x + BALANCE.PUNCH_GAP : f.x - BALANCE.PUNCH_GAP - BALANCE.PUNCH_REACH;
  return { x, y: f.y - BALANCE.PUNCH_HITBOX_TOP, w: BALANCE.PUNCH_REACH, h: BALANCE.PUNCH_HITBOX_H };
}

/** Jump i-frames: airborne and jumpTicks within the configured window (inclusive). */
export function isInvulnerable(f: FighterState): boolean {
  return !f.grounded && f.jumpTicks >= BALANCE.JUMP_IFRAME_START && f.jumpTicks <= BALANCE.JUMP_IFRAME_END;
}

export function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

const PUNCH_TOTAL = BALANCE.PUNCH_STARTUP + BALANCE.PUNCH_ACTIVE + BALANCE.PUNCH_RECOVERY;

export function advancePunches(s: MatchState): void {
  for (const f of s.fighters) {
    if (!f.action) continue;
    f.action.elapsed++;
    if (f.action.elapsed >= PUNCH_TOTAL) f.action = null;
  }
}

interface PendingHit { attacker: PlayerIndex; target: PlayerIndex; damage: number; blocked: boolean }

/** Two passes: collect every hit this tick, then apply. Same-tick trades land for both. */
export function resolvePunches(s: MatchState, events: SimEvent[]): void {
  const pending: PendingHit[] = [];
  for (const i of [0, 1] as const) {
    const attacker = s.fighters[i];
    const t: PlayerIndex = i === 0 ? 1 : 0;
    const target = s.fighters[t];
    const box = punchHitbox(attacker);
    if (!box || !attacker.action || attacker.action.landed) continue;
    if (isInvulnerable(target)) continue;
    if (!overlaps(box, hurtbox(target))) continue;
    attacker.action.landed = true;
    const blocked = target.blocking;
    pending.push({ attacker: i, target: t, damage: blocked ? BALANCE.CHIP_DAMAGE : BALANCE.PUNCH_DAMAGE, blocked });
  }
  for (const h of pending) {
    const target = s.fighters[h.target];
    const attacker = s.fighters[h.attacker];
    target.hp = Math.max(0, target.hp - h.damage);
    if (!h.blocked) {
      target.action = null;
      target.blocking = false;
      target.hitstun = BALANCE.HITSTUN_TICKS;
      target.knockbackVx = attacker.facing * (BALANCE.KNOCKBACK_PX / BALANCE.HITSTUN_TICKS);
      target.vx = 0;
    }
    events.push({ type: "HIT", attacker: h.attacker, target: h.target, damage: h.damage, blocked: h.blocked });
  }
}
