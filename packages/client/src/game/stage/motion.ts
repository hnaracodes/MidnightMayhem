/**
 * 11.02 — Stage motion: wheels and bogies, sparks, engine smoke, telegraph poles, train bob, lightning, moon drift.
 *
 * Every element is Graphics or a generated texture. All randomness comes from one LCG seeded at boot so both
 * laptops draw the same timeline; nothing here reads `Date` or `Math.random`. `scrollBackgrounds` drives
 * `update` once per render frame — do not call it a second time from the scene.
 */
import Phaser from "phaser";
import { WORLD, type TrainCar } from "@midnight/shared";
import { P } from "../palette";
import { BODY_INDEX, Lcg, ROOF_INDEX, type Layers } from "../backgrounds";

export type MotionEvent = { t: number; kind: "spark" | "puff" | "lightning" | "clack"; x: number };

// Undercarriage band: the body texture leaves world rows 500–540 to this layer.
const BAND_TOP = WORLD.HEIGHT - 40;
const WHEEL = { r: 14, cy: BAND_TOP + 18, pairs: [100, 250, 480, 810], gap: 22, spokes: 4 } as const;
const RAIL_Y = WHEEL.cy + WHEEL.r; // 532
const REAR_WHEEL_X = WHEEL.pairs[0] - WHEEL.gap;

const SPARK = { every: 0.4, jitter: 0.15, min: 3, max: 5, vx: 240, life: 0.4, gravity: 600 } as const;
const SMOKE = { every: 0.5, y: 300, r0: 10, r1: 40, alpha: 0.35, life: 4, rise: 12, drift: 0.6, x: WORLD.WIDTH + 40 } as const;
const POLE = { every: 480, speed: 300, w: 4, h: 220, bar: 36, sag: 14 } as const;
const BOB = { hz: 1.5, amp: 1, clackEvery: 6, clackAmp: 2, clackMs: 0.1 } as const;
const LIGHTNING = { min: 9, max: 14, frames: 2, flash: 0.18, bottom: 200, segments: 6 } as const;
const MOON = { period: 40, drift: 6, x: 740 } as const;

const SEED = 0x5747;

/**
 * Draw depths, all between the backgrounds.ts `DEPTH` rows (cloudsNear -15, dark -14, tunnel -13, roof -12,
 * body -10). Literals rather than `DEPTH + x` because this module is evaluated before backgrounds.ts finishes.
 */
const MD = {
  flash: -14.6,   // under the tunnel darkness
  bolt: -14.55,
  poles: -14.5,   // hidden by the tunnel wall
  smoke: -12.5,   // over the tunnel wall, under the roof
  rail: -9.52,
  bogies: -9.51,
  wheels: -9.5,   // body + 0.5
  sparks: -9.45,
} as const;

interface Spark { x: number; y: number; vx: number; vy: number; life: number }
interface Puff { x: number; y: number; age: number; tunnel: boolean; scale: number; speed: number }

type Draw = (g: Phaser.GameObjects.Graphics, w: number, h: number) => void;

function makeTexture(scene: Phaser.Scene, key: string, w: number, h: number, draw: Draw): void {
  if (scene.textures.exists(key)) return;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  draw(g, w, h);
  g.generateTexture(key, w, h);
  g.destroy();
}

/** Rail line and sleepers under the wheels; scrolls at roof speed. */
const drawRail: Draw = (g, w) => {
  const y = RAIL_Y - BAND_TOP;
  g.fillStyle(P.amber2, 0.5);
  for (let x = 0; x < w; x += 40) g.fillRect(x + 10, y + 2, 16, 6);
  g.fillStyle(P.outline, 1);
  g.fillRect(0, y - 1, w, 4);
  g.fillStyle(P.steel2, 1);
  g.fillRect(0, y - 1, w, 2);
};

/** One telegraph pole per 480 px with a sagging wire to the next; tiles seamlessly. */
const drawPoles: Draw = (g, w) => {
  const barY = 12;
  const barHalf = POLE.bar / 2;
  // Wire first so the pole sits in front of it.
  g.lineStyle(1, P.outline, 0.9);
  g.beginPath();
  const x0 = barHalf;
  const x1 = w - barHalf;
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    const x = x0 + (x1 - x0) * t;
    const y = barY + POLE.sag * 4 * t * (1 - t);
    if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
  }
  g.strokePath();
  for (const px of [0, w]) {
    g.fillStyle(P.outline, 1);
    g.fillRect(px - POLE.w / 2, 0, POLE.w, POLE.h);
    g.fillStyle(P.steel0, 1);
    g.fillRect(px - barHalf, barY - 2, POLE.bar, 4);
    g.fillStyle(P.moon, 0.8);
    for (const dx of [-barHalf + 4, 0, barHalf - 6]) g.fillRect(px + dx, barY - 5, 2, 2);
  }
};

/** Dark bogie frames and the wheel discs; the spokes are redrawn per frame on a separate Graphics. */
function drawBogies(g: Phaser.GameObjects.Graphics): void {
  for (const cx of WHEEL.pairs) {
    const x0 = cx - WHEEL.gap - WHEEL.r - 6;
    const x1 = cx + WHEEL.gap + WHEEL.r + 6;
    g.fillStyle(P.outline, 1);
    g.fillRect(x0, BAND_TOP, x1 - x0, 12);
    g.fillStyle(P.steel0, 1);
    g.fillRect(x0 + 2, BAND_TOP + 2, x1 - x0 - 4, 8);
    // Spring boxes above each axle.
    for (const wx of [cx - WHEEL.gap, cx + WHEEL.gap]) {
      g.fillStyle(P.steel2, 1);
      g.fillRect(wx - 6, BAND_TOP + 3, 12, 6);
      g.fillStyle(P.outline, 1);
      g.fillCircle(wx, WHEEL.cy, WHEEL.r + 1.5);
      g.fillStyle(P.steel1, 1);
      g.fillCircle(wx, WHEEL.cy, WHEEL.r);
      g.fillStyle(P.steel0, 1);
      g.fillCircle(wx, WHEEL.cy, WHEEL.r - 4);
    }
  }
}

export class Motion {
  private readonly scene: Phaser.Scene;
  private readonly layers: Layers;
  private readonly rng = new Lcg(SEED);
  private readonly events: MotionEvent[] = [];
  private t = 0;
  private angle = 0;
  private sparkTimer: number = SPARK.every;
  private puffTimer = 0;
  private clackTimer = BOB.clackEvery;
  private clackAge = Infinity;
  private lightningTimer: number;
  private flashFrames = 0;
  /** 13.06: this frame's bob offset in px and whether the joint clack fired this frame (props phase-lock to them). */
  bobOffset = 0;
  lastClack = false;
  private sparks: Spark[] = [];
  private puffs: Puff[] = [];

  readonly rail: Phaser.GameObjects.TileSprite;
  readonly bogies: Phaser.GameObjects.Graphics;
  /** Spokes; also the wheel layer whose `y` carries the bob. */
  readonly wheels: Phaser.GameObjects.Graphics;
  readonly sparkLayer: Phaser.GameObjects.Graphics;
  readonly smoke: Phaser.GameObjects.Graphics;
  readonly poles: Phaser.GameObjects.TileSprite;
  readonly flash: Phaser.GameObjects.Rectangle;
  readonly bolt: Phaser.GameObjects.Graphics;

  /** Spark launch speed screen-left in px/s. */
  readonly sparkSpeed: number = SPARK.vx;

  constructor(scene: Phaser.Scene, layers: Layers) {
    this.scene = scene;
    this.layers = layers;
    makeTexture(scene, "bg_rail", 1920, 40, drawRail);
    makeTexture(scene, "bg_poles", POLE.every, POLE.h + 10, drawPoles);

    this.flash = scene.add.rectangle(0, 0, WORLD.WIDTH, WORLD.ROOF_Y, P.moon, 1).setOrigin(0, 0).setAlpha(0).setDepth(MD.flash);
    this.bolt = scene.add.graphics().setDepth(MD.bolt);
    this.poles = scene.add.tileSprite(0, WORLD.ROOF_Y - POLE.h, WORLD.WIDTH, POLE.h + 10, "bg_poles")
      .setOrigin(0, 0).setDepth(MD.poles);
    this.smoke = scene.add.graphics().setDepth(MD.smoke);
    this.rail = scene.add.tileSprite(0, BAND_TOP, WORLD.WIDTH, 40, "bg_rail").setOrigin(0, 0).setDepth(MD.rail);
    this.bogies = scene.add.graphics().setDepth(MD.bogies);
    drawBogies(this.bogies);
    this.wheels = scene.add.graphics().setDepth(MD.wheels);
    this.sparkLayer = scene.add.graphics().setDepth(MD.sparks);
    this.lightningTimer = this.rng.range(LIGHTNING.min, LIGHTNING.max);
    this.drawSpokes();
  }

  get wheelAngle(): number { return this.angle; }

  /** Spark, puff, lightning and clack events with the motion time they fired at. */
  timeline(): readonly MotionEvent[] { return this.events; }

  liveParticles(): number { return this.sparks.length + this.puffs.length; }

  /** Force a strike now (preview only), held for `frames` updates; consumes the LCG like a timed strike. */
  strike(frames: number = LIGHTNING.frames): void {
    this.lightning();
    this.flashFrames = frames;
  }

  update(dtSec: number, roofSpeed: number, car: TrainCar): void {
    const dt = Math.min(Math.max(dtSec, 0), 0.1);
    this.t += dt;

    // 1. Wheels, rail, poles.
    this.angle += (roofSpeed * dt) / WHEEL.r;
    this.rail.tilePositionX += roofSpeed * dt;
    this.poles.tilePositionX += POLE.speed * dt;
    this.drawSpokes();

    // 2. Sparks from the rear wheel.
    if (roofSpeed > 0) {
      this.sparkTimer -= dt;
      if (this.sparkTimer <= 0) {
        this.sparkTimer = SPARK.every + this.rng.range(-SPARK.jitter, SPARK.jitter);
        const n = SPARK.min + Math.floor(this.rng.range(0, SPARK.max - SPARK.min + 1));
        for (let i = 0; i < n; i++) {
          this.sparks.push({
            x: REAR_WHEEL_X, y: RAIL_Y - 2,
            vx: -SPARK.vx * this.rng.range(0.8, 1.2), vy: this.rng.range(-40, 60), life: SPARK.life,
          });
        }
        this.events.push({ t: this.t, kind: "spark", x: REAR_WHEEL_X });
      }
    }
    this.sparkLayer.clear();
    this.sparks = this.sparks.filter((s) => {
      s.life -= dt;
      if (s.life <= 0) return false;
      s.x += s.vx * dt;
      s.vy += SPARK.gravity * dt;
      s.y += s.vy * dt;
      return s.y < WORLD.HEIGHT + 4;
    });
    for (const s of this.sparks) {
      this.sparkLayer.fillStyle(P.amber1, Math.min(1, s.life / SPARK.life + 0.3));
      this.sparkLayer.fillRect(s.x, s.y, 2, 2);
    }

    // 3. Engine smoke.
    this.puffTimer -= dt;
    if (this.puffTimer <= 0) {
      this.puffTimer += SMOKE.every;
      this.puffs.push({
        x: SMOKE.x, y: SMOKE.y + this.rng.range(-8, 8), age: 0, tunnel: car === "TUNNEL",
        scale: this.rng.range(0.8, 1.25), speed: this.rng.range(0.85, 1.15),
      });
      this.events.push({ t: this.t, kind: "puff", x: SMOKE.x });
    }
    this.smoke.clear();
    this.puffs = this.puffs.filter((p) => {
      p.age += dt;
      if (p.age >= SMOKE.life) return false;
      p.x -= SMOKE.drift * roofSpeed * p.speed * dt;
      p.y -= SMOKE.rise * dt;
      return p.x > -SMOKE.r1;
    });
    for (const p of this.puffs) {
      const k = p.age / SMOKE.life;
      const r = (SMOKE.r0 + (SMOKE.r1 - SMOKE.r0) * k) * p.scale * (p.tunnel ? 0.7 : 1);
      const a = SMOKE.alpha * (1 - k) * (p.tunnel ? 0.6 : 1);
      const color = p.tunnel ? P.night2 : P.steel2;
      // Three soft blobs per puff, stretched along the drift so neighbouring puffs join into one plume.
      this.smoke.fillStyle(color, a * 0.7);
      this.smoke.fillCircle(p.x, p.y, r);
      this.smoke.fillCircle(p.x + 18 + r * 0.5, p.y + r * 0.2, r * 0.8);
      this.smoke.fillStyle(color, a * 0.4);
      this.smoke.fillCircle(p.x + 36 + r * 0.3, p.y - r * 0.3, r * 0.7);
    }

    // 5. Bob and joint clack.
    this.clackTimer -= dt;
    this.lastClack = false;
    if (this.clackTimer <= 0) {
      this.clackTimer += BOB.clackEvery;
      this.clackAge = 0;
      this.lastClack = true;
      this.events.push({ t: this.t, kind: "clack", x: 0 });
    }
    let jolt = 0;
    if (this.clackAge < BOB.clackMs) {
      jolt = BOB.clackAmp * Math.sin((Math.PI * this.clackAge) / BOB.clackMs);
      this.clackAge += dt;
    }
    this.applyBob(Math.sin(this.t * 2 * Math.PI * BOB.hz) * BOB.amp + jolt);

    // 6. Lightning, never in the tunnel.
    if (this.flashFrames > 0) {
      this.flashFrames -= 1;
      if (this.flashFrames === 0) {
        this.flash.setAlpha(0);
        this.bolt.clear();
      }
    }
    if (car !== "TUNNEL") {
      this.lightningTimer -= dt;
      if (this.lightningTimer <= 0) {
        this.lightningTimer += this.rng.range(LIGHTNING.min, LIGHTNING.max);
        this.lightning();
      }
    }

    // 8. Moon drift.
    this.layers.moon.setX(MOON.x + Math.sin((this.t * 2 * Math.PI) / MOON.period) * MOON.drift);
  }

  destroy(): void {
    for (const o of [this.rail, this.bogies, this.wheels, this.sparkLayer, this.smoke, this.poles, this.flash, this.bolt]) o.destroy();
    this.sparks = [];
    this.puffs = [];
  }

  private drawSpokes(): void {
    const g = this.wheels;
    g.clear();
    g.lineStyle(2, P.steel2, 1);
    for (const cx of WHEEL.pairs) {
      for (const wx of [cx - WHEEL.gap, cx + WHEEL.gap]) {
        for (let s = 0; s < WHEEL.spokes; s++) {
          const a = this.angle + (s * Math.PI) / WHEEL.spokes;
          const dx = Math.cos(a) * (WHEEL.r - 4);
          const dy = Math.sin(a) * (WHEEL.r - 4);
          g.lineBetween(wx - dx, WHEEL.cy - dy, wx + dx, WHEEL.cy + dy);
        }
        g.fillStyle(P.outline, 1);
        g.fillCircle(wx, WHEEL.cy, 2.5);
      }
    }
  }

  private applyBob(offset: number): void {
    this.bobOffset = offset;
    const L = this.layers;
    const roof = L.tiles[ROOF_INDEX];
    const body = L.tiles[BODY_INDEX];
    if (roof) roof.setY(WORLD.ROOF_Y + offset);
    if (body) body.setY(WORLD.ROOF_Y + offset);
    L.glow.setY(WORLD.ROOF_Y + offset);
    this.rail.setY(BAND_TOP + offset);
    for (const g of [L.railing, L.lamp, this.bogies, this.wheels, this.sparkLayer]) g.setY(offset);
    L.map.bob(offset); // 13.05: mask, glow, track slices and the pixel-art images
  }

  private lightning(): void {
    const x = this.rng.range(100, WORLD.WIDTH - 100);
    this.events.push({ t: this.t, kind: "lightning", x });
    this.flashFrames = LIGHTNING.frames;
    this.flash.setAlpha(LIGHTNING.flash);
    const g = this.bolt;
    g.clear();
    let px = x;
    let py = 0;
    const step = LIGHTNING.bottom / LIGHTNING.segments;
    const points: Array<[number, number]> = [[px, py]];
    for (let i = 1; i <= LIGHTNING.segments; i++) {
      px += this.rng.range(-28, 28);
      py = i * step;
      points.push([px, py]);
    }
    for (const [width, alpha] of [[6, 0.25], [2, 1]] as const) {
      g.lineStyle(width, P.moon, alpha);
      g.beginPath();
      points.forEach(([bx, by], i) => (i === 0 ? g.moveTo(bx, by) : g.lineTo(bx, by)));
      g.strokePath();
    }
  }
}
