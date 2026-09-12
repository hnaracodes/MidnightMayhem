import { Debounce } from "../filters";
import { fistFor } from "../hands";
import type { Metrics } from "../metrics";
import {
  DEPTH_ENTER_NO_HAND,
  DEPTH_EXIT,
  EXT_ENTER,
  EXT_EXIT,
  PUNCH_DEBOUNCE_OFF,
  PUNCH_DEBOUNCE_ON,
  PUNCH_MIN_HOLD_MS,
  THRUST_ENABLED,
} from "../thresholds";

/** A thrust toward the camera per arm, using the no-hand depth rule until the hands plan lands. */
export class Punch {
  private readonly deb = new Debounce(PUNCH_DEBOUNCE_ON, PUNCH_DEBOUNCE_OFF);
  private active = false;
  private out = false;
  private enteredAt = 0;

  constructor(private readonly arm: "L" | "R") {}

  update(m: Metrics, ts: number): boolean {
    const ext = this.arm === "L" ? m.extL : m.extR;
    const depth = this.arm === "L" ? m.depthL : m.depthR;
    const atHeight = this.arm === "L" ? m.atHeightL : m.atHeightR;
    const thrust = this.arm === "L" ? m.thrustL : m.thrustR;

    if (this.active) {
      if (ext > EXT_EXIT || depth < DEPTH_EXIT) this.active = false;
    } else if (
      ext < EXT_ENTER &&
      depth > DEPTH_ENTER_NO_HAND &&
      atHeight &&
      (thrust || !THRUST_ENABLED) &&
      fistFor(this.arm) !== false
    ) {
      this.active = true;
    }

    const debounced = this.deb.update(this.active);
    if (debounced && !this.out) this.enteredAt = ts;
    this.out = debounced || (this.out && ts - this.enteredAt < PUNCH_MIN_HOLD_MS);
    return this.out;
  }

  reset(): void {
    this.deb.reset();
    this.active = false;
    this.out = false;
    this.enteredAt = 0;
  }
}
