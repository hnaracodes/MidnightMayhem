/**
 * Pixel grid parsing, palette and raster helpers for the paper-doll sprites (11.01).
 * Pure: no Phaser, no DOM. A pixel is a 32-bit unsigned `0xRRGGBBAA`; 0 is transparent.
 */
import { P } from "../palette";

/** One string per row; every character indexes the part's palette. */
export type Grid = string[];

export interface Part {
  grid: Grid;
  /** The grid pixel that sits on the joint. */
  anchor: { x: number; y: number };
  /** Character-specific colours (`k`, `s`, `1`–`4` …) layered over `GRID_PALETTE`. */
  palette?: Record<string, number | null>;
}

/** Character-independent grid characters. `k K s S 1 2 3 4` come from the part file. */
export const GRID_PALETTE: Record<string, number | null> = {
  ".": null,
  o: P.outline,
  h: P.moon,
  a: P.amber1,
  A: P.amber2,
  w: P.white,
  d: P.danger,
};

export interface Parsed { data: Uint32Array; w: number; h: number }

export const rgba = (rgb: number, a = 255): number => ((rgb << 8) | (a & 255)) >>> 0;
export const rgbOf = (px: number): number => px >>> 8;
export const alphaOf = (px: number): number => px & 255;

/** Multiplies each channel by `f` (0..1+), clamped. */
export function darken(rgb: number, f: number): number {
  const c = (v: number): number => Math.max(0, Math.min(255, Math.round(v * f)));
  return (c((rgb >> 16) & 255) << 16) | (c((rgb >> 8) & 255) << 8) | c(rgb & 255);
}

/**
 * 13.02 rule 6: palette entries binding four glyphs (lightest first) to the four steps of a ramp, e.g.
 * `materialPalette("hkKc", rampFrom(P.drifterKey))`.
 */
export function materialPalette(chars: string, ramp: readonly [number, number, number, number]): Record<string, number> {
  if (chars.length !== 4) throw new Error(`materialPalette: need 4 glyphs, got '${chars}'`);
  return { [chars[0]!]: ramp[0], [chars[1]!]: ramp[1], [chars[2]!]: ramp[2], [chars[3]!]: ramp[3] };
}

/** Linear mix from `a` toward `b` by `t`. */
export function mix(a: number, b: number, t: number): number {
  const ch = (s: number): number => Math.round(((a >> s) & 255) + (((b >> s) & 255) - ((a >> s) & 255)) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

/** Parses a grid; throws on ragged rows or unknown characters. */
export function parseGrid(grid: Grid, colors: Record<string, number | null>): Parsed {
  const h = grid.length;
  if (h === 0) throw new Error("parseGrid: empty grid");
  const w = grid[0]!.length;
  const data = new Uint32Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = grid[y]!;
    if (row.length !== w) throw new Error(`parseGrid: row ${y} has ${row.length} chars, expected ${w}`);
    for (let x = 0; x < w; x++) {
      const ch = row[x]!;
      if (!(ch in colors)) throw new Error(`parseGrid: unknown char '${ch}' at ${x},${y}`);
      const c = colors[ch];
      data[y * w + x] = c === null || c === undefined ? 0 : rgba(c);
    }
  }
  return { data, w, h };
}

/**
 * 13.01: nearest-neighbour resample of a part by `k` (grid and anchor). Used for the placeholder grids until
 * 13.03 re-authors every part at the 1 px art grid. Pure.
 */
export function scalePart(part: Part, k: number): Part {
  const src = part.grid;
  const h = src.length;
  const w = src[0]?.length ?? 0;
  const nw = Math.max(1, Math.round(w * k));
  const nh = Math.max(1, Math.round(h * k));
  const grid: Grid = [];
  for (let y = 0; y < nh; y++) {
    const sy = Math.min(h - 1, Math.floor((y + 0.5) / k));
    let row = "";
    for (let x = 0; x < nw; x++) row += src[sy]![Math.min(w - 1, Math.floor((x + 0.5) / k))]!;
    grid.push(row);
  }
  const out: Part = { grid, anchor: { x: Math.round(part.anchor.x * k), y: Math.round(part.anchor.y * k) } };
  if (part.palette) out.palette = part.palette;
  return out;
}

const parsedCache = new WeakMap<Part, Parsed>();
export function parsePart(part: Part): Parsed {
  let p = parsedCache.get(part);
  if (!p) {
    p = parseGrid(part.grid, { ...GRID_PALETTE, ...(part.palette ?? {}) });
    parsedCache.set(part, p);
  }
  return p;
}

/** 13.02: the id `outline` writes, so a later outline pass never expands from its own pixels. */
export const OUTLINE_ID = 255;

/**
 * A small RGBA raster with an origin offset: `set(x, y)` writes canvas pixel `(x + ox, y + oy)`. 13.02: every
 * `set` also records `id` (the body part being drawn) in `ids`, which the occlusion and outline passes read.
 */
export class PixelCanvas {
  readonly data: Uint32Array;
  readonly ids: Uint8Array;
  /** Part id recorded by `set` (1–254); compose.ts sets it before each part. */
  id = 1;
  private readonly scratch: Uint32Array;
  private readonly scratchIds: Uint8Array;
  constructor(readonly w: number, readonly h: number, readonly ox = 0, readonly oy = 0) {
    this.data = new Uint32Array(w * h);
    this.ids = new Uint8Array(w * h);
    this.scratch = new Uint32Array(w * h);
    this.scratchIds = new Uint8Array(w * h);
  }

  clear(): void { this.data.fill(0); this.ids.fill(0); }

  /** Raw index for canvas pixel coordinates (already offset). -1 when outside. */
  private idx(cx: number, cy: number): number {
    return cx < 0 || cy < 0 || cx >= this.w || cy >= this.h ? -1 : cy * this.w + cx;
  }

  get(x: number, y: number): number {
    const i = this.idx(x + this.ox, y + this.oy);
    return i < 0 ? 0 : this.data[i]!;
  }

  set(x: number, y: number, px: number): void {
    const i = this.idx(x + this.ox, y + this.oy);
    if (i >= 0) { this.data[i] = px >>> 0; this.ids[i] = this.id; }
  }

  /** Part id at a pixel (origin space); 0 when empty or outside. */
  idAt(x: number, y: number): number {
    const i = this.idx(x + this.ox, y + this.oy);
    return i < 0 ? 0 : this.ids[i]!;
  }

  /** Square-brush line: thickness `t` stamps a t×t block per step (pixel-art capsule). */
  line(x0: number, y0: number, x1: number, y1: number, t: number, color: number): void {
    const px = rgba(color);
    const lo = -Math.ceil((t - 1) / 2);
    const hi = lo + t - 1;
    const steps = Math.max(1, Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)));
    for (let s = 0; s <= steps; s++) {
      const x = Math.round(x0 + ((x1 - x0) * s) / steps);
      const y = Math.round(y0 + ((y1 - y0) * s) / steps);
      for (let dy = lo; dy <= hi; dy++) for (let dx = lo; dx <= hi; dx++) this.set(x + dx, y + dy, px);
    }
  }

  disc(cx: number, cy: number, r: number, color: number): void {
    const px = rgba(color);
    const rr = (r + 0.25) * (r + 0.25);
    for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) if (x * x + y * y <= rr) this.set(cx + x, cy + y, px);
  }

  /** Draws `part` with its anchor at `(x, y)`; `flipX` mirrors the part about its anchor column. */
  blit(part: Part, x: number, y: number, flipX = false): void {
    const { data, w, h } = parsePart(part);
    const { x: ax, y: ay } = part.anchor;
    for (let sy = 0; sy < h; sy++) {
      for (let sx = 0; sx < w; sx++) {
        const px = data[sy * w + sx]!;
        if (px === 0) continue;
        const dx = flipX ? ax - sx : sx - ax;
        this.set(x + dx, y + sy - ay, px);
      }
    }
  }

  /** `blit` with every row above the anchor row shifted by `shear` px per row (positive = toward +x going up). */
  blitSheared(part: Part, x: number, y: number, flipX: boolean, shear: number): void {
    const { data, w, h } = parsePart(part);
    const { x: ax, y: ay } = part.anchor;
    for (let sy = 0; sy < h; sy++) {
      const rowShift = Math.round((ay - sy) * shear);
      for (let sx = 0; sx < w; sx++) {
        const px = data[sy * w + sx]!;
        if (px === 0) continue;
        const dx = flipX ? ax - sx : sx - ax;
        this.set(x + dx + rowShift, y + sy - ay, px);
      }
    }
  }

  /** `blit` rotated by `deg` about the anchor (screen convention: positive rotates the top toward +x). Nearest neighbour. */
  blitRotated(part: Part, x: number, y: number, flipX: boolean, deg: number): void {
    const { data, w, h } = parsePart(part);
    const { x: ax, y: ay } = part.anchor;
    const rad = (deg * Math.PI) / 180;
    const c = Math.cos(rad);
    const s = Math.sin(rad);
    const R = Math.ceil(Math.hypot(w, h));
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        // inverse-map the destination offset back into part space
        const ux = dx * c + dy * s;
        const uy = -dx * s + dy * c;
        let sx = Math.round(ux) + ax;
        const sy = Math.round(uy) + ay;
        if (flipX) sx = 2 * ax - sx;
        if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
        const px = data[sy * w + sx]!;
        if (px !== 0) this.set(x + dx, y + dy, px);
      }
    }
  }

  /**
   * 1 px outline around every opaque pixel (8-neighbourhood), written onto transparent pixels only. 13.02: in
   * place, no copy — outline pixels take OUTLINE_ID and only part pixels (id 1–254) expand, so the ring stays 1 px.
   */
  outline(color: number): void {
    const px = rgba(color);
    const { w, h, data, ids } = this;
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        const i = row + x;
        const id = ids[i]!;
        if (data[i] === 0 || id === 0 || id === OUTLINE_ID) continue;
        for (let dy = -1; dy <= 1; dy++) {
          const ny = y + dy;
          if (ny < 0 || ny >= h) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            if (nx < 0 || nx >= w) continue;
            const j = ny * w + nx;
            if (data[j] === 0) { data[j] = px; ids[j] = OUTLINE_ID; }
          }
        }
      }
    }
  }

  /**
   * 13.02 rule 5 (+ 12.02 rule 8 in the same sweep): a part pixel with a higher part id in its 8-neighbourhood
   * mixes `near` toward `shadow`, one with a higher id in its 5×5 ring mixes `far`; then every part pixel mixes
   * `gloom` toward `gloomColor`. Outline pixels are neither sources nor targets, and pixels of colour `except`
   * (authored in-part outline detail: eyes, knuckles) are left alone like 12.02's `mixAll` did.
   */
  occludeAndGloom(near: number, far: number, shadow: number, gloom: number, gloomColor: number, except?: number): void {
    const { w, h, data, ids } = this;
    const occlude = near > 0 || far > 0;
    const skip = except === undefined ? -1 : rgba(except);
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        const i = row + x;
        const id = ids[i]!;
        const px = data[i]!;
        if (px === 0 || id === 0 || id === OUTLINE_ID || px === skip) continue;
        let k = 0;
        if (occlude) {
          let best = 0;
          const y0 = Math.max(0, y - 2), y1 = Math.min(h - 1, y + 2);
          const x0 = Math.max(0, x - 2), x1 = Math.min(w - 1, x + 2);
          for (let ny = y0; ny <= y1 && best < 2; ny++) {
            const nrow = ny * w;
            for (let nx = x0; nx <= x1; nx++) {
              const nid = ids[nrow + nx]!;
              if (nid <= id || nid === OUTLINE_ID) continue;
              const ring = Math.max(Math.abs(nx - x), Math.abs(ny - y));
              if (ring <= 1) { best = 2; break; }
              best = 1;
            }
          }
          k = best === 2 ? near : best === 1 ? far : 0;
        }
        let rgb = rgbOf(px);
        if (k > 0) rgb = mix(rgb, shadow, k);
        if (gloom > 0) rgb = mix(rgb, gloomColor, gloom);
        if (k > 0 || gloom > 0) data[i] = rgba(rgb, alphaOf(px));
      }
    }
  }

  /** 13.02 rule 7: the flash mix and the alpha scale in one sweep (either may be a no-op). */
  finishColor(flash: number | undefined, flashAlpha: number, alpha: number): void {
    const { data } = this;
    const doFlash = flash !== undefined && flashAlpha > 0;
    const doAlpha = alpha < 1;
    if (!doFlash && !doAlpha) return;
    const f = flash ?? 0;
    for (let i = 0; i < data.length; i++) {
      const px = data[i]!;
      if (px === 0) continue;
      const rgb = doFlash ? mix(rgbOf(px), f, flashAlpha) : rgbOf(px);
      const a = doAlpha ? Math.round(alphaOf(px) * alpha) : alphaOf(px);
      data[i] = rgba(rgb, a);
    }
  }

  /** Checkerboard mix toward `color` over the column band `[fromX, toX]` (canvas-relative to the origin). */
  dither(fromX: number, toX: number, color: number, alpha: number): void {
    for (let y = -this.oy; y < this.h - this.oy; y++) {
      for (let x = fromX; x <= toX; x++) {
        if (((x + y) & 1) !== 0) continue;
        const px = this.get(x, y);
        if (px === 0) continue;
        this.set(x, y, rgba(mix(rgbOf(px), color, alpha), alphaOf(px)));
      }
    }
  }

  /**
   * Per-row edge shading: the `depth` fill pixels just inside the left (or right) outline get a 2×2 checker mix
   * toward `color`. Outline pixels themselves are left alone.
   */
  edgeDither(depth: number, color: number, alpha: number, side: "left" | "right", outlineColor: number): void {
    const o = rgba(outlineColor);
    const { w, h, data } = this;
    for (let y = 0; y < h; y++) {
      const start = side === "left" ? 0 : w - 1;
      const step = side === "left" ? 1 : -1;
      let x = start;
      while (x >= 0 && x < w) {
        // find the next outline pixel, then shade the run of fill pixels after it
        while (x >= 0 && x < w && data[y * w + x] !== o) x += step;
        x += step;
        let n = 0;
        while (x >= 0 && x < w && n < depth) {
          const px = data[y * w + x]!;
          if (px === 0 || px === o) break;
          if ((((x >> 1) + (y >> 1)) & 1) === 0) data[y * w + x] = rgba(mix(rgbOf(px), color, alpha), alphaOf(px));
          x += step;
          n += 1;
        }
        // skip the rest of this fill run
        while (x >= 0 && x < w && data[y * w + x] !== 0 && data[y * w + x] !== o) x += step;
      }
    }
  }

  /**
   * 1 px highlight on the fill pixel just inside the outline of every run, on the lit `side` (12.02: the side
   * facing the strongest light; `"both"` in the tunnel).
   */
  rim(color: number, side: "left" | "right" | "both", outlineColor: number): void {
    const o = rgba(outlineColor);
    const c = rgba(color);
    const { w, h, data } = this;
    const doRight = side !== "left";
    const doLeft = side !== "right";
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const px = data[y * w + x]!;
        if (px === 0 || px === o) continue;
        const right = x + 1 < w ? data[y * w + x + 1]! : 0;
        const left = x > 0 ? data[y * w + x - 1]! : 0;
        if ((doRight && right === o) || (doLeft && left === o)) data[y * w + x] = c;
      }
    }
  }

  /** Mirrors the whole canvas (pixels and ids) about column `aboutX` (origin space): x → 2·aboutX − 1 − x, so a pixel at the anchor column lands just left of it. */
  mirror(aboutX = 0): void {
    const { w, h, data, ids, scratch, scratchIds } = this;
    const axis = 2 * (aboutX + this.ox) - 1;
    scratch.set(data);
    scratchIds.set(ids);
    data.fill(0);
    ids.fill(0);
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        const nx = axis - x;
        if (nx >= 0 && nx < w) { data[row + nx] = scratch[row + x]!; ids[row + nx] = scratchIds[row + x]!; }
      }
    }
  }

  /** Clears every pixel below row `y` (origin space). */
  clearBelow(y: number): void {
    const from = Math.max(0, y + 1 + this.oy) * this.w;
    if (from < this.data.length) { this.data.fill(0, from); this.ids.fill(0, from); }
  }

  /** Mixes every opaque pixel toward `color` by `alpha`; pixels of colour `except` (the outline) are left alone. */
  mixAll(color: number, alpha: number, except?: number): void {
    const { data } = this;
    const skip = except === undefined ? -1 : rgba(except);
    for (let i = 0; i < data.length; i++) {
      const px = data[i]!;
      if (px !== 0 && px !== skip) data[i] = rgba(mix(rgbOf(px), color, alpha), alphaOf(px));
    }
  }

  /** Multiplies every pixel's alpha. */
  scaleAlpha(a: number): void {
    if (a >= 1) return;
    const { data } = this;
    for (let i = 0; i < data.length; i++) {
      const px = data[i]!;
      if (px !== 0) data[i] = rgba(rgbOf(px), Math.round(alphaOf(px) * a));
    }
  }

  /** Bounding box of opaque pixels in origin space, or null when empty. */
  bounds(): { x0: number; y0: number; x1: number; y1: number } | null {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const { w, h, data } = this;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (data[y * w + x] !== 0) {
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    if (x0 === Infinity) return null;
    return { x0: x0 - this.ox, y0: y0 - this.oy, x1: x1 - this.ox, y1: y1 - this.oy };
  }
}
