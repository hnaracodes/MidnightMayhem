/**
 * Cosmetic punch hint (06-integration rule 4) and the KO-slowed render clock (4.07 rule 2). Pure: no Phaser,
 * no DOM, no session. The scene feeds these once per render frame and draws whatever they return.
 *
 * The hint hides the ~50 ms snapshot delay: on a local punch edge the local rig is drawn in the punch startup
 * pose (elapsed 0..3 over four frames, then held at 3) until a snapshot shows an action, or for at most
 * HINT_MAX_FRAMES frames. It never reaches the active pose (elapsed 4) and it never touches state.
 */
import { BALANCE, type Arm, type FighterState, type InputFrame } from "@midnight/shared";

export interface PunchHint {
  arm: Arm;
  /** Render frames since the edge; the drawn `elapsed` is `min(frames, PUNCH_STARTUP - 1)`. */
  frames: number;
}

export const HINT_MAX_FRAMES = 6;

/** A snapshot fighter that can start a punch: not punching, not in hitstun, not blocking. */
export function canHint(f: FighterState, fighting: boolean): boolean {
  return fighting && f.action === null && f.hitstun === 0 && !f.blocking;
}

/**
 * Advances the hint by one render frame. `edges` are this frame's rising edges of the local source,
 * `f` is the local fighter in the newest snapshot, `fighting` is whether the sim accepts punches right now.
 */
export function advanceHint(prev: PunchHint | null, edges: Readonly<InputFrame>, f: FighterState, fighting: boolean): PunchHint | null {
  if (prev) {
    if (f.action !== null || !fighting) return null; // the snapshot caught up (or the round ended): fall back
    const frames = prev.frames + 1;
    return frames >= HINT_MAX_FRAMES ? null : { arm: prev.arm, frames };
  }
  const arm: Arm | null = edges.punchL ? "L" : edges.punchR ? "R" : null;
  if (arm === null || !canHint(f, fighting)) return null;
  return { arm, frames: 0 };
}

/** The fighter to draw: the snapshot with a synthetic startup action while a hint runs, else the snapshot itself. */
export function hintedFighter(f: FighterState, hint: PunchHint | null): FighterState {
  if (!hint) return f;
  const elapsed = Math.min(hint.frames, BALANCE.PUNCH_STARTUP - 1);
  return { ...f, action: { kind: "punch", arm: hint.arm, elapsed, landed: false, sword: false } };
}

// ---------------------------------------------------------------------------------------------
// Render clock

/**
 * The scene's render clock: wall time scaled by the KO slowdown. While `timeScale < 1` the clock falls behind
 * wall time; once the slowdown ends it catches up at CATCHUP_RATE so the snapshot buffer (six entries, about
 * 200 ms) never sits on its oldest snapshot for the rest of the match. It never runs ahead of wall time.
 */
export class RenderClock {
  static readonly CATCHUP_RATE = 2;
  private renderMs: number | null = null;
  private lastNow = 0;

  /** Advances by the wall-time step since the previous call and returns the render time in ms. */
  advance(nowMs: number, timeScale: number): number {
    if (this.renderMs === null) {
      this.renderMs = nowMs;
      this.lastNow = nowMs;
      return nowMs;
    }
    const dt = Math.max(0, nowMs - this.lastNow);
    this.lastNow = nowMs;
    const rate = timeScale < 1 ? timeScale : RenderClock.CATCHUP_RATE;
    this.renderMs = Math.min(nowMs, this.renderMs + dt * rate);
    return this.renderMs;
  }

  /** How far the render clock trails wall time, in ms. */
  lagMs(nowMs: number): number {
    return this.renderMs === null ? 0 : nowMs - this.renderMs;
  }
}
