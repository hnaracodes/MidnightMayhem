import { describe, expect, it } from "vitest";
import type Phaser from "phaser";
import { BALANCE, WORLD, createMatch, type MatchState, type SimEvent } from "@midnight/shared";
import { Effects } from "../src/game/effects";
import { P } from "../src/game/palette";

/** Records fill alphas and destruction; every other Graphics method is a chainable no-op. */
class FakeGraphics {
  destroyed = false;
  fills: Array<{ color: number; alpha: number }> = [];
  constructor() {
    return new Proxy(this, {
      get: (target, prop, receiver) => {
        if (prop in target) return Reflect.get(target, prop, receiver);
        return () => receiver;
      },
    });
  }
  fillStyle(color: number, alpha = 1): this {
    this.fills.push({ color, alpha });
    return this;
  }
  clear(): this {
    this.fills = [];
    return this;
  }
  destroy(): void {
    this.destroyed = true;
  }
}

function stubScene() {
  const created: FakeGraphics[] = [];
  const shakes: unknown[][] = [];
  const scene = {
    add: { graphics: () => { const g = new FakeGraphics(); created.push(g); return g; } },
    cameras: { main: { shake: (...args: unknown[]) => { shakes.push(args); } } },
  };
  return { scene: scene as unknown as Phaser.Scene, created, shakes };
}

function fighting(): MatchState {
  const s = createMatch();
  s.phase = "FIGHTING";
  s.phaseTicks = 0;
  return s;
}

const DT = 1 / 60;

function frames(fx: Effects, state: MatchState, n: number, events: SimEvent[] = []): void {
  for (let k = 0; k < n; k += 1) {
    fx.consume(k === 0 ? events : [], state);
    fx.update(DT);
  }
}

const hit = (target: 0 | 1, blocked: boolean, damage: number = BALANCE.PUNCH_DAMAGE): SimEvent => ({
  type: "HIT", attacker: target === 0 ? 1 : 0, target, damage, blocked,
});

describe("Effects hit-stop and flashes", () => {
  it("freezes both fighters for exactly 4 render frames on a clean hit, with a snapshot copy", () => {
    const { scene } = stubScene();
    const fx = new Effects(scene);
    const state = fighting();
    state.fighters[1].x = 500;

    fx.consume([hit(1, false)], state);
    const seen: Array<number | null> = [];
    for (let k = 0; k < 6; k += 1) {
      seen.push(fx.frozen(1)?.x ?? null);
      expect(fx.frozen(0) === null).toBe(fx.frozen(1) === null);
      state.fighters[1].x += 10; // the live state keeps moving; the frozen copy must not
      fx.update(DT);
      fx.consume([], state);
    }
    expect(seen).toEqual([500, 500, 500, 500, null, null]);
  });

  it("flashes the target white 70 % for 2 frames then danger 30 % for 4, attacker untouched", () => {
    const { scene } = stubScene();
    const fx = new Effects(scene);
    const state = fighting();
    fx.consume([hit(0, false)], state);
    const fills: Array<{ fillOverride?: number; fillAlpha?: number }> = [];
    for (let k = 0; k < 7; k += 1) {
      fills.push(fx.fillFor(0));
      expect(fx.fillFor(1)).toEqual({});
      fx.update(DT);
      fx.consume([], state);
    }
    expect(fills).toEqual([
      { fillOverride: P.white, fillAlpha: 0.7 },
      { fillOverride: P.white, fillAlpha: 0.7 },
      { fillOverride: P.danger, fillAlpha: 0.3 },
      { fillOverride: P.danger, fillAlpha: 0.3 },
      { fillOverride: P.danger, fillAlpha: 0.3 },
      { fillOverride: P.danger, fillAlpha: 0.3 },
      {},
    ]);
  });

  it("blocked hit: moon 40 % for 2 frames, no freeze, no shake", () => {
    const { scene, shakes } = stubScene();
    const fx = new Effects(scene);
    const state = fighting();
    fx.consume([hit(1, true, BALANCE.CHIP_DAMAGE)], state);
    expect(fx.frozen(0)).toBeNull();
    expect(fx.frozen(1)).toBeNull();
    expect(fx.fillFor(1)).toEqual({ fillOverride: P.moon, fillAlpha: 0.4 });
    fx.update(DT);
    expect(fx.fillFor(1)).toEqual({ fillOverride: P.moon, fillAlpha: 0.4 });
    fx.update(DT);
    expect(fx.fillFor(1)).toEqual({});
    expect(shakes).toHaveLength(0);
  });

  it("shakes the camera once only when damage >= 12", () => {
    const { scene, shakes } = stubScene();
    const fx = new Effects(scene);
    const state = fighting();
    fx.consume([hit(1, false, 11)], state);
    expect(shakes).toHaveLength(0);
    fx.consume([hit(1, false, 12)], state);
    expect(shakes).toHaveLength(1);
    frames(fx, state, 10);
    expect(shakes).toHaveLength(1);
  });

  it("destroys every effect Graphics once its timer ends and never re-fires for old events", () => {
    const { scene, created } = stubScene();
    const fx = new Effects(scene);
    const state = fighting();
    fx.consume([hit(1, false), hit(0, true, 3), { type: "JUMP", player: 0 }], state);
    const spawned = created.length;
    expect(spawned).toBeGreaterThanOrEqual(3);
    frames(fx, state, 12);
    expect(created.length).toBe(spawned);
    expect(created.every((g) => g.destroyed)).toBe(true);
  });
});

describe("Effects landing and squash", () => {
  it("landFrames is large before any landing and counts from 0 after one; squash lasts 4 frames", () => {
    const { scene, created } = stubScene();
    const fx = new Effects(scene);
    const state = fighting();
    expect(fx.landFrames(0)).toBeGreaterThanOrEqual(1_000_000);
    expect(fx.squashFor(0)).toBe(1);

    state.fighters[0].grounded = false;
    state.fighters[0].y = WORLD.ROOF_Y - 40;
    frames(fx, state, 3);
    expect(created.length).toBe(0);

    state.fighters[0].grounded = true;
    state.fighters[0].y = WORLD.ROOF_Y;
    fx.consume([], state);
    expect(created.length).toBe(1); // landing dust
    const squash: number[] = [];
    const land: number[] = [];
    for (let k = 0; k < 6; k += 1) {
      squash.push(fx.squashFor(0));
      land.push(fx.landFrames(0));
      fx.update(DT);
      fx.consume([], state);
    }
    expect(squash).toEqual([0.94, 0.94, 0.94, 0.94, 1, 1]);
    expect(land).toEqual([0, 1, 2, 3, 4, 5]);
    expect(fx.squashFor(1)).toBe(1);
  });

  it("puffs dust every 10th tick of continuous walking and not while standing", () => {
    const { scene, created } = stubScene();
    const fx = new Effects(scene);
    const state = fighting();
    for (let tick = 1; tick <= 30; tick += 1) {
      state.tick = tick;
      state.fighters[0].vx = BALANCE.WALK_SPEED;
      fx.consume([], state);
      fx.update(DT);
    }
    expect(created.length).toBe(3);
    state.fighters[0].vx = 0;
    for (let tick = 31; tick <= 60; tick += 1) {
      state.tick = tick;
      fx.consume([], state);
      fx.update(DT);
    }
    expect(created.length).toBe(3);
  });
});

describe("Effects KO slowdown", () => {
  it("runs 0.25x for 30 frames and counts koFrames only for the fighter at 0 hp", () => {
    const { scene } = stubScene();
    const fx = new Effects(scene);
    const state = fighting();
    state.fighters[1].hp = 0;
    state.phase = "ROUND_END";
    fx.consume([{ type: "ROUND_END", round: 1, winner: 0 }], state);
    const scales: number[] = [];
    const ko: number[] = [];
    for (let k = 0; k < 32; k += 1) {
      scales.push(fx.timeScale());
      ko.push(fx.koFrames(1));
      expect(fx.koFrames(0)).toBe(0);
      fx.update(DT);
      fx.consume([], state);
    }
    expect(scales.slice(0, 30).every((s) => s === 0.25)).toBe(true);
    expect(scales.slice(30)).toEqual([1, 1]);
    expect(ko).toEqual(Array.from({ length: 32 }, (_, k) => k));

    state.phase = "COUNTDOWN";
    state.fighters[1].hp = BALANCE.MAX_HP;
    fx.consume([], state);
    expect(fx.koFrames(1)).toBe(0);
  });

  it("waits for the displayed state to reach ROUND_END with a 0 hp fighter", () => {
    const { scene } = stubScene();
    const fx = new Effects(scene);
    const state = fighting();
    fx.consume([{ type: "ROUND_END", round: 1, winner: 1 }], state); // sampled state still FIGHTING
    expect(fx.timeScale()).toBe(1);
    frames(fx, state, 2);
    state.phase = "ROUND_END";
    state.fighters[0].hp = 0;
    fx.consume([], state);
    expect(fx.timeScale()).toBe(0.25);
    expect(fx.koFrames(0)).toBe(0);
  });

  it("does not slow down when the round ends on the timer", () => {
    const { scene } = stubScene();
    const fx = new Effects(scene);
    const state = fighting();
    state.phase = "ROUND_END";
    state.fighters[0].hp = 20;
    state.fighters[1].hp = 10;
    frames(fx, state, 5, [{ type: "ROUND_END", round: 1, winner: 0 }]);
    expect(fx.timeScale()).toBe(1);
    expect(fx.koFrames(0)).toBe(0);
    expect(fx.koFrames(1)).toBe(0);
  });
});

describe("Effects danger vignette", () => {
  it("draws with alpha 0.5 * depth / 72 while a fighter is inside the soft edge and destroys it after", () => {
    const { scene, created } = stubScene();
    const fx = new Effects(scene);
    const state = fighting();
    state.fighters[0].x = WORLD.SOFT_EDGE_L / 2; // depth 36
    fx.consume([], state);
    fx.update(DT);
    expect(created.length).toBe(1);
    const peak = Math.max(...created[0]!.fills.map((f) => f.alpha));
    expect(peak).toBeCloseTo(0.25, 5);
    expect(created[0]!.fills.every((f) => f.color === P.danger)).toBe(true);

    state.fighters[0].x = WORLD.PLAYER_START_X[0];
    fx.consume([], state);
    fx.update(DT);
    expect(created[0]!.destroyed).toBe(true);
  });

  it("pulses at 2 Hz after OOB_DAMAGE without leaving [0, 0.5]", () => {
    const { scene, created } = stubScene();
    const fx = new Effects(scene);
    const state = fighting();
    state.fighters[1].x = WORLD.WIDTH;
    fx.consume([{ type: "OOB_DAMAGE", player: 1, damage: BALANCE.OOB_DAMAGE }], state);
    fx.update(DT);
    const peaks: number[] = [];
    for (let k = 0; k < 30; k += 1) {
      fx.consume([], state);
      fx.update(DT);
      peaks.push(Math.max(...created[0]!.fills.map((f) => f.alpha)));
    }
    expect(Math.max(...peaks)).toBeLessThanOrEqual(0.5);
    expect(Math.min(...peaks)).toBeGreaterThan(0);
    expect(new Set(peaks.map((p) => p.toFixed(3))).size).toBeGreaterThan(1);
  });
});

describe("Effects punch trail", () => {
  it("keeps one trail per fighter alive for 2 rendered frames after the last drawTrail call", () => {
    const { scene, created } = stubScene();
    const fx = new Effects(scene);
    const state = fighting();
    fx.consume([], state);
    fx.drawTrail(0, { x: 280, y: 320 }, { x: 358, y: 364 });
    fx.drawTrail(0, { x: 281, y: 320 }, { x: 359, y: 364 }); // same frame: one Graphics
    expect(created.length).toBe(1);
    fx.update(DT); // rendered frame 1 of 2
    expect(created[0]!.destroyed).toBe(false);
    fx.update(DT); // rendered frame 2 of 2
    expect(created[0]!.destroyed).toBe(false);
    fx.update(DT);
    expect(created[0]!.destroyed).toBe(true);

    // a call on a later frame refreshes the same Graphics instead of spawning another
    fx.drawTrail(1, { x: 680, y: 320 }, { x: 602, y: 364 });
    expect(created.length).toBe(2);
    fx.update(DT);
    fx.drawTrail(1, { x: 679, y: 320 }, { x: 601, y: 364 });
    expect(created.length).toBe(2);
    fx.update(DT);
    fx.update(DT);
    expect(created[1]!.destroyed).toBe(false);
    fx.update(DT);
    expect(created[1]!.destroyed).toBe(true);
  });
});
