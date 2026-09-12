import { BALANCE, type Action } from "@midnight/shared";

/**
 * 9.08 rule 5 — the pure half of the throw preview.
 *
 * INTEGRATOR: collapse after merge. `THROW`, `throwVelocity` and `chargeToRange` duplicate Lane A's
 * (`feat/throw-charge`) exports; once both lanes are on `main`, import them from `@midnight/shared` and delete the
 * copies here. `chargingThrow` and `predictFlight` stay: they are client-side reads of the sim's numbers.
 */

/** Lane A's `THROW` block (the three values the preview needs). */
export const THROW = { CHARGE_MAX: 45, MIN_RANGE: 120, MAX_RANGE: 640, ANGLE_DEG: 45 } as const;

/** Release height above the feet the sim throws from (Lane A: 100 px). */
export const THROW_RELEASE_H = 100;

/**
 * Launch speed that lands `range` px away on flat ground at `ANGLE_DEG`, released 100 px up, under
 * `BALANCE.GRAVITY`. At 45° the quadratic collapses to `v = R · sqrt(g / (R + h))`; `vx = v·cos θ`, `vy = −v·sin θ`.
 */
export function throwVelocity(range: number): { vx: number; vy: number } {
  const theta = (THROW.ANGLE_DEG * Math.PI) / 180;
  const g = BALANCE.GRAVITY;
  const r = Math.max(1, range);
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  // General form of the 45° shortcut above, so a later ANGLE_DEG change keeps working.
  const k = (r * g) / cos;
  const v2 = (k * k) / (2 * (k * sin + g * THROW_RELEASE_H));
  const v = Math.sqrt(v2);
  return { vx: v * cos, vy: -v * sin };
}

/** Linear `MIN_RANGE → MAX_RANGE` over `0 → CHARGE_MAX`, clamped. */
export function chargeToRange(charge: number): number {
  const t = Math.min(1, Math.max(0, charge / THROW.CHARGE_MAX));
  return THROW.MIN_RANGE + (THROW.MAX_RANGE - THROW.MIN_RANGE) * t;
}

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
