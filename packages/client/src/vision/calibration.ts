import { CALIBRATION_MS, MIN_VIS, RELOST_MS, RESTORE_TOLERANCE, STABLE_MOVE } from "./thresholds";
import type { Landmark } from "./workerClient";

export type CalibrationPhase = "idle" | "calibrating" | "ready" | "lost";

/** The player's resting pose. Image units unless noted. */
export interface Baseline {
  /** Shoulder width `|xm11 - xm12|`; every image distance is divided by this. */
  S: number;
  /** Natural shoulder-over-hip offset in mirrored x. */
  leanZero: number;
  hipY: number;
  shoulderY: number;
  noseY: number;
  eyeY: number;
  /** Mean 2D wrist-to-shoulder distance with the arms hanging. */
  armLen: number;
}

/** Landmarks that must be visible for a frame to count. */
export const CALIBRATION_LANDMARKS = [0, 11, 12, 15, 16, 23, 24] as const;

const xm = (l: Landmark) => 1 - l.x;
const dist2D = (a: Landmark, b: Landmark) => Math.hypot(a.x - b.x, a.y - b.y);

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}

/** True when every calibration landmark is present and visible. */
export function poseVisible(landmarks: Landmark[] | null): landmarks is Landmark[] {
  if (!landmarks) return false;
  for (const i of CALIBRATION_LANDMARKS) {
    const l = landmarks[i];
    if (!l || l.visibility <= MIN_VIS) return false;
  }
  return true;
}

/**
 * Captures the resting baseline over CALIBRATION_MS of still frames. Two owner rules (2026-09-12) keep the prompt
 * out of the way without touching what is measured: a ready baseline survives `lost` (the body coming back is
 * ready at once), and a baseline handed in by `restore` is used immediately and only replaced when the first
 * still window measures more than RESTORE_TOLERANCE away in S. Only `begin` discards a baseline on purpose.
 */
export class Calibration {
  baseline: Baseline | null = null;
  /** True while a restored baseline has not yet been checked against a still window. */
  provisional = false;

  private phase: CalibrationPhase = "idle";
  private progress = 0;
  private window: Baseline[] = [];
  private windowStart = -1;
  private lastShoulderMid: { x: number; y: number } | null = null;
  private lastSeenTs: number | null = null;
  private resolvers: (() => void)[] = [];
  private captureCb: ((b: Baseline) => void) | null = null;

  /** Called with every baseline a still window produces (a fresh capture or a replaced restore). */
  onCapture(cb: (b: Baseline) => void): void {
    this.captureCb = cb;
  }

  /** Adopts a stored baseline: ready now, verified against the first still window (see `provisional`). */
  restore(baseline: Baseline): void {
    this.startWindow();
    this.baseline = baseline;
    this.provisional = true;
    this.phase = "ready";
    this.progress = 1;
  }

  state(): { phase: CalibrationPhase; progress: number } {
    return { phase: this.phase, progress: this.progress };
  }

  /** Starts (or restarts) a capture. Resolves when the phase reaches `ready`. Safe to call at any time. */
  begin(): Promise<void> {
    if (this.baseline && this.phase === "ready" && this.provisional) return Promise.resolve();
    this.baseline = null;
    this.provisional = false;
    this.startWindow();
    this.progress = 0;
    this.phase = "calibrating";
    return new Promise((resolve) => this.resolvers.push(resolve));
  }

  update(landmarks: Landmark[] | null, ts: number): void {
    if (this.lastSeenTs === null) this.lastSeenTs = ts;

    if (!poseVisible(landmarks)) {
      if (this.phase === "calibrating") { this.startWindow(); this.progress = 0; }
      if ((this.phase === "calibrating" || this.phase === "ready") && ts - this.lastSeenTs > RELOST_MS) {
        this.phase = "lost";
        this.progress = 0;
      }
      this.lastShoulderMid = null;
      return;
    }

    this.lastSeenTs = ts;
    if (this.phase === "lost") {
      this.startWindow();
      if (this.baseline) { this.phase = "ready"; this.progress = 1; }
      else { this.phase = "calibrating"; this.progress = 0; }
    }

    const ls = landmarks[11] as Landmark;
    const rs = landmarks[12] as Landmark;
    const mid = { x: (xm(ls) + xm(rs)) / 2, y: (ls.y + rs.y) / 2 };
    const moved = this.lastShoulderMid ? Math.hypot(mid.x - this.lastShoulderMid.x, mid.y - this.lastShoulderMid.y) : 0;
    this.lastShoulderMid = mid;

    if (this.phase !== "calibrating" && !(this.phase === "ready" && this.provisional)) return;

    const lh = landmarks[23] as Landmark;
    const rh = landmarks[24] as Landmark;
    const lw = landmarks[15] as Landmark;
    const rw = landmarks[16] as Landmark;
    const hipMidY = (lh.y + rh.y) / 2;
    const stable = moved < STABLE_MOVE && lw.y > hipMidY && rw.y > hipMidY;
    if (!stable) {
      this.startWindow();
      if (this.phase === "calibrating") this.progress = 0;
      return;
    }

    if (this.windowStart < 0) this.windowStart = ts;
    this.window.push({
      S: Math.abs(xm(ls) - xm(rs)),
      leanZero: mid.x - (xm(lh) + xm(rh)) / 2,
      hipY: hipMidY,
      shoulderY: mid.y,
      noseY: (landmarks[0] as Landmark).y,
      eyeY: ((landmarks[2] as Landmark).y + (landmarks[5] as Landmark).y) / 2,
      armLen: (dist2D(lw, ls) + dist2D(rw, rs)) / 2,
    });
    const elapsed = ts - this.windowStart;
    if (this.phase === "calibrating") this.progress = Math.min(1, elapsed / CALIBRATION_MS);
    if (elapsed >= CALIBRATION_MS) this.finish();
  }

  /** Clears the still window; callers set `progress` (a provisional check must not disturb a ready 1). */
  private startWindow(): void {
    this.window = [];
    this.windowStart = -1;
  }

  private finish(): void {
    const pick = (k: keyof Baseline) => median(this.window.map((s) => s[k]));
    const measured: Baseline = {
      S: pick("S"),
      leanZero: pick("leanZero"),
      hipY: pick("hipY"),
      shoulderY: pick("shoulderY"),
      noseY: pick("noseY"),
      eyeY: pick("eyeY"),
      armLen: pick("armLen"),
    };
    this.window = [];
    if (this.provisional && this.baseline) {
      // A restored baseline stands unless the room has changed enough to matter.
      this.provisional = false;
      if (Math.abs(measured.S - this.baseline.S) <= RESTORE_TOLERANCE * this.baseline.S) return;
    }
    this.baseline = measured;
    this.captureCb?.(measured);
    this.phase = "ready";
    this.progress = 1;
    const resolvers = this.resolvers;
    this.resolvers = [];
    for (const r of resolvers) r();
  }
}
