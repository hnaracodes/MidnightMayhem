/**
 * 12.01 — The pixel grid for everything that is not a fighter: effects, shadows, particles and (13.04) the
 * background rasters land on a 2 world-px grid so the world reads as one image. Lights, fog, bloom and gradients
 * are the smooth layer of the hybrid look and are deliberately exempt.
 *
 * 13.01: fighters rasterise at `SPRITE_SCALE = 1` (see `sprites/compose.ts`), finer than this grid by design, so
 * the 105 px body keeps a face; `PIXEL` no longer follows `SPRITE_SCALE`.
 */

/** World px per art pixel: the quantisation unit for drawing code outside the fighter sprites. */
export const PIXEL = 2;

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
