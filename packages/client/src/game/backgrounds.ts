/**
 * 4.04 — Stage: parallax layers and train states. Spec: design/03-backgrounds-parallax.md.
 *
 * Every layer is a texture generated once at boot from Phaser Graphics (`generateTexture`) and scrolled as a
 * `TileSprite`. Tile widths equal texture widths, so wrapping is seamless by construction. Seeded LCG so the sky
 * is identical on both laptops. No image files anywhere.
 */
import Phaser from "phaser";
import { WORLD, type MapId, type TrainCar } from "@midnight/shared";
import { P } from "./palette";
import { PIXEL } from "./pixel";
import { PixelCanvas, mix as mixRgb, rgba } from "./sprites/grid";
import { Motion } from "./stage/motion";
import { createMapLayer, type MapLayer } from "./stage/mapDraw";

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
  bg_roof_lamps:  [1920, 60],
  bg_haze:        [64, 120],
  bg_foreground:  [1920, 540],
} as const;

type TextureKey = keyof typeof TEXTURE_SIZE;

/** The six parallax TileSprites, in `Layers.tiles` order (the moon is an Image, not a tile). */
const TILE_ROWS = PARALLAX.filter((row) => row.key !== "bg_moon");
const STARS_INDEX = TILE_ROWS.findIndex((row) => row.key === "bg_stars");
export const ROOF_INDEX = TILE_ROWS.findIndex((row) => row.key === "bg_train_roof");
export const BODY_INDEX = TILE_ROWS.findIndex((row) => row.key === "bg_train_body");

const STANDARD_ROOF_SPEED = 240;
const FINAL_CAR_ROOF_SPEED = 180;
const TUNNEL_SPEED = 420;
const TRACK_SPEED = 300;
const TRANSITION_MS = 400;
const FLASH_MS = 120;
const WHOOSH_MS = 300;
const EXIT_FLASH_ALPHA = 0.1;

/** Resting alpha of each tile in the STANDARD car (clouds are drawn opaque and faded as a whole). */
const TILE_ALPHA: Record<ParallaxKey, number> = {
  bg_sky: 1, bg_stars: 1, bg_moon: 1, bg_clouds_far: 0.7, bg_clouds_near: 0.85, bg_train_roof: 1, bg_train_body: 1,
};
const GLOW_ALPHA = 0.3;
const GLOW_ALPHA_TUNNEL = 0.45;
const DARK_ALPHA_TUNNEL = 0.78;
/** 12.02: the final-car red wash is retired (0); the tail lamp is a real light in stage/lighting.ts. */
const TINT_ALPHA_FINAL = 0;
const FLASH_ALPHA = 0.3;

/**
 * Draw order, back to front. All below 0 so the assembler's shadow (1), rigs (2, 3) and debug (9) sit on top.
 * The 11.02 motion and map layers sit between these (poles -14.5, smoke -12.5, wheels -9.5, gaps -9.3, racks -6);
 * the final-car track trail moved under the wheels so the bogies stay visible on the last car.
 */
export const DEPTH = {
  sky: -20, stars: -19, twinkle: -18, moon: -17, cloudsFar: -16, cloudsNear: -15,
  dark: -14, hazeFar: -15.5, hazeNear: -12.6, tunnel: -13, roofLamps: -12.2, roof: -12, foreground: 0.3, glow: -11, body: -10, track: -9.7, railing: -8, lamp: -7, tint: -1, flash: 50,
} as const;
const TILE_DEPTH: Record<ParallaxKey, number> = {
  bg_sky: DEPTH.sky, bg_stars: DEPTH.stars, bg_moon: DEPTH.moon, bg_clouds_far: DEPTH.cloudsFar,
  bg_clouds_near: DEPTH.cloudsNear, bg_train_roof: DEPTH.roof, bg_train_body: DEPTH.body,
};

// Roof lip: the roof tile is visible from ROOF_Y down to the carriage gutter; the body tile is transparent above it.
const ROOF_LIP = 30;
// The bottom 40 px of the body texture stay transparent for the 11.02 wheel band (world 500–540).
const WHEEL_BAND = 40;
const WINDOW = { w: 60, h: 32, every: 120, startX: 30, top: 36 } as const; // top is a body-texture row (world 466)
// Track trail rows above this stay transparent so the final-car ballast starts under the windows (world 508).
const TRACK_TOP = 28;
const RAILING = { x0: 900, x1: 960, top: 380, bottom: 430, post: 20 } as const;
const LAMP = { x: 950, y: 372, r: 6, glow: 15 } as const;
/** 12.02: window centres in body-texture x (windows every 120 px from x 30, 60 wide) for the spill pools. */
export const WINDOW_CENTRE = { x: WINDOW.startX + WINDOW.w / 2, every: WINDOW.every } as const;
/** 12.02: two roof lamps per roof tile (960 apart, so one is always on screen), in roof-texture x, heads above the roof. */
export const ROOF_LAMPS: readonly { x: number; y: number }[] = [{ x: 300, y: WORLD.ROOF_Y - 46 }, { x: 1260, y: WORLD.ROOF_Y - 46 }];
export const ROOF_LAMP_PERIOD = 1920;
const ROOF_LAMP_H = 60;
/** 12.02: the tunnel wall lamps of `drawTunnelWall`, in tunnel-texture x. */
export const TUNNEL_LAMP = { x: 160, y: 150, every: 320 } as const;

// ---------------------------------------------------------------------------------------------------------------
// Seeded generator
// ---------------------------------------------------------------------------------------------------------------

/** Numerical Recipes LCG; identical sequence on every machine. Shared with stage/motion.ts. */
export class Lcg {
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

export function makeTexture(scene: Phaser.Scene, key: TextureKey | string, draw: Draw, width?: number, height?: number): void {
  if (scene.textures.exists(key)) return;
  const size = (TEXTURE_SIZE as Record<string, readonly [number, number] | undefined>)[key];
  const w = width ?? size?.[0] ?? 0;
  const h = height ?? size?.[1] ?? 0;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  draw(g, w, h);
  g.generateTexture(key, w, h);
  g.destroy();
}

export { makePixelTexture, type PixelDraw } from "./pixelTexture";
import { makePixelTexture, type PixelDraw } from "./pixelTexture";

/** Draw a horizontally wrapping shape: the callback is invoked at x, x - w and x + w so edges tile seamlessly. */
function wrapped(w: number, x: number, draw: (x: number) => void): void {
  draw(x);
  draw(x - w);
  draw(x + w);
}

// 12.02 contrast pass: the far sky runs from void0 to a hazed night2, so distance reads as air, not paint.
const SKY_BOTTOM = lerpColor(P.night2, P.haze, 0.45);
const drawSky: Draw = (g, w) => {
  const bands = 12;
  const bandH = WORLD.ROOF_Y / bands;
  for (let i = 0; i < bands; i++) {
    g.fillStyle(lerpColor(P.void0, SKY_BOTTOM, i / (bands - 1)), 1);
    g.fillRect(0, Math.round(i * bandH), w, Math.ceil(bandH) + 1);
  }
  g.fillStyle(SKY_BOTTOM, 1);
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
    g.fillStyle(P.moon, s.alpha * 0.8); // 12.02: stars sit behind haze
    g.fillRect(s.x, s.y, s.size, s.size);
  }
};

const drawMoon: Draw = (g, w, h) => {
  const cx = w / 2;
  const cy = h / 2;
  // 12.02: the moon is a source, not the brightest thing on screen — its disc leans toward haze and the halo is cold
  g.fillStyle(P.glow1, 0.04);
  g.fillCircle(cx, cy, 105);
  g.fillStyle(P.glow1, 0.08);
  g.fillCircle(cx, cy, 90);
  g.fillStyle(lerpColor(P.moon, P.haze, 0.22), 1);
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

// 12.02: far clouds are 60 % toward haze (lower contrast against the hazed sky), near clouds 30 %.
const drawCloudsFar = drawClouds({
  count: 7, seed: SEED.cloudsFar, color: lerpColor(P.night2, P.haze, 0.6), yMin: 40, yMax: 200, wMin: 90, wMax: 200, hMin: 24, hMax: 56,
});
// Layer y = 150, so a texture y of about 180 puts the bottom edge near world y = 330.
const drawCloudsNear = drawClouds({
  count: 5, seed: SEED.cloudsNear, color: lerpColor(P.steel0, P.haze, 0.3), yMin: 130, yMax: 160, wMin: 200, wMax: 360, hMin: 44, hMax: 80,
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

const drawBody: Draw = (g, w, fullH) => {
  // Rows above ROOF_LIP stay transparent so the roof lip and its glow strip show through; rows below h belong
  // to the wheels.
  const h = fullH - WHEEL_BAND;
  g.fillStyle(lerpColor(P.steel0, P.void0, 0.25), 1); // 12.02: the near carriage falls toward the void
  g.fillRect(0, ROOF_LIP, w, h - ROOF_LIP);
  g.fillStyle(P.outline, 1);
  g.fillRect(0, h - 2, w, 2);
  g.fillStyle(P.steel2, 1);
  g.fillRect(0, ROOF_LIP, w, 3);
  g.fillStyle(P.outline, 1);
  g.fillRect(0, ROOF_LIP + 3, w, 1);
  // Carriage seams line up with the roof seams.
  for (let x = 0; x < w; x += 240) g.fillRect(x, ROOF_LIP, 3, h - ROOF_LIP);
  for (let x = WINDOW.startX; x < w; x += WINDOW.every) {
    g.fillStyle(P.outline, 1);
    g.fillRect(x - 2, WINDOW.top - 2, WINDOW.w + 4, WINDOW.h + 4);
    g.fillStyle(lerpColor(P.amber1, P.amber2, 0.15), 1); // 12.02: glass a touch darker than the pool it casts
    g.fillRect(x, WINDOW.top, WINDOW.w, WINDOW.h);
    g.fillStyle(P.moon, 0.2);
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

/**
 * 12.02: roof lamp fixtures at `ROOF_LAMPS` — a steel bracket rising from the roof line with a `lamp` head and a
 * white specular, so every pool of warm light on the roof has a thing casting it. Scrolls with the roof.
 */
const drawRoofLamps: Draw = (g, _w, h) => {
  for (const { x } of ROOF_LAMPS) {
    const top = 6;
    g.fillStyle(P.outline, 1);
    g.fillRect(x - 4, top + 6, 8, h - top - 6);
    g.fillStyle(P.steel1, 1);
    g.fillRect(x - 2, top + 8, 4, h - top - 8);
    g.fillStyle(P.steel2, 1);
    g.fillRect(x - 1, top + 8, 1, h - top - 8);
    // hood
    g.fillStyle(P.outline, 1);
    g.fillRect(x - 11, top, 22, 9);
    g.fillStyle(P.steel1, 1);
    g.fillRect(x - 9, top + 2, 18, 5);
    // head
    g.fillStyle(P.lamp, 0.18);
    g.fillCircle(x, top + 11, 16);
    g.fillStyle(P.outline, 1);
    g.fillCircle(x, top + 11, 7);
    g.fillStyle(P.lamp, 1);
    g.fillCircle(x, top + 11, 5);
    g.fillStyle(P.white, 0.9);
    g.fillCircle(x - 1.5, top + 9.5, 1.8);
  }
};

/** 12.03 rule 1: a vertical strip, `haze` fading to transparent downward; stretched across the screen as an Image. */
const drawHaze: Draw = (g, w, h) => {
  for (let row = 0; row < h; row++) {
    const t = 1 - row / h;
    g.fillStyle(P.haze, t * t);
    g.fillRect(0, row, w, 1);
  }
};

/** 12.03 rule 1 alpha per car for the two haze strips (open / tunnel). */
export const HAZE_ALPHA = { far: 0.35, near: 0.25 } as const;
export const FOREGROUND_SPEED = 1.4;
const FOREGROUND_SEED = 0xf06e;
/** The fighter band the foreground never crosses (rule 2). */
const FOREGROUND_BAND = { top: 100, bottom: WORLD.ROOF_Y + 40 } as const;

/**
 * 12.03 rule 2: near-camera silhouettes in `void0` — catenary cable sags across the top and pole stubs / a railing
 * edge along the bottom — seeded, transparent through the fighter band, scrolled faster than the roof.
 */
const drawForeground: Draw = (g, w, h) => {
  const rng = new Lcg(FOREGROUND_SEED);
  g.fillStyle(P.void0, 1);
  // cables: three sagging spans per 480 px, 3 px thick, hanging 12–30 px into the top band
  const span = 480;
  for (let x0 = 0; x0 < w; x0 += span) {
    const sag = rng.range(12, 30);
    const y0 = rng.range(6, 22);
    for (let x = 0; x <= span; x += 3) {
      const t = x / span;
      const y = y0 + sag * 4 * t * (1 - t);
      if (y + 3 < FOREGROUND_BAND.top) g.fillRect(x0 + x, Math.round(y), 3, 3);
    }
    // a hanger at the span's start
    g.fillRect(x0, 0, 3, Math.round(y0));
  }
  // bottom: a railing rail along the very bottom with posts every 160 px, and pole stubs
  const railY = h - 14;
  g.fillRect(0, railY, w, 4);
  for (let x = 0; x < w; x += 160) {
    const post = rng.range(20, 36);
    const y = h - post;
    if (y > FOREGROUND_BAND.bottom) g.fillRect(x, y, 6, post);
    else g.fillRect(x, FOREGROUND_BAND.bottom + 1, 6, h - FOREGROUND_BAND.bottom - 1);
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

// ---------------------------------------------------------------------------------------------------------------
// 13.04 — pixel-art generators (art px = world px / PIXEL). Every x goes through `wrap`, so the tiles are seamless.
// ---------------------------------------------------------------------------------------------------------------

const ART_SEED = 0xa47;
/** 2×2 Bayer threshold at a pixel, 0.125 .. 0.875. */
const bayer = (x: number, y: number): number => [0.125, 0.625, 0.875, 0.375][(x & 1) + 2 * (y & 1)]!;

/** Pixel painter over a `PixelCanvas` that wraps x into the tile and dithers between two colours by a weight. */
class Painter {
  constructor(private readonly c: PixelCanvas, readonly w: number, readonly h: number) {}
  wrap(x: number): number { return ((Math.round(x) % this.w) + this.w) % this.w; }
  px(x: number, y: number, color: number): void {
    if (y < 0 || y >= this.h) return;
    this.c.set(this.wrap(x), Math.round(y), rgba(color));
  }
  /** Paints `b` where the dither says so (weight 0..1 of `b`), else `a`. */
  dither(x: number, y: number, a: number, b: number, t: number): void {
    this.px(x, y, t > bayer(this.wrap(x), y) ? b : a);
  }
  rect(x0: number, y0: number, w: number, h: number, color: number): void {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) this.px(x, y, color);
  }
  get(x: number, y: number): number { return this.c.get(this.wrap(x), y); }
}

/** Only art rows 0–14 of the roof show above the body layer (ROOF_LIP), so every feature lives in that band. */
const ROOF_ART = {
  seamEvery: 120, rivetEvery: 30, ridgeY: 6, visible: ROOF_LIP / PIXEL, tarPatches: 8, rustStreaks: 16,
} as const;
const BODY_ART = {
  top: ROOF_LIP / PIXEL, bottom: (110 - WHEEL_BAND) / PIXEL, seamEvery: 120, winEvery: WINDOW.every / PIXEL,
  winX: WINDOW.startX / PIXEL, winW: WINDOW.w / PIXEL, glassTop: 18, glassBottom: 31, rivetRows: [18, 31],
} as const;

/** 3 × 5 stencil digits for the car numbers (rows top to bottom, 1 = ink). */
const STENCIL: Record<string, readonly string[]> = {
  "0": ["111", "101", "101", "101", "111"], "1": ["010", "110", "010", "010", "111"], "2": ["111", "001", "111", "100", "111"],
  "3": ["111", "001", "111", "001", "111"], "4": ["101", "101", "111", "001", "001"], "5": ["111", "100", "111", "001", "111"],
  "6": ["111", "100", "111", "101", "111"], "7": ["111", "001", "010", "010", "010"], "8": ["111", "101", "111", "101", "111"],
  "9": ["111", "101", "111", "001", "111"],
};

/** 13.04 rule 1: the carriage roof. */
const drawRoofPx: PixelDraw = (c, w, h) => {
  const p = new Painter(c, w, h);
  const rng = new Lcg(ART_SEED);
  const base = P.steel1;
  const dark = P.steel0;
  const lit = P.steel2;
  const grime = mixRgb(P.steel0, P.void0, 0.35);
  // base plate with a dithered fall-off toward the gutter (rows past `visible` sit under the body layer)
  for (let y = 0; y < h; y++) {
    const t = Math.max(0, (y - 11) / (ROOF_ART.visible - 11)) * 0.5 + Math.max(0, (y - ROOF_ART.visible) / (h - ROOF_ART.visible)) * 0.5;
    for (let x = 0; x < w; x++) p.dither(x, y, base, dark, Math.min(0.85, t));
  }
  // moonlit lip and the raised ridge
  p.rect(0, 0, w, 1, lit);
  for (let x = 0; x < w; x++) p.dither(x, 1, base, lit, 0.35);
  p.rect(0, ROOF_ART.ridgeY, w, 1, lit);
  for (let x = 0; x < w; x++) p.dither(x, ROOF_ART.ridgeY + 1, base, lit, 0.3);
  p.rect(0, ROOF_ART.ridgeY + 3, w, 1, dark);
  for (let x = 0; x < w; x++) p.dither(x, ROOF_ART.ridgeY + 4, base, dark, 0.5);
  // rivet pairs under the lip and under the ridge
  for (let x = 0; x < w; x += ROOF_ART.rivetEvery) {
    for (const rx of [x + 12, x + 16]) {
      p.px(rx, 3, lit); p.px(rx + 1, 3, base); p.px(rx, 4, dark); p.px(rx + 1, 4, dark);
      p.px(rx, 11, lit); p.px(rx + 1, 11, base); p.px(rx, 12, dark); p.px(rx + 1, 12, dark);
    }
  }
  // panel seams: a dark double line with a rivet column, and pooled grime at the foot
  for (let sx = 0; sx < w; sx += ROOF_ART.seamEvery) {
    // the rolled lip (rows 0–1) runs unbroken over the seams
    p.rect(sx, 2, 1, h - 2, dark);
    p.rect(sx + 1, 2, 1, h - 2, P.outline);
    for (let y = 3; y < h; y += 4) { p.px(sx - 1, y, lit); p.px(sx + 2, y, lit); p.px(sx - 1, y + 1, dark); p.px(sx + 2, y + 1, dark); }
    // pooled grime where the panel joint meets the gutter (the visible band's last rows)
    for (let y = 11; y < ROOF_ART.visible; y++) {
      const t = (y - 10) / (ROOF_ART.visible - 10);
      for (let dx = -6; dx <= 7; dx++) {
        if (dx === 0 || dx === 1) continue; // the seam lines stay crisp
        p.dither(sx + dx, y, p.get(sx + dx, y) >>> 8, grime, 0.7 * t * (1 - Math.abs(dx) / 8));
      }
    }
  }
  // tar patches
  for (let i = 0; i < ROOF_ART.tarPatches; i++) {
    const cx = rng.range(0, w);
    const cy = rng.range(2.5, 4.5) + (rng.next() < 0.5 ? 0 : 9); // between lip and ridge, or under the ridge
    const rx = rng.range(5, 12);
    const ry = rng.range(1, 1.6);
    for (let y = Math.floor(cy - ry); y <= cy + ry; y++) {
      for (let x = Math.floor(cx - rx); x <= cx + rx; x++) {
        const d = Math.hypot((x - cx) / rx, (y - cy) / ry);
        if (d > 1) continue;
        p.dither(x, y, grime, P.void0, d < 0.7 ? 0.6 : 0.2);
      }
    }
  }
  // rust streaks trailing screen-left from a rivet or seam, with the airflow
  const rust = mixRgb(P.amber2, P.steel1, 0.35);
  for (let i = 0; i < ROOF_ART.rustStreaks; i++) {
    const x0 = Math.floor(rng.range(0, w));
    const y0 = rng.next() < 0.5 ? 4 : 12; // from a rivet row
    const len = Math.floor(rng.range(8, 30));
    for (let k = 0; k < len; k++) {
      const t = 1 - k / len;
      p.dither(x0 - k, y0, p.get(x0 - k, y0) >>> 8, rust, 0.75 * t);
      if (k % 3 === 0) p.dither(x0 - k, y0 + 1, p.get(x0 - k, y0 + 1) >>> 8, rust, 0.35 * t);
    }
  }
};

/** 13.04 rule 2: the carriage body under the roof lip. */
const drawBodyPx: PixelDraw = (c, w, h) => {
  const p = new Painter(c, w, h);
  const rng = new Lcg(ART_SEED ^ 0x5eed);
  const top = BODY_ART.top;
  const bottom = BODY_ART.bottom; // exclusive
  const body = lerpColor(P.steel0, P.void0, 0.25);
  const bodyDark = lerpColor(P.steel0, P.void0, 0.55);
  const glass = lerpColor(P.amber1, P.amber2, 0.15);
  const glassLit = lerpColor(glass, P.moon, 0.25);
  const bone = lerpColor(P.bone, P.steel2, 0.35);
  void h;
  // body plate, darker toward the sill
  for (let y = top; y < bottom; y++) {
    const t = ((y - top) / (bottom - top)) * 0.7;
    for (let x = 0; x < w; x++) p.dither(x, y, body, bodyDark, t);
  }
  // gutter highlight and dark edge under the roof lip; dark sill edge at the bottom
  p.rect(0, top, w, 1, P.steel2);
  p.rect(0, top + 1, w, 1, P.outline);
  p.rect(0, bottom - 1, w, 1, P.outline);
  // horizontal rivet rows
  for (const ry of BODY_ART.rivetRows) for (let x = 3; x < w; x += 6) { p.px(x, ry, P.steel2); p.px(x, ry + 1, P.outline); }
  // seams with rivet columns, a ladder every other seam, a vent and a stencilled number per panel
  let panel = 0;
  for (let sx = 0; sx < w; sx += BODY_ART.seamEvery, panel++) {
    // the gutter (rows top, top + 1) runs unbroken over the seams
    p.rect(sx, top + 2, 2, bottom - top - 2, P.outline);
    for (let y = top + 3; y < bottom - 1; y += 3) { p.px(sx - 1, y, P.steel2); p.px(sx + 2, y, P.steel2); }
    if (panel % 2 === 0) {
      const lx = sx + 5;
      p.rect(lx, top + 2, 1, bottom - top - 3, P.steel2);
      p.rect(lx + 4, top + 2, 1, bottom - top - 3, P.steel2);
      for (let y = top + 3; y < bottom - 1; y += 3) { p.rect(lx + 1, y, 3, 1, P.steel1); p.px(lx + 2, y + 1, P.outline); }
    }
    // louvred vent
    const vx = sx + 100;
    p.rect(vx - 1, 17, 8, 5, P.outline);
    for (let k = 0; k < 3; k++) { p.rect(vx, 18 + k * 2 - 1, 6, 1, P.steel1); }
    // stencilled car number
    const digits = `${(panel * 7 + 3) % 10}${(panel * 3 + 1) % 10}`;
    let dx = sx + 40;
    for (const ch of digits) {
      const rows = STENCIL[ch]!;
      rows.forEach((row, ry) => { for (let cx = 0; cx < 3; cx++) if (row[cx] === "1") p.px(dx + cx, 25 + ry, bone); });
      dx += 4;
    }
  }
  // windows: frame, glass, reflection, mullion, sill, weathering under the sill
  for (let x = BODY_ART.winX; x < w; x += BODY_ART.winEvery) {
    const g0 = BODY_ART.glassTop;
    const g1 = BODY_ART.glassBottom;
    p.rect(x - 1, g0 - 1, BODY_ART.winW + 2, g1 - g0 + 3, P.outline);
    for (let y = g0; y <= g1; y++) {
      for (let gx = x; gx < x + BODY_ART.winW; gx++) {
        const diag = (gx - x) + (y - g0) * 2;
        const reflect = y - g0 < 5 && diag % 7 < 3 ? 0.8 : y - g0 < 3 ? 0.35 : 0;
        p.dither(gx, y, glass, glassLit, reflect);
      }
    }
    p.rect(x + BODY_ART.winW / 2 - 1, g0, 1, g1 - g0 + 1, P.outline);
    p.rect(x - 2, g1 + 2, BODY_ART.winW + 4, 1, P.steel2);
    const streaks = 2 + Math.floor(rng.range(0, 2));
    for (let s = 0; s < streaks; s++) {
      const wx = Math.floor(x + rng.range(2, BODY_ART.winW - 2));
      const len = Math.floor(rng.range(3, bottom - g1 - 3));
      for (let k = 0; k < len; k++) p.dither(wx, g1 + 3 + k, p.get(wx, g1 + 3 + k) >>> 8, bodyDark, 0.7 * (1 - k / len));
    }
  }
};

const PIXEL_GENERATORS: Partial<Record<TextureKey, PixelDraw>> = {
  bg_train_roof: drawRoofPx,
  bg_train_body: drawBodyPx,
};

/** 13.04: the pixel raster of a ported layer at art resolution, for tests and tooling. Pure. */
export function renderPixelArt(key: "bg_train_roof" | "bg_train_body"): PixelCanvas {
  const [tw, th] = TEXTURE_SIZE[key];
  const w = Math.ceil(tw / PIXEL);
  const h = Math.ceil(th / PIXEL);
  const c = new PixelCanvas(w, h);
  PIXEL_GENERATORS[key]!(c, w, h);
  return c;
}

/** 13.04 rule 4: milliseconds the last `generateTextures` took (0 without `performance`). */
export let TEXTURE_BOOT_MS = 0;

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
  bg_roof_lamps: drawRoofLamps,
  bg_haze: drawHaze,
  bg_foreground: drawForeground,
};

/** Creates every stage texture once from the seeded generators. Safe to call again; existing keys are kept. */
export function generateTextures(scene: Phaser.Scene): void {
  const perf = typeof performance !== "undefined" ? performance : null;
  const t0 = perf ? perf.now() : 0;
  let made = 0;
  for (const key of Object.keys(GENERATORS) as TextureKey[]) {
    if (scene.textures.exists(key)) continue;
    made += 1;
    const px = PIXEL_GENERATORS[key];
    if (px) makePixelTexture(scene, key, px, TEXTURE_SIZE[key][0], TEXTURE_SIZE[key][1]);
    else makeTexture(scene, key, GENERATORS[key]);
  }
  if (perf && made > 0) {
    TEXTURE_BOOT_MS = perf.now() - t0;
    if (typeof console !== "undefined") console.info(`[art] stage textures: ${made} generated in ${TEXTURE_BOOT_MS.toFixed(1)} ms (roof and body as pixel rasters)`);
  }
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
  /** `danger` tint over every layer; kept at 0 since 12.02 (the tail lamp lights the last car instead). */
  tint: Phaser.GameObjects.Rectangle;
  moon: Phaser.GameObjects.Image;
  /** Amber window spill on the roof lip; scrolls with the body. */
  glow: Phaser.GameObjects.TileSprite;
  /** 12.02 roof lamp fixtures at `ROOF_LAMPS`; scrolls with the roof. */
  lamps: Phaser.GameObjects.TileSprite;
  /** 12.03 haze strips between the far bands (behind the near clouds) and between the clouds and the roof. */
  hazeFar: Phaser.GameObjects.Image;
  hazeNear: Phaser.GameObjects.Image;
  /** 12.03 near-camera silhouettes, scrolled at `FOREGROUND_SPEED` × roof speed. */
  foreground: Phaser.GameObjects.TileSprite;
  railing: Phaser.GameObjects.Graphics;
  lamp: Phaser.GameObjects.Graphics;
  /** Current roof and body scroll speed in px/s (240, or 180 in the final car). Rigs use it as wind speed. */
  roofSpeed: number;
  /** 11.02 wheels, sparks, smoke, poles, bob, lightning; stepped by `scrollBackgrounds`. */
  motion: Motion;
  /** 11.02 gap couplings and cargo racks for the current map. */
  map: MapLayer;
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

/** Builds the stage in the STANDARD car state on `map`. Generates textures first if the scene has not done so. */
export function createBackgrounds(scene: Phaser.Scene, map: MapId = "roof"): Layers {
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
  const lamps = scene.add.tileSprite(0, WORLD.ROOF_Y - ROOF_LAMP_H, W, ROOF_LAMP_H, "bg_roof_lamps")
    .setOrigin(0, 0).setDepth(DEPTH.roofLamps);
  const [hazeW, hazeH] = TEXTURE_SIZE.bg_haze;
  const hazeFar = scene.add.image(0, 150, "bg_haze").setOrigin(0, 0).setDisplaySize(W, hazeH * 1.5).setAlpha(HAZE_ALPHA.far).setDepth(DEPTH.hazeFar);
  const hazeNear = scene.add.image(0, WORLD.ROOF_Y - hazeH, "bg_haze").setOrigin(0, 0).setDisplaySize(W, hazeH).setAlpha(HAZE_ALPHA.near).setDepth(DEPTH.hazeNear);
  void hazeW;
  const foreground = scene.add.tileSprite(0, 0, W, H, "bg_foreground").setOrigin(0, 0).setDepth(DEPTH.foreground);

  const railing = scene.add.graphics().setDepth(DEPTH.railing).setAlpha(0).setVisible(false);
  drawRailing(railing);
  const lamp = scene.add.graphics().setDepth(DEPTH.lamp).setAlpha(0).setVisible(false);
  drawLamp(lamp);

  const tint = scene.add.rectangle(0, 0, W, H, P.danger, 1).setOrigin(0, 0).setAlpha(0).setDepth(DEPTH.tint);

  const base = { tiles, tunnel, track, dark, tint, moon, glow, lamps, hazeFar, hazeNear, foreground, railing, lamp, roofSpeed: STANDARD_ROOF_SPEED };
  const mapLayer = createMapLayer(scene, base);
  mapLayer.setMap(map);
  const layers = { ...base, map: mapLayer } as Layers;
  layers.motion = new Motion(scene, layers);
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

/**
 * Advances every scrolling layer screen-left. Call once per render frame with the frame delta in seconds.
 *
 * 13.07 (owner, 2026-09-12): the fighters stand on the train, so the car itself — roof, body, window glow and lamp
 * fixtures — no longer slides under their feet; it only bobs. Everything that is *not* the car moves: sky, stars,
 * clouds, telegraph poles, tunnel wall, foreground silhouettes, the rail ballast under the wheels, the track seen
 * through a gap and the final car's track trail. `roofSpeed` stays the train's speed for those layers, the wind,
 * the particles and the sparks.
 */
export function scrollBackgrounds(layers: Layers, dtSec: number): void {
  const dt = Math.min(Math.max(dtSec, 0), 0.1);
  layers.tiles.forEach((tile, i) => {
    const row = TILE_ROWS[i];
    if (!row || i === ROOF_INDEX || i === BODY_INDEX) return; // the car stands still
    if (row.speed !== 0) tile.tilePositionX += row.speed * dt;
  });
  layers.foreground.tilePositionX += layers.roofSpeed * FOREGROUND_SPEED * dt;
  layers.tunnel.tilePositionX += TUNNEL_SPEED * dt;
  layers.track.tilePositionX += TRACK_SPEED * dt;
  const ex = extras.get(layers);
  if (ex) placeTwinkle(layers, ex.dots);
  layers.map.update(dt, layers.roofSpeed);
  layers.motion.update(dt, layers.roofSpeed, ex?.car ?? "STANDARD");
}

/**
 * Cross-fades the stage to a train car over 400 ms. Entering the tunnel also sweeps a `night0` wipe in from the
 * right over 300 ms ahead of the fade; leaving it flashes `moon` at 10 %. Idempotent: running tweens on the same targets are killed
 * first, so it is safe to call again before an earlier transition has finished.
 */
export function applyTrainCar(scene: Phaser.Scene, layers: Layers, car: TrainCar): void {
  const ex = extras.get(layers);
  const twinkle = ex?.twinkle;
  const previous = ex?.car ?? "STANDARD";
  if (ex) ex.car = car;

  const targets: object[] = [
    ...layers.tiles, layers.tunnel, layers.track, layers.dark, layers.tint, layers.moon, layers.glow,
    layers.hazeFar, layers.hazeNear, layers.railing, layers.lamp, layers,
  ];
  if (twinkle) targets.push(twinkle);
  scene.tweens.killTweensOf(targets);

  const tunnel = car === "TUNNEL";
  const finalCar = car === "FINAL_CAR";
  if (tunnel && previous !== "TUNNEL") {
    const sweep = scene.add.rectangle(WORLD.WIDTH, 0, WORLD.WIDTH, WORLD.HEIGHT, P.night0, 1)
      .setOrigin(0, 0).setDepth(DEPTH.flash);
    scene.tweens.add({
      targets: sweep, x: 0, duration: WHOOSH_MS, ease: "Quad.easeOut",
      onComplete: () => scene.tweens.add({ targets: sweep, alpha: 0, duration: TRANSITION_MS, onComplete: () => sweep.destroy() }),
    });
  } else if (!tunnel && previous === "TUNNEL") {
    const flash = scene.add.rectangle(0, 0, WORLD.WIDTH, WORLD.HEIGHT, P.moon, 1)
      .setOrigin(0, 0).setAlpha(EXIT_FLASH_ALPHA).setDepth(DEPTH.flash);
    scene.tweens.add({ targets: flash, alpha: 0, duration: FLASH_MS, onComplete: () => flash.destroy() });
  }
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
  fade(layers.hazeFar, sky * HAZE_ALPHA.far);
  fade(layers.hazeNear, sky * HAZE_ALPHA.near);
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
