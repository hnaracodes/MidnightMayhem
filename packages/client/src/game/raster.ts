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

/** True when this engine stores Uint32 words little-endian (every browser we ship to; checked once, not assumed). */
export const LITTLE_ENDIAN: boolean = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;

/**
 * 13.02 rule 7: repacks 0xRRGGBBAA words into the byte order an `ImageData` buffer expects (R, G, B, A in memory)
 * through a Uint32 view, one word per pixel, no per-byte writes. `out` must be a view over the ImageData buffer.
 */
export function packForImageData(src: Uint32Array, out: Uint32Array, littleEndian: boolean = LITTLE_ENDIAN): void {
  const n = Math.min(src.length, out.length);
  if (littleEndian) {
    for (let i = 0; i < n; i++) {
      const px = src[i]!;
      // memory R,G,B,A == word A<<24 | B<<16 | G<<8 | R
      out[i] = px === 0 ? 0 : (((px & 255) << 24) | (((px >>> 8) & 255) << 16) | (((px >>> 16) & 255) << 8) | (px >>> 24)) >>> 0;
    }
  } else {
    out.set(src.subarray(0, n));
  }
}
