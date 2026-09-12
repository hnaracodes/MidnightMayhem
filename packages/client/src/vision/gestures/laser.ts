import { Debounce } from "../filters";
import type { Metrics } from "../metrics";
import { LASER_DEBOUNCE_OFF, LASER_DEBOUNCE_ON, LASER_HEIGHT, LASER_SIDE_OFFSET, LASER_SIDE_RISE } from "../thresholds";

/**
 * The beam gesture: sweep the right hand quickly out to the player's right.
 * It deliberately measures image-plane side motion rather than depth, so a forward punch does not become special.
 */
export class Laser {
  private readonly deb = new Debounce(LASER_DEBOUNCE_ON, LASER_DEBOUNCE_OFF);

  update(m: Metrics, _ts: number): boolean {
    const raw =
      m.sideR >= LASER_SIDE_OFFSET &&
      m.jabRiseR >= LASER_SIDE_RISE &&
      Math.abs(m.wristHeightR) <= LASER_HEIGHT;
    return this.deb.update(raw);
  }

  reset(): void {
    this.deb.reset();
  }
}
