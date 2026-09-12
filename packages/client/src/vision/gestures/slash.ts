import type { ItemId } from "@midnight/shared";
import { RingBuffer } from "../filters";
import type { Metrics } from "../metrics";
import {
  CHOP_DROP, CHOP_EXT, CHOP_WINDOW_MS, SLASH_GESTURES_ENABLED, SLASH_EXCLUSIVE_MS, SWEEP_TRAVEL, SWEEP_WINDOW_MS,
} from "../thresholds";

/** One frame of slash output: one-frame pulses plus whether the arm's punch is currently suppressed. */
export interface SlashOutput {
  chop: boolean;
  sweep: boolean;
  /** True for SLASH_EXCLUSIVE_MS after a pulse: the arm's punch is suppressed. */
  exclusive: boolean;
}

/** Per-arm, per-frame slash gates for the harness. */
export interface SlashDiag {
  /** wrist above the nose this frame */
  aboveNose: boolean;
  /** largest wrist drop (in S) within CHOP_WINDOW_MS since it was above the nose */
  chopDrop: number;
  /** ext > CHOP_EXT */
  chopExt: boolean;
  /** horizontal travel (in S) within SWEEP_WINDOW_MS */
  sweepTravel: number;
  /** the travel crossed the shoulder midline at shoulder height */
  sweepCross: boolean;
  chop: boolean;
  sweep: boolean;
  exclusive: boolean;
}

const EMPTY: SlashDiag = {
  aboveNose: false, chopDrop: 0, chopExt: false, sweepTravel: 0, sweepCross: false, chop: false, sweep: false,
  exclusive: false,
};

/**
 * Sword slashes (9.10), one per arm, only while the held item is "sword".
 * Chop: the wrist was above the nose, then fell ≥ CHOP_DROP·S within CHOP_WINDOW_MS with the arm extended.
 * Sweep: the wrist travelled ≥ SWEEP_TRAVEL·S horizontally across the shoulder midline within
 * SWEEP_WINDOW_MS at shoulder height. Each is a one-frame pulse followed by SLASH_EXCLUSIVE_MS of exclusivity.
 */
export class Slash {
  private readonly ys = new RingBuffer<number>(CHOP_WINDOW_MS);
  private readonly xs = new RingBuffer<number>(SWEEP_WINDOW_MS);
  private readonly above = new RingBuffer<boolean>(CHOP_WINDOW_MS);
  private firedAt = -Infinity;
  private last: SlashDiag = EMPTY;
  private readonly out: SlashOutput = { chop: false, sweep: false, exclusive: false };

  constructor(private readonly arm: "L" | "R") {}

  update(m: Metrics, ts: number, held: ItemId | null): SlashOutput {
    const L = this.arm === "L";
    const noseDrop = L ? m.noseDropL : m.noseDropR;
    const wristX = L ? m.wristXL : m.wristXR;
    const ext = L ? m.extL : m.extR;
    const atHeight = L ? m.atHeightL : m.atHeightR;

    this.ys.push(ts, noseDrop);
    this.xs.push(ts, wristX);
    const aboveNose = noseDrop < 0;
    this.above.push(ts, aboveNose);

    const exclusive = ts - this.firedAt < SLASH_EXCLUSIVE_MS;
    const wasAbove = this.above.values().some(Boolean);
    const chopDrop = this.ys.maxRiseWithin(CHOP_WINDOW_MS);
    const chopExt = ext > CHOP_EXT;
    const travelRise = this.xs.maxRiseWithin(SWEEP_WINDOW_MS);
    const travelDrop = this.xs.maxDropWithin(SWEEP_WINDOW_MS);
    const sweepTravel = Math.max(travelRise, travelDrop);
    const xsVals = this.xs.values();
    const crossed = xsVals.some((x) => Math.sign(x) !== Math.sign(wristX) && x !== 0);
    const sweepCross = atHeight && crossed;

    let chop = false;
    let sweep = false;
    if (SLASH_GESTURES_ENABLED && held === "sword" && !exclusive) {
      chop = wasAbove && chopDrop >= CHOP_DROP && chopExt;
      sweep = !chop && sweepCross && sweepTravel >= SWEEP_TRAVEL;
      if (chop || sweep) {
        this.firedAt = ts;
        this.ys.clear();
        this.xs.clear();
        this.above.clear();
      }
    }
    this.out.chop = chop;
    this.out.sweep = sweep;
    this.out.exclusive = exclusive || chop || sweep;
    this.last = { aboveNose, chopDrop, chopExt, sweepTravel, sweepCross, chop, sweep, exclusive: this.out.exclusive };
    return this.out;
  }

  diag(): SlashDiag {
    return this.last;
  }

  reset(): void {
    this.ys.clear();
    this.xs.clear();
    this.above.clear();
    this.firedAt = -Infinity;
    this.last = EMPTY;
    this.out.chop = this.out.sweep = this.out.exclusive = false;
  }
}
