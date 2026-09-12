/**
 * 11.02 / 13.05 — Map drawing: gaps as torn roof edges with couplings and brake hoses, platforms as stacked cargo
 * on a braced rack, both as pixel art at the 2 px grid.
 *
 * Geometry comes from `MAPS` in shared constants so what the sim collides with is exactly what the player sees:
 * the gap mask covers exactly `[x0, x1]` and a rack's plank row sits exactly on `platform.y` across `[x0, x1]`.
 * The mask and the rack underlight stay Graphics (alpha); the art is one canvas texture per span (`gapArt`,
 * `rackArt`, both pure) shown through an Image. The track visible in a gap is a slice of `bg_track_trail`.
 */
import type Phaser from "phaser";
import { MAPS, WORLD, type MapId } from "@midnight/shared";
import { P } from "../palette";
import { PIXEL } from "../pixel";
import { makePixelTexture } from "../pixelTexture";
import { PixelCanvas, mix, rgba } from "../sprites/grid";
import type { Layers } from "../backgrounds";

export interface MapLayer {
  /** Gap masks (night0 over exactly the pit span), depth just above the wheels so roof, body and bogies vanish over each pit. */
  gaps: Phaser.GameObjects.Graphics;
  /** 13.05: only the warm underlight beneath each rack; the rack itself is an Image. */
  platforms: Phaser.GameObjects.Graphics;
  /** 13.05: one pixel-art Image per gap and per rack. */
  images: Phaser.GameObjects.Image[];
  setMap(map: MapId): void;
  /** Track slices visible in each gap; they scroll at roof speed and bob with the train. */
  slices: Phaser.GameObjects.TileSprite[];
  /** What is currently drawn, for tests and the preview. */
  readonly spans: { gaps: { x0: number; x1: number }[]; platforms: { x0: number; x1: number; y: number }[] };
  /** Scrolls the gap track slices. Driven by `scrollBackgrounds`. */
  update(dtSec: number, roofSpeed: number): void;
  /** 13.05 rule 4: moves the mask, glow, slices and every image by the train bob (called by `Motion.applyBob`). */
  bob(offset: number): void;
  destroy(): void;
}

/** Depths: gaps sit above the wheels (-9.5), their art above the track slice; racks sit under the shadow (1) and rigs (2+). */
export const MAP_DEPTH = { gaps: -9.3, slice: -9.29, gapArt: -9.28, rackGlow: -6.01, platforms: -6 } as const;

/** Gap art geometry in world px. `reach`: how far the torn-edge art extends onto each car; `wall`: the car-end wall. */
export const GAP_ART = { reach: 8, wall: 4, trackY: 480, trackH: 60, bufferY: 444, bufferH: 10, bufferW: 14, barY: 458, barH: 8, hoseSag: 14 } as const;
/** Rack art geometry in world px. `slab`: the cargo stack the fighter stands on; `legInset`: leg from the span edge. */
export const RACK_ART = { slab: 12, legInset: 10, leg: 4, crate: 40, underlight: 6 } as const;

interface Art { canvas: PixelCanvas; x: number; y: number }

const a = (world: number): number => Math.round(world / PIXEL);
const WOOD = mix(P.amber2, P.steel1, 0.45);
const WOOD_LIGHT = mix(WOOD, P.bone, 0.3);
const WOOD_DARK = mix(WOOD, P.void0, 0.4);
const RUST = mix(P.amber2, P.steel0, 0.3);
const BONE = mix(P.bone, P.steel2, 0.35);
const TARP = mix(P.haze, P.steel0, 0.5);

/** Pixel painter in art px with a 2×2 Bayer dither. */
class Px {
  constructor(readonly c: PixelCanvas) {}
  put(x: number, y: number, color: number): void { this.c.set(x, y, rgba(color)); }
  dither(x: number, y: number, base: number, over: number, t: number): void {
    const th = [0.125, 0.625, 0.875, 0.375][(x & 1) + 2 * (y & 1)]!;
    this.put(x, y, t > th ? over : base);
  }
  rect(x0: number, y0: number, w: number, h: number, color: number): void {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) this.put(x, y, color);
  }
  line(x0: number, y0: number, x1: number, y1: number, color: number): void {
    const n = Math.max(1, Math.abs(x1 - x0), Math.abs(y1 - y0));
    for (let i = 0; i <= n; i++) this.put(Math.round(x0 + ((x1 - x0) * i) / n), Math.round(y0 + ((y1 - y0) * i) / n), color);
  }
}

/**
 * 13.05 rule 1: the art around a pit, world `x0 − reach .. x1 + reach` × `ROOF_Y .. HEIGHT`. Pure. Inside the
 * span nothing opaque sits above the buffers except the shards hanging off each lip, so the pit reads open.
 */
export function gapArt(x0: number, x1: number, worn = false): Art {
  const left = x0 - GAP_ART.reach;
  const w = a(x1 - x0 + 2 * GAP_ART.reach);
  const h = a(WORLD.HEIGHT - WORLD.ROOF_Y);
  const c = new PixelCanvas(w, h);
  const p = new Px(c);
  const gx0 = a(GAP_ART.reach); // first art column of the pit
  const gx1 = w - a(GAP_ART.reach); // one past the pit's last column
  const wall = a(GAP_ART.wall);
  const wallH = a(70);
  // car-end walls with exposed vertical ribs
  for (const [wx, dir] of [[gx0 - wall, 1], [gx1, 1]] as const) {
    p.rect(wx, 0, wall, wallH, P.outline);
    for (let y = 1; y < wallH; y++) {
      if (y % 3 === 0) p.put(wx + (dir === 1 ? 0 : wall - 1), y, P.steel0);
      p.put(wx + 1, y, y % 4 === 0 ? P.steel1 : P.steel0);
    }
  }
  // torn roof edge on each car: a bright lip with a dark drop shadow, bent shards hanging into the gap
  for (const side of [-1, 1] as const) {
    const edge = side === -1 ? gx0 - 1 : gx1; // the wall's inner face column
    const dir = side === -1 ? -1 : 1; // toward the car
    for (let k = 0; k < gx0; k++) {
      const x = edge + dir * k;
      const gapPx = k === 1 || (worn && k === 3);
      p.put(x, 0, gapPx ? P.steel1 : P.steel2);
      p.put(x, 1, P.outline);
    }
    // bent shards hanging off the lip into the pit, 1–2 columns past the wall face
    const shards = worn ? [0, 1, 2] : [0, 1];
    for (const s of shards) {
      const x = edge - dir * (s + 1);
      const drop = s === 0 ? 3 : 2;
      p.put(x, 0, P.steel2);
      for (let y = 1; y <= drop; y++) p.put(x, y, y === drop ? P.outline : P.steel1);
    }
  }
  // buffers: riveted plates on each wall face
  const bw = a(GAP_ART.bufferW);
  const by = a(GAP_ART.bufferY - WORLD.ROOF_Y);
  const bh = a(GAP_ART.bufferH);
  for (const bx of [gx0, gx1 - bw]) {
    p.rect(bx - 1, by - 1, bw + 2, bh + 2, P.outline);
    p.rect(bx, by, bw, bh, P.steel2);
    p.rect(bx === gx0 ? bx + bw - 2 : bx, by, 2, bh, P.steel0);
    for (const ry of [by + 1, by + bh - 2]) for (let rx = bx + 2; rx < bx + bw - 2; rx += 2) p.put(rx, ry, P.steel1);
  }
  // coupling: a striped bar, two hooks and a pin at the knuckle
  const barY = a(GAP_ART.barY - WORLD.ROOF_Y);
  const barH = a(GAP_ART.barH);
  const barX0 = gx0 + 2;
  const barX1 = gx1 - 2;
  p.rect(barX0 - 1, barY - 1, barX1 - barX0 + 2, barH + 2, P.outline);
  p.rect(barX0, barY, barX1 - barX0, barH, P.steel0);
  for (let sx = barX0 + 2; sx + 4 <= barX1 - 2; sx += 8) p.rect(sx, barY + 1, 4, barH - 2, mix(P.danger, P.steel0, 0.15));
  const mid = Math.floor((gx0 + gx1) / 2);
  p.rect(mid - 4, barY - 2, 8, barH + 4, P.outline);
  p.rect(mid - 3, barY - 1, 3, barH + 2, P.steel2); // left hook
  p.rect(mid, barY - 1, 3, barH + 2, P.steel1); // right hook
  p.put(mid - 1, barY + 1, P.moon); // pin
  p.put(mid, barY + 1, P.moon);
  // brake hoses sagging between the buffers, red coupling heads on each end
  const hy0 = by + bh;
  const sag = a(GAP_ART.hoseSag);
  for (const [dy, tone] of [[0, P.outline], [2, P.steel0]] as const) {
    for (let x = gx0 + bw; x <= gx1 - bw; x++) {
      const t = (x - (gx0 + bw)) / Math.max(1, gx1 - bw - (gx0 + bw));
      const y = hy0 + dy + Math.round(Math.sin(t * Math.PI) * sag);
      p.put(x, y, tone);
      if (dy === 0) p.put(x, y + 1, P.steel0);
    }
    p.rect(gx0 + bw - 1, hy0 + dy - 1, 2, 3, P.danger);
    p.rect(gx1 - bw - 1, hy0 + dy - 1, 2, 3, P.danger);
  }
  void RUST;
  return { canvas: c, x: left, y: WORLD.ROOF_Y };
}

/**
 * 13.05 rule 2: a cargo rack, world `x0 − 2 .. x1 + 2` × `y − 2 .. ROOF_Y`. Pure. Art row 0 is the plank outline,
 * row 1 the plank the fighter stands on (world `y`), rows 2–6 the crate stack, then the braced frame to the roof.
 */
export function rackArt(x0: number, x1: number, y: number, worn = false): Art {
  const w = a(x1 - x0) + 2;
  const h = a(WORLD.ROOF_Y - y) + 1;
  const c = new PixelCanvas(w, h);
  const p = new Px(c);
  const slab = a(RACK_ART.slab); // rows 1..slab
  // plank outline and surface
  p.rect(1, 0, w - 2, 1, P.outline);
  p.rect(0, 1, w, 1, P.outline);
  for (let x = 1; x < w - 1; x++) p.put(x, 1, x % 7 === 3 ? WOOD_DARK : WOOD_LIGHT);
  // crates: 40 world px each with a 1 px outline gap, slats, nail heads, straps, labels, rust
  const crateW = a(RACK_ART.crate);
  let n = 0;
  for (let cx = 1; cx < w - 1; cx += crateW, n++) {
    const cw = Math.min(crateW, w - 1 - cx);
    p.rect(cx, 2, cw, slab - 1, WOOD);
    p.rect(cx, 2, 1, slab - 1, P.outline);
    p.rect(cx + cw - 1, 2, 1, slab - 1, P.outline);
    for (let sy = 3; sy < slab + 1; sy += 2) for (let x = cx + 1; x < cx + cw - 1; x++) p.dither(x, sy, WOOD, WOOD_DARK, x % 2 === 0 ? 0.9 : 0.5);
    for (const [nx, ny] of [[cx + 1, 2], [cx + cw - 2, 2], [cx + 1, slab], [cx + cw - 2, slab]] as const) p.put(nx, ny, P.steel2);
    for (const sx of [cx + Math.floor(cw / 3), cx + Math.floor((2 * cw) / 3)]) {
      p.rect(sx, 2, 1, slab - 1, P.outline);
      p.put(sx, 4, P.steel2);
      p.put(sx, 5, P.steel1);
    }
    if (n % 2 === 0 && cw > 10) {
      p.rect(cx + 3, 4, 5, 3, BONE);
      p.put(cx + 4, 5, P.outline);
      p.put(cx + 6, 5, P.outline);
    }
    for (let k = 0; k < 3; k++) p.dither(cx + 1 + k, slab - k, WOOD, RUST, 0.6);
    if (worn && n === 1 && cw > 6) for (let y = 6; y < 8; y++) for (let x = cx + 3; x < cx + 6; x++) c.set(x, y, 0); // a missing slat: a hole
  }
  p.rect(0, slab + 1, w, 1, P.outline);
  // tarpaulin corner hanging off the far end, inside the span
  for (let k = 0; k < 6; k++) for (let x = w - 3 - k; x < w - 2; x++) p.dither(x, slab + 2 + k, TARP, P.steel0, 0.35);
  p.line(w - 8, slab + 7, w - 3, slab + 2, P.outline);
  // frame: two legs with cross braces and rusty feet
  const legW = a(RACK_ART.leg);
  const lx0 = a(RACK_ART.legInset) + 1;
  const lx1 = w - 1 - a(RACK_ART.legInset) - legW;
  const top = slab + 2;
  p.line(lx0 + 1, top, lx1 + 1, h - 1, P.outline);
  p.line(lx1 + 1, top, lx0 + 1, h - 1, P.outline);
  for (const lx of [lx0, lx1]) {
    p.rect(lx - 1, top, legW + 2, h - top, P.outline);
    p.rect(lx, top, legW, h - top, P.steel0);
    p.rect(lx, top, 1, h - top, P.steel2);
    for (let k = 0; k < 3; k++) for (let x = lx - 1; x < lx + legW + 1; x++) p.dither(x, h - 1 - k, P.steel0, RUST, 0.7 - k * 0.2);
  }
  if (worn) for (let k = 0; k < 6; k++) p.dither(lx0 + (k % legW), top + 4 + k, P.steel0, RUST, 0.6);
  return { canvas: c, x: x0 - PIXEL, y: y - PIXEL };
}

export function createMapLayer(scene: Phaser.Scene, _layers: Pick<Layers, "tiles">): MapLayer {
  const gaps = scene.add.graphics().setDepth(MAP_DEPTH.gaps);
  const platforms = scene.add.graphics().setDepth(MAP_DEPTH.rackGlow);
  let slices: Phaser.GameObjects.TileSprite[] = [];
  let images: Phaser.GameObjects.Image[] = [];
  let baseY: number[] = [];
  const spans: MapLayer["spans"] = { gaps: [], platforms: [] };

  const place = (art: Art, key: string, depth: number): void => {
    const [w, h] = [art.canvas.w * PIXEL, art.canvas.h * PIXEL];
    makePixelTexture(scene, key, (c) => { c.data.set(art.canvas.data); }, w, h);
    const img = scene.add.image(art.x, art.y, key).setOrigin(0, 0).setDepth(depth);
    images.push(img);
    baseY.push(art.y);
  };

  const layer: MapLayer = {
    gaps,
    platforms,
    images,
    slices,
    spans,
    setMap(map: MapId): void {
      const def = MAPS[map];
      const worn = def.ground.length > 1 && def.platforms.length > 0; // chaos: the car that has been through the most
      gaps.clear();
      platforms.clear();
      for (const s of slices) s.destroy();
      for (const i of images) i.destroy();
      slices = [];
      images = [];
      baseY = [];
      spans.gaps = [];
      spans.platforms = [];
      const ground = def.ground;
      for (let i = 1; i < ground.length; i++) {
        const x0 = ground[i - 1]!.x1;
        const x1 = ground[i]!.x0;
        if (x1 <= x0) continue;
        spans.gaps.push({ x0, x1 });
        gaps.fillStyle(P.night0, 1);
        gaps.fillRect(x0, WORLD.ROOF_Y, x1 - x0, WORLD.HEIGHT - WORLD.ROOF_Y);
        const inset = GAP_ART.wall + 2;
        const slice = scene.add.tileSprite(x0 + inset, GAP_ART.trackY, x1 - x0 - inset * 2, GAP_ART.trackH, "bg_track_trail")
          .setOrigin(0, 0).setDepth(MAP_DEPTH.slice);
        slices.push(slice);
        place(gapArt(x0, x1, worn), `map_gap_${x0}_${x1}${worn ? "_worn" : ""}`, MAP_DEPTH.gapArt);
      }
      for (const pl of def.platforms) {
        spans.platforms.push({ x0: pl.x0, x1: pl.x1, y: pl.y });
        const w = pl.x1 - pl.x0;
        platforms.fillStyle(P.amber1, 0.2);
        platforms.fillRect(pl.x0, WORLD.ROOF_Y, w, RACK_ART.underlight);
        platforms.fillStyle(P.amber1, 0.12);
        platforms.fillRect(pl.x0 - 6, WORLD.ROOF_Y + RACK_ART.underlight, w + 12, RACK_ART.underlight);
        platforms.fillStyle(P.amber1, 0.06);
        platforms.fillRect(pl.x0 - 12, WORLD.ROOF_Y + RACK_ART.underlight * 2, w + 24, RACK_ART.underlight);
        place(rackArt(pl.x0, pl.x1, pl.y, worn), `map_rack_${pl.x0}_${pl.x1}_${pl.y}${worn ? "_worn" : ""}`, MAP_DEPTH.platforms);
      }
      layer.slices = slices;
      layer.images = images;
    },
    update(dtSec: number, roofSpeed: number): void {
      for (const s of slices) s.tilePositionX += roofSpeed * dtSec;
    },
    bob(offset: number): void {
      gaps.setY(offset);
      platforms.setY(offset);
      for (const s of slices) s.setY(GAP_ART.trackY + offset);
      images.forEach((img, i) => img.setY(baseY[i]! + offset));
    },
    destroy(): void {
      gaps.destroy();
      platforms.destroy();
      for (const s of slices) s.destroy();
      for (const i of images) i.destroy();
      slices = [];
      images = [];
    },
  };
  return layer;
}
