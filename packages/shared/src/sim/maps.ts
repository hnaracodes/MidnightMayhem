// 10-arenas/01 (sim-maps): gaps, one-way platforms and pit falls. Geometry lives in MAPS / PIT (constants.ts).
import { MAPS, PIT, WORLD, type MapId } from "../constants";
import { applyDamage } from "./combat";
import { playerIndices } from "./create";
import type { MatchState, SimEvent } from "./types";

/** Feet level tolerance: a surface counts as "at" the feet within this many px. */
const FEET_EPS = 0.5;

/** True when `x` lies inside any ground segment of the map (inclusive ends). */
export function onGround(map: MapId, x: number): boolean {
  return MAPS[map].ground.some((g) => x >= g.x0 && x <= g.x1);
}

/** Index of the platform whose span contains `x` and whose level is at the feet `y` (±0.5), else null. */
export function platformAt(map: MapId, x: number, y: number): number | null {
  const platforms = MAPS[map].platforms;
  for (let i = 0; i < platforms.length; i++) {
    const p = platforms[i]!;
    if (x >= p.x0 && x <= p.x1 && Math.abs(p.y - y) <= FEET_EPS) return i;
  }
  return null;
}

/** The highest surface no higher than `minY` under `x`: platforms in span, the roof if on ground, else the pit. */
function highestSurfaceFrom(map: MapId, x: number, minY: number): number {
  let best: number = onGround(map, x) ? WORLD.ROOF_Y : PIT.Y;
  for (const p of MAPS[map].platforms) {
    if (x >= p.x0 && x <= p.x1 && p.y >= minY && p.y < best) best = p.y;
  }
  return best;
}

/** The highest surface at or below the feet `y` (±0.5) under `x`; `PIT.Y` when there is none. */
export function groundYAt(map: MapId, x: number, y: number): number {
  return highestSurfaceFrom(map, x, y - FEET_EPS);
}

/**
 * The highest surface at or below `y` under `x`, used for one-way landing: a falling fighter whose previous feet
 * were at or above a surface lands on it; a surface above the previous feet is passed through.
 */
export function surfaceBelow(map: MapId, x: number, y: number): number {
  return highestSurfaceFrom(map, x, y);
}

/** The x on a ground segment nearest to `x`, moved `PIT.RESPAWN_INSET` inward from the edge. */
export function nearestGroundEdgeX(map: MapId, x: number): number {
  let bestX = WORLD.WIDTH / 2;
  let bestDist = Infinity;
  for (const g of MAPS[map].ground) {
    const nearest = Math.min(Math.max(x, g.x0), g.x1);
    const dist = Math.abs(nearest - x);
    if (dist < bestDist) {
      bestDist = dist;
      const lo = g.x0 + PIT.RESPAWN_INSET;
      const hi = g.x1 - PIT.RESPAWN_INSET;
      bestX = lo <= hi ? Math.min(Math.max(nearest, lo), hi) : (g.x0 + g.x1) / 2;
    }
  }
  return bestX;
}

/**
 * Pit falls and respawns. A fighter down a pit counts down `pitTicks` and respawns at the nearest ground edge
 * with i-frames; a fighter reaching `PIT.Y` takes pit damage (never shielded) and starts the count.
 */
export function applyPits(s: MatchState, events: SimEvent[]): void {
  for (const i of playerIndices(s)) {
    const f = s.fighters[i]!;
    if (f.pitTicks > 0) {
      f.pitTicks--;
      if (f.pitTicks === 0) {
        f.x = nearestGroundEdgeX(s.config.map, f.x);
        f.y = WORLD.ROOF_Y;
        f.vy = 0;
        f.grounded = true;
        f.jumpTicks = 0;
        f.invuln = PIT.INVULN;
        f.onPlatform = null;
        events.push({ type: "PIT_RESPAWN", player: i });
      }
      continue;
    }
    if (f.y >= PIT.Y) {
      applyDamage(s, i, PIT.DAMAGE, "pit", null, events);
      f.pitTicks = PIT.TICKS;
      f.action = null;
      f.blocking = false;
      f.vx = 0;
      events.push({ type: "PIT_FALL", player: i });
    }
  }
}
