/**
 * The game's own lettering: a 5 × 7 uppercase pixel face authored in code, rastered with the same bevel,
 * outline and block-shadow language as the fighters (11.01 grids). Used for the title, the room code, the
 * verdict and section heads so both laptops draw identical type without a font file (the demo runs offline;
 * the constitution allows no assets). Pure below `pixelText`; the DOM wrapper is at the bottom.
 */
import { P } from "../game/palette";
import { PixelCanvas, alphaOf, mix, rgbOf, rgba } from "../game/sprites/grid";

export const GLYPH_W = 5;
export const GLYPH_H = 7;

/** One string per row, `#` is ink. Unknown characters fall back to `?`. */
const GLYPHS: Record<string, string[]> = {
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  G: ["01111", "10000", "10000", "10111", "10001", "10001", "01111"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
  J: ["00111", "00010", "00010", "00010", "00010", "10010", "01100"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  Q: ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  W: ["10001", "10001", "10001", "10101", "10101", "10101", "01010"],
  X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  "3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "10000", "11110", "00001", "00001", "11110"],
  "6": ["01110", "10000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00001", "01110"],
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
  "-": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
  ".": ["00000", "00000", "00000", "00000", "00000", "01100", "01100"],
  ",": ["00000", "00000", "00000", "00000", "00000", "00100", "01000"],
  "!": ["00100", "00100", "00100", "00100", "00100", "00000", "00100"],
  "?": ["01110", "10001", "00001", "00010", "00100", "00000", "00100"],
  "'": ["00100", "00100", "01000", "00000", "00000", "00000", "00000"],
  "/": ["00001", "00010", "00010", "00100", "01000", "01000", "10000"],
  "+": ["00000", "00100", "00100", "11111", "00100", "00100", "00000"],
  ":": ["00000", "01100", "01100", "00000", "01100", "01100", "00000"],
};

export function hasGlyph(ch: string): boolean {
  return ch.toUpperCase() in GLYPHS;
}

export interface PixelTextStyle {
  /**
   * `heavy` dilates every stroke one cell to the right (6-wide letters) for the logotype; `regular` is the
   * plain 5 × 7 for codes and heads.
   */
  weight?: "regular" | "heavy";
  /** Face colours, top to bottom: the bevel highlight, the body, the shade. Default: cream, amber-1, amber-2. */
  fill?: [number, number, number];
  /** Block shadow depth in cells (down-right), 0 for none. Default 2. */
  depth?: number;
  /** Outline colour; null skips the outline. Default `P.outline`. */
  outline?: number | null;
  /** Cells between letters. Default 1. */
  tracking?: number;
}

export const AMBER_FACE: [number, number, number] = [0xFFE9B8, P.amber1, P.amber2];
export const MOON_FACE: [number, number, number] = [0xFFFFFF, P.moon, 0x9AA8C7];
export const DANGER_FACE: [number, number, number] = [0xFFB3B8, P.danger, 0x8E2530];

/** Ink cells of one glyph after weight is applied. */
export function glyphCells(ch: string, weight: "regular" | "heavy" = "regular"): boolean[][] {
  const rows = GLYPHS[ch.toUpperCase()] ?? GLYPHS["?"]!;
  const w = weight === "heavy" ? GLYPH_W + 1 : GLYPH_W;
  return rows.map((row) => {
    const cells: boolean[] = [];
    for (let x = 0; x < w; x++) {
      const here = row[x] === "1";
      const left = weight === "heavy" && x > 0 && row[x - 1] === "1";
      cells.push(here || left);
    }
    return cells;
  });
}

/** Padding cells around the ink on every side (outline plus shadow), so letters never clip. */
export function padding(style: PixelTextStyle): { l: number; t: number; r: number; b: number } {
  const o = style.outline === null ? 0 : 1;
  const d = style.depth ?? 2;
  return { l: o, t: o, r: o + d, b: o + d };
}

/** Rasterises one glyph: bevelled face, outline, block shadow. Cells, not screen pixels. */
export function rasterGlyph(ch: string, style: PixelTextStyle = {}): PixelCanvas {
  const weight = style.weight ?? "regular";
  const [hi, body, lo] = style.fill ?? AMBER_FACE;
  const depth = style.depth ?? 2;
  const outline = style.outline === undefined ? P.outline : style.outline;
  const cells = glyphCells(ch, weight);
  const gw = cells[0]!.length;
  const pad = padding(style);
  const c = new PixelCanvas(gw + pad.l + pad.r, GLYPH_H + pad.t + pad.b, pad.l, pad.t);
  const ink = (x: number, y: number): boolean => y >= 0 && y < GLYPH_H && x >= 0 && x < gw && cells[y]![x]!;
  const near = (x: number, y: number): boolean => {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (ink(x + dx, y + dy)) return true;
    return false;
  };
  // Shadow first (deepest layer, one warm-black tone so it reads as a block), then outline, then the face.
  const shade = rgba(mix(P.void0, lo, 0.18));
  for (let k = depth; k >= 1; k--) {
    for (let y = -1; y <= GLYPH_H; y++) for (let x = -1; x <= gw; x++) if (near(x, y)) c.set(x + k, y + k, shade);
  }
  if (outline !== null) {
    for (let y = -1; y <= GLYPH_H; y++) for (let x = -1; x <= gw; x++) if (near(x, y)) c.set(x, y, rgba(outline));
  }
  for (let y = 0; y < GLYPH_H; y++) {
    for (let x = 0; x < gw; x++) {
      if (!ink(x, y)) continue;
      // Bevel: the top row catches the moon; the last two rows fall into shade.
      const color = y === 0 ? hi : y >= GLYPH_H - 2 ? lo : body;
      c.set(x, y, rgba(color));
    }
  }
  return c;
}

/** Width in cells of a whole string at `style`, letters plus tracking. */
export function measure(text: string, style: PixelTextStyle = {}): number {
  const gw = (style.weight ?? "regular") === "heavy" ? GLYPH_W + 1 : GLYPH_W;
  const pad = padding(style);
  const tracking = style.tracking ?? 1;
  const n = text.length;
  return n === 0 ? 0 : n * gw + (n - 1) * tracking + pad.l + pad.r;
}

/** Draws a cell raster into a 2D context at `k` screen px per cell. */
export function paintCells(ctx: CanvasRenderingContext2D, c: PixelCanvas, k: number): void {
  for (let y = 0; y < c.h; y++) {
    for (let x = 0; x < c.w; x++) {
      const px = c.data[y * c.w + x]!;
      if (px === 0) continue;
      ctx.globalAlpha = alphaOf(px) / 255;
      ctx.fillStyle = `#${rgbOf(px).toString(16).padStart(6, "0")}`;
      ctx.fillRect(x * k, y * k, k, k);
    }
  }
  ctx.globalAlpha = 1;
}

export interface PixelTextOpts extends PixelTextStyle {
  /**
   * CSS px per cell. The canvases are drawn at 1 px per cell and scaled by CSS (`image-rendering: pixelated`).
   * Omit it to size from the stylesheet's `--cell` (the title does, so it can respond to the viewport).
   */
  cell?: number;
  /** Extra class on the wrapper. */
  className?: string;
}

/**
 * A run of pixel letters for the DOM: one canvas per glyph (so entrances can stagger), each sized by CSS from
 * the `--cell` custom property, plus a visually hidden copy of the text for screen readers and `textContent`.
 * Words are wrapped in `.px-word` so lines break only between words.
 */
export function pixelText(text: string, opts: PixelTextOpts): HTMLElement {
  const wrap = document.createElement("span");
  wrap.className = `px${opts.className ? ` ${opts.className}` : ""}`;
  if (opts.cell !== undefined) wrap.style.setProperty("--cell", `${opts.cell}px`);
  const hidden = document.createElement("span");
  hidden.className = "sr-only";
  hidden.textContent = text;
  wrap.append(hidden);
  let index = 0;
  for (const word of text.split(" ")) {
    const run = document.createElement("span");
    run.className = "px-word";
    run.setAttribute("aria-hidden", "true");
    for (const ch of word) {
      const c = rasterGlyph(ch, opts);
      const canvas = document.createElement("canvas");
      canvas.width = c.w;
      canvas.height = c.h;
      canvas.className = "px-glyph";
      canvas.style.setProperty("--i", String(index++));
      canvas.style.width = `calc(var(--cell) * ${c.w})`;
      canvas.style.height = `calc(var(--cell) * ${c.h})`;
      // Letters overlap by the shadow depth so the tracking reads as the gap between faces, not between shadows.
      canvas.style.marginRight = `calc(var(--cell) * ${(opts.tracking ?? 1) - padding(opts).r})`;
      const ctx = canvas.getContext?.("2d");
      if (ctx) paintCells(ctx, c, 1);
      run.append(canvas);
    }
    wrap.append(run);
  }
  return wrap;
}
