import { Debounce, RingBuffer } from "../filters";
import type { Metrics } from "../metrics";
import { JUMP_DEBOUNCE_OFF, JUMP_DEBOUNCE_ON, JUMP_LAND, JUMP_RISE, JUMP_WINDOW_MS } from "../thresholds";

/** A physical hop: both hips and shoulders rise fast past JUMP_RISE; ends when either drops below JUMP_LAND. */
export class Jump {
  private readonly rise = new RingBuffer<number>(JUMP_WINDOW_MS);
  private readonly deb = new Debounce(JUMP_DEBOUNCE_ON, JUMP_DEBOUNCE_OFF);
  private airborne = false;

  update(m: Metrics, ts: number): boolean {
    const minRise = Math.min(m.riseHip, m.riseShoulder);
    this.rise.push(ts, minRise);
    if (this.airborne) {
      if (m.riseHip < JUMP_LAND || m.riseShoulder < JUMP_LAND) this.airborne = false;
    } else if (m.riseHip > JUMP_RISE && m.riseShoulder > JUMP_RISE) {
      const oldest = this.rise.oldestWithin(JUMP_WINDOW_MS) ?? minRise;
      if (minRise - oldest >= JUMP_RISE) this.airborne = true;
    }
    return this.deb.update(this.airborne);
  }

  reset(): void {
    this.rise.clear();
    this.deb.reset();
    this.airborne = false;
  }
}
