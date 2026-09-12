import { Debounce } from "../filters";
import type { Metrics } from "../metrics";
import { LASER_DEBOUNCE_OFF, LASER_DEBOUNCE_ON, LASER_EXT, LASER_GAP } from "../thresholds";

/**
 * The beam pose (9.04): both arms thrust toward the camera together. Raw = both extensions below LASER_EXT,
 * both wrists at shoulder height, wrists within LASER_GAP · S of each other; debounced on / off.
 * A single-arm punch pose fails the "both" gates and never fires it.
 */
export class Laser {
  private readonly deb = new Debounce(LASER_DEBOUNCE_ON, LASER_DEBOUNCE_OFF);

  update(m: Metrics, _ts: number): boolean {
    const raw =
      m.extL < LASER_EXT && m.extR < LASER_EXT && m.atHeightL && m.atHeightR && m.wristGap < LASER_GAP;
    return this.deb.update(raw);
  }

  reset(): void {
    this.deb.reset();
  }
}
