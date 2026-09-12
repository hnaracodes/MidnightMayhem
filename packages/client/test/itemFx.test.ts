import { describe, expect, it } from "vitest";
import type Phaser from "phaser";
import {
  ARSENAL, ITEM_IDS, ITEMS, WORLD, createMatch,
  type Hazard, type ItemId, type MatchState, type PlayerIndex, type Projectile, type SimEvent,
} from "@midnight/shared";
import { ItemFx, type HandPoint } from "../src/game/itemFx";
import { P } from "../src/game/palette";

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
    expect(g.count("fillCircle")).toBe(14); // 14 particles on the spawn frame, no flash disc yet
    expect(g.colors().has(accent[item])).toBe(true);

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

describe("ItemFx shield", () => {
  it("bubble crack count is 3 − uses and the bubble disappears with the item", () => {
    const { scene, created } = stubScene();
    const fx = new ItemFx(scene);
    const state = fighting();
    const f = state.fighters[0]!;
    f.item = { kind: "shield", uses: 3 };
    fx.draw(state, hands, 0);
    expect(created).toHaveLength(1);
    const bubble = created[0]!;
    expect(bubble.depth).toBe(4);
    expect(bubble.count("fillEllipse")).toBe(1);
    expect(bubble.count("lineBetween")).toBe(0);
    f.item = { kind: "shield", uses: 1 };
    fx.draw(state, hands, 0);
    expect(bubble.count("lineBetween")).toBe(2);
    expect(bubble.styles()[0]).toEqual({ kind: "fill", color: P.steel2, alpha: 0.3 });
    f.item = null;
    fx.draw(state, hands, 0);
    expect(bubble.destroyed).toBe(true);
    expect(created).toHaveLength(1); // still one: nothing new created for a fighter without a shield
  });

  it("no bubble while the shield is materialising; it appears once the 26 frames end", () => {
    const { scene, created } = stubScene();
    const fx = new ItemFx(scene);
    const state = fighting();
    state.fighters[0]!.item = { kind: "shield", uses: 3 };
    frames(fx, state, 1, [{ type: "ITEM_EQUIP", player: 0, item: "shield" }]);
    expect(created).toHaveLength(1); // the materialise only
    frames(fx, state, 25);
    expect(created).toHaveLength(1);
    frames(fx, state, 1);
    expect(created).toHaveLength(2);
    expect(created[1]!.count("fillEllipse")).toBe(1);
  });

  it("SHIELD_ABSORB flashes the bubble moon for 2 frames", () => {
    const { scene, created } = stubScene();
    const fx = new ItemFx(scene);
    const state = fighting();
    state.fighters[0]!.item = { kind: "shield", uses: 2 };
    fx.draw(state, hands, 0);
    const bubble = created[0]!;
    fx.consume([{ type: "SHIELD_ABSORB", player: 0, left: 2 }], state, hands);
    const fillColor = () => bubble.styles()[0]!.color;
    fx.draw(state, hands, 0);
    expect(fillColor()).toBe(P.moon);
    fx.update(DT);
    fx.draw(state, hands, 0);
    expect(fillColor()).toBe(P.moon);
    fx.update(DT);
    fx.draw(state, hands, 0);
    expect(fillColor()).toBe(P.steel2);
  });

  it("ITEM_BREAK for a shield throws 8 shards for 10 frames; other items do not", () => {
    const { scene, created } = stubScene();
    const fx = new ItemFx(scene);
    const state = fighting();
    fx.consume([{ type: "ITEM_BREAK", player: 0, item: "sword" }], state, hands);
    expect(created).toHaveLength(0);
    frames(fx, state, 1, [{ type: "ITEM_BREAK", player: 0, item: "shield" }]);
    expect(created).toHaveLength(1);
    const g = created[0]!;
    expect(g.count("fillTriangle")).toBe(8);
    frames(fx, state, 9);
    expect(g.destroyed).toBe(false);
    frames(fx, state, 1);
    expect(g.destroyed).toBe(true);
  });
});

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
