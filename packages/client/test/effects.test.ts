import { describe, expect, it } from "vitest";
import type Phaser from "phaser";
import { BALANCE, WORLD, createMatch, type MatchState, type SimEvent } from "@midnight/shared";
import { CHOP_HIT, Effects, isChopHit } from "../src/game/effects";
import { P } from "../src/game/palette";
import { PIXEL } from "../src/game/pixel";

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
  circles: Array<{ x: number; y: number; r: number }> = [];
  fillStyle(color: number, alpha = 1): this {
    this.fills.push({ color, alpha });
    return this;
  }
  fillCircle(x: number, y: number, r: number): this {
    this.circles.push({ x, y, r });
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
    state.fighters[1]!.x = 500;

    fx.consume([hit(1, false)], state);
    const seen: Array<number | null> = [];
    for (let k = 0; k < 6; k += 1) {
      seen.push(fx.frozen(1)?.x ?? null);
      expect(fx.frozen(0) === null).toBe(fx.frozen(1) === null);
      state.fighters[1]!.x += 10; // the live state keeps moving; the frozen copy must not
      fx.update(DT);
      fx.consume([], state);
    }
    expect(seen).toEqual([500, 500, 500, 500, null, null]);
  });

  it("freezes the newest snapshot at HIT time, not the 50 ms-delayed sampled one", () => {
    const { scene } = stubScene();
    const fx = new Effects(scene);
    const sampled = fighting();
    sampled.fighters[0]!.action = { kind: "punch", arm: "L", elapsed: 1, landed: false, sword: false }; // still in startup
    const newest = fighting();
    newest.tick = sampled.tick + 3;
    newest.fighters[0]!.action = { kind: "punch", arm: "L", elapsed: BALANCE.PUNCH_STARTUP, landed: true, sword: false };
    newest.fighters[1]!.hitstun = BALANCE.HITSTUN_TICKS;
    newest.fighters[1]!.x = 520;

    fx.consume([hit(1, false)], sampled, newest);
    expect(fx.frozen(0)?.action?.elapsed).toBe(BALANCE.PUNCH_STARTUP);
    expect(fx.frozen(1)?.hitstun).toBe(BALANCE.HITSTUN_TICKS);
    expect(fx.frozen(1)?.x).toBe(520);
    newest.fighters[1]!.x = 999; // a copy, not a reference
    expect(fx.frozen(1)?.x).toBe(520);
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

describe("Effects impact position", () => {
  it("4.06 rule 1: the spark sits on the newest snapshot's target chest, 14 px toward the attacker (13.00: 20 × 0.7)", () => {
    const { scene, created } = stubScene();
    const fx = new Effects(scene);
    const state = fighting();
    state.fighters[0]!.x = 300;
    state.fighters[1]!.x = 400;
    // the snapshot that carried the event: the target has already taken a knockback step
    const newest = structuredClone(state);
    newest.fighters[1]!.x = 460;
    fx.consume([hit(1, false)], state, newest);
    // 12.04: a clean hit spawns the impact star, then the spark burst and the ring; the star is the one with circles
    const spark = [...created].reverse().find((g) => g.circles.length > 0)!;
    const core = spark.circles.at(-1)!;
    // 12.01 / 13.01: snapped to the 2 px grid (446 → 446, 367 → 368)
    expect(core.x).toBe(446);
    expect(core.y).toBe(368);
    expect(Math.abs(core.x - (460 - 14))).toBeLessThanOrEqual(PIXEL / 2);
    expect(Math.abs(core.y - (WORLD.ROOF_Y - 63))).toBeLessThanOrEqual(PIXEL / 2);
    expect(fx.frozen(1)?.x).toBe(460);
  });

  it("12.01 rule 4: dust puffs land on the pixel grid", () => {
    const { scene, created } = stubScene();
    const fx = new Effects(scene);
    const state = fighting();
    state.fighters[0]!.x = 301;
    state.fighters[0]!.y = WORLD.ROOF_Y;
    fx.consume([{ type: "JUMP", player: 0 }], state);
    const dust = created.at(-1)!;
    expect(dust.circles.length).toBeGreaterThan(0);
    // drawDust offsets puff 0 by dx −10 from the feet; feet 301 snap to 302 on the 2 px grid (13.01), so the puff sits at 292 (not 291)
    expect(dust.circles[0]!.x).toBe(292);
    expect(PIXEL).toBe(2);
  });
});

describe("Effects landing and squash", () => {
  it("landFrames is large before any landing and counts from 0 after one; squash lasts 4 frames", () => {
    const { scene, created } = stubScene();
    const fx = new Effects(scene);
    const state = fighting();
    expect(fx.landFrames(0)).toBeGreaterThanOrEqual(1_000_000);
    expect(fx.squashFor(0)).toBe(1);

    state.fighters[0]!.grounded = false;
    state.fighters[0]!.y = WORLD.ROOF_Y - 40;
    frames(fx, state, 3);
    expect(created.length).toBe(0);

    state.fighters[0]!.grounded = true;
    state.fighters[0]!.y = WORLD.ROOF_Y;
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
      state.fighters[0]!.vx = BALANCE.WALK_SPEED;
      fx.consume([], state);
      fx.update(DT);
    }
    expect(created.length).toBe(3);
    state.fighters[0]!.vx = 0;
    for (let tick = 31; tick <= 60; tick += 1) {
      state.tick = tick;
      fx.consume([], state);
      fx.update(DT);
    }
    expect(created.length).toBe(3);
  });
});

describe("Effects KO slowdown", () => {
  it("advances koFrames by timeScale: the 30-frame collapse spans 120 render frames at 0.25x", () => {
    const { scene } = stubScene();
    const fx = new Effects(scene);
    const state = fighting();
    state.fighters[1]!.hp = 0;
    state.phase = "ROUND_END";
    fx.consume([{ type: "ROUND_END", round: 1, winner: 0 }], state);
    const scales: number[] = [];
    const ko: number[] = [];
    for (let k = 0; k < 124; k += 1) {
      scales.push(fx.timeScale());
      ko.push(fx.koFrames(1));
      expect(fx.koFrames(0)).toBe(0);
      fx.update(DT);
      fx.consume([], state);
    }
    // slow while the collapse plays (koFrames < 30), i.e. for exactly 120 render frames
    expect(scales.slice(0, 120).every((s) => s === 0.25)).toBe(true);
    expect(scales.slice(120)).toEqual([1, 1, 1, 1]);
    // the counter climbs by 0.25 per render frame during the slowdown, then by 1
    expect(ko.slice(0, 120)).toEqual(Array.from({ length: 120 }, (_, k) => k * 0.25));
    expect(ko.slice(120)).toEqual([30, 31, 32, 33]);

    state.phase = "COUNTDOWN";
    state.fighters[1]!.hp = BALANCE.MAX_HP;
    fx.consume([], state);
    expect(fx.koFrames(1)).toBe(0);
    expect(fx.timeScale()).toBe(1);
  });

  it("a mutual KO slows once and both counters climb together", () => {
    const { scene } = stubScene();
    const fx = new Effects(scene);
    const state = fighting();
    state.fighters[0]!.hp = 0;
    state.fighters[1]!.hp = 0;
    state.phase = "ROUND_END";
    frames(fx, state, 60, [{ type: "ROUND_END", round: 1, winner: "draw" }]);
    expect(fx.koFrames(0)).toBe(15);
    expect(fx.koFrames(1)).toBe(15);
    expect(fx.timeScale()).toBe(0.25);
    frames(fx, state, 60);
    expect(fx.koFrames(0)).toBe(30);
    expect(fx.timeScale()).toBe(1);
  });

  it("waits for the displayed state to reach ROUND_END with a 0 hp fighter", () => {
    const { scene } = stubScene();
    const fx = new Effects(scene);
    const state = fighting();
    fx.consume([{ type: "ROUND_END", round: 1, winner: 1 }], state); // sampled state still FIGHTING
    expect(fx.timeScale()).toBe(1);
    frames(fx, state, 2);
    state.phase = "ROUND_END";
    state.fighters[0]!.hp = 0;
    fx.consume([], state);
    expect(fx.timeScale()).toBe(0.25);
    expect(fx.koFrames(0)).toBe(0);
  });

  it("(11.05) a fighter KO'd mid-round in a four-player match collapses at once, at 1x, and stays collapsed", () => {
    const { scene } = stubScene();
    const fx = new Effects(scene);
    const state = createMatch({ players: 4, teams: "2v2", mode: "rounds", map: "roof", items: true });
    state.phase = "FIGHTING";
    frames(fx, state, 3);
    expect(fx.timeScale()).toBe(1);
    state.fighters[2]!.hp = 0;
    frames(fx, state, 1);
    // The round goes on and the server keeps running: no slowdown, the collapse plays at normal speed.
    expect(fx.timeScale()).toBe(1);
    expect(fx.koFrames(2)).toBe(1);
    frames(fx, state, 200);
    expect(fx.timeScale()).toBe(1);
    expect(fx.koFrames(2)).toBeGreaterThan(30); // still collapsed while the round goes on
    expect(fx.koFrames(0)).toBe(0);
    // The last KO ends the round: that collapse gets the 0.25x slowdown, the earlier one is already down.
    state.fighters[3]!.hp = 0;
    state.phase = "ROUND_END";
    frames(fx, state, 1);
    expect(fx.timeScale()).toBe(0.25);
    expect(fx.koFrames(3)).toBe(0.25);
    state.phase = "COUNTDOWN";
    frames(fx, state, 1);
    expect(fx.koFrames(2)).toBe(0);
    expect(fx.koFrames(3)).toBe(0);
    expect(fx.timeScale()).toBe(1);
  });

  it("(11.05) a laser hit flashes the target without hit-stop; a blocked one chips", () => {
    const { scene } = stubScene();
    const fx = new Effects(scene);
    const state = fighting();
    fx.consume([{ type: "LASER_HIT", attacker: 0, target: 1, damage: 10, blocked: false }], state);
    expect(fx.frozen(1)).toBeNull();
    expect(fx.fillFor(1)).toEqual({ fillOverride: P.white, fillAlpha: 0.7 });
    fx.consume([{ type: "LASER_HIT", attacker: 1, target: 0, damage: 4, blocked: true }], state);
    expect(fx.fillFor(0)).toEqual({ fillOverride: P.moon, fillAlpha: 0.4 });
    fx.consume([{ type: "HAZARD_HIT", id: 1, kind: "fire", target: 1, damage: 2 }], state);
    expect(fx.fillFor(1)).toEqual({ fillOverride: P.danger, fillAlpha: 0.3 });
  });

  it("does not slow down when the round ends on the timer", () => {
    const { scene } = stubScene();
    const fx = new Effects(scene);
    const state = fighting();
    state.phase = "ROUND_END";
    state.fighters[0]!.hp = 20;
    state.fighters[1]!.hp = 10;
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
    state.fighters[0]!.x = WORLD.SOFT_EDGE_L / 2; // depth 36
    fx.consume([], state);
    fx.update(DT);
    expect(created.length).toBe(1);
    const peak = Math.max(...created[0]!.fills.map((f) => f.alpha));
    expect(peak).toBeCloseTo(0.25, 5);
    expect(created[0]!.fills.every((f) => f.color === P.danger)).toBe(true);

    state.fighters[0]!.x = WORLD.PLAYER_START_X[0];
    fx.consume([], state);
    fx.update(DT);
    expect(created[0]!.destroyed).toBe(true);
  });

  it("pulses at 2 Hz after OOB_DAMAGE without leaving [0, 0.5]", () => {
    const { scene, created } = stubScene();
    const fx = new Effects(scene);
    const state = fighting();
    state.fighters[1]!.x = WORLD.WIDTH;
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

// ---- 12.04 ----

import { Lcg } from "../src/game/backgrounds";
import { landingScale, sparkSpecks } from "../src/game/effects";

describe("12.04 rules 7–9: impact juice, landing weight, KO rim", () => {
  it("a clean hit spawns the impact star, a spark burst and a ring; a blocked hit only its ring", () => {
    const { scene, created } = stubScene();
    const fx = new Effects(scene);
    const state = fighting();
    const before = created.length;
    fx.consume([hit(1, true)], state);
    expect(created.length - before).toBe(1);
    fx.consume([hit(1, false)], state);
    expect(created.length - before).toBe(4);
    const cam = (scene as unknown as { cameras: { main: { scrollX?: number } } }).cameras.main;
    fx.update(DT);
    expect(Math.abs(cam.scrollX ?? 0)).toBeGreaterThan(0);
    for (let k = 0; k < 6; k++) fx.update(DT);
    expect(cam.scrollX).toBe(0);
  });

  it("spark specks are seeded, fanned around the punch direction, and snapped when drawn", () => {
    const a = sparkSpecks(new Lcg(1), 1), b = sparkSpecks(new Lcg(1), 1), c = sparkSpecks(new Lcg(2), 1);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
    expect(a.length).toBe(7);
    for (const s of a) { expect(s.ux).toBeGreaterThan(0); expect(Math.abs(s.uy)).toBeLessThan(Math.sin((35 * Math.PI) / 180) + 1e-9); }
    for (const s of sparkSpecks(new Lcg(1), -1)) expect(s.ux).toBeLessThan(0);
  });

  it("landing dust scales with the fall speed and a heavy landing pulses a light", () => {
    expect(landingScale(0)).toBeCloseTo(0.6, 6);
    expect(landingScale(6)).toBeCloseTo(1, 6);
    expect(landingScale(20)).toBeCloseTo(1.4, 6);
    const pulses: number[] = [];
    const sink = { addLight: () => ({ id: 1 }), moveLight: () => undefined, removeLight: () => undefined, pulse: (l: { r: number }) => { pulses.push(l.r); }, glow: () => undefined };
    const { scene, created } = stubScene();
    const fx = new Effects(scene, sink);
    const state = fighting();
    const f = state.fighters[0]!;
    f.grounded = false; f.vy = 9;
    fx.consume([], state); fx.update(DT);
    f.grounded = true; f.vy = 0;
    fx.consume([], state); fx.update(DT);
    const puff = created.at(-1)!;
    expect(puff.circles[0]!.r).toBeGreaterThan(6);
    expect(pulses).toContain(80);
  });

  it("koRim runs 1 → 0 over the collapse", () => {
    const { scene } = stubScene();
    const fx = new Effects(scene);
    const state = fighting();
    expect(fx.koRim(1)).toBe(1);
    state.fighters[1]!.hp = 0;
    state.phase = "ROUND_END";
    frames(fx, state, 1);
    expect(fx.koRim(1)).toBeLessThanOrEqual(1);
    frames(fx, state, 130); // the collapse plays over 30 ko-frames at the 0.25 time scale
    expect(fx.koRim(1)).toBe(0);
  });
});

describe("9.10 chop hit", () => {
  it("isChopHit reads the attacker's live slash action", () => {
    expect(isChopHit({ action: { kind: "slash", style: "chop" } })).toBe(true);
    expect(isChopHit({ action: { kind: "slash", style: "sweep" } })).toBe(false);
    expect(isChopHit({ action: { kind: "punch" } })).toBe(false);
    expect(isChopHit({ action: null })).toBe(false);
    expect(isChopHit(undefined)).toBe(false);
  });
  it("a chop hit shakes harder and longer than a punch", () => {
    expect(CHOP_HIT.SHAKE_SCALE).toBeGreaterThan(1);
    expect(CHOP_HIT.NUDGE_SCALE).toBeGreaterThan(1);
    expect(CHOP_HIT.EXTRA_HITSTOP).toBeGreaterThan(0);
  });
});
