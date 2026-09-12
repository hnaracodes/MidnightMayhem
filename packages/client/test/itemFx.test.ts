import { describe, expect, it } from "vitest";
import type Phaser from "phaser";
import {
  ARSENAL, BALANCE, ITEM_IDS, ITEMS, WORLD, createMatch,
  type Hazard, type ItemId, type MatchState, type PlayerIndex, type Projectile, type SimEvent,
} from "@midnight/shared";
import { ItemFx, type HandPoint } from "../src/game/itemFx";
import { P } from "../src/game/palette";
import { THROW, chargeToRange, chargingThrow, predictFlight, throwVelocity } from "../src/game/throwPreview";

/**
 * Records every Graphics call (name + args), the depth and destruction; everything else is a chainable no-op.
 * Same stub pattern as `effects.test.ts`, widened so a test can inspect radii, line counts and alphas.
 */
class FakeGraphics {
  destroyed = false;
  depth = 0;
  calls: Array<{ m: string; args: unknown[] }> = [];
  constructor() {
    return new Proxy(this, {
      get: (target, prop, receiver) => {
        if (prop in target) return Reflect.get(target, prop, receiver);
        return (...args: unknown[]) => {
          target.calls.push({ m: String(prop), args });
          return receiver;
        };
      },
    });
  }
  setDepth(d: number): this {
    this.depth = d;
    return this;
  }
  clear(): this {
    this.calls = [];
    return this;
  }
  destroy(): void {
    this.destroyed = true;
  }
  /** Every `fillStyle`/`lineStyle` since the last clear as `{ color, alpha }`. */
  styles(): Array<{ kind: string; color: number; alpha: number }> {
    return this.calls
      .filter((c) => c.m === "fillStyle" || c.m === "lineStyle")
      .map((c) => {
        const [a, b, c2] = c.args as number[];
        return c.m === "fillStyle"
          ? { kind: "fill", color: a!, alpha: b ?? 1 }
          : { kind: "line", color: b!, alpha: c2 ?? 1 };
      });
  }
  count(m: string): number {
    return this.calls.filter((c) => c.m === m).length;
  }
  colors(): Set<number> {
    return new Set(this.styles().map((s) => s.color));
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

/** Runs a recorded shake's per-update callback at `progress` and returns the amplitude it set, in world px. */
function shakeAmplitudePx(shake: unknown[], progress: number): { x: number; y: number } {
  const set = { x: 0, y: 0 };
  const camera = { shakeEffect: { intensity: { set: (x: number, y: number) => { set.x = x; set.y = y; } } } };
  (shake[3] as (c: unknown, p: number) => void)(camera, progress);
  return { x: set.x * WORLD.WIDTH, y: set.y * WORLD.HEIGHT };
}

function fighting(): MatchState {
  const s = createMatch();
  s.phase = "FIGHTING";
  s.phaseTicks = 0;
  return s;
}

const DT = 1 / 60;
const hands = (i: PlayerIndex): HandPoint => ({ x: 280 + i * 400, y: WORLD.ROOF_Y - 100 });

/** One render frame: consume (events only on the first), draw, update. */
function frames(fx: ItemFx, state: MatchState, n: number, events: SimEvent[] = []): void {
  for (let k = 0; k < n; k += 1) {
    fx.consume(k === 0 ? events : [], state, hands);
    fx.draw(state, hands, 0);
    fx.update(DT);
  }
}

const live = (created: FakeGraphics[]) => created.filter((g) => !g.destroyed);

describe("ItemFx materialise", () => {
  it.each(ITEM_IDS)("%s: materialising for exactly 26 frames, particles carry the item accent", (item) => {
    const accent: Record<ItemId, number> = {
      molotov: P.danger, sword: P.moon, shield: P.steel2, banana: P.amber1, flash: P.white,
    };
    const { scene, created } = stubScene();
    const fx = new ItemFx(scene);
    const state = fighting();
    fx.consume([{ type: "ITEM_EQUIP", player: 1, item }], state, hands);
    expect(fx.materialising(1)).toBe(true);
    expect(fx.materialising(0)).toBe(false);
    const g = created[0]!;
    expect(g.count("fillCircle")).toBe(24); // 24 particles on the spawn frame, no flash disc yet
    expect(g.colors().has(accent[item])).toBe(true);
    // the ring starts 60 px out from the hand
    const first = g.calls.find((c) => c.m === "fillCircle")!.args as number[];
    expect(Math.hypot(first[0]! - hands(1).x, first[1]! - hands(1).y)).toBeCloseTo(60, 5);

    let frames26 = 0;
    for (let k = 0; k < 40; k += 1) {
      if (fx.materialising(1)) frames26 += 1;
      fx.draw(state, hands, 0);
      fx.update(DT);
      fx.consume([], state, hands);
    }
    expect(frames26).toBe(26);
    expect(fx.materialising(1)).toBe(false);
    expect(live(created)).toHaveLength(0);
  });

  it("the item sprite scales 1.6 → 1 over the 6 frames after it appears", () => {
    const { scene } = stubScene();
    const fx = new ItemFx(scene);
    const state = fighting();
    expect(fx.itemScale(0)).toBe(1);
    frames(fx, state, 1, [{ type: "ITEM_EQUIP", player: 0, item: "banana" }]);
    expect(fx.itemScale(0)).toBe(1); // hidden while materialising: no pop yet
    frames(fx, state, 25); // materialise over
    expect(fx.materialising(0)).toBe(false);
    expect(fx.itemScale(0)).toBeCloseTo(1.6, 5);
    frames(fx, state, 3);
    const mid = fx.itemScale(0);
    expect(mid).toBeGreaterThan(1);
    expect(mid).toBeLessThan(1.6);
    frames(fx, state, 3);
    expect(fx.itemScale(0)).toBe(1);
    expect(fx.itemScale(1)).toBe(1);
  });

  it("a 2-frame amber screen-edge flash for the local player's equip only", () => {
    const { scene, created } = stubScene();
    const fx = new ItemFx(scene);
    const state = fighting();
    // the other fighter equips: no edge flash for the local viewer (player 0)
    frames(fx, state, 1, [{ type: "ITEM_EQUIP", player: 1, item: "sword" }]);
    expect(created.filter((g) => g.depth === 11.5)).toHaveLength(0);
    fx.consume([{ type: "ITEM_EQUIP", player: 0, item: "sword" }], state, hands);
    fx.draw(state, hands, 0);
    const edge = created.filter((g) => g.depth === 11.5);
    expect(edge).toHaveLength(1);
    const g = edge[0]!;
    expect(g.count("fillRect")).toBe(4);
    expect(g.styles()[0]).toEqual({ kind: "fill", color: P.amber1, alpha: 0.08 });
    fx.update(DT);
    fx.draw(state, hands, 0);
    expect(g.count("fillRect")).toBe(4);
    fx.update(DT);
    fx.draw(state, hands, 0);
    expect(g.count("fillRect")).toBe(0);
  });

  it("frame 20 shows the moon flash disc r 14 at the hand, fading over the next 6", () => {
    const { scene, created } = stubScene();
    const fx = new ItemFx(scene);
    const state = fighting();
    frames(fx, state, 21, [{ type: "ITEM_EQUIP", player: 0, item: "sword" }]); // now at frame 20 (drawn by update)
    const g = created[0]!;
    const disc = g.calls.find((c) => c.m === "fillCircle" && (c.args as number[])[2] === 14);
    expect(disc).toBeDefined();
    expect((disc!.args as number[])[0]).toBe(hands(0).x);
    const moonFills = g.styles().filter((s) => s.kind === "fill" && s.color === P.moon);
    expect(moonFills.at(-1)!.alpha).toBeCloseTo(1, 5);
    frames(fx, state, 3);
    const later = g.styles().filter((s) => s.kind === "fill" && s.color === P.moon).at(-1)!;
    expect(later.alpha).toBeLessThan(1);
    expect(later.alpha).toBeGreaterThan(0);
  });
});

describe("ItemFx laser", () => {
  it("charge ring grows r 6 → 22 over 30 frames with 3 orbiting dots, then goes away", () => {
    const { scene, created } = stubScene();
    const fx = new ItemFx(scene);
    const state = fighting();
    state.fighters[0]!.action = { kind: "laser", elapsed: 0, hit: [] };
    fx.consume([{ type: "LASER_CHARGE", player: 0 }], state, hands);
    const ring = created[0]!;
    expect(ring.depth).toBe(4);
    const radiusAt = () => (ring.calls.find((c) => c.m === "strokeCircle")!.args as number[])[2]!;
    expect(radiusAt()).toBeCloseTo(6, 5);
    expect(ring.count("fillCircle")).toBe(3);
    fx.draw(state, hands, 0);
    fx.update(DT); // the spawn frame's own update: still frame 0 of 30
    frames(fx, state, 15);
    const mid = radiusAt();
    expect(mid).toBeGreaterThan(6);
    expect(mid).toBeLessThan(22);
    frames(fx, state, 14);
    expect(radiusAt()).toBeCloseTo(22, 5); // frame 29 of 30: the ring reaches r 22 on its last frame
    expect(ring.destroyed).toBe(false);
    frames(fx, state, 1);
    expect(ring.destroyed).toBe(true);
    expect(live(created)).toHaveLength(0);
  });

  it("beam: 12 frames full then a 10-frame fade, moon core + amber edge, shake 4 px for 8 frames", () => {
    const { scene, created, shakes } = stubScene();
    const fx = new ItemFx(scene);
    const state = fighting();
    state.fighters[0]!.action = { kind: "laser", elapsed: ARSENAL.LASER_CHARGE, hit: [] };
    fx.consume([{ type: "LASER_FIRE", player: 0 }], state, hands);
    const beam = created[0]!;
    expect(beam.depth).toBe(4.5);
    expect(shakes).toHaveLength(1);
    expect(shakes[0]![0]).toBeCloseTo(8 * (1000 / 60), 5);
    expect(shakes[0]![2]).toBe(true); // forced: a beam shake replaces any running punch shake
    expect(shakeAmplitudePx(shakes[0]!, 0).x).toBeCloseTo(4, 5);
    expect(shakeAmplitudePx(shakes[0]!, 0).y).toBeCloseTo(4, 5);
    expect(shakeAmplitudePx(shakes[0]!, 1).x).toBeCloseTo(0, 5);
    const styles = beam.styles();
    const edge = styles.find((s) => s.color === P.amber1)!;
    const core = styles.find((s) => s.color === P.moon)!;
    expect(edge.alpha).toBeCloseTo(0.6, 5);
    expect(core.alpha).toBeCloseTo(1, 5);
    // the beam runs from the hand to the right world edge (facing 1)
    const rect = beam.calls.find((c) => c.m === "fillRect")!.args as number[];
    expect(rect[0]).toBe(hands(0).x);
    expect(rect[0]! + rect[2]!).toBe(WORLD.WIDTH);

    fx.draw(state, hands, 0);
    fx.update(DT); // the spawn frame's own update: still frame 0
    frames(fx, state, 11); // frame 11: last full-strength frame
    expect(beam.styles().find((s) => s.color === P.moon)!.alpha).toBeCloseTo(1, 5);
    frames(fx, state, 1); // frame 12: first fade frame
    expect(beam.destroyed).toBe(false);
    const fading = beam.styles().find((s) => s.color === P.moon)!;
    expect(fading.alpha).toBeLessThan(1);
    expect(fading.alpha).toBeGreaterThan(0);
    frames(fx, state, 9); // frame 21: last fade frame
    expect(beam.destroyed).toBe(false);
    frames(fx, state, 1);
    expect(beam.destroyed).toBe(true);
  });

  it("LASER_HIT draws an impact burst at the target's chest for 6 frames", () => {
    const { scene, created } = stubScene();
    const fx = new ItemFx(scene);
    const state = fighting();
    frames(fx, state, 1, [{ type: "LASER_HIT", attacker: 0, target: 1, damage: ARSENAL.LASER_DAMAGE, blocked: false }]);
    expect(created).toHaveLength(1);
    const g = created[0]!;
    expect(g.count("lineBetween")).toBe(8);
    expect(g.colors().has(P.amber1)).toBe(true);
    expect(g.colors().has(P.moon)).toBe(true);
    frames(fx, state, 5);
    expect(g.destroyed).toBe(false);
    frames(fx, state, 1);
    expect(g.destroyed).toBe(true);
  });
});

describe("ItemFx sword", () => {
  it("PUNCH with a sword draws a 3-frame moon slash; without a sword nothing", () => {
    const { scene, created } = stubScene();
    const fx = new ItemFx(scene);
    const state = fighting();
    fx.consume([{ type: "PUNCH", player: 0, arm: "R" }], state, hands);
    expect(created).toHaveLength(0);
    state.fighters[0]!.item = { kind: "sword", uses: ITEMS.sword.uses };
    frames(fx, state, 1, [{ type: "PUNCH", player: 0, arm: "R" }]);
    expect(created).toHaveLength(1);
    const g = created[0]!;
    expect(g.depth).toBe(4);
    expect(g.colors().has(P.moon)).toBe(true);
    frames(fx, state, 2);
    expect(g.destroyed).toBe(false);
    frames(fx, state, 1);
    expect(g.destroyed).toBe(true);
  });

  it("PARRY: 6-frame white spark star at the parrier's hand and a 2 px shake", () => {
    const { scene, created, shakes } = stubScene();
    const fx = new ItemFx(scene);
    const state = fighting();
    frames(fx, state, 1, [{ type: "PARRY", player: 1, attacker: 0 }]);
    expect(created).toHaveLength(1);
    expect(created[0]!.colors().has(P.white)).toBe(true);
    expect(shakes).toHaveLength(1);
    expect(shakeAmplitudePx(shakes[0]!, 0).x).toBeCloseTo(2, 5);
    expect(shakeAmplitudePx(shakes[0]!, 0.5).x).toBeCloseTo(1, 5);
    frames(fx, state, 5);
    expect(created[0]!.destroyed).toBe(false);
    frames(fx, state, 1);
    expect(created[0]!.destroyed).toBe(true);
  });
});

describe("ItemFx shield barrier", () => {
  it("a moon 35 % hexagon 70 × 150 in front of the fighter, with a steel edge; cracks are 3 − uses; gone with the item", () => {
    const { scene, created } = stubScene();
    const fx = new ItemFx(scene);
    const state = fighting();
    const f = state.fighters[0]!;
    f.item = { kind: "shield", uses: 3 };
    fx.draw(state, hands, 0);
    expect(created).toHaveLength(1);
    const barrier = created[0]!;
    expect(barrier.depth).toBe(4);
    expect(barrier.count("fillPoints")).toBeGreaterThanOrEqual(1);
    const hex = barrier.calls.find((c) => c.m === "fillPoints")!.args[0] as Array<{ x: number; y: number }>;
    expect(hex).toHaveLength(6);
    const xs = hex.map((p) => p.x);
    const ys = hex.map((p) => p.y);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(70, 5);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(150, 5);
    expect(Math.min(...xs)).toBeCloseTo(f.x + 30, 5); // near edge 30 px in front (facing 1)
    expect(Math.max(...ys)).toBeCloseTo(f.y, 5);
    expect(barrier.styles()[0]).toEqual({ kind: "fill", color: P.moon, alpha: 0.35 });
    const edge = barrier.styles().find((s) => s.kind === "line" && s.color === P.steel2);
    expect(edge).toBeDefined();
    expect(barrier.count("lineBetween")).toBe(0); // no cracks at full uses
    f.item = { kind: "shield", uses: 1 };
    fx.draw(state, hands, 0);
    expect(barrier.count("strokePoints")).toBeGreaterThanOrEqual(1 + 2); // the edge plus two jagged cracks
    f.item = null;
    fx.draw(state, hands, 0);
    expect(barrier.destroyed).toBe(true);
    expect(created).toHaveLength(1);
  });

  it("the barrier follows facing", () => {
    const { scene, created } = stubScene();
    const fx = new ItemFx(scene);
    const state = fighting();
    const f = state.fighters[0]!;
    f.item = { kind: "shield", uses: 3 };
    f.facing = -1;
    fx.draw(state, hands, 0);
    const hex = created[0]!.calls.find((c) => c.m === "fillPoints")!.args[0] as Array<{ x: number }>;
    expect(Math.max(...hex.map((p) => p.x))).toBeCloseTo(f.x - 30, 5);
  });

  it("the shimmer band moves top → bottom every 1.2 s", () => {
    const { scene, created } = stubScene();
    const fx = new ItemFx(scene);
    const state = fighting();
    const f = state.fighters[0]!;
    f.item = { kind: "shield", uses: 3 };
    fx.draw(state, hands, 0);
    const g = created[0]!;
    const bandY = () => {
      const band = g.calls.filter((c) => c.m === "fillPoints")[1]!.args[0] as Array<{ y: number }>;
      return Math.min(...band.map((p) => p.y));
    };
    const start = bandY();
    fx.update(0.3);
    fx.draw(state, hands, 0);
    const y0 = bandY();
    expect(y0).toBeGreaterThan(start);
    fx.update(0.3);
    fx.draw(state, hands, 0);
    const y1 = bandY();
    expect(y1 - y0).toBeCloseTo(150 * 0.25, 0); // a quarter of the height per 0.3 s
    fx.update(0.6);
    fx.draw(state, hands, 0);
    expect(bandY()).toBeCloseTo(start, 0); // wrapped after 1.2 s
  });

  it("the barrier goes away while the fighter is down a pit and comes back on respawn", () => {
    const { scene, created } = stubScene();
    const fx = new ItemFx(scene);
    const state = fighting();
    const f = state.fighters[0]!;
    f.item = { kind: "shield", uses: 3 };
    fx.draw(state, hands, 0);
    expect(created).toHaveLength(1);
    f.pitTicks = 40; f.y = 520;
    fx.draw(state, hands, 0);
    expect(created[0]!.destroyed).toBe(true);
    f.pitTicks = 0; f.y = WORLD.ROOF_Y;
    fx.draw(state, hands, 0);
    expect(created).toHaveLength(2);
    expect(created[1]!.count("fillPoints")).toBeGreaterThanOrEqual(1);
  });

  it("no barrier while the shield is materialising; it appears once the 26 frames end", () => {
    const { scene, created } = stubScene();
    const fx = new ItemFx(scene);
    const state = fighting();
    state.fighters[0]!.item = { kind: "shield", uses: 3 };
    frames(fx, state, 1, [{ type: "ITEM_EQUIP", player: 0, item: "shield" }]);
    expect(created.filter((g) => g.depth === 4)).toHaveLength(1); // the materialise only
    frames(fx, state, 25);
    expect(created.filter((g) => g.depth === 4)).toHaveLength(1);
    frames(fx, state, 1);
    expect(created.filter((g) => g.depth === 4)).toHaveLength(2);
  });

  it("SHIELD_ABSORB: 4-frame white flash, a ripple ring from the impact point, and one more crack", () => {
    const { scene, created } = stubScene();
    const fx = new ItemFx(scene);
    const state = fighting();
    state.fighters[0]!.item = { kind: "shield", uses: 2 };
    fx.draw(state, hands, 0);
    const barrier = created[0]!;
    fx.consume([{ type: "SHIELD_ABSORB", player: 0, left: 2 }], state, hands);
    expect(created).toHaveLength(2);
    const ripple = created[1]!;
    expect(ripple.count("strokeCircle")).toBe(1);
    expect(ripple.colors().has(P.white)).toBe(true);
    const r0 = (ripple.calls.find((c) => c.m === "strokeCircle")!.args as number[])[2]!;
    const fillColor = () => barrier.styles()[0]!.color;
    for (let k = 0; k < 4; k += 1) {
      fx.draw(state, hands, 0);
      expect(fillColor()).toBe(P.white);
      fx.update(DT);
    }
    fx.draw(state, hands, 0);
    expect(fillColor()).toBe(P.moon);
    expect(barrier.count("strokePoints")).toBe(1 + 2); // edge + one crack with its branch (3 − 2)
    const r1 = (ripple.calls.find((c) => c.m === "strokeCircle")!.args as number[])[2]!;
    expect(r1).toBeGreaterThan(r0);
  });

  it("ITEM_BREAK for a shield shatters the hexagon into 6 shards over 12 frames; other items do not", () => {
    const { scene, created } = stubScene();
    const fx = new ItemFx(scene);
    const state = fighting();
    fx.consume([{ type: "ITEM_BREAK", player: 0, item: "sword" }], state, hands);
    expect(created).toHaveLength(0);
    frames(fx, state, 1, [{ type: "ITEM_BREAK", player: 0, item: "shield" }]);
    expect(created).toHaveLength(1);
    const g = created[0]!;
    expect(g.count("fillTriangle")).toBe(6);
    expect(g.colors().has(P.moon)).toBe(true);
    frames(fx, state, 11);
    expect(g.destroyed).toBe(false);
    frames(fx, state, 1);
    expect(g.destroyed).toBe(true);
  });
});

describe("throw preview (rule 5)", () => {
  it("throwVelocity lands within ±10 px of the asked range at 120, 380 and 640 under the sim's Euler step", () => {
    for (const range of [120, 380, 640]) {
      const { vx, vy } = throwVelocity(range);
      expect(vx).toBeGreaterThan(0);
      expect(vy).toBeLessThan(0);
      const { landing } = predictFlight({ x: 0, y: -100 }, vx, vy, 0, 12);
      expect(Math.abs(landing.x - range), `range ${range}`).toBeLessThanOrEqual(10);
    }
  });

  it("predictFlight steps exactly like the sim's projectile (gravity, then move) so the dots sit on the real arc", () => {
    const { vx, vy } = throwVelocity(500);
    // packages/shared/src/sim/projectiles.ts: `vy += GRAVITY; x += vx; y += vy;` then land when `vy > 0 && y >= surface`.
    const sim: { x: number; y: number }[] = [];
    let x = 0;
    let y = -100;
    let dy = vy;
    while (!(dy > 0 && y >= 0)) {
      dy += BALANCE.GRAVITY;
      x += vx;
      y += dy;
      sim.push({ x, y });
    }
    const { landing, dots } = predictFlight({ x: 0, y: -100 }, vx, vy, 0, 12);
    expect(dots).toHaveLength(12);
    expect(landing.y).toBe(0);
    expect(Math.abs(landing.x - x)).toBeLessThanOrEqual(Math.abs(vx)); // the marker backs off along the last step
    for (const d of dots.slice(0, 11)) {
      const on = sim.some((p) => Math.abs(p.x - d.x) < 1e-6 && Math.abs(p.y - d.y) < 1e-6);
      expect(on, `dot (${d.x.toFixed(1)}, ${d.y.toFixed(1)}) lies on the sim path`).toBe(true);
    }
  });

  it("chargeToRange is linear 120 → 640 over 0 → 45 and clamps", () => {
    expect(chargeToRange(0)).toBe(THROW.MIN_RANGE);
    expect(chargeToRange(THROW.CHARGE_MAX)).toBe(THROW.MAX_RANGE);
    expect(chargeToRange(22.5)).toBeCloseTo(380, 5);
    expect(chargeToRange(999)).toBe(THROW.MAX_RANGE);
    expect(chargeToRange(-5)).toBe(THROW.MIN_RANGE);
  });

  it("chargingThrow reads only a throw in its charge phase", () => {
    expect(chargingThrow(null)).toBeNull();
    expect(chargingThrow({ kind: "punch", arm: "R", elapsed: 0, landed: false, sword: false })).toBeNull();
    expect(chargingThrow(charging("molotov", 12))).toBe(12);
    expect(chargingThrow(released("molotov"))).toBeNull();
  });

  it("12 amber dots fading 60 % → 20 % plus a danger landing ring r 10 while the local fighter charges; none after release", () => {
    const { scene, created } = stubScene();
    const fx = new ItemFx(scene);
    const state = fighting();
    const f = state.fighters[0]!;
    f.item = { kind: "molotov", uses: 2 };
    f.action = charging("molotov", 0);
    fx.draw(state, hands, 0);
    const preview = created.find((g) => g.depth === 4.2)!;
    expect(preview).toBeDefined();
    const fills = preview.styles().filter((s) => s.kind === "fill" && s.color === P.amber1);
    expect(fills).toHaveLength(12);
    expect(preview.count("fillCircle")).toBe(12 + 1); // the dots plus the landing marker's core
    expect(fills[0]!.alpha).toBeCloseTo(0.6, 5);
    expect(fills[11]!.alpha).toBeCloseTo(0.2, 5);
    const ring = preview.calls.find((c) => c.m === "strokeCircle")!.args as number[];
    expect(ring[2]).toBe(10);
    expect(ring[1]).toBeCloseTo(f.y, 5);
    expect(preview.styles().some((s) => s.kind === "line" && s.color === P.danger)).toBe(true);
    const near = ring[0]!;
    f.action = charging("molotov", THROW.CHARGE_MAX);
    fx.draw(state, hands, 0);
    const far = (preview.calls.find((c) => c.m === "strokeCircle")!.args as number[])[0]!;
    expect(far - hands(0).x).toBeGreaterThan(near - hands(0).x + 400);
    f.action = released("molotov");
    fx.draw(state, hands, 0);
    expect(preview.destroyed).toBe(true);
    expect(created.filter((g) => g.depth === 4.2 && !g.destroyed)).toHaveLength(0);
  });

  it("only the local fighter's charge draws a preview", () => {
    const { scene, created } = stubScene();
    const fx = new ItemFx(scene);
    const state = fighting();
    state.fighters[1]!.action = charging("banana", 10);
    fx.draw(state, hands, 0);
    expect(created.filter((g) => g.depth === 4.2)).toHaveLength(0);
    fx.draw(state, hands, 1);
    expect(created.filter((g) => g.depth === 4.2)).toHaveLength(1);
  });
});

function charging(item: "molotov" | "banana", charge: number) {
  // Lane A's ThrowAction shape; cast until its types merge (INTEGRATOR: drop the cast after merge).
  return { kind: "throw", item, arm: "R", phase: "charge", charge, elapsed: 0, released: false } as unknown as MatchState["fighters"][0]["action"];
}

function released(item: "molotov" | "banana") {
  return { kind: "throw", item, arm: "R", phase: "release", charge: 20, elapsed: 0, released: false } as unknown as MatchState["fighters"][0]["action"];
}

describe("ItemFx projectiles and hazards", () => {
  const molotov: Projectile = { id: 1, kind: "molotov", owner: 0, x: 300, y: 330, vx: 6, vy: -7 };
  const banana: Projectile = { id: 2, kind: "banana", owner: 1, x: 600, y: 330, vx: -5, vy: -4 };
  const fire: Hazard = { id: 3, kind: "fire", owner: 0, x: 500, y: WORLD.ROOF_Y, w: ARSENAL.FIRE_W, ticks: ARSENAL.FIRE_TICKS, age: 0 };
  const peel: Hazard = { id: 4, kind: "peel", owner: 1, x: 700, y: WORLD.ROOF_Y, w: ARSENAL.PEEL_W, ticks: ARSENAL.PEEL_TICKS, age: 0 };

  it("creates one Graphics per projectile at depth 4 and destroys it when the projectile is gone", () => {
    const { scene, created } = stubScene();
    const fx = new ItemFx(scene);
    const state = fighting();
    state.projectiles = [molotov, banana];
    fx.draw(state, hands, 0);
    expect(created).toHaveLength(2);
    expect(created.every((g) => g.depth === 4)).toBe(true);
    fx.draw(state, hands, 0);
    expect(created).toHaveLength(2); // reused, not re-created
    state.projectiles = [banana];
    fx.draw(state, hands, 0);
    expect(created[0]!.destroyed).toBe(true);
    expect(created[1]!.destroyed).toBe(false);
    state.projectiles = [];
    fx.draw(state, hands, 0);
    expect(live(created)).toHaveLength(0);
  });

  it("molotov: steel bottle with an amber flame and a trail that grows to 6 points", () => {
    const { scene, created } = stubScene();
    const fx = new ItemFx(scene);
    const state = fighting();
    const p = { ...molotov };
    state.projectiles = [p];
    for (let k = 0; k < 8; k += 1) {
      fx.draw(state, hands, 0);
      p.x += p.vx;
      p.y += p.vy;
    }
    const g = created[0]!;
    expect(g.colors().has(P.steel2)).toBe(true);
    expect(g.colors().has(P.amber1)).toBe(true);
    expect(g.count("lineBetween")).toBe(5); // 6 trail points → 5 segments, capped
  });

  it("banana spins 15° per frame", () => {
    const { scene, created } = stubScene();
    const fx = new ItemFx(scene);
    const state = fighting();
    state.projectiles = [{ ...banana }];
    fx.draw(state, hands, 0);
    const first = created[0]!.calls.find((c) => c.m === "fillPoints")!.args[0] as Array<{ x: number; y: number }>;
    fx.draw(state, hands, 0);
    const second = created[0]!.calls.find((c) => c.m === "fillPoints")!.args[0] as Array<{ x: number; y: number }>;
    const ang = (pts: Array<{ x: number; y: number }>) => Math.atan2(pts[0]!.y - banana.y, pts[0]!.x - banana.x);
    let d = ang(second) - ang(first);
    d = Math.atan2(Math.sin(d), Math.cos(d));
    expect(Math.abs(d)).toBeCloseTo((15 * Math.PI) / 180, 5);
  });

  it("hazards: fire has 7 tongues plus a scorch at depth 0.5 and fades over its last 30 ticks; peel is a crescent", () => {
    const { scene, created } = stubScene();
    const fx = new ItemFx(scene);
    const state = fighting();
    const f = { ...fire };
    state.hazards = [f, peel];
    fx.draw(state, hands, 0);
    expect(created).toHaveLength(2);
    expect(created.every((g) => g.depth === 0.5)).toBe(true);
    const fireG = created[0]!;
    expect(fireG.count("fillTriangle")).toBe(7);
    expect(fireG.count("fillEllipse")).toBe(1);
    expect(fireG.colors().has(P.danger)).toBe(true);
    expect(fireG.colors().has(P.amber1)).toBe(true);
    expect(fireG.colors().has(P.night0)).toBe(true);
    const scorchAlpha = () => fireG.styles().find((s) => s.color === P.night0)!.alpha;
    expect(scorchAlpha()).toBeCloseTo(0.25, 5);
    f.age = f.ticks - 15;
    fx.draw(state, hands, 0);
    expect(scorchAlpha()).toBeCloseTo(0.125, 5);

    const peelG = created[1]!;
    expect(peelG.count("fillPoints")).toBe(1);
    expect(peelG.colors().has(P.amber1)).toBe(true);
    expect(peelG.colors().has(P.outline)).toBe(true);
    expect(peelG.count("lineBetween")).toBe(2);

    state.hazards = [];
    fx.draw(state, hands, 0);
    expect(live(created)).toHaveLength(0);
  });

  it("HAZARD_HIT: damage → danger flash at the feet; slip (damage 0) → 6-frame moon stars over the head", () => {
    const { scene, created } = stubScene();
    const fx = new ItemFx(scene);
    const state = fighting();
    fx.consume([{ type: "HAZARD_HIT", id: 3, kind: "fire", target: 1, damage: ARSENAL.FIRE_DAMAGE }], state, hands);
    expect(created).toHaveLength(1);
    expect(created[0]!.colors().has(P.danger)).toBe(true);
    frames(fx, state, 1, [{ type: "HAZARD_HIT", id: 4, kind: "peel", target: 1, damage: 0 }]);
    expect(created).toHaveLength(2);
    const stars = created[1]!;
    expect(stars.colors().has(P.moon)).toBe(true);
    expect(stars.count("fillPoints")).toBe(3);
    const head = state.fighters[1]!.y - WORLD.HURTBOX_H;
    const pts = stars.calls.find((c) => c.m === "fillPoints")!.args[0] as Array<{ y: number }>;
    expect(Math.max(...pts.map((p) => p.y))).toBeLessThan(head);
    frames(fx, state, 5);
    expect(stars.destroyed).toBe(false);
    frames(fx, state, 1);
    expect(stars.destroyed).toBe(true);
  });
});

describe("ItemFx flash", () => {
  it("dazzleAlpha is 1 for the first 90 ticks then linear to 0 by 120", () => {
    const { scene } = stubScene();
    const fx = new ItemFx(scene);
    const state = fighting();
    const f = state.fighters[0]!;
    const at = (dazzle: number) => { f.dazzle = dazzle; return fx.dazzleAlpha(state, 0); };
    expect(at(0)).toBe(0);
    expect(at(ARSENAL.DAZZLE_TICKS)).toBe(1);
    expect(at(60)).toBe(1);
    expect(at(30)).toBe(1);
    expect(at(15)).toBeCloseTo(0.5, 5);
    expect(at(3)).toBeCloseTo(0.1, 5);
    f.dazzle = ARSENAL.DAZZLE_TICKS;
    expect(fx.dazzleAlpha(state, 1)).toBe(0); // the other fighter is not dazzled
    expect(fx.dazzleAlpha(state, 3)).toBe(0); // absent slot
  });

  it("FLASH spawns a 6-frame white burst at the flasher's hand", () => {
    const { scene, created } = stubScene();
    const fx = new ItemFx(scene);
    const state = fighting();
    frames(fx, state, 1, [{ type: "FLASH", player: 1 }]);
    expect(created).toHaveLength(1);
    const g = created[0]!;
    expect(g.colors().has(P.white)).toBe(true);
    const circle = g.calls.find((c) => c.m === "fillCircle")!.args as number[];
    expect(circle[0]).toBe(hands(1).x);
    frames(fx, state, 5);
    expect(g.destroyed).toBe(false);
    frames(fx, state, 1);
    expect(g.destroyed).toBe(true);
  });
});

describe("ItemFx lifecycle", () => {
  it("destroy() leaves nothing alive", () => {
    const { scene, created } = stubScene();
    const fx = new ItemFx(scene);
    const state = fighting();
    state.fighters[1]!.item = { kind: "shield", uses: 3 }; // player 0 is materialising, which hides a bubble
    state.fighters[1]!.action = { kind: "laser", elapsed: 0, hit: [] };
    state.projectiles = [{ id: 1, kind: "molotov", owner: 0, x: 300, y: 330, vx: 6, vy: -7 }];
    state.hazards = [{ id: 2, kind: "peel", owner: 0, x: 500, y: WORLD.ROOF_Y, w: 40, ticks: 900, age: 0 }];
    fx.consume([
      { type: "ITEM_EQUIP", player: 0, item: "banana" },
      { type: "LASER_CHARGE", player: 1 },
      { type: "LASER_FIRE", player: 1 },
      { type: "PARRY", player: 0, attacker: 1 },
    ], state, hands);
    fx.draw(state, hands, 0);
    fx.update(DT);
    expect(live(created).length).toBeGreaterThanOrEqual(6);
    fx.destroy();
    expect(live(created)).toHaveLength(0);
    expect(fx.materialising(0)).toBe(false);
    // a later frame after destroy creates nothing on its own
    fx.update(DT);
    expect(live(created)).toHaveLength(0);
  });
});
