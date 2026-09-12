import { Debounce, Hysteresis } from "../filters";
import type { Metrics } from "../metrics";
import { LEAN_ENTER, LEAN_EXIT, WALK_DEBOUNCE_OFF, WALK_DEBOUNCE_ON } from "../thresholds";

export interface WalkOutput {
  left: boolean;
  right: boolean;
}

/** Lean past LEAN_ENTER walks; back inside LEAN_EXIT stops. Left and right are mutually exclusive. */
export class Walk {
  private readonly rightHys = new Hysteresis(LEAN_ENTER, LEAN_EXIT);
  private readonly leftHys = new Hysteresis(LEAN_ENTER, LEAN_EXIT);
  private readonly rightDeb = new Debounce(WALK_DEBOUNCE_ON, WALK_DEBOUNCE_OFF);
  private readonly leftDeb = new Debounce(WALK_DEBOUNCE_ON, WALK_DEBOUNCE_OFF);
  private readonly out: WalkOutput = { left: false, right: false };

  update(m: Metrics, _ts: number): WalkOutput {
    const right = this.rightDeb.update(this.rightHys.update(m.lean));
    const left = this.leftDeb.update(this.leftHys.update(-m.lean));
    this.out.right = right;
    this.out.left = left && !right;
    return this.out;
  }

  reset(): void {
    this.rightHys.reset();
    this.leftHys.reset();
    this.rightDeb.reset();
    this.leftDeb.reset();
    this.out.left = false;
    this.out.right = false;
  }
}
