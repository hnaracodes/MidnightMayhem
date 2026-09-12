import { Debounce } from "../filters";
import { fistFor } from "../hands";
import type { Metrics } from "../metrics";
import {
  DEPTH_ENTER_NO_HAND,
  EXT_ENTER,
  JAB_EXT,
  JAB_RISE,
  PUNCH_DEBOUNCE_OFF,
  PUNCH_DEBOUNCE_ON,
  PUNCH_MIN_HOLD_MS,
  PUNCH_RETRIGGER_COOLDOWN_MS,
  SIDE_JAB_ENABLED,
  THRUST_ENABLED,
} from "../thresholds";

/** How the current punch was entered; null while not active. */
export type PunchPath = "thrust" | "jab" | null;

/**
 * Per-arm, per-frame view of every punch gate (integrator amendment to 5.03), for the harness and the
 * recorder. The first ten fields are the shared contract with the preview lane; the rest are extras.
 */
export interface PunchDiag {
  ext: number;
  depth: number;
  drop: number;
  atHeight: boolean;
  /** ext < EXT_ENTER */
  extOk: boolean;
  /** depth > DEPTH_ENTER_NO_HAND */
  depthOk: boolean;
  /** raw extension dropped by THRUST_DROP within THRUST_WINDOW_MS (or thrust disabled) */
  thrustOk: boolean;
  /** side-jab alternative entry: atHeight and side > JAB_EXT and side rose by JAB_RISE within JAB_WINDOW_MS */
  jabOk: boolean;
  /** the gesture's internal active flag (before debounce and hold) */
  active: boolean;
  /** the debounced, minimum-held output */
  out: boolean;
  /** horizontal outward extension over arm length (side-jab metric) */
  side: number;
  /** largest raw side rise within JAB_WINDOW_MS */
  jabRise: number;
  /** which entry path the active punch took */
  path: PunchPath;
}

function emptyDiag(): PunchDiag {
  return {
    ext: 0, depth: 0, drop: 0, atHeight: false, extOk: false, depthOk: false, thrustOk: false, jabOk: false,
    active: false, out: false, side: 0, jabRise: 0, path: null,
  };
}

/**
 * A punch per arm: either a thrust toward the camera (the no-hand depth rule) or, behind SIDE_JAB_ENABLED,
 * a fast horizontal jab away from the body. Each detection emits one short pulse, then waits for its motion
 * signal to clear before another motion can enter.
 */
export class Punch {
  private readonly deb = new Debounce(PUNCH_DEBOUNCE_ON, PUNCH_DEBOUNCE_OFF);
  private active = false;
  private path: PunchPath = null;
  private out = false;
  private enteredAt = 0;
  private cooldownUntil = 0;
  private awaitingMotionClear = false;
  private last: PunchDiag = emptyDiag();

  constructor(private readonly arm: "L" | "R") {}

  update(m: Metrics, ts: number): boolean {
    const L = this.arm === "L";
    const ext = L ? m.extL : m.extR;
    const depth = L ? m.depthL : m.depthR;
    const atHeight = L ? m.atHeightL : m.atHeightR;
    const thrust = L ? m.thrustL : m.thrustR;
    const drop = L ? m.dropL : m.dropR;
    const side = L ? m.sideL : m.sideR;
    const jabRise = L ? m.jabRiseL : m.jabRiseR;

    const extOk = ext < EXT_ENTER;
    const depthOk = depth > DEPTH_ENTER_NO_HAND;
    const thrustOk = thrust || !THRUST_ENABLED;
    // A crossed arm has negative side; an arm swinging up is off-height and never reaches JAB_EXT sideways.
    const jabOk = atHeight && side > JAB_EXT && jabRise >= JAB_RISE;

    const motionPresent = thrustOk || jabOk;
    if (this.out && ts - this.enteredAt >= PUNCH_MIN_HOLD_MS) {
      this.out = false;
      this.path = null;
    }
    if (this.awaitingMotionClear) {
      this.active = false;
      this.deb.update(false);
      if (!motionPresent) this.awaitingMotionClear = false;
    } else if (ts < this.cooldownUntil) {
      // Retraction can briefly look like a new thrust. Require a fresh motion after this short window.
      this.active = false;
      this.path = null;
      this.deb.update(false);
    } else {
      if (fistFor(this.arm) !== false && extOk && depthOk && atHeight && thrustOk) {
        this.active = true;
        this.path = "thrust";
      } else if (fistFor(this.arm) !== false && SIDE_JAB_ENABLED && jabOk) {
        this.active = true;
        this.path = "jab";
      } else {
        this.active = false;
        this.path = null;
      }

      if (this.deb.update(this.active) && !this.out) {
        this.out = true;
        this.enteredAt = ts;
        this.cooldownUntil = ts + PUNCH_RETRIGGER_COOLDOWN_MS;
        this.awaitingMotionClear = true;
      }
    }

    this.last = {
      ext, depth, drop, atHeight, extOk, depthOk, thrustOk, jabOk,
      active: this.active, out: this.out, side, jabRise, path: this.path,
    };
    return this.out;
  }

  /** Every gate from the last update(); all-false zeros after reset(). */
  diag(): PunchDiag {
    return this.last;
  }

  reset(): void {
    this.deb.reset();
    this.active = false;
    this.path = null;
    this.out = false;
    this.enteredAt = 0;
    this.cooldownUntil = 0;
    this.awaitingMotionClear = false;
    this.last = emptyDiag();
  }
}
