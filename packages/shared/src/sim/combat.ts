import { ARSENAL, BALANCE, WORLD } from "../constants";
import { playerIndices } from "./create";
import { absorbWithShield } from "./items";
import type { FighterState, MatchState, PlayerIndex, Rect, SimEvent, SlashAction } from "./types";

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
  const reach = f.action?.kind === "punch" && f.action.sword ? ARSENAL.SWORD_REACH : BALANCE.PUNCH_REACH;
  const x = f.facing === 1 ? f.x + BALANCE.PUNCH_GAP : f.x - BALANCE.PUNCH_GAP - reach;
  return { x, y: f.y - BALANCE.PUNCH_HITBOX_TOP, w: reach, h: BALANCE.PUNCH_HITBOX_H };
}

/** 9.10: chop (tall, narrow) or sweep (wide, low) geometry from ARSENAL.CHOP_* / SWEEP_*. */
function slashSpec(style: SlashAction["style"]) {
  return style === "chop"
    ? { startup: ARSENAL.CHOP_STARTUP, active: ARSENAL.CHOP_ACTIVE, recovery: ARSENAL.CHOP_RECOVERY, damage: ARSENAL.CHOP_DAMAGE,
        gap: ARSENAL.CHOP_GAP, reach: ARSENAL.CHOP_REACH, top: ARSENAL.CHOP_HITBOX_TOP, h: ARSENAL.CHOP_HITBOX_H, push: 1 }
    : { startup: ARSENAL.SWEEP_STARTUP, active: ARSENAL.SWEEP_ACTIVE, recovery: ARSENAL.SWEEP_RECOVERY, damage: ARSENAL.SWEEP_DAMAGE,
        gap: ARSENAL.SWEEP_GAP, reach: ARSENAL.SWEEP_REACH, top: ARSENAL.SWEEP_HITBOX_TOP, h: ARSENAL.SWEEP_HITBOX_H, push: ARSENAL.SWEEP_PUSH };
}

export function isActiveSlash(f: FighterState): boolean {
  if (!f.action || f.action.kind !== "slash") return false;
  const spec = slashSpec(f.action.style);
  return f.action.elapsed >= spec.startup && f.action.elapsed < spec.startup + spec.active;
}

export function slashHitbox(f: FighterState): Rect | null {
  if (!f.action || f.action.kind !== "slash" || !isActiveSlash(f)) return null;
  const spec = slashSpec(f.action.style);
  const x = f.facing === 1 ? f.x + spec.gap : f.x - spec.gap - spec.reach;
  return { x, y: f.y - spec.top, w: spec.reach, h: spec.h };
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

function actionTotal(a: NonNullable<FighterState["action"]>): number {
  if (a.kind === "slash") { const sp = slashSpec(a.style); return sp.startup + sp.active + sp.recovery; }
  return a.kind === "punch" ? PUNCH_TOTAL : a.kind === "throw" ? THROW_TOTAL : LASER_TOTAL;
}

/** Advances every action (punch, slash, throw, laser) and clears finished ones. */
export function advancePunches(s: MatchState): void {
  for (const f of s.fighters) {
    if (!f.action) continue;
    f.action.elapsed++;
    if (f.action.elapsed >= actionTotal(f.action)) f.action = null;
  }
}

export type DamageSource = "punch" | "laser" | "hazard" | "oob" | "pit";

/**
 * The single place hp goes down. A held shield absorbs punch, laser and hazard damage in full (hp unchanged,
 * `absorbed: true`); OOB and pit damage always go through.
 */
export function applyDamage(
  s: MatchState, target: PlayerIndex, damage: number, source: DamageSource, _attacker: PlayerIndex | null, events: SimEvent[],
): { absorbed: boolean } {
  const f = s.fighters[target];
  if (!f) return { absorbed: false };
  if ((source === "punch" || source === "laser" || source === "hazard") && absorbWithShield(s, target, events)) {
    return { absorbed: true };
  }
  f.hp = Math.max(0, f.hp - damage);
  return { absorbed: false };
}

interface PendingHit { attacker: PlayerIndex; target: PlayerIndex; damage: number; blocked: boolean; parried: boolean; push: number }

/** Blocking with a sword inside the first PARRY_WINDOW ticks of the block turns the hit back on the attacker. */
function isParry(target: FighterState): boolean {
  return target.blocking && target.item?.kind === "sword" && target.blockTicks < ARSENAL.PARRY_WINDOW;
}

/**
 * Two passes: collect every hit this tick, then apply. Same-tick trades land for both. Every attacker is tried
 * against every living opponent; one landed hit per punch (first overlap wins, lowest index).
 */
export function resolvePunches(s: MatchState, events: SimEvent[]): void {
  const pending: PendingHit[] = [];
  for (const i of playerIndices(s)) {
    const attacker = s.fighters[i]!;
    const action = attacker.action;
    if (!action || (action.kind !== "punch" && action.kind !== "slash") || action.landed) continue;
    const box = action.kind === "punch" ? punchHitbox(attacker) : slashHitbox(attacker);
    if (!box) continue;
    for (const t of opponentsOf(s, i)) {
      const target = s.fighters[t]!;
      if (!canBeHit(target) || isInvulnerable(target)) continue;
      if (!overlaps(box, hurtbox(target))) continue;
      action.landed = true;
      const blocked = target.blocking;
      let damage: number;
      let push = 1;
      if (action.kind === "punch") {
        damage = blocked ? BALANCE.CHIP_DAMAGE : action.sword ? ARSENAL.SWORD_DAMAGE : BALANCE.PUNCH_DAMAGE;
      } else {
        const spec = slashSpec(action.style);
        push = spec.push;
        // Chop crushes guard: a blocking target takes CHOP_GUARD_FRACTION of the damage, not chip.
        damage = blocked
          ? (action.style === "chop" ? Math.round(spec.damage * ARSENAL.CHOP_GUARD_FRACTION) : BALANCE.CHIP_DAMAGE)
          : spec.damage;
      }
      pending.push({ attacker: i, target: t, damage, blocked, parried: isParry(target), push });
      break;
    }
  }
  for (const h of pending) {
    const target = s.fighters[h.target]!;
    const attacker = s.fighters[h.attacker]!;
    if (h.parried) {
      attacker.action = null;
      attacker.hitstun = ARSENAL.PARRY_STUN;
      attacker.knockbackVx = 0;
      attacker.vx = 0;
      events.push({ type: "PARRY", player: h.target, attacker: h.attacker });
      continue;
    }
    const { absorbed } = applyDamage(s, h.target, h.damage, "punch", h.attacker, events);
    if (!h.blocked && !absorbed) {
      target.action = null;
      target.blocking = false;
      target.hitstun = BALANCE.HITSTUN_TICKS;
      target.knockbackVx = attacker.facing * h.push * (BALANCE.KNOCKBACK_PX / BALANCE.HITSTUN_TICKS);
      target.vx = 0;
    }
    events.push({ type: "HIT", attacker: h.attacker, target: h.target, damage: absorbed ? 0 : h.damage, blocked: h.blocked });
  }
}
