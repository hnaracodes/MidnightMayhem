/**
 * 13.01 — Pure raster helpers shared by the background pixel textures and tests. No Phaser, no DOM.
 */

/**
 * Exact nearest-neighbour block upscale of a 0xRRGGBBAA raster (`0` = transparent) to RGBA bytes, `k` output
 * pixels per source pixel on each axis, no offset and no blending. Output is `(w·k) × (h·k) × 4` bytes.
 */
export function upscaleBlock(src: Uint32Array, w: number, h: number, k: number): Uint8ClampedArray {
  const ow = w * k;
  const out = new Uint8ClampedArray(ow * h * k * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = src[y * w + x]!;
      if (px === 0) continue;
      const r = (px >>> 24) & 255;
      const g = (px >>> 16) & 255;
      const b = (px >>> 8) & 255;
      const a = px & 255;
      for (let dy = 0; dy < k; dy++) {
        let i = ((y * k + dy) * ow + x * k) * 4;
        for (let dx = 0; dx < k; dx++, i += 4) {
          out[i] = r; out[i + 1] = g; out[i + 2] = b; out[i + 3] = a;
        }
      }
    }
  }
  return out;
}
