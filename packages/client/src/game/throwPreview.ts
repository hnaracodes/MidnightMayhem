import { BALANCE, type Action } from "@midnight/shared";

/**
 * 9.08 rule 5 — the pure half of the throw preview.
 *
 * `THROW`, `THROW_RELEASE_H`, `throwVelocity` and `chargeToRange` are the sim's own (`@midnight/shared`,
 * `sim/projectiles.ts`), re-exported so the preview and the dev harness read the exact numbers the server throws
 * with. `chargingThrow` and `predictFlight` are client-side reads of those numbers.
 */
export { THROW, THROW_RELEASE_H, throwVelocity, chargeToRange } from "@midnight/shared";

/** The charge of a throw still in its `charge` phase, else null (a released throw, or any other action). */
export function chargingThrow(action: Action | null | undefined): number | null {
  if (!action || action.kind !== "throw") return null;
  const a = action as { phase?: string; charge?: number };
  if (a.phase !== "charge") return null;
  return Math.max(0, a.charge ?? 0);
}

export interface Pt { x: number; y: number }

/**
 * The predicted flight from `from`, tick by tick with the sim's Euler step (`projectiles.ts`: `vy += g; x += vx;
 * y += vy`, landing once falling and at or below the surface), until it reaches `groundY`. Returns `dots` evenly
 * spaced samples along the flight and the landing point.
 */
export function predictFlight(
  from: Pt, vx: number, vy: number, groundY: number, dots: number, maxTicks = 600,
): { dots: Pt[]; landing: Pt } {
  const path: Pt[] = [];
  let x = from.x;
  let y = from.y;
  let dy = vy;
  for (let t = 0; t < maxTicks; t += 1) {
    dy += BALANCE.GRAVITY;
    x += vx;
    y += dy;
    if (dy > 0 && y >= groundY) {
      // Back off to the ground line along the last step so the marker sits on the roof, not under it.
      const over = (y - groundY) / Math.max(1e-6, dy);
      x -= vx * over;
      y = groundY;
      path.push({ x, y });
      break;
    }
    path.push({ x, y });
  }
  const landing = path[path.length - 1] ?? { x: from.x, y: groundY };
  const out: Pt[] = [];
  for (let k = 0; k < dots; k += 1) {
    const idx = Math.min(path.length - 1, Math.round(((k + 0.5) / dots) * (path.length - 1)));
    out.push(path[idx] ?? landing);
  }
  return { dots: out, landing };
}
