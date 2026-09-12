/**
 * 11.05 — Arena scene: stage, map, N fighters (pixel sprites, or the vector rig with `?rig=vector`), item and
 * laser FX, effects, HUD, sound fan-out, attract mode and the dazzle overlay, all reading `session`.
 *
 * Draw order (depth): stage < 0, map layer (gaps -9.3, racks -6), hazards 0.5, shadow 1, fighters 2..3.2
 * back-to-front (nearest the camera centre last), item FX 4–4.5, effects 4.6/5, debug 9, HUD 10/11, dazzle 12.
 * Never talks to the socket; the only `net/` import is the session. The sim runs here only in attract mode,
 * with no server snapshot present.
 */
import Phaser from "phaser";
import {
  EMPTY_FRAME, MAPS, PIT, TICK, WORLD, createMatch, groundYAt, hazardRect, hurtbox, isActivePunch, laserHitbox,
  punchHitbox, risingEdges, step,
  type FighterState, type InputFrame, type MapId, type MatchState, type PlayerIndex, type SimEvent, type TrainCar,
} from "@midnight/shared";
import { attractInputs, attractSetup, drawOrder, fighterAlpha, fireLoopTransition, posedFighter } from "./arenaGlue";
import { applyTrainCar, createBackgrounds, scrollBackgrounds, type Layers } from "./backgrounds";
import { Effects } from "./effects";
import { Hud } from "./hud";
import { ItemFx, type HandPoint } from "./itemFx";
import { CSS_P, P } from "./palette";
import { RenderClock, advanceHint, hintedFighter, type PunchHint } from "./punchHint";
import { drawFighter, drawShadow } from "./rig/draw";
import { computePose, type Clock } from "./rig/pose";
import { session } from "./session";
import { SpriteFighter } from "./sprites/SpriteFighter";

/**
 * Fighter depths run RIG0 + rank · RIG_STEP for the rank in the back-to-front draw order (four fighters fit
 * under the item FX at 4); debug stays above everything but the HUD.
 */
const DEPTH = { SHADOW: 1, RIG0: 2, RIG_STEP: 0.4, DEBUG: 9, DAZZLE: 12 } as const;
const DEBUG_TEXT = { X: 20, Y: 84, SIZE: 11 } as const;
/** Exponential moving average weight for the update() cost readout. */
const BUDGET_EMA = 0.05;
/** Attract mode steps the sim at most this many ticks per render frame (a hidden tab must not spiral). */
const ATTRACT_MAX_STEPS = 5;
/** Rim stroke colour of the vector rig (design/02). */
const VECTOR_RIM = P.amber1;

/** Dev hook: the headless driver reads the measured update cost and the current hint through it. */
declare global {
  interface Window {
    __arena?: {
      updateMs: () => number;
      hint: () => PunchHint | null;
      latest: () => MatchState | null;
      /** The state drawn this frame: the server sample, or the attract match when no snapshot exists. */
      drawn: () => MatchState | null;
      fighters: () => number;
      attract: () => boolean;
    };
  }
}

/** One drawn fighter: a pixel sprite, or a Graphics for the vector rig. */
type FighterView =
  | { kind: "sprite"; sprite: SpriteFighter }
  | { kind: "vector"; g: Phaser.GameObjects.Graphics };

interface AttractRun { state: MatchState; accMs: number }

export class ArenaScene extends Phaser.Scene {
  private layers!: Layers;
  private shadow!: Phaser.GameObjects.Graphics;
  private views: FighterView[] = [];
  private debug!: Phaser.GameObjects.Graphics;
  private debugText: Phaser.GameObjects.Text | null = null;
  private hud!: Hud;
  private effects!: Effects;
  private itemFx!: ItemFx;
  private dazzle!: Phaser.GameObjects.Rectangle;

  private readonly clock = new RenderClock();
  private car: TrainCar = "STANDARD";
  private drawnMap: MapId = "roof";
  private names: string[] | null = null;
  private prevSample: Readonly<InputFrame> = EMPTY_FRAME;
  private hint: PunchHint | null = null;
  private newestTick = -1;
  private newestAt = 0;
  private updateMs = 0;
  private attract: AttractRun | null = null;
  private drawnState: MatchState | null = null;
  private hadFire = false;
  private readonly attractEvents: SimEvent[] = [];
  /** Front-hand world position per fighter from the last draw; what ItemFx anchors to. */
  private readonly hands: HandPoint[] = [];

  constructor() {
    super("arena");
  }

  create(): void {
    this.layers = createBackgrounds(this, this.drawnMap);
    this.shadow = this.add.graphics().setDepth(DEPTH.SHADOW);
    this.debug = this.add.graphics().setDepth(DEPTH.DEBUG);
    this.hud = new Hud(this);
    this.effects = new Effects(this);
    this.itemFx = new ItemFx(this);
    this.dazzle = this.add.rectangle(0, 0, WORLD.WIDTH, WORLD.HEIGHT, P.white, 1)
      .setOrigin(0, 0).setAlpha(0).setDepth(DEPTH.DAZZLE);
    if (session.debug) {
      this.debugText = this.add
        .text(DEBUG_TEXT.X, DEBUG_TEXT.Y, "", {
          fontFamily: "ui-monospace, Menlo, monospace", fontSize: `${DEBUG_TEXT.SIZE}px`, color: CSS_P.moon,
          stroke: CSS_P.outline, strokeThickness: 2,
        })
        .setDepth(DEPTH.DEBUG);
    }
    window.__arena = {
      updateMs: () => this.updateMs,
      hint: () => this.hint,
      latest: () => session.buffer.latest(),
      drawn: () => this.drawnState,
      fighters: () => this.views.length,
      attract: () => this.attract !== null,
    };
  }

  update(_time: number, delta: number): void {
    const start = performance.now();
    this.frame(start, delta);
    this.updateMs += (performance.now() - start - this.updateMs) * BUDGET_EMA;
  }

  private frame(now: number, delta: number): void {
    const dt = delta / 1000;
    scrollBackgrounds(this.layers, session.reducedMotion ? 0 : dt);

    const renderMs = this.clock.advance(now, this.effects.timeScale());
    const sampled = session.buffer.sample(renderMs);
    const attracting = !sampled && session.attract !== null;
    const state = sampled ?? (attracting ? this.stepAttract(delta) : null);
    if (!attracting) this.attract = null;
    this.drawnState = state;
    if (!state) {
      // Between the landing and the first snapshot (the lobby): a bare stage, no fighters, timers still run out.
      this.ensureViews(0);
      this.shadow.clear();
      this.debug.clear();
      this.effects.update(dt);
      this.itemFx.update(dt);
      this.dazzle.setAlpha(0);
      return;
    }
    const newest = attracting ? state : (session.buffer.latest() ?? state);
    if (newest.tick !== this.newestTick) {
      this.newestTick = newest.tick;
      this.newestAt = now;
    }

    if (state.trainCar !== this.car) {
      this.car = state.trainCar;
      applyTrainCar(this, this.layers, this.car);
    }
    if (state.config.map !== this.drawnMap) {
      this.drawnMap = state.config.map;
      this.layers.map.setMap(this.drawnMap);
    }
    if (this.names !== session.playerNames) {
      this.names = session.playerNames;
      this.hud.setNames(this.names.map((name) => name.toUpperCase()));
    }
    this.ensureViews(state.fighters.length);

    // Events fan out once per frame: effects, item FX, sound (never in attract mode), then the HUD reads state.
    const events = attracting ? this.attractEvents.splice(0) : session.events.splice(0);
    const hands = (i: PlayerIndex): HandPoint => this.handOf(i, newest);
    this.effects.consume(events, state, newest);
    this.itemFx.consume(events, newest, hands);
    if (!attracting) {
      session.sfx?.consume(events, newest);
      const nowHas = newest.hazards.some((h) => h.kind === "fire");
      const edge = fireLoopTransition(this.hadFire, nowHas);
      this.hadFire = nowHas;
      if (edge === "start") session.sfx?.play("fire_loop_start");
      else if (edge === "stop") session.sfx?.play("fire_loop_stop");
    }
    this.advanceHint(newest, attracting);

    this.shadow.clear();
    this.debug.clear();
    const order = drawOrder(state.fighters);
    order.forEach((i, rank) => {
      const fighter = this.displayed(state, i);
      const view = this.views[i];
      if (!fighter || !view) return;
      this.drawOne(i, rank, fighter, view, renderMs, state);
    });
    if (session.debug) this.drawWorldBoxes(state);

    this.itemFx.draw(state, hands, session.localIndex);
    this.effects.update(dt);
    this.itemFx.update(dt);
    if (!attracting) this.hud.update(state, dt);
    this.dazzle.setAlpha(attracting ? 0 : this.itemFx.dazzleAlpha(state, session.localIndex));
    if (this.debugText) this.updateDebugText(state, now, attracting);
  }

  private drawOne(i: PlayerIndex, rank: number, fighter: FighterState, view: FighterView, renderMs: number, state: MatchState): void {
    const clock: Clock = {
      renderMs,
      koFrames: this.effects.koFrames(i),
      landFrames: this.effects.landFrames(i),
      win: isWinner(state, i),
    };
    const joints = computePose(posedFighter(fighter), clock);
    const alpha = fighterAlpha(fighter);
    joints.alpha *= alpha;
    const depth = DEPTH.RIG0 + rank * DEPTH.RIG_STEP;
    const ground = groundYAt(state.config.map, fighter.x, fighter.y);
    if (alpha > 0 && ground < PIT.Y) drawShadow(this.shadow, fighter.x, ground, Math.max(0, ground - fighter.y));
    const fill = this.effects.fillFor(i);
    if (view.kind === "sprite") {
      view.sprite.setVisible(alpha > 0);
      view.sprite.setDepth(depth);
      view.sprite.update(fighter, joints, {
        rimBoth: this.car === "TUNNEL",
        flash: fill.fillOverride,
        flashAlpha: fill.fillAlpha,
        squash: this.effects.squashFor(i),
        itemVisible: !this.itemFx.materialising(i),
        blinkMs: renderMs,
      });
      this.hands[i] = view.sprite.hand();
    } else {
      const g = view.g;
      g.clear();
      g.setDepth(depth);
      g.setVisible(alpha > 0);
      drawFighter(g, joints, fighter.character, {
        facing: fighter.facing,
        rim: VECTOR_RIM,
        rimBoth: this.car === "TUNNEL", // design/03: tunnel lamps light both edges
        squash: this.effects.squashFor(i),
        windSpeed: this.layers.roofSpeed,
        ...fill,
      });
      this.hands[i] = { ...joints.arms.F.fist };
    }
    if (joints.punchingArm && isActivePunch(fighter)) {
      const arm = joints.arms[joints.punchingArm];
      this.effects.drawTrail(i, arm.shoulder, arm.fist);
    }
    if (session.debug) this.drawBoxes(fighter);
  }

  /** Front-hand position for ItemFx: last drawn, else the chest-height guess from the newest snapshot. */
  private handOf(i: PlayerIndex, newest: MatchState): HandPoint {
    const hand = this.hands[i];
    if (hand) return hand;
    const f = newest.fighters[i];
    return f ? { x: f.x + f.facing * 20, y: f.y - 90 } : { x: WORLD.WIDTH / 2, y: WORLD.ROOF_Y - 90 };
  }

  /** Creates or destroys fighter views so there is exactly one per fighter in the state. */
  private ensureViews(count: number): void {
    while (this.views.length > count) {
      const view = this.views.pop()!;
      if (view.kind === "sprite") view.sprite.destroy();
      else view.g.destroy();
      this.hands.length = this.views.length;
    }
    while (this.views.length < count) {
      const i = this.views.length as PlayerIndex;
      const depth = DEPTH.RIG0 + i * DEPTH.RIG_STEP;
      this.views.push(session.useVectorRig
        ? { kind: "vector", g: this.add.graphics().setDepth(depth) }
        : { kind: "sprite", sprite: new SpriteFighter(this, i, depth) });
    }
  }

  // ---- attract mode: the only place the client runs the sim, and only with no server snapshot ----

  private stepAttract(deltaMs: number): MatchState {
    const characters = session.attract ?? [];
    let run = this.attract;
    if (!run) {
      const { config, roster } = attractSetup(characters);
      run = { state: createMatch(config, roster), accMs: 0 };
      this.attract = run;
    }
    run.accMs += session.reducedMotion ? 0 : Math.min(deltaMs, TICK.MS * ATTRACT_MAX_STEPS);
    let steps = 0;
    while (run.accMs >= TICK.MS && steps < ATTRACT_MAX_STEPS) {
      run.accMs -= TICK.MS;
      const result = step(run.state, attractInputs(run.state.tick, run.state.config.players));
      run.state = result.state;
      this.attractEvents.push(...result.events);
      steps += 1;
    }
    return run.state;
  }

  /** The fighter to draw: hit-stop freeze first, then the local punch hint over the sampled state. */
  private displayed(state: MatchState, i: PlayerIndex): FighterState | null {
    const fighter = this.effects.frozen(i) ?? state.fighters[i];
    if (!fighter) return null;
    return i === session.localIndex ? hintedFighter(fighter, this.hint) : fighter;
  }

  /** 06-integration rule 4: rising edges of the local source drive a cosmetic startup pose on the local rig. */
  private advanceHint(newest: MatchState, attracting: boolean): void {
    const sample = session.localSource?.sample() ?? EMPTY_FRAME;
    session.localEdge = risingEdges(this.prevSample, sample);
    this.prevSample = { ...sample };
    const local = newest.fighters[session.localIndex];
    this.hint = local && !attracting ? advanceHint(this.hint, session.localEdge, local, newest.phase === "FIGHTING") : null;
  }

  private drawBoxes(fighter: FighterState): void {
    const hb = hurtbox(fighter);
    this.debug.lineStyle(1, P.moon, 0.9).strokeRect(hb.x, hb.y, hb.w, hb.h);
    const pb = punchHitbox(fighter);
    if (pb) this.debug.lineStyle(1, P.danger, 1).strokeRect(pb.x, pb.y, pb.w, pb.h);
    const beam = laserHitbox(fighter);
    if (beam) this.debug.lineStyle(1, P.amber1, 1).strokeRect(beam.x, beam.y, beam.w, beam.h);
  }

  /** Debug: hazard rects, projectiles and the platform outlines of the current map. */
  private drawWorldBoxes(state: MatchState): void {
    for (const h of state.hazards) {
      const r = hazardRect(h);
      this.debug.lineStyle(1, h.kind === "fire" ? P.danger : P.amber1, 0.9).strokeRect(r.x, r.y, r.w, r.h);
    }
    for (const p of state.projectiles) {
      this.debug.lineStyle(1, P.moon, 1).strokeRect(p.x - 6, p.y - 6, 12, 12);
    }
    for (const plat of MAPS[state.config.map].platforms) {
      this.debug.lineStyle(1, P.steel2, 1).lineBetween(plat.x0, plat.y, plat.x1, plat.y);
    }
  }

  private updateDebugText(state: MatchState, now: number, attracting: boolean): void {
    const age = Math.max(0, now - this.newestAt).toFixed(0);
    const lag = this.clock.lagMs(now).toFixed(0);
    const rtt = session.rtt === null ? "n/a" : `${session.rtt.toFixed(1)} ms`;
    const mode = attracting ? "ATTRACT" : state.phase;
    this.debugText!.setText(
      `tick ${state.tick}  age ${age} ms  clock -${lag} ms  update ${this.updateMs.toFixed(2)} ms  rtt ${rtt}  ${mode}  ${state.config.map}/${state.config.mode}`,
    );
  }
}

/** True during MATCH_END for every fighter on the winning team (design/02: both fists raised); round winners stay in idle. */
function isWinner(state: MatchState, i: PlayerIndex): boolean {
  return state.phase === "MATCH_END" && state.winner !== "draw" && state.winner === state.fighters[i]?.team;
}
