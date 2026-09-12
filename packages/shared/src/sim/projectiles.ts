// 09-arsenal/02 (sim-throwables): molotov and banana throws and their flight.
import { ARSENAL, BALANCE, PIT, WORLD } from "../constants";
import { playerIndices } from "./create";
import { spawnHazard } from "./hazards";
import { groundYAt } from "./maps";
import type { Arm, MatchState, PlayerIndex, Projectile, SimEvent } from "./types";

type Throwable = Extract<Projectile["kind"], "molotov" | "banana">;

function isThrowable(kind: string): kind is Throwable {
  return kind === "molotov" || kind === "banana";
}

/** Starts a throw action for the held throwable; true when the punch edge was consumed. */
export function startThrow(s: MatchState, i: PlayerIndex, arm: Arm, _events: SimEvent[]): boolean {
  const f = s.fighters[i];
  if (!f || !f.item || !isThrowable(f.item.kind)) return false;
  f.action = { kind: "throw", item: f.item.kind, arm, elapsed: 0, released: false };
  return true;
}

/**
 * INTEGRATOR: collapse after merge. 09.01 (sim-items) exposes `consumeUse`; until it lands this is the same rule
 * kept private: one use gone, ITEM_USE, and at zero ITEM_BREAK with the hand emptied.
 */
function spend(s: MatchState, i: PlayerIndex, events: SimEvent[]): void {
  const f = s.fighters[i];
  if (!f || !f.item) return;
  const item = f.item.kind;
  f.item.uses--;
  events.push({ type: "ITEM_USE", player: i, item });
  if (f.item.uses <= 0) {
    f.item = null;
    events.push({ type: "ITEM_BREAK", player: i, item });
  }
}

/** Spawns the projectile of every throw that reaches its release tick (elapsed === THROW_STARTUP, once). */
export function releaseThrows(s: MatchState, events: SimEvent[]): void {
  for (const i of playerIndices(s)) {
    const f = s.fighters[i]!;
    const a = f.action;
    if (!a || a.kind !== "throw" || a.elapsed !== ARSENAL.THROW_STARTUP || a.released) continue;
    const vx = a.item === "molotov" ? ARSENAL.MOLOTOV_VX : ARSENAL.BANANA_VX;
    const vy = a.item === "molotov" ? ARSENAL.MOLOTOV_VY : ARSENAL.BANANA_VY;
    const p: Projectile = { id: s.nextId++, kind: a.item, owner: i, x: f.x + f.facing * 20, y: f.y - 100, vx: f.facing * vx, vy };
    s.projectiles.push(p);
    a.released = true;
    events.push({ type: "PROJECTILE_SPAWN", id: p.id, kind: p.kind, owner: i });
    spend(s, i, events);
  }
}

/**
 * Releases due throws, then flies every projectile one tick under gravity. A projectile that reaches the surface
 * below where it was (roof or platform) becomes its hazard, clamped inside the world; one that leaves the world or
 * falls into a pit spawns nothing.
 */
export function advanceProjectiles(s: MatchState, events: SimEvent[]): void {
  releaseThrows(s, events);
  const kept: Projectile[] = [];
  for (const p of s.projectiles) {
    const prevY = p.y;
    p.vy += BALANCE.GRAVITY;
    p.x += p.vx;
    p.y += p.vy;
    if (p.x < 0 || p.x > WORLD.WIDTH) continue;
    // The surface is looked up from where the projectile was, so a falling one cannot skip through a platform
    // and a rising one passes up through it (10.01 makes groundYAt map-aware; on the roof it is ROOF_Y).
    const surface = groundYAt(s.config.map, p.x, prevY);
    if (p.vy > 0 && p.y >= surface) {
      if (surface < PIT.Y) {
        const w = p.kind === "molotov" ? ARSENAL.FIRE_W : ARSENAL.PEEL_W;
        const x = Math.min(Math.max(p.x, w / 2), WORLD.WIDTH - w / 2);
        spawnHazard(s, p.kind === "molotov" ? "fire" : "peel", p.owner, x, groundYAt(s.config.map, x, prevY), events);
      }
      continue;
    }
    kept.push(p);
  }
  s.projectiles = kept;
}
