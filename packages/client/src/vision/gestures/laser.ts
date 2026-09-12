import { Debounce } from "../filters";
import type { Metrics } from "../metrics";
import { LASER_DEBOUNCE_OFF, LASER_DEBOUNCE_ON, LASER_HEIGHT, LASER_SIDE_OFFSET } from "../thresholds";

/**
 * The beam gesture: hold the right hand out to the player's right.
 * It deliberately measures image-plane side position rather than depth, so a forward punch does not become special.
 */
export class Laser {
  private readonly deb = new Debounce(LASER_DEBOUNCE_ON, LASER_DEBOUNCE_OFF);

  update(m: Metrics, _ts: number): boolean {
    const raw =
      m.sideR >= LASER_SIDE_OFFSET &&
      Math.abs(m.wristHeightR) <= LASER_HEIGHT;
    return this.deb.update(raw);
  }

  reset(): void {
    this.deb.reset();
  }
}
