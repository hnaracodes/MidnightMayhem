/**
 * 4.04 — Stage: parallax layers and train states. Spec: design/03-backgrounds-parallax.md.
 *
 * Every layer is a texture generated once at boot from Phaser Graphics (`generateTexture`) and scrolled as a
 * `TileSprite`. Tile widths equal texture widths, so wrapping is seamless by construction. Seeded LCG so the sky
 * is identical on both laptops. No image files anywhere.
 */
import Phaser from "phaser";
import { WORLD, type TrainCar } from "@midnight/shared";
import { P } from "./palette";

// ---------------------------------------------------------------------------------------------------------------
// Table (design/03, verbatim)
// ---------------------------------------------------------------------------------------------------------------

export const PARALLAX = [
  { key: "bg_sky",         speed: 0,   y: 0,   tile: false },
  { key: "bg_stars",       speed: 4,   y: 0,   tile: true  },
  { key: "bg_moon",        speed: 0,   x: 740, y: 110, tile: false },
  { key: "bg_clouds_far",  speed: 14,  y: 60,  tile: true  },
  { key: "bg_clouds_near", speed: 38,  y: 150, tile: true  },
  { key: "bg_train_roof",  speed: 240, y: 430, tile: true  },
  { key: "bg_train_body",  speed: 240, y: 430, tile: true  },
] as const;

type ParallaxKey = (typeof PARALLAX)[number]["key"];

/** Texture sizes from the design/03 table. Overlays not in PARALLAX are listed after the six layers. */
const TEXTURE_SIZE = {
  bg_sky:         [960, 540],
  bg_stars:       [1920, 440],
  bg_moon:        [220, 220],
  bg_clouds_far:  [1920, 300],
  bg_clouds_near: [1920, 260],
  bg_train_roof:  [1920, 130],
  bg_train_body:  [1920, 110],
  bg_window_glow: [1920, 30],
  bg_tunnel_wall: [1920, 440],
  bg_track_trail: [1920, 60],
} as const;

type TextureKey = keyof typeof TEXTURE_SIZE;

/** The six parallax TileSprites, in `Layers.tiles` order (the moon is an Image, not a tile). */
const TILE_ROWS = PARALLAX.filter((row) => row.key !== "bg_moon");
const STARS_INDEX = TILE_ROWS.findIndex((row) => row.key === "bg_stars");
const ROOF_INDEX = TILE_ROWS.findIndex((row) => row.key === "bg_train_roof");
const BODY_INDEX = TILE_ROWS.findIndex((row) => row.key === "bg_train_body");

const STANDARD_ROOF_SPEED = 240;
const FINAL_CAR_ROOF_SPEED = 180;
const TUNNEL_SPEED = 420;
const TRACK_SPEED = 300;
const TRANSITION_MS = 400;
const FLASH_MS = 120;

/** Resting alpha of each tile in the STANDARD car (clouds are drawn opaque and faded as a whole). */
const TILE_ALPHA: Record<ParallaxKey, number> = {
  bg_sky: 1, bg_stars: 1, bg_moon: 1, bg_clouds_far: 0.7, bg_clouds_near: 0.85, bg_train_roof: 1, bg_train_body: 1,
};
const GLOW_ALPHA = 0.3;
const GLOW_ALPHA_TUNNEL = 0.45;
const DARK_ALPHA_TUNNEL = 0.78;
const TINT_ALPHA_FINAL = 0.12;
const FLASH_ALPHA = 0.3;

/** Draw order, back to front. All below 0 so the assembler's shadow (1), rigs (2, 3) and debug (9) sit on top. */
const DEPTH = {
  sky: -20, stars: -19, twinkle: -18, moon: -17, cloudsFar: -16, cloudsNear: -15,
  dark: -14, tunnel: -13, roof: -12, glow: -11, body: -10, track: -9, railing: -8, lamp: -7, tint: -1, flash: 50,
} as const;
const TILE_DEPTH: Record<ParallaxKey, number> = {
  bg_sky: DEPTH.sky, bg_stars: DEPTH.stars, bg_moon: DEPTH.moon, bg_clouds_far: DEPTH.cloudsFar,
  bg_clouds_near: DEPTH.cloudsNear, bg_train_roof: DEPTH.roof, bg_train_body: DEPTH.body,
};

// Roof lip: the roof tile is visible from ROOF_Y down to the carriage gutter; the body tile is transparent above it.
const ROOF_LIP = 30;
const WINDOW = { w: 60, h: 40, every: 120, startX: 30, top: 36 } as const; // top is a body-texture row (world 466)
// Track trail rows above this stay transparent so the final-car ballast starts under the windows (world 508).
const TRACK_TOP = 28;
const RAILING = { x0: 900, x1: 960, top: 380, bottom: 430, post: 20 } as const;
const LAMP = { x: 950, y: 372, r: 6, glow: 15 } as const;

// ---------------------------------------------------------------------------------------------------------------
// Seeded generator
// ---------------------------------------------------------------------------------------------------------------

/** Numerical Recipes LCG; identical sequence on every machine. */
class Lcg {
  private state: number;
  constructor(seed: number) { this.state = seed >>> 0; }
  next(): number {
    this.state = (Math.imul(this.state, 1664525) + 1013904223) >>> 0;
    return this.state / 4294967296;
  }
  range(min: number, max: number): number { return min + this.next() * (max - min); }
}

const SEED = { stars: 0x4d1d, cloudsFar: 0x0c10, cloudsNear: 0x0c11 } as const;

interface Star { x: number; y: number; size: 1 | 2 | 3; halo: boolean; alpha: number }

function starField(): Star[] {
  const rng = new Lcg(SEED.stars);
  const [w] = TEXTURE_SIZE.bg_stars;
  const stars: Star[] = [];
  for (let i = 0; i < 90; i++) {
    const halo = i % 11 === 5; // eight haloed stars, spread through the field
    const x = Math.floor(rng.range(0, w));
    const y = 6 + Math.floor(rng.range(0, 400));
    const size: Star["size"] = halo ? 3 : rng.next() < 0.6 ? 1 : 2;
    const alpha = halo ? 1 : 0.55 + rng.next() * 0.45;
    stars.push({ x, y, size, halo, alpha });
  }
  return stars;
}

/** Indices of the six stars that twinkle in code; none of them is a haloed star. */
const TWINKLE_STARS = [3, 17, 31, 45, 59, 73] as const;

function lerpColor(a: number, b: number, t: number): number {
  const ch = (shift: number): number => {
    const ca = (a >> shift) & 0xff;
    const cb = (b >> shift) & 0xff;
    return Math.round(ca + (cb - ca) * t) & 0xff;
  };
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

// ---------------------------------------------------------------------------------------------------------------
// Texture generators (one per design/03 row)
// ---------------------------------------------------------------------------------------------------------------

type Draw = (g: Phaser.GameObjects.Graphics, w: number, h: number) => void;

function makeTexture(scene: Phaser.Scene, key: TextureKey, draw: Draw): void {
  if (scene.textures.exists(key)) return;
  const [w, h] = TEXTURE_SIZE[key];
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  draw(g, w, h);
  g.generateTexture(key, w, h);
  g.destroy();
}

/** Draw a horizontally wrapping shape: the callback is invoked at x, x - w and x + w so edges tile seamlessly. */
function wrapped(w: number, x: number, draw: (x: number) => void): void {
  draw(x);
  draw(x - w);
  draw(x + w);
}

const drawSky: Draw = (g, w) => {
  const bands = 8;
  const bandH = WORLD.ROOF_Y / bands;
  for (let i = 0; i < bands; i++) {
    g.fillStyle(lerpColor(P.night0, P.night2, i / (bands - 1)), 1);
    g.fillRect(0, Math.round(i * bandH), w, Math.ceil(bandH) + 1);
  }
  g.fillStyle(P.night2, 1);
  g.fillRect(0, WORLD.ROOF_Y, w, TEXTURE_SIZE.bg_sky[1] - WORLD.ROOF_Y);
};

const drawStars: Draw = (g) => {
  for (const s of starField()) {
    if (s.halo) {
      g.fillStyle(P.moon, 0.1);
      g.fillCircle(s.x + 1.5, s.y + 1.5, 9);
      g.fillStyle(P.moon, 0.4);
      g.fillCircle(s.x + 1.5, s.y + 1.5, 5);
    }
    g.fillStyle(P.moon, s.alpha);
    g.fillRect(s.x, s.y, s.size, s.size);
  }
};

const drawMoon: Draw = (g, w, h) => {
  const cx = w / 2;
  const cy = h / 2;
  g.fillStyle(P.moon, 0.05);
  g.fillCircle(cx, cy, 105);
  g.fillStyle(P.moon, 0.12);
  g.fillCircle(cx, cy, 90);
  g.fillStyle(P.moon, 1);
  g.fillCircle(cx, cy, 70);
  g.fillStyle(P.night2, 0.3);
  g.fillCircle(cx - 18, cy - 14, 13);
  g.fillCircle(cx + 18, cy + 16, 9);
};

interface CloudSpec { count: number; seed: number; color: number; yMin: number; yMax: number; wMin: number; wMax: number; hMin: number; hMax: number }

function drawClouds(spec: CloudSpec): Draw {
  return (g, w) => {
    const rng = new Lcg(spec.seed);
    const slot = w / spec.count;
    g.fillStyle(spec.color, 1);
    for (let i = 0; i < spec.count; i++) {
      const cx = slot * (i + 0.5) + rng.range(-slot * 0.3, slot * 0.3);
      const cy = rng.range(spec.yMin, spec.yMax);
      const parts = 3 + Math.floor(rng.range(0, 3)); // 3 to 5 ellipses
      for (let p = 0; p < parts; p++) {
        const ew = rng.range(spec.wMin, spec.wMax);
        const eh = rng.range(spec.hMin, spec.hMax);
        const dx = rng.range(-0.55, 0.55) * ew;
        const dy = rng.range(-0.3, 0.3) * eh;
        wrapped(w, cx + dx, (x) => g.fillEllipse(x, cy + dy, ew, eh));
      }
    }
  };
}

const drawCloudsFar = drawClouds({
  count: 7, seed: SEED.cloudsFar, color: P.night2, yMin: 40, yMax: 200, wMin: 90, wMax: 200, hMin: 24, hMax: 56,
});
// Layer y = 150, so a texture y of about 180 puts the bottom edge near world y = 330.
const drawCloudsNear = drawClouds({
  count: 5, seed: SEED.cloudsNear, color: P.steel0, yMin: 130, yMax: 160, wMin: 200, wMax: 360, hMin: 44, hMax: 80,
});

const drawRoof: Draw = (g, w, h) => {
  g.fillStyle(P.steel1, 1);
  g.fillRect(0, 0, w, h);
  // Moonlit lip along the top edge.
  g.fillStyle(P.steel2, 1);
  g.fillRect(0, 0, w, 2);
  // One raised ridge, 8 px tall at y = 12: highlight on top, shadow below.
  g.fillStyle(P.steel2, 1);
  g.fillRect(0, 12, w, 2);
  g.fillStyle(P.steel0, 1);
  g.fillRect(0, 19, w, 1);
  // Panel seams every 240 px.
  g.fillStyle(P.steel0, 1);
  for (let x = 0; x < w; x += 240) g.fillRect(x, 0, 3, h);
  // Rivet pairs every 60 px, below the ridge.
  g.fillStyle(P.steel2, 1);
  for (let x = 0; x < w; x += 60) {
    g.fillRect(x + 24, 23, 3, 3);
    g.fillRect(x + 32, 23, 3, 3);
  }
};

const drawBody: Draw = (g, w, h) => {
  // Rows above ROOF_LIP stay transparent so the roof lip and its glow strip show through.
  g.fillStyle(P.steel0, 1);
  g.fillRect(0, ROOF_LIP, w, h - ROOF_LIP);
  g.fillStyle(P.steel2, 1);
  g.fillRect(0, ROOF_LIP, w, 3);
  g.fillStyle(P.outline, 1);
  g.fillRect(0, ROOF_LIP + 3, w, 1);
  // Carriage seams line up with the roof seams.
  for (let x = 0; x < w; x += 240) g.fillRect(x, ROOF_LIP, 3, h - ROOF_LIP);
  for (let x = WINDOW.startX; x < w; x += WINDOW.every) {
    g.fillStyle(P.outline, 1);
    g.fillRect(x - 2, WINDOW.top - 2, WINDOW.w + 4, WINDOW.h + 4);
    g.fillStyle(P.amber1, 1);
    g.fillRect(x, WINDOW.top, WINDOW.w, WINDOW.h);
    g.fillStyle(P.moon, 0.3);
    g.fillRect(x, WINDOW.top, WINDOW.w, 14);
    g.fillStyle(P.outline, 1);
    g.fillRect(x + WINDOW.w / 2 - 1, WINDOW.top, 2, WINDOW.h);
  }
};

/**
 * Amber spill from the windows onto the roof lip: a full-width vertical gradient, transparent at the roof edge and
 * strongest right above the carriage. The TileSprite alpha sets its strength (30 %, 45 % in the tunnel).
 */
const drawWindowGlow: Draw = (g, w, h) => {
  for (let row = 0; row < h; row++) {
    const t = (row + 1) / h;
    g.fillStyle(P.amber1, t * t);
    g.fillRect(0, row, w, 1);
  }
};

const drawTunnelWall: Draw = (g, w, h) => {
  g.fillStyle(P.night0, 1);
  g.fillRect(0, 0, w, h);
  const rowH = 24;
  const brickW = 60;
  g.fillStyle(P.steel0, 0.55);
  for (let row = 0; row * rowH < h; row++) {
    const offset = row % 2 === 0 ? 0 : brickW / 2;
    for (let x = -brickW + offset; x < w; x += brickW) {
      g.fillRect(x + 1, row * rowH + 1, brickW - 1, rowH - 1);
    }
  }
  for (let x = 160; x < w; x += 320) {
    const y = 150;
    g.fillStyle(P.amber1, 0.08);
    g.fillCircle(x, y, 60);
    g.fillStyle(P.amber1, 0.25);
    g.fillCircle(x, y, 20);
    g.fillStyle(P.steel2, 1);
    g.fillRect(x - 2, y - 18, 4, 12);
    g.fillStyle(P.amber1, 1);
    g.fillCircle(x, y, 6);
    g.fillStyle(P.moon, 0.7);
    g.fillCircle(x - 1.5, y - 1.5, 2);
  }
};

const drawTrackTrail: Draw = (g, w, h) => {
  // Rows above TRACK_TOP stay transparent so the carriage windows show; the ballast bed starts under them.
  g.fillStyle(P.outline, 1);
  g.fillRect(0, TRACK_TOP, w, h - TRACK_TOP);
  g.fillStyle(P.steel0, 0.7);
  g.fillRect(0, TRACK_TOP + 2, w, h - TRACK_TOP - 2);
  // Sleepers every 40 px.
  g.fillStyle(P.amber2, 0.55);
  for (let x = 0; x < w; x += 40) g.fillRect(x + 12, TRACK_TOP + 6, 14, h - TRACK_TOP - 8);
  // Two rails converging slightly: the far one a touch thinner and darker so the pair reads as receding.
  const nearY = TRACK_TOP + 24;
  const farY = TRACK_TOP + 9;
  g.fillStyle(P.outline, 1);
  g.fillRect(0, farY + 2, w, 2);
  g.fillRect(0, nearY + 3, w, 2);
  g.fillStyle(P.steel2, 0.75);
  g.fillRect(0, farY, w, 2);
  g.fillStyle(P.steel2, 1);
  g.fillRect(0, nearY, w, 3);
};

const GENERATORS: Record<TextureKey, Draw> = {
  bg_sky: drawSky,
  bg_stars: drawStars,
  bg_moon: drawMoon,
  bg_clouds_far: drawCloudsFar,
  bg_clouds_near: drawCloudsNear,
  bg_train_roof: drawRoof,
  bg_train_body: drawBody,
  bg_window_glow: drawWindowGlow,
  bg_tunnel_wall: drawTunnelWall,
  bg_track_trail: drawTrackTrail,
};

/** Creates every stage texture once from the seeded generators. Safe to call again; existing keys are kept. */
export function generateTextures(scene: Phaser.Scene): void {
  for (const key of Object.keys(GENERATORS) as TextureKey[]) makeTexture(scene, key, GENERATORS[key]);
}

// ---------------------------------------------------------------------------------------------------------------
// Layers
// ---------------------------------------------------------------------------------------------------------------

export interface Layers {
  /** The six parallax TileSprites in draw order: sky, stars, clouds far, clouds near, roof, body. */
  tiles: Phaser.GameObjects.TileSprite[];
  /** Tunnel brick wall, alpha 0 outside the tunnel. */
  tunnel: Phaser.GameObjects.TileSprite;
  /** Track trail under the last car, alpha 0 outside the final car. */
  track: Phaser.GameObjects.TileSprite;
  /** `night0` darkness over the sky layers, 78 % in the tunnel. */
  dark: Phaser.GameObjects.Rectangle;
  /** `danger` tint over every layer, 12 % in the final car. */
  tint: Phaser.GameObjects.Rectangle;
  moon: Phaser.GameObjects.Image;
  /** Amber window spill on the roof lip; scrolls with the body. */
  glow: Phaser.GameObjects.TileSprite;
  railing: Phaser.GameObjects.Graphics;
  lamp: Phaser.GameObjects.Graphics;
  /** Current roof and body scroll speed in px/s (240, or 180 in the final car). Rigs use it as wind speed. */
  roofSpeed: number;
}

/** Per-Layers state that is not part of the contract. */
interface Extras {
  twinkle: Phaser.GameObjects.Container;
  /** The six twinkling dots with the texture x of the star each one sits on. */
  dots: { dot: Phaser.GameObjects.Arc; starX: number }[];
  car: TrainCar;
}
const extras = new WeakMap<Layers, Extras>();

function drawRailing(g: Phaser.GameObjects.Graphics): void {
  const { x0, x1, top, bottom, post } = RAILING;
  const w = x1 - x0;
  for (const y of [top + 4, top + 26]) {
    g.fillStyle(P.outline, 1);
    g.fillRect(x0, y - 1, w, 6);
    g.fillStyle(P.steel2, 1);
    g.fillRect(x0, y, w, 4);
  }
  for (let x = x0; x <= x1 - 4; x += post) {
    g.fillStyle(P.outline, 1);
    g.fillRect(x - 1, top - 1, 6, bottom - top + 1);
    g.fillStyle(P.steel2, 1);
    g.fillRect(x, top, 4, bottom - top);
    g.fillStyle(P.steel1, 1);
    g.fillRect(x + 2, top + 2, 2, bottom - top - 2);
  }
}

function drawLamp(g: Phaser.GameObjects.Graphics): void {
  g.fillStyle(P.steel2, 1);
  g.fillRect(LAMP.x - 2, LAMP.y, 4, RAILING.top - LAMP.y + 2);
  g.fillStyle(P.danger, 0.08);
  g.fillCircle(LAMP.x, LAMP.y, LAMP.glow * 2);
  g.fillStyle(P.danger, 0.2);
  g.fillCircle(LAMP.x, LAMP.y, LAMP.glow);
  g.fillStyle(P.outline, 1);
  g.fillCircle(LAMP.x, LAMP.y, LAMP.r + 1.5);
  g.fillStyle(P.danger, 1);
  g.fillCircle(LAMP.x, LAMP.y, LAMP.r);
  g.fillStyle(P.white, 0.8);
  g.fillCircle(LAMP.x - 2, LAMP.y - 2, 1.5);
}

/** Builds the stage in the STANDARD car state. Generates textures first if the scene has not done so. */
export function createBackgrounds(scene: Phaser.Scene): Layers {
  generateTextures(scene);
  const W = WORLD.WIDTH;
  const H = WORLD.HEIGHT;

  const tiles = TILE_ROWS.map((row) => {
    const [, h] = TEXTURE_SIZE[row.key];
    return scene.add.tileSprite(0, row.y, W, h, row.key)
      .setOrigin(0, 0)
      .setAlpha(TILE_ALPHA[row.key])
      .setDepth(TILE_DEPTH[row.key]);
  });

  const moonRow = PARALLAX[2];
  const moon = scene.add.image(moonRow.x, moonRow.y, "bg_moon").setDepth(DEPTH.moon);

  const twinkle = scene.add.container(0, 0).setDepth(DEPTH.twinkle);
  const stars = starField();
  const dots: Extras["dots"] = [];
  TWINKLE_STARS.forEach((index, i) => {
    const s = stars[index];
    if (!s) return;
    const dot = scene.add.circle(s.x + 1, s.y + 1, 1.6, P.moon, 1);
    twinkle.add(dot);
    dots.push({ dot, starX: s.x + 1 });
    scene.tweens.add({
      targets: dot, alpha: { from: 1, to: 0.15 }, duration: 700 + i * 160, yoyo: true, repeat: -1,
      ease: "Sine.easeInOut", delay: i * 230,
    });
  });

  const dark = scene.add.rectangle(0, 0, W, H, P.night0, 1).setOrigin(0, 0).setAlpha(0).setDepth(DEPTH.dark);
  const tunnel = scene.add.tileSprite(0, 0, W, TEXTURE_SIZE.bg_tunnel_wall[1], "bg_tunnel_wall")
    .setOrigin(0, 0).setAlpha(0).setDepth(DEPTH.tunnel);
  const glow = scene.add.tileSprite(0, WORLD.ROOF_Y, W, TEXTURE_SIZE.bg_window_glow[1], "bg_window_glow")
    .setOrigin(0, 0).setAlpha(GLOW_ALPHA).setDepth(DEPTH.glow);
  const track = scene.add.tileSprite(0, H - TEXTURE_SIZE.bg_track_trail[1], W, TEXTURE_SIZE.bg_track_trail[1], "bg_track_trail")
    .setOrigin(0, 0).setAlpha(0).setDepth(DEPTH.track);

  const railing = scene.add.graphics().setDepth(DEPTH.railing).setAlpha(0).setVisible(false);
  drawRailing(railing);
  const lamp = scene.add.graphics().setDepth(DEPTH.lamp).setAlpha(0).setVisible(false);
  drawLamp(lamp);

  const tint = scene.add.rectangle(0, 0, W, H, P.danger, 1).setOrigin(0, 0).setAlpha(0).setDepth(DEPTH.tint);

  const layers: Layers = { tiles, tunnel, track, dark, tint, moon, glow, railing, lamp, roofSpeed: STANDARD_ROOF_SPEED };
  extras.set(layers, { twinkle, dots, car: "STANDARD" });
  placeTwinkle(layers, dots);
  return layers;
}

/** Keeps each twinkle dot on its star as the star tile wraps: same texture x, offset by the tile scroll. */
function placeTwinkle(layers: Layers, dots: Extras["dots"]): void {
  const stars = layers.tiles[STARS_INDEX];
  if (!stars) return;
  const period = TEXTURE_SIZE.bg_stars[0];
  const offset = stars.tilePositionX % period;
  for (const { dot, starX } of dots) {
    const x = (((starX - offset) % period) + period) % period;
    dot.setX(x);
    dot.setVisible(x < WORLD.WIDTH);
  }
}

/** Advances every scrolling layer screen-left. Call once per render frame with the frame delta in seconds. */
export function scrollBackgrounds(layers: Layers, dtSec: number): void {
  const dt = Math.min(Math.max(dtSec, 0), 0.1);
  layers.tiles.forEach((tile, i) => {
    const row = TILE_ROWS[i];
    if (!row) return;
    const speed = i === ROOF_INDEX || i === BODY_INDEX ? layers.roofSpeed : row.speed;
    if (speed !== 0) tile.tilePositionX += speed * dt;
  });
  layers.glow.tilePositionX += layers.roofSpeed * dt;
  layers.tunnel.tilePositionX += TUNNEL_SPEED * dt;
  layers.track.tilePositionX += TRACK_SPEED * dt;
  const ex = extras.get(layers);
  if (ex) placeTwinkle(layers, ex.dots);
}

/**
 * Cross-fades the stage to a train car over 400 ms. Idempotent: running tweens on the same targets are killed
 * first, so it is safe to call again before an earlier transition has finished.
 */
export function applyTrainCar(scene: Phaser.Scene, layers: Layers, car: TrainCar): void {
  const ex = extras.get(layers);
  const twinkle = ex?.twinkle;
  const previous = ex?.car ?? "STANDARD";
  if (ex) ex.car = car;

  const targets: object[] = [
    ...layers.tiles, layers.tunnel, layers.track, layers.dark, layers.tint, layers.moon, layers.glow,
    layers.railing, layers.lamp, layers,
  ];
  if (twinkle) targets.push(twinkle);
  scene.tweens.killTweensOf(targets);

  const tunnel = car === "TUNNEL";
  const finalCar = car === "FINAL_CAR";
  const sky = tunnel ? 0 : 1;
  const fade = (target: object, alpha: number, onComplete?: () => void): void => {
    scene.tweens.add({ targets: target, alpha, duration: TRANSITION_MS, ease: "Sine.easeInOut", ...(onComplete ? { onComplete } : {}) });
  };

  layers.tiles.forEach((tile, i) => {
    const row = TILE_ROWS[i];
    if (!row || row.key === "bg_sky" || row.key === "bg_train_roof" || row.key === "bg_train_body") return;
    fade(tile, sky * TILE_ALPHA[row.key]);
  });
  fade(layers.moon, sky);
  if (twinkle) fade(twinkle, sky);
  fade(layers.dark, tunnel ? DARK_ALPHA_TUNNEL : 0);
  fade(layers.tunnel, tunnel ? 1 : 0);
  fade(layers.glow, tunnel ? GLOW_ALPHA_TUNNEL : GLOW_ALPHA);
  fade(layers.track, finalCar ? 1 : 0);
  fade(layers.tint, finalCar ? TINT_ALPHA_FINAL : 0);

  scene.tweens.add({
    targets: layers, roofSpeed: finalCar ? FINAL_CAR_ROOF_SPEED : STANDARD_ROOF_SPEED,
    duration: TRANSITION_MS, ease: "Sine.easeInOut",
  });

  if (finalCar) {
    layers.railing.setVisible(true);
    layers.lamp.setVisible(true);
    fade(layers.railing, 1);
    // Fade in, then pulse at 1 Hz.
    scene.tweens.add({
      targets: layers.lamp, alpha: 1, duration: TRANSITION_MS, ease: "Sine.easeInOut",
      onComplete: () => {
        scene.tweens.add({ targets: layers.lamp, alpha: 0.4, duration: 500, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
      },
    });
    if (previous !== "FINAL_CAR") {
      const flash = scene.add.rectangle(0, 0, WORLD.WIDTH, WORLD.HEIGHT, P.white, 1)
        .setOrigin(0, 0).setAlpha(FLASH_ALPHA).setDepth(DEPTH.flash);
      scene.tweens.add({ targets: flash, alpha: 0, duration: FLASH_MS, onComplete: () => flash.destroy() });
    }
  } else {
    fade(layers.railing, 0, () => layers.railing.setVisible(false));
    fade(layers.lamp, 0, () => layers.lamp.setVisible(false));
  }
}
