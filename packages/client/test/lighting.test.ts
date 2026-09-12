import { describe, expect, it } from "vitest";
import type Phaser from "phaser";
import { WORLD } from "@midnight/shared";
import { Lcg, ROOF_LAMPS } from "../src/game/backgrounds";
import { P } from "../src/game/palette";
import { PIXEL } from "../src/game/pixel";
import { drawShadow, shadowPool } from "../src/game/rig/draw";
import {
  DARK_ALPHA, FIGHTER_MIN_BRIGHTNESS, Lighting, carLights, flicker, gloomFor, lightLevel, placeRepeating, rimFor,
  type FlickerState, type Resolved,
} from "../src/game/stage/lighting";

/** Chainable no-op for every Phaser setter; records the render-texture stamps and fills we care about. */
class FakeObject {
  alpha = 1;
  depth = 0;
  destroyed = false;
  stamps: Array<{ x: number; y: number; alpha: number; tint: number | undefined; erase: boolean }> = [];
  fills: Array<{ color: number; alpha: number }> = [];
  ellipses: Array<{ x: number; y: number; w: number; h: number; alpha: number }> = [];
  private fillAlpha = 1;
  constructor() {
    return new Proxy(this, {
      get: (target, prop, receiver) => {
        if (prop in target) return Reflect.get(target, prop, receiver);
        return () => receiver;
      },
    });
  }
  setDepth(d: number): this { this.depth = d; return this; }
  fill(color: number, alpha = 1): this { this.fills.push({ color, alpha }); return this; }
  stamp(_key: string, _frame: unknown, x: number, y: number, cfg: { alpha?: number; tint?: number; blendMode?: number }): this {
    this.stamps.push({ x, y, alpha: cfg.alpha ?? 1, tint: cfg.tint, erase: cfg.blendMode !== undefined });
    return this;
  }
  clear(): this { this.stamps = []; this.fills = []; this.ellipses = []; return this; }
  fillStyle(_c: number, a = 1): this { this.fillAlpha = a; return this; }
  fillEllipse(x: number, y: number, w: number, h: number): this { this.ellipses.push({ x, y, w, h, alpha: this.fillAlpha }); return this; }
  destroy(): void { this.destroyed = true; }
}

function stubScene() {
  const objects: FakeObject[] = [];
  const tweens: Array<{ targets: object; darkAlpha?: number }> = [];
  const textures = new Set<string>();
  const scene = {
    add: {
      renderTexture: () => { const o = new FakeObject(); objects.push(o); return o; },
      graphics: () => { const o = new FakeObject(); objects.push(o); return o; },
      image: () => { const o = new FakeObject(); objects.push(o); return o; },
    },
    make: { graphics: () => { const g = new FakeObject(); (g as unknown as { generateTexture: (k: string) => void }).generateTexture = (k) => { textures.add(k); }; return g; } },
    textures: { exists: (k: string) => textures.has(k) },
    tweens: { add: (cfg: { targets: object; darkAlpha?: number }) => { tweens.push(cfg); return {}; }, killTweensOf: () => undefined },
    renderer: { type: 2 },
  };
  return { scene: scene as unknown as Phaser.Scene, objects, tweens, textures };
}

const OFF = { roof: 0, tunnel: 0 };
const OPTS = { reducedMotion: false, rays: true };
const DT = 1 / 60;
const pool = (over: Partial<Resolved>): Resolved => ({ x: 0, y: WORLD.ROOF_Y, rx: 200, ry: 200, color: P.lamp, intensity: 1, cold: false, kind: "lamp", ...over });

describe("12.02 rule 3: sources per car", () => {
  it("the open roof has windows, two roof lamps, the moon and the firebox; the tunnel swaps the moon for wall lamps; the last car adds the tail lamp", () => {
    const kinds = (car: "STANDARD" | "TUNNEL" | "FINAL_CAR"): string[] => carLights(car).map((l) => l.kind);
    expect(kinds("STANDARD")).toEqual(["window", "lamp", "lamp", "moon", "firebox"]);
    expect(kinds("TUNNEL")).toEqual(["window", "lamp", "lamp", "tunnel", "firebox"]);
    expect(kinds("FINAL_CAR")).toEqual(["window", "lamp", "lamp", "moon", "firebox", "tail"]);
    const tail = carLights("FINAL_CAR").find((l) => l.kind === "tail")!;
    expect(tail.color).toBe(P.danger);
    expect(carLights("STANDARD").find((l) => l.kind === "moon")!.color).toBe(P.glow1);
    expect(carLights("STANDARD").filter((l) => l.kind === "lamp").every((l) => l.color === P.lamp)).toBe(true);
    expect(DARK_ALPHA.TUNNEL).toBeGreaterThan(DARK_ALPHA.FINAL_CAR);
    expect(DARK_ALPHA.FINAL_CAR).toBeGreaterThan(DARK_ALPHA.STANDARD);
  });

  it("a repeating source is placed once per period across the screen and follows the offset", () => {
    const lamp = carLights("STANDARD").find((l) => l.kind === "lamp")!;
    const xs0 = placeRepeating(lamp, 0);
    expect(xs0.length).toBeGreaterThanOrEqual(1);
    expect(xs0.every((x) => x > -lamp.r && x < WORLD.WIDTH + lamp.r)).toBe(true);
    const xs1 = placeRepeating(lamp, 100);
    expect(xs1[0]! + 100 - xs0[0]!).toBeCloseTo(0, 6);
    const windows = carLights("STANDARD")[0]!;
    expect(placeRepeating(windows, 0).length).toBe(Math.floor((WORLD.WIDTH + 2 * windows.r) / (windows.every ?? 1)) + 1);
    expect(ROOF_LAMPS.length).toBe(2);
  });
});

describe("12.02 rule 5: flicker", () => {
  it("stays within the amplitude and is identical for the same seed", () => {
    const run = (seed: number): number[] => {
      const rng = new Lcg(seed);
      const st: FlickerState = { value: 1, target: 1, timer: 0 };
      const out: number[] = [];
      for (let k = 0; k < 600; k++) out.push(flicker(rng, st, 0.7, 0.05, DT));
      return out;
    };
    const a = run(7), b = run(7), c = run(8);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
    expect(Math.max(...a)).toBeLessThanOrEqual(1.05 + 1e-9);
    expect(Math.min(...a)).toBeGreaterThanOrEqual(0.95 - 1e-9);
    expect(new Set(a.map((v) => v.toFixed(4))).size).toBeGreaterThan(5);
  });

  it("reduced motion freezes the lamps at their nominal intensity", () => {
    const { scene } = stubScene();
    const rig = new Lighting(scene);
    for (let k = 0; k < 120; k++) rig.update(DT, OFF, { reducedMotion: true, rays: true });
    const lamp = rig.lights().find((l) => l.kind === "lamp")!;
    expect(lamp.intensity).toBe(0.85);
  });
});

describe("12.02 rule 7: transients", () => {
  it("a pulse decays linearly and is gone after its frames; a moved light reports its new place", () => {
    const { scene } = stubScene();
    const rig = new Lighting(scene);
    rig.pulse({ x: 100, y: 400, r: 90, color: P.amber1, intensity: 0.8 }, 4);
    const seen: number[] = [];
    for (let k = 0; k < 6; k++) {
      rig.update(DT, OFF, OPTS);
      const t = rig.lights().find((l) => l.kind === "transient");
      seen.push(t ? t.intensity : -1);
    }
    expect(seen[0]).toBeCloseTo(0.8, 6);
    expect(seen[1]).toBeCloseTo(0.6, 6);
    expect(seen[3]).toBeCloseTo(0.2, 6);
    expect(seen[4]).toBe(-1);
    const h = rig.addLight({ x: 10, y: 20, r: 50, color: P.danger, intensity: 0.5 });
    rig.moveLight(h, 300, 400, 0.25);
    rig.update(DT, OFF, OPTS);
    const moved = rig.lights().find((l) => l.kind === "transient")!;
    expect([moved.x, moved.y, moved.intensity]).toEqual([300, 400, 0.25]);
    rig.removeLight(h);
    rig.update(DT, OFF, OPTS);
    expect(rig.lights().some((l) => l.kind === "transient")).toBe(false);
  });
});

describe("12.02 rule 8: rim and gloom", () => {
  it("the side flips across a lamp, the moon wins far from every lamp, and the tunnel lights both edges", () => {
    const lamp = pool({ x: 400 });
    expect(rimFor([lamp], 0.35, 300, 380).side).toBe("right");
    expect(rimFor([lamp], 0.35, 500, 380).side).toBe("left");
    expect(rimFor([lamp], 0.35, 300, 380).color).toBe(P.lamp);
    const moon = pool({ x: 740, y: 110, rx: 520, ry: 520, color: P.glow1, intensity: 0.25, cold: true, kind: "moon" });
    const far = rimFor([lamp, moon], 0.35, 900, 380);
    expect(far.color).toBe(P.glow1);
    expect(far.side).toBe("left");
    expect(rimFor([lamp, moon], 0.35, 100, 380).side).toBe("right");
    const tunnel = rimFor([lamp], 0.7, 300, 380, true);
    expect(tunnel).toMatchObject({ color: P.amber1, side: "both" });
    const left = pool({ x: 200, rx: 300 }), right = pool({ x: 600, rx: 300 });
    expect(rimFor([left, right], 0.35, 400, WORLD.ROOF_Y).side).toBe("both");
  });

  it("gloom is 0 under a lamp and never more than the 75 % floor allows", () => {
    const lamp = pool({ x: 400 });
    expect(rimFor([lamp], 0.35, 400, WORLD.ROOF_Y).gloom).toBe(0);
    expect(rimFor([lamp], 0.35, 400, 380).gloom).toBeLessThan(0.01);
    expect(gloomFor(0, 0.7)).toBe(1 - FIGHTER_MIN_BRIGHTNESS);
    expect(gloomFor(0, 0.35)).toBeCloseTo(0.175, 6);
    for (let x = 0; x <= WORLD.WIDTH; x += 40) {
      const g = rimFor([lamp], DARK_ALPHA.TUNNEL, x, 380, true).gloom;
      expect(g).toBeGreaterThanOrEqual(0);
      expect(g).toBeLessThanOrEqual(1 - FIGHTER_MIN_BRIGHTNESS);
    }
    expect(lightLevel([lamp], 400, WORLD.ROOF_Y)).toBe(1);
    expect(lightLevel([lamp], 700, WORLD.ROOF_Y)).toBe(0);
  });
});

describe("12.02 rules 1–2: darkness and pools", () => {
  it("fills the darkness with void0 at the car's alpha and stamps every light out of it and into the cast", () => {
    const { scene, objects, tweens } = stubScene();
    const rig = new Lighting(scene);
    rig.setCar("TUNNEL", { immediate: true });
    expect(rig.darkAlpha).toBe(DARK_ALPHA.TUNNEL);
    rig.update(DT, OFF, OPTS);
    const dark = objects.find((o) => o.depth === 0)!;
    const cast = objects.find((o) => o.depth === 0.1)!;
    expect(dark.fills.at(-1)).toEqual({ color: P.void0, alpha: DARK_ALPHA.TUNNEL });
    expect(dark.stamps.length).toBe(rig.lights().length);
    expect(dark.stamps.every((s) => s.erase)).toBe(true);
    expect(cast.stamps.length).toBe(rig.lights().length);
    expect(cast.stamps.some((s) => s.tint === P.amber1)).toBe(true);
    rig.setCar("STANDARD");
    expect(tweens.at(-1)?.darkAlpha).toBe(DARK_ALPHA.STANDARD);
  });
});

describe("12.02 rule 10: contact shadow pool", () => {
  it("widens and fades with height, snapped to the pixel grid", () => {
    expect(shadowPool(0)).toEqual({ w: 64, alpha: 1 });
    expect(shadowPool(150).w).toBe(110);
    expect(shadowPool(150).alpha).toBeCloseTo(0.3, 6);
    expect(shadowPool(75).w).toBeGreaterThan(64);
    expect(shadowPool(75).w).toBeLessThan(110);
    const g = new FakeObject();
    drawShadow(g as unknown as Phaser.GameObjects.Graphics, 301, WORLD.ROOF_Y, 0);
    expect(g.ellipses.length).toBe(3);
    expect(g.ellipses.every((e) => e.x % PIXEL === 0 && e.w % PIXEL === 0)).toBe(true);
    const planted = g.ellipses[0]!.alpha;
    g.clear();
    drawShadow(g as unknown as Phaser.GameObjects.Graphics, 301, WORLD.ROOF_Y, 150);
    expect(g.ellipses[0]!.alpha).toBeLessThan(planted);
    expect(g.ellipses[0]!.w).toBeGreaterThan(64);
  });
});
