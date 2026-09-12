/**
 * Pure box arithmetic for the YOLO backend (9.07): IoU, non-maximum suppression, and the letterbox mapping
 * between a source frame and the square model input. No DOM, no runtime imports.
 */

/** A scored, labelled box in any consistent unit (pixels or normalised); `x, y` is the top-left corner. */
export interface Candidate {
  label: string;
  score: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Letterbox transform: source × scale, then offset by (dx, dy) into the square. */
export interface Letterbox {
  scale: number;
  dx: number;
  dy: number;
}

/** Intersection over union of two boxes; 0 when they do not overlap. */
export function iou(a: Box, b: Box): number {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const inter = ix * iy;
  if (inter <= 0) return 0;
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}

/**
 * Greedy per-label non-maximum suppression: highest score first, dropping any later box of the same label
 * whose IoU with a kept box is at or above `threshold`. Returns the kept boxes, highest score first.
 */
export function nms(boxes: Candidate[], threshold: number): Candidate[] {
  const sorted = [...boxes].sort((a, b) => b.score - a.score);
  const kept: Candidate[] = [];
  for (const cand of sorted) {
    let suppressed = false;
    for (const k of kept) {
      if (k.label === cand.label && iou(k, cand) >= threshold) {
        suppressed = true;
        break;
      }
    }
    if (!suppressed) kept.push(cand);
  }
  return kept;
}

/** The transform that fits a `w × h` frame into a `size × size` square, preserving aspect and centring. */
export function letterbox(w: number, h: number, size: number): Letterbox {
  const scale = size / Math.max(w, h, 1);
  return { scale, dx: (size - w * scale) / 2, dy: (size - h * scale) / 2 };
}

/** Maps a source-pixel box into letterboxed square pixels. */
export function toLetterbox(box: Box, lb: Letterbox): Box {
  return { x: box.x * lb.scale + lb.dx, y: box.y * lb.scale + lb.dy, w: box.w * lb.scale, h: box.h * lb.scale };
}

/** Maps a letterboxed square-pixel box back into source pixels. */
export function unletterbox(box: Box, lb: Letterbox): Box {
  return { x: (box.x - lb.dx) / lb.scale, y: (box.y - lb.dy) / lb.scale, w: box.w / lb.scale, h: box.h / lb.scale };
}
