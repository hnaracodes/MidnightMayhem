/**
 * 4.07 — Arena scene: stage, rigs, HUD, effects and the debug overlay, all reading `session`.
 * Draw order (depth): stage < 0, shadow 1, P0 rig 2, P1 rig 3, effects 4/5, debug 9, HUD 10/11.
 * Never talks to the socket; the only `net/` import is the session.
 */
import Phaser from "phaser";
import {
  WORLD, EMPTY_FRAME, hurtbox, isActivePunch, punchHitbox, risingEdges, roundWinner,
  type FighterState, type InputFrame, type MatchState, type PlayerIndex, type TrainCar,
} from "@midnight/shared";
import { applyTrainCar, createBackgrounds, scrollBackgrounds, type Layers } from "./backgrounds";
import { Effects } from "./effects";
import { Hud } from "./hud";
import { CSS_P, P } from "./palette";
import { RenderClock, advanceHint, hintedFighter, type PunchHint } from "./punchHint";
import { drawFighter, drawShadow } from "./rig/draw";
import { computePose, type Clock } from "./rig/pose";
import { session } from "./session";

const DEPTH = { SHADOW: 1, RIG0: 2, RIG1: 3, DEBUG: 9 } as const;
const DEBUG_TEXT = { X: 20, Y: 84, SIZE: 11 } as const;
/** Exponential moving average weight for the update() cost readout. */
const BUDGET_EMA = 0.05;

/** Dev hook: the headless driver reads the measured update cost and the current hint through it. */
declare global {
  interface Window { __arena?: { updateMs: () => number; hint: () => PunchHint | null; latest: () => MatchState | null } }
}

export class ArenaScene extends Phaser.Scene {
  private layers!: Layers;
  private shadow!: Phaser.GameObjects.Graphics;
  private rigs!: [Phaser.GameObjects.Graphics, Phaser.GameObjects.Graphics];
  private debug!: Phaser.GameObjects.Graphics;
  private debugText: Phaser.GameObjects.Text | null = null;
  private hud!: Hud;
  private effects!: Effects;

  private readonly clock = new RenderClock();
  private car: TrainCar = "STANDARD";
  private names: [string, string] | null = null;
  private prevSample: Readonly<InputFrame> = EMPTY_FRAME;
  private hint: PunchHint | null = null;
  private newestTick = -1;
  private newestAt = 0;
  private updateMs = 0;

  constructor() {
    super("arena");
  }

  create(): void {
    this.layers = createBackgrounds(this);
    this.shadow = this.add.graphics().setDepth(DEPTH.SHADOW);
    this.rigs = [this.add.graphics().setDepth(DEPTH.RIG0), this.add.graphics().setDepth(DEPTH.RIG1)];
    this.debug = this.add.graphics().setDepth(DEPTH.DEBUG);
    this.hud = new Hud(this);
    this.effects = new Effects(this);
    if (session.debug) {
      this.debugText = this.add
        .text(DEBUG_TEXT.X, DEBUG_TEXT.Y, "", {
          fontFamily: "ui-monospace, Menlo, monospace", fontSize: `${DEBUG_TEXT.SIZE}px`, color: CSS_P.moon,
          stroke: CSS_P.outline, strokeThickness: 2,
        })
        .setDepth(DEPTH.DEBUG);
    }
    window.__arena = { updateMs: () => this.updateMs, hint: () => this.hint, latest: () => session.buffer.latest() };
  }

  update(_time: number, delta: number): void {
    const start = performance.now();
    this.frame(start, delta);
    this.updateMs += (performance.now() - start - this.updateMs) * BUDGET_EMA;
  }

  private frame(now: number, delta: number): void {
    const dt = delta / 1000;
    scrollBackgrounds(this.layers, dt);

    const renderMs = this.clock.advance(now, this.effects.timeScale());
    const state = session.buffer.sample(renderMs);
    if (!state) return;
    const newest = session.buffer.latest() ?? state;
    if (newest.tick !== this.newestTick) {
      this.newestTick = newest.tick;
      this.newestAt = now;
    }

    if (state.trainCar !== this.car) {
      this.car = state.trainCar;
      applyTrainCar(this, this.layers, this.car);
    }
    if (this.names !== session.playerNames) {
      this.names = session.playerNames;
      this.hud.setNames([this.names[0].toUpperCase(), this.names[1].toUpperCase()]);
    }

    this.effects.consume(session.events.splice(0), state);
    this.advanceHint(newest);

    this.shadow.clear();
    this.debug.clear();
    for (const i of [0, 1] as const) {
      const fighter = this.displayed(state, i);
      const clock: Clock = {
        renderMs,
        koFrames: this.effects.koFrames(i),
        landFrames: this.effects.landFrames(i),
        win: isWinner(state, i),
      };
      const joints = computePose(fighter, clock);
      const g = this.rigs[i];
      g.clear();
      drawShadow(this.shadow, fighter.x, WORLD.ROOF_Y, WORLD.ROOF_Y - fighter.y);
      drawFighter(g, joints, fighter.character, {
        facing: fighter.facing,
        rim: P.amber1,
        squash: this.effects.squashFor(i),
        windSpeed: this.layers.roofSpeed,
        ...this.effects.fillFor(i),
      });
      if (joints.punchingArm && isActivePunch(fighter)) {
        const arm = joints.arms[joints.punchingArm];
        this.effects.drawTrail(i, arm.shoulder, arm.fist);
      }
      if (session.debug) this.drawBoxes(fighter);
    }

    this.effects.update(dt);
    this.hud.update(state, dt);
    if (this.debugText) this.updateDebugText(state, now);
  }

  /** The fighter to draw: hit-stop freeze first, then the local punch hint over the sampled state. */
  private displayed(state: MatchState, i: PlayerIndex): FighterState {
    const fighter = this.effects.frozen(i) ?? state.fighters[i];
    return i === session.localIndex ? hintedFighter(fighter, this.hint) : fighter;
  }

  /** 06-integration rule 4: rising edges of the local source drive a cosmetic startup pose on the local rig. */
  private advanceHint(newest: MatchState): void {
    const sample = session.localSource?.sample() ?? EMPTY_FRAME;
    session.localEdge = risingEdges(this.prevSample, sample);
    this.prevSample = { ...sample };
    const local = newest.fighters[session.localIndex];
    this.hint = advanceHint(this.hint, session.localEdge, local, newest.phase === "FIGHTING");
  }

  private drawBoxes(fighter: FighterState): void {
    const hb = hurtbox(fighter);
    this.debug.lineStyle(1, P.moon, 0.9).strokeRect(hb.x, hb.y, hb.w, hb.h);
    const pb = punchHitbox(fighter);
    if (pb) this.debug.lineStyle(1, P.danger, 1).strokeRect(pb.x, pb.y, pb.w, pb.h);
  }

  private updateDebugText(state: MatchState, now: number): void {
    const age = Math.max(0, now - this.newestAt).toFixed(0);
    const lag = this.clock.lagMs(now).toFixed(0);
    this.debugText!.setText(
      `tick ${state.tick}  age ${age} ms  clock -${lag} ms  update ${this.updateMs.toFixed(2)} ms  rtt n/a  ${state.phase}`,
    );
  }
}

/** True during ROUND_END / MATCH_END for the fighter that won it; drives the win pose. */
function isWinner(state: MatchState, i: PlayerIndex): boolean {
  if (state.phase === "MATCH_END") return state.winner === i;
  if (state.phase === "ROUND_END") return roundWinner(state) === i;
  return false;
}
