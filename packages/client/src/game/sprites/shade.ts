/**
 * 13.02 — The shading engine: tapered limbs shaded as lit cylinders in four steps with a 2×2 ordered dither,
 * joint creases, and the material ramps behind them. Pure: no Phaser, no DOM, no randomness. Spec:
 * implementation-docs/13-art/02-shading.md.
 */
import { P } from "../palette";
import type { Pt } from "../rig/pose";
import { PixelCanvas, darken, mix, rgba } from "./grid";

/** Four value steps of one material, lightest first. */
export type Ramp = readonly [highlight: number, base: number, shade: number, core: number];

/** Rule 6: a ramp from one colour — a cool highlight, the base, a darker shade and a night-tinted core shadow. */
export function rampFrom(base: number): Ramp {
  return [mix(base, P.moon, 0.22), base, darken(base, 0.74), mix(darken(base, 0.52), P.night1, 0.3)];
}

/** Unit vector toward the light in authored (facing-right) sprite space, y down. */
export interface LightDir { x: number; y: number }

/** The light's out-of-screen component and, from it, how much of it lies in the screen plane. */
const LIGHT_Z = 0.6;
const LIGHT_PLANE = Math.sqrt(1 - LIGHT_Z * LIGHT_Z);
/** Step thresholds on the Lambert term `N · L` (rule 2). */
const STEP_HI = 0.78;
const STEP_BASE = 0.3;
const STEP_SHADE = -0.2;
/** Half-width of the dither band around each threshold. */
const DITHER_AMP = 0.12;
/** 2×2 Bayer matrix, indexed by `(x & 1) + 2 · (y & 1)`. */
const BAYER2 = [0, 0.5, 0.75, 0.25] as const;
/** Shading term of a flat (unlit) limb: the base step. */
const FLAT_S = 0.5;
/** Rule 4: bends shallower than this get no crease. */
export const CREASE_MIN_DEG = 25;
const CREASE_MIX = 0.5;

/** Maps a Lambert term to a ramp index, dithering each boundary with the 2×2 matrix. */
export function stepFor(s: number, x: number, y: number, dither = true): 0 | 1 | 2 | 3 {
  const v = dither ? s + (BAYER2[(x & 1) + 2 * (y & 1)]! - 0.5) * DITHER_AMP : s;
  if (v > STEP_HI) return 0;
  if (v > STEP_BASE) return 1;
  if (v > STEP_SHADE) return 2;
  return 3;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/**
 * Rules 1–2: a capsule from `a` (width `wa`) to `b` (width `wb`), each pixel shaded as a point on a cylinder lit
 * from `light` (or from the camera when null). Joints are pixel indices (the pixel at `a` is the axis), so a
 * capsule of width w is exactly w pixels across. `flat` paints the base step only.
 */
export function taperedLimb(c: PixelCanvas, a: Pt, b: Pt, wa: number, wb: number, ramp: Ramp, light: LightDir | null, flat = false): void {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  const ux = len > 1e-6 ? dx / len : 0;
  const uy = len > 1e-6 ? dy / len : 1;
  const px = -uy;
  const py = ux;
  const lp = light ? (light.x * px + light.y * py) * LIGHT_PLANE : 0;
  const ra = wa / 2;
  const rb = wb / 2;
  const rmax = Math.max(ra, rb);
  const x0 = Math.floor(Math.min(a.x, b.x) - rmax) - 1;
  const x1 = Math.ceil(Math.max(a.x, b.x) + rmax) + 1;
  const y0 = Math.floor(Math.min(a.y, b.y) - rmax) - 1;
  const y1 = Math.ceil(Math.max(a.y, b.y) + rmax) + 1;
  const cols = [rgba(ramp[0]), rgba(ramp[1]), rgba(ramp[2]), rgba(ramp[3])] as const;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const rx = x - a.x;
      const ry = y - a.y;
      const along = rx * ux + ry * uy;
      const t = len > 1e-6 ? clamp(along / len, 0, 1) : 0;
      const r = ra + (rb - ra) * t;
      const d = rx * px + ry * py;
      const inBand = along >= 0 && along <= len && Math.abs(d) < r;
      const inCapA = rx * rx + ry * ry < ra * ra;
      const bx = x - b.x;
      const by = y - b.y;
      const inCapB = bx * bx + by * by < rb * rb;
      if (!inBand && !inCapA && !inCapB) continue;
      let step: 0 | 1 | 2 | 3 = 1;
      if (flat) {
        step = stepFor(FLAT_S, x, y, false);
      } else {
        const n = clamp(d / Math.max(r, 0.5), -1, 1);
        const z = Math.sqrt(Math.max(0, 1 - n * n));
        step = stepFor(n * lp + z * LIGHT_Z, x, y, true);
      }
      c.set(x, y, cols[step]);
    }
  }
}

/**
 * Rule 4: at a joint bent past CREASE_MIN_DEG, a one-pixel core crease along the inner rim and a half-core
 * wedge over the limb pixels inside the bend. Touches only opaque pixels within `r` of the joint.
 */
export function jointCrease(c: PixelCanvas, joint: Pt, from: Pt, to: Pt, r: number, ramp: Ramp): void {
  const u1 = unit(joint.x - from.x, joint.y - from.y);
  const u2 = unit(to.x - joint.x, to.y - joint.y);
  const cos = clamp(u1.x * u2.x + u1.y * u2.y, -1, 1);
  const bend = (Math.acos(cos) * 180) / Math.PI;
  if (bend < CREASE_MIN_DEG) return;
  // the concave side is where the chain turns toward
  const inner = unit(u2.x - u1.x, u2.y - u1.y);
  const core = ramp[3];
  const coreRgba = rgba(core);
  const R = Math.ceil(r);
  for (let dy = -R; dy <= R; dy++) {
    for (let dx = -R; dx <= R; dx++) {
      const x = Math.round(joint.x) + dx;
      const y = Math.round(joint.y) + dy;
      const px = c.get(x, y);
      if (px === 0) continue;
      const ox = x - joint.x;
      const oy = y - joint.y;
      const dist = Math.hypot(ox, oy);
      if (dist > r) continue;
      const side = ox * inner.x + oy * inner.y;
      if (side < 0.3 * r) continue;
      if (dist >= r - 1) c.set(x, y, coreRgba);
      else c.set(x, y, rgba(mix(px >>> 8, core, CREASE_MIX), px & 255));
    }
  }
}

function unit(x: number, y: number): Pt {
  const l = Math.hypot(x, y) || 1;
  return { x: x / l, y: y / l };
}
