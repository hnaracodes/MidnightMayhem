import type Phaser from "phaser";
import { BALANCE, WORLD, type FighterState, type MatchState, type PlayerIndex, type SimEvent } from "@midnight/shared";
import { P } from "./palette";
import { PIXEL, snapPt } from "./pixel";
import type { LightSink } from "./stage/lighting";

/**
 * 4.06 — Effects and feel. Reacts to `SimEvent`s and state reads; never predicts and never mutates the state.
 *
 * Per render frame the scene calls, in this order: `consume(events, state, newest)`, then the readers
 * (`frozen`, `fillFor`, `squashFor`, `koFrames`, `landFrames`, `timeScale`, `drawTrail`), then `update(dtSec)`.
 * Every timer counts render frames; hit-stop is a display freeze (the scene draws `frozen(i)`), never a Phaser pause.
 *
 * Only structural `{ x, y }` points cross this boundary; nothing here imports from `rig/`.
 */

type Pt = { x: number; y: number };
type Graphics = Phaser.GameObjects.Graphics;

/** Presentation timings in render frames at 60 Hz. Gameplay numbers stay in `@midnight/shared`. */
const FRAMES = {
  HIT_STOP: 4,
  FLASH_WHITE: 2,
  FLASH_DANGER: 4,
  CHIP_FLASH: 2,
  IMPACT: 6,
  BLOCK_RING: 5,
  DUST: 8,
  SQUASH: 4,
  /** Length of the KO collapse in ko-frames (koPose spans 0 → 30); the slowdown holds while it plays. */
  KO_SLOW: 30,
  TRAIL: 2,
  SHAKE: 6,
  /** Pulse hold after an OOB_DAMAGE event: longer than the 30-tick gap between events, so the pulse never gaps. */
  OOB_PULSE: 40,
  /** Laser and fire flashes: a shorter white than a clean punch, no hit-stop (the beam and the fire keep moving). */
  FLASH_BURN: 3,
} as const;

const FRAME_MS = 1000 / 60;
const KO_TIME_SCALE = 0.25;
const SQUASH_Y = 0.94; // vertical; the drawer widens by the inverse (≈ 1.06)
const SHAKE_PX = 3;
const SHAKE_MIN_DAMAGE = BALANCE.PUNCH_DAMAGE; // a clean punch shakes; chip never does
const CHEST_ABOVE_FEET = 90;
/** 12.02 rule 7: a clean hit lights the roof around the impact for four frames. */
const IMPACT_LIGHT = { r: 90, intensity: 0.7, frames: 4 } as const;
const IMPACT_OFFSET = 20;
const TRAIL_WIDTH = 10;
const WALK_DUST_EVERY_TICKS = 10;
const NO_LANDING = 1_000_000;
const VIGNETTE_STRIPS = 18;
const OOB_PULSE_HZ = 2;
const DEPTH = { FX: 4.6, VIGNETTE: 5 } as const; // above the item FX (4–4.5), under the debug layer
const IMPACT_LENGTHS = [26, 16, 22, 14, 26, 18, 20, 14] as const;
const DUST_PUFFS = [
  { dx: -10, dy: -2, r: 6 },
  { dx: 2, dy: -6, r: 7 },
  { dx: 11, dy: -1, r: 5 },
] as const;

interface Timed {
  g: Graphics;
  frame: number;
  total: number;
  /** Drawn on spawn (frame 0) and after every advance; `t` runs 0 → 1 over the lifetime. */
  draw: (g: Graphics, t: number) => void;
  /** True until the first `update` after spawn so the spawn frame is rendered once. */
  fresh: boolean;
}

interface Trail { g: Graphics; life: number; fresh: boolean }

type Fill = { fillOverride?: number; fillAlpha?: number };

/** One entry per player slot (08-contracts: up to four fighters); `state.fighters` says how many are live. */
type Per<T> = [T, T, T, T];
const per = <T>(v: T): Per<T> => [v, v, v, v];
const PLAYERS: readonly PlayerIndex[] = [0, 1, 2, 3];

export class Effects {
  private readonly timed: Timed[] = [];
  private readonly trails: Per<Trail | null> = per(null);
  private vignette: Graphics | null = null;
  private readonly vignetteAlpha: [number, number] = [0, 0]; // left edge, right edge

  private freezeFrames = 0;
  private frozenSnap: FighterState[] | null = null;
  private readonly flashFrames: Per<number> = per(0);
  private readonly flashBlocked: Per<boolean> = per(false);
  private readonly squashFrames: Per<number> = per(0);
  private readonly landCount: Per<number> = per(NO_LANDING);
  private readonly prevGrounded: Per<boolean> = per(true);
  private readonly walkDustTick: Per<number | null> = per(null);
  private readonly koActive: Per<boolean> = per(false);
  private readonly koCount: Per<number> = per(0);
  /** Displayed phase from the last consume(): the slowdown only plays over ROUND_END / MATCH_END. */
  private koPhase: MatchState["phase"] = "COUNTDOWN";
  private readonly oobPulseFrames: Per<number> = per(0);
  private clockSec = 0;

  /** 12.02: `lights` is optional so the tests and previews can run without a rig. */
  constructor(private readonly scene: Phaser.Scene, private readonly lights: LightSink | null = null) {}

  /**
   * Drain this frame's events and read the sampled state. Call once per render frame before the readers.
   * `newest` is the latest snapshot in the buffer (the one that carried the events): hit-stop freezes it, not the
   * 50 ms-delayed `state`, so the held pose is the contact pose (arm extended, target in hitstun).
   */
  consume(events: SimEvent[], state: MatchState, newest: MatchState = state): void {
    for (const event of events) this.onEvent(event, state, newest);
    this.readLandings(state);
    this.readWalking(state);
    this.readKo(state);
    this.readEdges(state);
  }

  /** The fighter snapshot captured at a clean HIT while hit-stop holds, else null. */
  frozen(i: PlayerIndex): FighterState | null {
    return this.frozenSnap?.[i] ?? null;
  }

  /** Damage flash (white 70 % then danger 30 %) or chip flash (moon 40 %); `{}` when none. */
  fillFor(i: PlayerIndex): Fill {
    const left = this.flashFrames[i];
    if (left <= 0) return {};
    if (this.flashBlocked[i]) return { fillOverride: P.moon, fillAlpha: 0.4 };
    return left > FRAMES.FLASH_DANGER
      ? { fillOverride: P.white, fillAlpha: 0.7 }
      : { fillOverride: P.danger, fillAlpha: 0.3 };
  }

  /** Vertical torso scale about the feet: 0.94 for 4 frames after a landing, else 1. */
  squashFor(i: PlayerIndex): number {
    return this.squashFrames[i] > 0 ? SQUASH_Y : 1;
  }

  /**
   * (integrator amendment) Ko-frames since this fighter's KO ROUND_END; 0 when not KO'd. Advances by `timeScale()`
   * per render frame, so the 30-frame collapse spans ~120 render frames (2 s) while the slowdown holds.
   */
  koFrames(i: PlayerIndex): number {
    return this.koActive[i] ? this.koCount[i] : 0;
  }

  /** (integrator amendment) Frames since the last landing; large when none yet. */
  landFrames(i: PlayerIndex): number {
    return this.landCount[i];
  }

  /**
   * (integrator amendment) 0.25 while a KO collapse is playing (some `koFrames(i)` below 30) over ROUND_END or
   * MATCH_END, else 1. Scales the scene's render clock only; the collapse counter advances by the same factor so
   * both end together. A mid-round KO with three or four fighters collapses at 1x: the server keeps running and
   * the 200 ms snapshot buffer cannot hold a 1.5 s render lag, so slowing there would pin the display to the
   * oldest snapshot with no interpolation (11.05 rule 10 only asks that the KO'd fighter stays down).
   */
  timeScale(): number {
    if (this.koPhase !== "ROUND_END" && this.koPhase !== "MATCH_END") return 1;
    for (const i of PLAYERS) {
      if (this.koActive[i] && this.koCount[i] < FRAMES.KO_SLOW) return KO_TIME_SCALE;
    }
    return 1;
  }

  /** (integrator amendment) Punch trail: a 2-frame moon 30 % arc from the shoulder to the fist. Call on active ticks. */
  drawTrail(i: PlayerIndex, shoulder: Pt, fist: Pt): void {
    let trail = this.trails[i];
    if (!trail) {
      trail = { g: this.scene.add.graphics().setDepth(DEPTH.FX), life: FRAMES.TRAIL, fresh: true };
      this.trails[i] = trail;
    }
    trail.life = FRAMES.TRAIL;
    trail.fresh = true;
    drawArc(trail.g, shoulder, fist);
  }

  /** Advance every timer by one render frame; `dtSec` only drives the 2 Hz vignette pulse. */
  update(dtSec: number): void {
    this.clockSec += dtSec;

    if (this.freezeFrames > 0 && --this.freezeFrames === 0) this.frozenSnap = null;
    const koStep = this.timeScale(); // read before advancing so the last slow frame lands exactly on KO_SLOW
    for (const i of PLAYERS) {
      if (this.flashFrames[i] > 0) this.flashFrames[i] -= 1;
      if (this.squashFrames[i] > 0) this.squashFrames[i] -= 1;
      if (this.landCount[i] < NO_LANDING) this.landCount[i] += 1;
      if (this.koActive[i]) this.koCount[i] += koStep;
      if (this.oobPulseFrames[i] > 0) this.oobPulseFrames[i] -= 1;
    }

    for (let k = this.timed.length - 1; k >= 0; k -= 1) {
      const fx = this.timed[k]!;
      if (fx.fresh) { fx.fresh = false; continue; }
      fx.frame += 1;
      if (fx.frame >= fx.total) {
        fx.g.destroy();
        this.timed.splice(k, 1);
      } else {
        fx.draw(fx.g, fx.frame / fx.total);
      }
    }

    for (const i of PLAYERS) {
      const trail = this.trails[i];
      if (!trail) continue;
      if (trail.fresh) { trail.fresh = false; continue; }
      trail.life -= 1;
      if (trail.life <= 0) {
        trail.g.destroy();
        this.trails[i] = null;
      }
    }

    this.drawVignette();
  }

  // ---- events ----

  private onEvent(event: SimEvent, state: MatchState, newest: MatchState): void {
    switch (event.type) {
      case "HIT": {
        // Positions from `newest`, the snapshot that carried the event: an unblocked hit freezes that snapshot,
        // so the spark must sit on the frozen target's chest, not on the 50 ms-delayed sample.
        const target = newest.fighters[event.target];
        const attacker = newest.fighters[event.attacker];
        if (!target || !attacker) break;
        const toward = attacker.x !== target.x ? Math.sign(attacker.x - target.x) : target.facing;
        // 12.01: sparks and rings sit on the pixel grid
        const at = snapPt({ x: target.x + toward * IMPACT_OFFSET, y: target.y - CHEST_ABOVE_FEET });
        if (event.blocked) {
          this.flashFrames[event.target] = FRAMES.CHIP_FLASH;
          this.flashBlocked[event.target] = true;
          this.spawn(FRAMES.BLOCK_RING, (g, t) => drawBlockRing(g, at, t));
        } else {
          this.freezeFrames = FRAMES.HIT_STOP;
          this.frozenSnap = structuredClone(newest.fighters);
          this.flashFrames[event.target] = FRAMES.FLASH_WHITE + FRAMES.FLASH_DANGER;
          this.flashBlocked[event.target] = false;
          this.spawn(FRAMES.IMPACT, (g, t) => drawImpact(g, at, t));
          this.lights?.pulse({ x: at.x, y: at.y, r: IMPACT_LIGHT.r, color: P.amber1, intensity: IMPACT_LIGHT.intensity }, IMPACT_LIGHT.frames);
          if (event.damage >= SHAKE_MIN_DAMAGE) this.shake();
        }
        break;
      }
      case "JUMP": {
        const f = state.fighters[event.player];
        if (f) this.dust(f.x, f.y);
        break;
      }
      case "LASER_HIT": {
        // 11.05: a beam hit flashes the target like a punch (chip flash when blocked) but never freezes the frame.
        this.flashFrames[event.target] = event.blocked ? FRAMES.CHIP_FLASH : FRAMES.FLASH_BURN + FRAMES.FLASH_DANGER;
        this.flashBlocked[event.target] = event.blocked;
        if (!event.blocked && event.damage >= SHAKE_MIN_DAMAGE) this.shake();
        break;
      }
      case "HAZARD_HIT": {
        // Fire ticks flash danger; a slip (damage 0) has its own stars in ItemFx.
        if (event.damage <= 0) break;
        this.flashFrames[event.target] = FRAMES.FLASH_DANGER;
        this.flashBlocked[event.target] = false;
        break;
      }
      case "OOB_DAMAGE":
        this.oobPulseFrames[event.player] = FRAMES.OOB_PULSE;
        break;
      default:
        break;
    }
  }

  private shake(): void {
    const ix = SHAKE_PX / WORLD.WIDTH;
    const iy = SHAKE_PX / WORLD.HEIGHT;
    // Intensity starts at 0 and is set per update from the callback (which Phaser runs before it
    // computes the offset), giving a 3 px amplitude that decays to 0 over the 6 frames.
    this.scene.cameras.main.shake(
      FRAMES.SHAKE * FRAME_MS,
      0,
      true,
      (camera: Phaser.Cameras.Scene2D.Camera, progress: number) => {
        camera.shakeEffect.intensity.set(ix * (1 - progress), iy * (1 - progress));
      },
    );
  }

  // ---- state reads ----

  private readLandings(state: MatchState): void {
    for (const i of PLAYERS) {
      const f = state.fighters[i];
      if (!f) continue;
      if (!this.prevGrounded[i] && f.grounded) {
        this.dust(f.x, f.y);
        this.squashFrames[i] = FRAMES.SQUASH;
        this.landCount[i] = 0;
      }
      this.prevGrounded[i] = f.grounded;
    }
  }

  private readWalking(state: MatchState): void {
    for (const i of PLAYERS) {
      const f = state.fighters[i];
      if (!f) continue;
      const walking = state.phase === "FIGHTING" && f.grounded && f.hitstun === 0 && f.vx !== 0;
      if (!walking) {
        this.walkDustTick[i] = null;
        continue;
      }
      const since = this.walkDustTick[i];
      if (since === null) {
        this.walkDustTick[i] = state.tick - 1; // this tick already counts as one walked
      } else if (state.tick - since >= WALK_DUST_EVERY_TICKS) {
        this.walkDustTick[i] = state.tick;
        this.dust(f.x, f.y);
      }
    }
  }

  /**
   * (11.05) A KO is read per fighter from the displayed state: the moment a fighter's hp reaches 0 its collapse
   * starts and the slowdown holds for the 30 ko-frames. With three or four fighters that happens mid-round
   * (the KO'd fighter stays collapsed, 10.02); with two it coincides with ROUND_END as before. The countdown
   * of the next round stands everyone back up.
   */
  private readKo(state: MatchState): void {
    this.koPhase = state.phase;
    if (state.phase === "COUNTDOWN") {
      for (const i of PLAYERS) { this.koActive[i] = false; this.koCount[i] = 0; }
      return;
    }
    for (const i of PLAYERS) {
      const f = state.fighters[i];
      if (!f || f.hp > 0 || this.koActive[i]) continue;
      this.koActive[i] = true;
      this.koCount[i] = 0; // over ROUND_END, timeScale() drops to 0.25 until this reaches KO_SLOW
    }
  }

  private readEdges(state: MatchState): void {
    const marginL = WORLD.SOFT_EDGE_L;
    const marginR = WORLD.WIDTH - WORLD.SOFT_EDGE_R;
    let left = 0;
    let right = 0;
    for (const i of PLAYERS) {
      const f = state.fighters[i];
      if (!f) continue;
      const pulse = this.oobPulseFrames[i] > 0
        ? 0.75 + 0.25 * Math.sin(2 * Math.PI * OOB_PULSE_HZ * this.clockSec)
        : 1;
      const depthL = clamp(WORLD.SOFT_EDGE_L - f.x, 0, marginL);
      const depthR = clamp(f.x - WORLD.SOFT_EDGE_R, 0, marginR);
      left = Math.max(left, 0.5 * (depthL / marginL) * pulse);
      right = Math.max(right, 0.5 * (depthR / marginR) * pulse);
    }
    this.vignetteAlpha[0] = left;
    this.vignetteAlpha[1] = right;
  }

  // ---- drawing ----

  private spawn(total: number, draw: (g: Graphics, t: number) => void): void {
    const g = this.scene.add.graphics().setDepth(DEPTH.FX);
    draw(g, 0);
    this.timed.push({ g, frame: 0, total, draw, fresh: true });
  }

  private dust(x: number, y: number): void {
    this.spawn(FRAMES.DUST, (g, t) => drawDust(g, snapPt({ x, y }), t));
  }

  private drawVignette(): void {
    const [left, right] = this.vignetteAlpha;
    if (left <= 0 && right <= 0) {
      if (this.vignette) {
        this.vignette.destroy();
        this.vignette = null;
      }
      return;
    }
    const g = (this.vignette ??= this.scene.add.graphics().setDepth(DEPTH.VIGNETTE));
    g.clear();
    if (left > 0) drawEdgeGradient(g, left, WORLD.SOFT_EDGE_L, false);
    if (right > 0) drawEdgeGradient(g, right, WORLD.WIDTH - WORLD.SOFT_EDGE_R, true);
  }
}

// ---- pure drawing helpers (world coordinates) ----

function drawImpact(g: Graphics, at: Pt, t: number): void {
  const s = 0.6 + 0.7 * t;
  const a = 1 - t;
  g.clear();
  g.lineStyle(3, P.amber1, a);
  const inner = 6 * s;
  for (let k = 0; k < IMPACT_LENGTHS.length; k += 1) {
    const ang = (k / IMPACT_LENGTHS.length) * Math.PI * 2 + Math.PI / 16;
    const cos = Math.cos(ang);
    const sin = Math.sin(ang);
    const outer = inner + IMPACT_LENGTHS[k]! * s;
    g.lineBetween(at.x + cos * inner, at.y + sin * inner, at.x + cos * outer, at.y + sin * outer);
  }
  g.fillStyle(P.moon, a);
  g.fillCircle(at.x, at.y, 10 * s);
}

function drawBlockRing(g: Graphics, at: Pt, t: number): void {
  g.clear();
  g.lineStyle(3, P.moon, 1 - t);
  g.strokeCircle(at.x, at.y, 12 + 16 * t);
}

function drawDust(g: Graphics, feet: Pt, t: number): void {
  g.clear();
  g.fillStyle(P.steel2, 0.8 * (1 - t));
  for (const puff of DUST_PUFFS) {
    const r = puff.r + 6 * t;
    g.fillCircle(feet.x + puff.dx - 20 * t, feet.y + puff.dy - 4 * t, r);
  }
}

function drawArc(g: Graphics, shoulder: Pt, fist: Pt): void {
  const dx = fist.x - shoulder.x;
  const dy = fist.y - shoulder.y;
  const len = Math.hypot(dx, dy) || 1;
  // Normal always bulging screen-down so the arc reads as the swing regardless of facing.
  let nx = -dy / len;
  let ny = dx / len;
  if (ny < 0) { nx = -nx; ny = -ny; }
  const bulge = 14;
  const cx = (shoulder.x + fist.x) / 2 + nx * bulge;
  const cy = (shoulder.y + fist.y) / 2 + ny * bulge;
  // One filled band (thin at the shoulder, TRAIL_WIDTH at the fist) instead of a thick stroked path: at 30 %
  // alpha the overlapping segment quads of a stroke show as seams, a single polygon does not.
  const segments = 10;
  const outer: Pt[] = [];
  const inner: Pt[] = [];
  let prev: Pt = shoulder;
  for (let k = 0; k <= segments; k += 1) {
    const u = k / segments;
    const w = 1 - u;
    const x = w * w * shoulder.x + 2 * w * u * cx + u * u * fist.x;
    const y = w * w * shoulder.y + 2 * w * u * cy + u * u * fist.y;
    // tangent from the previous sample (the derivative at u = 0 for the first point)
    const tx = k === 0 ? cx - shoulder.x : x - prev.x;
    const ty = k === 0 ? cy - shoulder.y : y - prev.y;
    const tl = Math.hypot(tx, ty) || 1;
    const half = (TRAIL_WIDTH / 2) * (0.35 + 0.65 * u);
    outer.push({ x: x - (ty / tl) * half, y: y + (tx / tl) * half });
    inner.push({ x: x + (ty / tl) * half, y: y - (tx / tl) * half });
    prev = { x, y };
  }
  g.clear();
  g.fillStyle(P.moon, 0.3);
  g.fillPoints([...outer, ...inner.reverse()], true);
}

/** A `danger` gradient `width` px deep on one screen edge, alpha `peak` at the edge fading to 0 inward. */
function drawEdgeGradient(g: Graphics, peak: number, width: number, rightEdge: boolean): void {
  const w = width / VIGNETTE_STRIPS;
  for (let k = 0; k < VIGNETTE_STRIPS; k += 1) {
    const x = rightEdge ? WORLD.WIDTH - (k + 1) * w : k * w;
    g.fillStyle(P.danger, peak * (1 - k / VIGNETTE_STRIPS));
    g.fillRect(x, 0, w, WORLD.HEIGHT); // 72 / 18 = 4 px strips; no overlap, or the seams double up
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
