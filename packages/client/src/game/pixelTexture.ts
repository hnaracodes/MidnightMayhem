/**
 * 13.01 — A pixel-art texture. `draw` paints a `PixelCanvas` of `width / PIXEL × height / PIXEL` art pixels; the
 * raster is block-copied ×PIXEL into a CanvasTexture of exactly `width × height` with nearest filtering, so every
 * TEXTURE_SIZE, tile width, scroll speed and wrap is untouched. Boot-time cost only. Shared by the stage layers
 * (backgrounds.ts, 13.04) and the map art (stage/mapDraw.ts, 13.05); no runtime Phaser import (tests run in node).
 */
import type Phaser from "phaser";
import { PIXEL } from "./pixel";
import { upscaleBlock } from "./raster";
import { PixelCanvas } from "./sprites/grid";

export type PixelDraw = (c: PixelCanvas, w: number, h: number) => void;
/** `Phaser.Textures.FilterMode.NEAREST` by value. */
const NEAREST = 1;

export function makePixelTexture(scene: Phaser.Scene, key: string, draw: PixelDraw, width: number, height: number): void {
  if (scene.textures.exists(key)) return;
  // 13.04 rule 5: the node test stubs have no canvas textures; production Phaser always does
  if (typeof (scene.textures as { createCanvas?: unknown }).createCanvas !== "function") return;
  const w = Math.ceil(width / PIXEL);
  const h = Math.ceil(height / PIXEL);
  const c = new PixelCanvas(w, h);
  draw(c, w, h);
  const tex = scene.textures.createCanvas(key, width, height);
  if (!tex) return;
  tex.setFilter(NEAREST);
  const bytes = upscaleBlock(c.data, w, h, PIXEL);
  const img = tex.context.createImageData(w * PIXEL, h * PIXEL);
  img.data.set(bytes);
  tex.context.putImageData(img, 0, 0);
  tex.refresh();
}
