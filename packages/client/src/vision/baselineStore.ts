import type { Baseline } from "./calibration";

/**
 * The remembered calibration (owner rule, 2026-09-12): the last good baseline is kept per browser so a reload does
 * not ask for "stand still" again. `Calibration.restore` checks it against the first still window. Pure over a
 * Storage-like object so the source can pass `localStorage` and tests a stub; every access is guarded because
 * storage can be absent or throw (private windows, blocked site data).
 */
export const BASELINE_KEY = "midnight-mayhem:baseline";

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const FIELDS: (keyof Baseline)[] = ["S", "leanZero", "hipY", "shoulderY", "noseY", "eyeY", "armLen"];

/** A stored baseline, or null when there is none or it is not a well-formed one (S and armLen must be > 0). */
export function loadBaseline(storage: StorageLike | null | undefined): Baseline | null {
  try {
    const raw = storage?.getItem(BASELINE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const out = {} as Baseline;
    for (const k of FIELDS) {
      const v = (parsed as Record<string, unknown>)[k];
      if (typeof v !== "number" || !Number.isFinite(v)) return null;
      out[k] = v;
    }
    if (out.S <= 0 || out.armLen <= 0) return null;
    return out;
  } catch {
    return null;
  }
}

export function saveBaseline(storage: StorageLike | null | undefined, baseline: Baseline): void {
  try {
    storage?.setItem(BASELINE_KEY, JSON.stringify(baseline));
  } catch {
    // storage full or blocked: the next start simply calibrates as before
  }
}
