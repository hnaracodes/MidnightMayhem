import type { Landmark } from "./workerClient";

/**
 * Exponential moving average per landmark coordinate. `alpha` is the weight of the new sample
 * (higher = less lag). Visibility is taken from the newest sample so loss detection stays prompt.
 * Restarts from `next` when there is no previous frame or the landmark count changed.
 */
export function emaLandmarks(prev: Landmark[] | null, next: Landmark[], alpha: number): Landmark[] {
  if (!prev || prev.length !== next.length) return next.map((l) => ({ ...l }));
  const out: Landmark[] = new Array(next.length);
  for (let i = 0; i < next.length; i++) {
    const p = prev[i] as Landmark;
    const n = next[i] as Landmark;
    out[i] = {
      x: p.x + alpha * (n.x - p.x),
      y: p.y + alpha * (n.y - p.y),
      z: p.z + alpha * (n.z - p.z),
      visibility: n.visibility,
    };
  }
  return out;
}

/** On when `value > enter`; stays on until `value < exit`. */
export class Hysteresis {
  private on = false;
  constructor(
    private readonly enter: number,
    private readonly exit: number,
  ) {}
  update(value: number): boolean {
    if (this.on) {
      if (value < this.exit) this.on = false;
    } else if (value > this.enter) {
      this.on = true;
    }
    return this.on;
  }
  reset(): void {
    this.on = false;
  }
}

/** Output turns on after `onFrames` consecutive true raws and off after `offFrames` consecutive false raws. */
export class Debounce {
  private on = false;
  private trues = 0;
  private falses = 0;
  constructor(
    private readonly onFrames: number,
    private readonly offFrames: number,
  ) {}
  update(raw: boolean): boolean {
    if (raw) {
      this.trues++;
      this.falses = 0;
      if (!this.on && this.trues >= this.onFrames) this.on = true;
    } else {
      this.falses++;
      this.trues = 0;
      if (this.on && this.falses >= this.offFrames) this.on = false;
    }
    return this.on;
  }
  reset(): void {
    this.on = false;
    this.trues = 0;
    this.falses = 0;
  }
}

/** Timestamped samples kept for at most `maxAgeMs` behind the latest push. Windows are relative to the latest push. */
export class RingBuffer<T = number> {
  private entries: { t: number; v: T }[] = [];
  constructor(private readonly maxAgeMs: number) {}

  push(t: number, v: T): void {
    this.entries.push({ t, v });
    const cutoff = t - this.maxAgeMs;
    let drop = 0;
    while (drop < this.entries.length - 1 && (this.entries[drop] as { t: number }).t < cutoff) drop++;
    if (drop > 0) this.entries.splice(0, drop);
  }

  /** Value of the earliest sample no older than `ms` before the latest push. */
  oldestWithin(ms: number): T | undefined {
    const latest = this.entries[this.entries.length - 1];
    if (!latest) return undefined;
    const cutoff = latest.t - ms;
    for (const e of this.entries) if (e.t >= cutoff) return e.v;
    return latest.v;
  }

  /** Largest fall from any sample inside the window to the latest value. 0 when empty or rising. */
  maxDropWithin(this: RingBuffer<number>, ms: number): number {
    const latest = this.entries[this.entries.length - 1];
    if (!latest) return 0;
    const cutoff = latest.t - ms;
    let max = 0;
    for (const e of this.entries) {
      if (e.t < cutoff) continue;
      const drop = e.v - latest.v;
      if (drop > max) max = drop;
    }
    return max;
  }

  /** Largest rise from any sample inside the window to the latest value. 0 when empty or falling. */
  maxRiseWithin(this: RingBuffer<number>, ms: number): number {
    const latest = this.entries[this.entries.length - 1];
    if (!latest) return 0;
    const cutoff = latest.t - ms;
    let max = 0;
    for (const e of this.entries) {
      if (e.t < cutoff) continue;
      const rise = latest.v - e.v;
      if (rise > max) max = rise;
    }
    return max;
  }

  /** Every kept value, oldest first. */
  values(): T[] {
    return this.entries.map((e) => e.v);
  }

  clear(): void {
    this.entries = [];
  }
}
