import { Debounce } from "../filters";
import type { Metrics } from "../metrics";
import { BLOCK_DEBOUNCE_OFF, BLOCK_DEBOUNCE_ON } from "../thresholds";

/** Crossed arms (or, later, the guard) held for BLOCK_DEBOUNCE_ON frames. */
export class Block {
  private readonly deb = new Debounce(BLOCK_DEBOUNCE_ON, BLOCK_DEBOUNCE_OFF);

  update(m: Metrics, _ts: number): boolean {
    return this.deb.update(m.crossed || m.guard);
  }

  reset(): void {
    this.deb.reset();
  }
}
