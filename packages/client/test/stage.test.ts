import { describe, expect, it } from "vitest";
import type Phaser from "phaser";
import { MAPS, WORLD } from "@midnight/shared";
import { WINDOW_CENTRE, applyTrainCar, createBackgrounds, renderPixelArt, scrollBackgrounds, type Layers } from "../src/game/backgrounds";
import { PIXEL } from "../src/game/pixel";
import { rgba } from "../src/game/sprites/grid";
import { Motion } from "../src/game/stage/motion";
import { P } from "../src/game/palette";

/** Chainable no-op for every Phaser setter we do not care about; the few we read are real fields. */
class FakeObject {
  x = 0;
  y = 0;
  alpha = 1;
  visible = true;
  depth = 0;
  tilePositionX = 0;
  destroyed = false;
  constructor(x = 0, y = 0) {
    this.x = x;
    this.y = y;
    return new Proxy(this, {
      get: (target, prop, receiver) => {
        if (prop in target) return Reflect.get(target, prop, receiver);
        return () => receiver;
      },
    });
  }
  setX(x: number): this { this.x = x; return this; }
  setY(y: number): this { this.y = y; return this; }
  setPosition(x: number, y: number): this { this.x = x; this.y = y; return this; }
  setAlpha(a: number): this { this.alpha = a; return this; }
  setDepth(d: number): this { this.depth = d; return this; }
  setVisible(v: boolean): this { this.visible = v; return this; }
  destroy(): void { this.destroyed = true; }
}

class FakeGraphics extends FakeObject {
  rects: Array<{ x: number; y: number; w: number; h: number; color: number; alpha: number }> = [];
  private color = 0;
  private fillAlpha = 1;
  fillStyle(color: number, alpha = 1): this { this.color = color; this.fillAlpha = alpha; return this; }
  fillRect(x: number, y: number, w: number, h: number): this {
    this.rects.push({ x, y, w, h, color: this.color, alpha: this.fillAlpha });
    return this;
  }
  clear(): this { this.rects = []; return this; }
}

type FakeRect = FakeObject & { fillColor: number };
type TweenConfig = { targets: object; duration?: number; x?: number; alpha?: number; roofSpeed?: number };

function stubScene() {
  const graphics: FakeGraphics[] = [];
  const objects: FakeObject[] = [];
  const rectangles: FakeRect[] = [];
  const tweens: TweenConfig[] = [];
  const textures = new Set<string>();
  /** 13.04: canvas textures made through makePixelTexture, with their declared size and the bytes uploaded. */
  const canvases: Array<{ key: string; w: number; h: number; uploaded: number }> = [];
  const track = <T extends FakeObject>(o: T): T => { objects.push(o); return o; };
  const scene = {
    add: {
      graphics: () => { const g = new FakeGraphics(); graphics.push(g); return track(g); },
      tileSprite: (x: number, y: number) => track(new FakeObject(x, y)),
      image: (x: number, y: number) => track(new FakeObject(x, y)),
      rectangle: (x: number, y: number, _w: number, _h: number, fillColor: number) => {
        const r = Object.assign(new FakeObject(x, y), { fillColor }) as FakeRect;
        rectangles.push(r);
        return track(r);
      },
      circle: (x: number, y: number) => track(new FakeObject(x, y)),
      container: (x: number, y: number) => track(new FakeObject(x, y)),
    },
    make: { graphics: () => new FakeGraphics() },
    textures: {
      exists: (key: string) => textures.has(key),
      createCanvas: (key: string, w: number, h: number) => {
        textures.add(key);
        const entry = { key, w, h, uploaded: 0 };
        canvases.push(entry);
        return {
          setFilter: () => undefined,
          refresh: () => undefined,
          context: {
            createImageData: (iw: number, ih: number) => ({ data: new Uint8ClampedArray(iw * ih * 4), width: iw, height: ih }),
            putImageData: (img: { data: Uint8ClampedArray }) => { entry.uploaded = img.data.length; },
          },
        };
      },
    },
    tweens: { add: (cfg: TweenConfig) => { tweens.push(cfg); return {}; }, killTweensOf: () => undefined },
  };
  // generateTexture is a no-op on the proxy; record keys so a second call does not regenerate.
  const made = scene.make.graphics;
  scene.make.graphics = () => {
    const g = made();
    (g as unknown as { generateTexture: (key: string) => void }).generateTexture = (key) => { textures.add(key); };
    return g;
  };
  return { scene: scene as unknown as Phaser.Scene, graphics, objects, rectangles, tweens, canvases };
}

describe("13.04 roof and body pixel rasters", () => {
  it("the roof and body textures are canvas textures at exactly their TEXTURE_SIZE, uploaded in full", () => {
    const { scene, canvases } = stubScene();
    createBackgrounds(scene);
    const roof = canvases.find((c) => c.key === "bg_train_roof")!;
    const body = canvases.find((c) => c.key === "bg_train_body")!;
    expect([roof.w, roof.h]).toEqual([1920, 130]);
    expect([body.w, body.h]).toEqual([1920, 110]);
    expect(roof.uploaded).toBe(1920 * 130 * 4);
    expect(body.uploaded).toBe(1920 * 110 * 4);
    expect(canvases.map((c) => c.key).sort()).toEqual(["bg_train_body", "bg_train_roof"]);
  });

  it("the rasters are deterministic, art-sized, lip and gutter run the full width, and every window's glass sits on its WINDOW_CENTRE", () => {
    const roof = renderPixelArt("bg_train_roof");
    const again = renderPixelArt("bg_train_roof");
    expect(Array.from(roof.data)).toEqual(Array.from(again.data));
    expect([roof.w, roof.h]).toEqual([1920 / PIXEL, 130 / PIXEL]);
    for (let x = 0; x < roof.w; x++) expect(roof.get(x, 0)).toBe(rgba(P.steel2));
    const body = renderPixelArt("bg_train_body");
    expect([body.w, body.h]).toEqual([1920 / PIXEL, 110 / PIXEL]);
    for (let x = 0; x < body.w; x++) {
      expect(body.get(x, 0)).toBe(0); // roof lip rows stay transparent
      expect(body.get(x, body.h - 1)).toBe(0); // wheel band rows stay transparent
      expect(body.get(x, 15)).toBe(rgba(P.steel2)); // gutter highlight
    }
    const glass = new Set([0xf2a03d, 0xebba46]); // amber glass and its mix; any opaque non-outline, non-body pixel counts
    for (let cx = WINDOW_CENTRE.x; cx < 1920; cx += WINDOW_CENTRE.every) {
      const ax = Math.floor(cx / PIXEL);
      const px = body.get(ax, 24) >>> 8;
      // glass is warm: red channel well above blue
      expect((px >> 16) & 255, `window at world x ${cx}`).toBeGreaterThan(((px & 255) + 60));
    }
    void glass;
  });

  it("the tiles are seamless: every structural row continues across the wrap and a feature at the last column continues at the first", () => {
    const roof = renderPixelArt("bg_train_roof");
    // the wrap must look like any other panel joint: column w−1 matches the column before the seam at 120, column 0 the seam itself
    for (const y of [0, 1, 6, 9, 11, 28, 33]) {
      expect(roof.get(roof.w - 1, y), `row ${y} last column`).toBe(roof.get(119, y));
      expect(roof.get(0, y), `row ${y} first column`).toBe(roof.get(120, y));
    }
    const body = renderPixelArt("bg_train_body");
    for (const y of [15, 16, 18, 31, 34]) {
      expect(body.get(body.w - 1, y), `body row ${y} last column`).toBe(body.get(119, y));
      expect(body.get(0, y), `body row ${y} first column`).toBe(body.get(120, y));
    }
    // a seeded feature (tar, rust) that reaches the last column continues past the wrap: at the seam it meets the
    // seam line (x 0–1), otherwise a non-base pixel at x 2 within the same streak row (visible rows only)
    const base = new Set([rgba(P.steel1), rgba(P.steel0), rgba(P.steel2)]);
    for (let y = 2; y < 15; y++) {
      const last = roof.get(roof.w - 1, y);
      if (base.has(last)) continue;
      expect(roof.get(0, y), `row ${y}: the seam continues`).toBe(rgba(P.steel0));
    }
  });
});

const DT = 1 / 60;
const ROOF = 240;

function step(motion: Motion, seconds: number, speed = ROOF, car: "STANDARD" | "TUNNEL" | "FINAL_CAR" = "STANDARD"): void {
  for (let t = 0; t < seconds; t += DT) motion.update(DT, speed, car);
}

describe("map drawing", () => {
  it("gaps: two masks whose x ranges equal MAPS.gaps, no platforms", () => {
    const { scene } = stubScene();
    const layers = createBackgrounds(scene, "gaps");
    expect(layers.map.spans.gaps).toEqual([{ x0: 300, x1: 380 }, { x0: 580, x1: 660 }]);
    expect(layers.map.spans.platforms).toEqual([]);
    const masks = (layers.map.gaps as unknown as FakeGraphics).rects.filter((r) => r.y === WORLD.ROOF_Y && r.h === WORLD.HEIGHT - WORLD.ROOF_Y);
    expect(masks.map((r) => [r.x, r.x + r.w])).toEqual([[300, 380], [580, 660]]);
  });

  it("platforms: two racks at MAPS.platforms.platforms with the slab top on platform.y", () => {
    const { scene } = stubScene();
    const layers = createBackgrounds(scene, "platforms");
    expect(layers.map.spans.gaps).toEqual([]);
    expect(layers.map.spans.platforms).toEqual(MAPS.platforms.platforms);
    const slabs = (layers.map.platforms as unknown as FakeGraphics).rects.filter((r) => r.h === 12 && r.w === 180);
    expect(slabs.map((r) => [r.x, r.y])).toEqual([[150, 330], [630, 330]]);
  });

  it("chaos: both; roof: neither; setMap switches in place", () => {
    const { scene } = stubScene();
    const layers = createBackgrounds(scene, "chaos");
    expect(layers.map.spans.gaps).toHaveLength(2);
    expect(layers.map.spans.platforms).toHaveLength(2);
    layers.map.setMap("roof");
    expect(layers.map.spans).toEqual({ gaps: [], platforms: [] });
    const plain = createBackgrounds(stubScene().scene);
    expect(plain.map.spans).toEqual({ gaps: [], platforms: [] });
  });
});

describe("Motion", () => {
  it("advances the wheel angle by roofSpeed * dt / 14 rad", () => {
    const { scene } = stubScene();
    const layers = createBackgrounds(scene);
    const motion = layers.motion;
    const before = motion.wheelAngle;
    motion.update(DT, ROOF, "STANDARD");
    expect(motion.wheelAngle - before).toBeCloseTo((ROOF * DT) / 14, 9);
  });

  it("emits a spark in every 0.6 s window at speed, none at roof speed 0", () => {
    const { scene } = stubScene();
    const motion = createBackgrounds(scene).motion;
    step(motion, 12);
    const sparks = motion.timeline().filter((e) => e.kind === "spark").map((e) => e.t);
    expect(sparks.length).toBeGreaterThan(0);
    for (let w = 0; w + 0.6 <= 12; w += 0.3) {
      expect(sparks.some((t) => t >= w && t < w + 0.6), `window ${w}`).toBe(true);
    }
    expect(motion.sparkSpeed).toBe(240);

    const still = createBackgrounds(stubScene().scene).motion;
    step(still, 12, 0);
    expect(still.timeline().filter((e) => e.kind === "spark")).toHaveLength(0);
  });

  it("never strikes lightning in the tunnel, but does outside it", () => {
    const { scene } = stubScene();
    const motion = createBackgrounds(scene).motion;
    step(motion, 60, ROOF, "TUNNEL");
    expect(motion.timeline().filter((e) => e.kind === "lightning")).toHaveLength(0);
    step(motion, 60, ROOF, "STANDARD");
    const strikes = motion.timeline().filter((e) => e.kind === "lightning");
    expect(strikes.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < strikes.length; i++) {
      const gap = strikes[i]!.t - strikes[i - 1]!.t;
      expect(gap).toBeGreaterThanOrEqual(9 - DT);
      expect(gap).toBeLessThanOrEqual(14 + DT);
    }
  });

  it("bobs roof, body, glow and wheels; not sky, stars, moon or clouds", () => {
    const { scene } = stubScene();
    const layers: Layers = createBackgrounds(scene);
    const [sky, stars, cloudsFar, cloudsNear, roof, body] = layers.tiles as unknown as FakeObject[];
    const wheels = layers.motion.wheels as unknown as FakeObject;
    const baseMoonY = layers.moon.y;
    // A quarter of a 1.5 Hz cycle puts sin at its peak: 1 px down.
    for (let t = 0; t < 1 / 6 - 1e-9; t += DT) layers.motion.update(DT, ROOF, "STANDARD");
    expect(roof!.y - WORLD.ROOF_Y).toBeCloseTo(1, 1);
    expect(body!.y - WORLD.ROOF_Y).toBeCloseTo(1, 1);
    expect((layers.glow as unknown as FakeObject).y - WORLD.ROOF_Y).toBeCloseTo(1, 1);
    expect(wheels.y).toBeCloseTo(1, 1);
    expect(sky!.y).toBe(0);
    expect(stars!.y).toBe(0);
    expect(cloudsFar!.y).toBe(60);
    expect(cloudsNear!.y).toBe(150);
    expect(layers.moon.y).toBe(baseMoonY);
  });

  it("keeps the live Graphics count bounded after 60 s and destroys expired particles", () => {
    const { scene, graphics } = stubScene();
    const layers = createBackgrounds(scene);
    for (let t = 0; t < 60; t += DT) scrollBackgrounds(layers, DT);
    const live = graphics.filter((g) => !g.destroyed);
    expect(live.length).toBeLessThanOrEqual(60);
    expect(layers.motion.liveParticles()).toBeLessThanOrEqual(60);
    // Nothing lives forever: after 5 s at speed 0 with no new sparks the sparks are gone, and puffs age out.
    step(layers.motion, 5, 0);
    expect(layers.motion.liveParticles()).toBeLessThanOrEqual(8);
  });

  it("is deterministic: two instances stepped with the same dt sequence share a timeline", () => {
    const a = createBackgrounds(stubScene().scene).motion;
    const b = createBackgrounds(stubScene().scene).motion;
    const dts = [DT, 0.02, DT, 0.033, DT, DT, 0.05];
    for (let i = 0; i < 2400; i++) {
      const dt = dts[i % dts.length]!;
      const car = i % 700 < 350 ? "STANDARD" : "FINAL_CAR";
      a.update(dt, ROOF, car);
      b.update(dt, ROOF, car);
    }
    expect(a.timeline()).toEqual(b.timeline());
    expect(a.timeline().some((e) => e.kind === "lightning")).toBe(true);
    expect(a.timeline().some((e) => e.kind === "spark")).toBe(true);
  });
});

describe("applyTrainCar", () => {
  it("still runs the 4.04 transitions; the tunnel whoosh and exit flash are additive and fire once per entry", () => {
    const { scene, rectangles, tweens } = stubScene();
    const layers = createBackgrounds(scene);
    expect(layers.roofSpeed).toBe(240);
    scrollBackgrounds(layers, DT);
    expect(layers.roofSpeed).toBe(240);

    const sweeps = () => rectangles.filter((r) => r.fillColor === P.night0 && r.x === WORLD.WIDTH);
    const flashes = () => rectangles.filter((r) => r.fillColor === P.moon && r.alpha === 0.1);

    applyTrainCar(scene, layers, "TUNNEL");
    expect(sweeps()).toHaveLength(1);
    const sweepTween = tweens.find((t) => t.targets === sweeps()[0]);
    expect(sweepTween).toMatchObject({ x: 0, duration: 300 });
    // The existing fade still happens: darkness to 0.78, tunnel wall to 1, sky tiles to 0, roof speed tween.
    expect(tweens.find((t) => t.targets === layers.dark)).toMatchObject({ alpha: 0.78, duration: 400 });
    expect(tweens.find((t) => t.targets === layers.tunnel)).toMatchObject({ alpha: 1, duration: 400 });
    expect(tweens.find((t) => t.targets === layers.moon)).toMatchObject({ alpha: 0, duration: 400 });
    expect(tweens.find((t) => t.targets === layers)).toMatchObject({ roofSpeed: 240 });

    // Idempotent: re-applying the tunnel does not sweep again.
    applyTrainCar(scene, layers, "TUNNEL");
    expect(sweeps()).toHaveLength(1);
    expect(flashes()).toHaveLength(0);

    applyTrainCar(scene, layers, "FINAL_CAR");
    expect(flashes()).toHaveLength(1);
    expect(tweens.find((t) => t.targets === flashes()[0])).toMatchObject({ alpha: 0, duration: 120 });
    expect(tweens.filter((t) => t.targets === layers).at(-1)).toMatchObject({ roofSpeed: 180 });
    expect(tweens.filter((t) => t.targets === layers.track).at(-1)).toMatchObject({ alpha: 1 });

    // Standard from the final car: no whoosh, no exit flash.
    applyTrainCar(scene, layers, "STANDARD");
    expect(sweeps()).toHaveLength(1);
    expect(flashes()).toHaveLength(1);
  });
});
