/**
 * 12.01 — The pixel grid. Fighters are rasterised at `SPRITE_SCALE` world px per sprite px; everything new that
 * is drawn as art (effects, shadows, particles) lands on the same grid so the picture reads as one image. Lights,
 * fog, bloom and gradients are the smooth layer of the hybrid look and are deliberately exempt.
 */
import { SPRITE_SCALE } from "./sprites/compose";

/** World px per art pixel: the quantisation unit for new drawing code. */
export const PIXEL: number = SPRITE_SCALE;

/** Nearest multiple of `PIXEL`; half-way rounds up. */
export function snap(v: number): number {
  return Math.round(v / PIXEL) * PIXEL || 0; // `|| 0` folds −0 into 0
}

/** Next multiple of `PIXEL` at or above `v` (sizes that must not shrink). */
export function snapUp(v: number): number {
  return Math.ceil(v / PIXEL - 1e-9) * PIXEL || 0;
}

/** Both coordinates snapped; other fields kept. */
export function snapPt<T extends { x: number; y: number }>(p: T): T {
  return { ...p, x: snap(p.x), y: snap(p.y) };
}
