import type { ItemId } from "@midnight/shared";
import type { Metrics } from "../metrics";
import {
  WINDUP_DROP, WINDUP_ENABLED,
  WINDUP_ELBOW_DEG, WINDUP_EXTEND, WINDUP_OFF, WINDUP_ON, WINDUP_RAISE,
} from "../thresholds";

/** Items a wind-up can throw (9.10). Mirrors the sim's throwables; the sim stays the truth. */
export const THROWABLES: ReadonlySet<ItemId> = new Set<ItemId>(["molotov", "banana"]);

export function isThrowable(item: ItemId | null): boolean {
  return item !== null && THROWABLES.has(item);
}

/** Per-arm, per-frame wind-up gates for the harness. */
export interface WindupDiag {
  elbow: number;
  raise: number;
  /** elbow ≤ WINDUP_ELBOW_DEG && raise ≥ WINDUP_RAISE this frame */
  bent: boolean;
  /** elbow ≥ WINDUP_ELBOW_DEG + WINDUP_EXTEND || raise < WINDUP_DROP this frame */
  released: boolean;
  active: boolean;
}

/**
 * The molotov wind-up (9.10), one per arm: the elbow held bent with the hand raised for WINDUP_ON frames
 * starts it; the arm straightening past WINDUP_ELBOW_DEG + WINDUP_EXTEND or the hand dropping below
 * WINDUP_DROP for WINDUP_OFF frames releases it. While active the arm's punch is held true so the sim
 * charges; the release is the falling edge that throws. Evaluated only while a throwable is held.
 */
export class Windup {
  private active = false;
  private onCount = 0;
  private offCount = 0;
  private last: WindupDiag = { elbow: 180, raise: 0, bent: false, released: false, active: false };

  constructor(private readonly arm: "L" | "R") {}

  update(m: Metrics, _ts: number, held: ItemId | null): boolean {
    const L = this.arm === "L";
    const elbow = L ? m.elbowL : m.elbowR;
    const raise = L ? m.raiseL : m.raiseR;
    const bent = elbow <= WINDUP_ELBOW_DEG && raise >= WINDUP_RAISE;
    const released = elbow >= WINDUP_ELBOW_DEG + WINDUP_EXTEND || raise < WINDUP_DROP;

    if (!WINDUP_ENABLED || !isThrowable(held)) {
      this.active = false;
      this.onCount = this.offCount = 0;
    } else if (this.active) {
      this.offCount = released ? this.offCount + 1 : 0;
      if (this.offCount >= WINDUP_OFF) {
        this.active = false;
        this.offCount = 0;
      }
    } else {
      this.onCount = bent ? this.onCount + 1 : 0;
      if (this.onCount >= WINDUP_ON) {
        this.active = true;
        this.onCount = 0;
      }
    }
    this.last = { elbow, raise, bent, released, active: this.active };
    return this.active;
  }

  diag(): WindupDiag {
    return this.last;
  }

  reset(): void {
    this.active = false;
    this.onCount = this.offCount = 0;
    this.last = { elbow: 180, raise: 0, bent: false, released: false, active: false };
  }
}
