// 09-arsenal/02 (sim-throwables): molotov and banana throws and their flight. 09-arsenal/08: charged, aimed throws.
import { ARSENAL, BALANCE, PIT, THROW, WORLD } from "../constants";
import type { InputFrame } from "../input";
import { playerIndices } from "./create";
import { spawnHazard } from "./hazards";
import { consumeUse } from "./items";
import { groundYAt } from "./maps";
import type { Arm, MatchState, PlayerIndex, Projectile, SimEvent } from "./types";

type Throwable = Extract<Projectile["kind"], "molotov" | "banana">;

function isThrowable(kind: string): kind is Throwable {
  return kind === "molotov" || kind === "banana";
}

/** Release height above the ground, and how far in front of the feet the hand lets go. */
export const THROW_RELEASE_H = 100;
const HAND_X = 20;
/** A charge released before this many ticks is a tap or a camera pulse: it throws at VISION_CHARGE. */
const TAP_TICKS = 3;

/**
 * Pure: the launch velocity that lands `range` px from the release point on flat ground, thrown at THROW.ANGLE_DEG
 * from THROW_RELEASE_H up under BALANCE.GRAVITY. Continuous solution of `range = vx · t_land`, where t_land is the
 * positive root of `h + v·sinθ·t − g·t²/2 = 0`: with u = v·sinθ, v·cosθ = u·cotθ this gives
 * `u = range · tanθ · sqrt(g / (2 · (range · tanθ + h)))` (at 45°, `u = range · sqrt(g / (2 · (range + h)))`).
 * The sim integrates gravity before moving (`vy += g; y += vy`), which is the continuous flight with the vertical
 * speed offset by g/2, so vy carries that offset and the tick-sampled arc lands on the continuous point.
 */
export function throwVelocity(range: number): { vx: number; vy: number } {
  const g = BALANCE.GRAVITY;
  const theta = (THROW.ANGLE_DEG * Math.PI) / 180;
  const tan = Math.tan(theta);
  const r = Math.max(0, range);
  const u = r * tan * Math.sqrt(g / (2 * (r * tan + THROW_RELEASE_H)));
  return { vx: u / tan, vy: -(u + g / 2) };
}

/** Pure: linear MIN_RANGE → MAX_RANGE over charge 0 → CHARGE_MAX (clamped). */
export function chargeToRange(charge: number): number {
  const t = Math.min(1, Math.max(0, charge / THROW.CHARGE_MAX));
  return THROW.MIN_RANGE + (THROW.MAX_RANGE - THROW.MIN_RANGE) * t;
}

/** Starts a throw action for the held throwable in its charge phase; true when the punch edge was consumed. */
export function startThrow(s: MatchState, i: PlayerIndex, arm: Arm, _events: SimEvent[]): boolean {
  const f = s.fighters[i];
  if (!f || !f.item || !isThrowable(f.item.kind)) return false;
  f.action = { kind: "throw", item: f.item.kind, arm, phase: "charge", charge: 0, elapsed: 0, released: false };
  return true;
}

/**
 * Runs after every `controlFighter` this tick. A throw in its charge phase gains one charge per tick the same
 * punch key stays held (the start tick counts) and releases on the key's falling edge or at CHARGE_MAX; a release
 * before TAP_TICKS (a keyboard tap, or the camera's one-frame punch pulse) throws at VISION_CHARGE · CHARGE_MAX.
 * `combat.ts` advances and clears every action by `elapsed`, so a charging throw pins `elapsed` at 0 and the
 * release phase counts from 0: the projectile leaves at RELEASE_TICKS and the action clears RECOVERY ticks later.
 * A fighter that can no longer act (KO, pit, hitstun) drops the charge without spending a use.
 */
export function advanceThrowCharge(s: MatchState, inputs: readonly InputFrame[]): void {
  for (const i of playerIndices(s)) {
    const f = s.fighters[i]!;
    const a = f.action;
    if (!a || a.kind !== "throw" || a.phase !== "charge") continue;
    if (f.hp <= 0 || f.pitTicks > 0 || f.hitstun > 0) { f.action = null; continue; }
    a.elapsed = 0;
    const input = inputs[i];
    const held = input ? (a.arm === "L" ? input.punchL : input.punchR) : false;
    if (held) a.charge = Math.min(THROW.CHARGE_MAX, a.charge + 1);
    if (held && a.charge < THROW.CHARGE_MAX) continue;
    if (a.charge < TAP_TICKS) a.charge = THROW.VISION_CHARGE * THROW.CHARGE_MAX;
    a.phase = "release";
    a.elapsed = 0;
  }
}

/** Spawns the projectile of every released throw that reaches its release tick (elapsed === RELEASE_TICKS, once). */
export function releaseThrows(s: MatchState, events: SimEvent[]): void {
  for (const i of playerIndices(s)) {
    const f = s.fighters[i]!;
    const a = f.action;
    if (!a || a.kind !== "throw" || a.phase !== "release" || a.elapsed !== THROW.RELEASE_TICKS || a.released) continue;
    const { vx, vy } = throwVelocity(chargeToRange(a.charge));
    const p: Projectile = {
      id: s.nextId++, kind: a.item, owner: i, x: f.x + f.facing * HAND_X, y: f.y - THROW_RELEASE_H, vx: f.facing * vx, vy,
    };
    s.projectiles.push(p);
    a.released = true;
    events.push({ type: "PROJECTILE_SPAWN", id: p.id, kind: p.kind, owner: i });
    consumeUse(s, i, events);
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
    if (p.y < 0) p.y = 0; // ceiling
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
