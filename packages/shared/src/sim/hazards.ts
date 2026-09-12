// 09-arsenal/02 (sim-throwables): fire patches and banana peels.
import { ARSENAL } from "../constants";
import { applyDamage, canBeHit, hurtbox, overlaps } from "./combat";
import { playerIndices } from "./create";
import type { Hazard, MatchState, PlayerIndex, Rect, SimEvent } from "./types";

const HAZARD_H = 20;

/** The strip a hazard covers: its width, 20 px tall, sitting on the surface it landed on. For the debug boxes too. */
export function hazardRect(h: Hazard): Rect {
  return { x: h.x - h.w / 2, y: h.y - HAZARD_H, w: h.w, h: HAZARD_H };
}

/** Adds a fire patch or a banana peel at (x, y) and announces it. */
export function spawnHazard(s: MatchState, kind: Hazard["kind"], owner: PlayerIndex, x: number, y: number, events: SimEvent[]): void {
  const h: Hazard = kind === "fire"
    ? { id: s.nextId++, kind, owner, x, y, w: ARSENAL.FIRE_W, ticks: ARSENAL.FIRE_TICKS, age: 0 }
    : { id: s.nextId++, kind, owner, x, y, w: ARSENAL.PEEL_W, ticks: ARSENAL.PEEL_TICKS, age: 0 };
  s.hazards.push(h);
  events.push({ type: "HAZARD_SPAWN", id: h.id, kind, x });
}

/**
 * Grounded, hittable, and standing on the hazard strip: the feet must rest on the hazard's own surface (a fighter on
 * the roof under a rack hazard has a hurtbox that overlaps the strip but is not standing in it).
 */
function standingOn(s: MatchState, i: PlayerIndex, h: Hazard, rect: Rect): boolean {
  const f = s.fighters[i]!;
  return canBeHit(f) && f.grounded && Math.abs(f.y - h.y) <= 0.5 && overlaps(hurtbox(f), rect);
}

/** Fire: every FIRE_EVERY ticks of age, FIRE_DAMAGE to everyone standing in it (owner included), no hitstun. */
function burn(s: MatchState, h: Hazard, events: SimEvent[]): void {
  if (h.age % ARSENAL.FIRE_EVERY !== 0) return;
  const rect = hazardRect(h);
  for (const i of playerIndices(s)) {
    if (!standingOn(s, i, h, rect)) continue;
    const { absorbed } = applyDamage(s, i, ARSENAL.FIRE_DAMAGE, "hazard", h.owner, events);
    events.push({ type: "HAZARD_HIT", id: h.id, kind: h.kind, target: i, damage: absorbed ? 0 : ARSENAL.FIRE_DAMAGE });
  }
}

/** Peel: the first walker (moving, not already stunned, owner past the immunity window) slips and uses it up. */
function slip(s: MatchState, h: Hazard, events: SimEvent[]): boolean {
  const rect = hazardRect(h);
  for (const i of playerIndices(s)) {
    const f = s.fighters[i]!;
    if (f.vx === 0 || f.hitstun !== 0 || !standingOn(s, i, h, rect)) continue;
    if (i === h.owner && h.age <= ARSENAL.PEEL_OWNER_IMMUNE) continue;
    f.hitstun = ARSENAL.SLIP_STUN;
    f.slipped = ARSENAL.SLIP_STUN;
    f.knockbackVx = 0;
    f.vx = 0;
    f.action = null;
    f.blocking = false;
    events.push({ type: "HAZARD_HIT", id: h.id, kind: h.kind, target: i, damage: 0 });
    return true;
  }
  return false;
}

/** Ages every hazard, applies fire ticks and slips, removes expired and used-up ones. */
export function advanceHazards(s: MatchState, events: SimEvent[]): void {
  const kept: Hazard[] = [];
  for (const h of s.hazards) {
    h.age++;
    h.ticks--;
    if (h.kind === "fire") burn(s, h, events);
    else if (slip(s, h, events)) continue;
    if (h.ticks > 0) kept.push(h);
  }
  s.hazards = kept;
}
