/**
 * 12.03 — Quality tiers. `high` is everything; `low` keeps the light rig and drops post-FX, god-rays and
 * particulate. Auto resolves to `high` on WebGL (Canvas has no camera FX) and drops to `low` once the measured
 * update cost sits over budget for ~2 s. Pure, so the policy is testable; the scene applies it.
 */
export type Quality = "high" | "low";

/** `update()` EMA (ms) that counts as over budget — the 4 ms sim/draw budget plus compositing headroom. */
export const FRAME_BUDGET_MS = 6;
/** Consecutive over-budget frames before the tier drops (~2 s at 60 fps). */
export const OVER_BUDGET_FRAMES = 120;

export interface QualityState { quality: Quality; over: number; locked: boolean }

/** `?quality=high|low`; anything else is `auto`. */
export function qualityFromQuery(search: string): Quality | "auto" {
  const q = new URLSearchParams(search).get("quality");
  return q === "high" || q === "low" ? q : "auto";
}

/** Auto is high on WebGL and low on Canvas (no camera FX there anyway). */
export function resolveQuality(pref: Quality | "auto", webgl: boolean): Quality {
  if (pref !== "auto") return pref;
  return webgl ? "high" : "low";
}

export function initialQualityState(quality: Quality): QualityState {
  return { quality, over: 0, locked: quality === "low" };
}

/** One frame of the downgrade policy: trips to `low` exactly once after `OVER_BUDGET_FRAMES` over-budget frames in a row. */
export function qualityStep(st: QualityState, updateMs: number): { state: QualityState; changed: boolean } {
  if (st.locked) return { state: st, changed: false };
  const over = updateMs > FRAME_BUDGET_MS ? st.over + 1 : 0;
  if (over >= OVER_BUDGET_FRAMES) return { state: { quality: "low", over, locked: true }, changed: true };
  return { state: { ...st, over }, changed: false };
}
