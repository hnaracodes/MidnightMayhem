/**
 * Procedural smoke frames for the detector benchmark (9.07): coloured silhouettes of a bottle, tennis racket
 * (or umbrella, whichever ITEMS names), backpack, banana and phone on a dark background at three sizes and a few positions. This is a smoke set
 * for timing and coordinate sanity, NOT ground truth: neither detector was trained on cartoons, so hit rates
 * on it say little about real objects. The real set lives in public/bench/ (owner-supplied photos).
 */
import { ITEMS } from "@midnight/shared";

export const FIXTURE_WIDTH = 640;
export const FIXTURE_HEIGHT = 480;

export type FixtureSize = "small" | "medium" | "large";

export interface FixtureSpec {
  /** COCO label the silhouette represents. */
  label: string;
  size: FixtureSize;
  /** Bounding box of the silhouette in frame pixels. */
  x: number;
  y: number;
  w: number;
  h: number;
}

const LABELS = Object.values(ITEMS).map((i) => i.cocoLabel);
const SIZES: FixtureSize[] = ["small", "medium", "large"];
/** Height of the silhouette per size; width follows the object's aspect. */
const HEIGHTS: Record<FixtureSize, number> = { small: 80, medium: 160, large: 300 };
const ASPECT: Record<string, number> = {
  bottle: 0.35, umbrella: 1.3, "tennis racket": 0.45, backpack: 0.8, banana: 1.6, "cell phone": 0.5,
};
/** Silhouette anchor positions, as fractions of the frame, cycled per frame. */
const ANCHORS = [
  [0.5, 0.5], [0.3, 0.45], [0.7, 0.55], [0.5, 0.35], [0.25, 0.6], [0.75, 0.4], [0.5, 0.65], [0.4, 0.5],
] as const;

/** The 40 frame specs: 5 labels × 8 variants (sizes cycle small/medium/large, positions cycle the anchors). */
export function fixtureSpecs(): FixtureSpec[] {
  const specs: FixtureSpec[] = [];
  let i = 0;
  for (const label of LABELS) {
    for (let v = 0; v < 8; v++, i++) {
      const size = SIZES[v % SIZES.length] as FixtureSize;
      const h = HEIGHTS[size];
      const w = Math.round(h * (ASPECT[label] ?? 1));
      const [ax, ay] = ANCHORS[i % ANCHORS.length] as readonly [number, number];
      const x = Math.round(Math.min(Math.max(ax * FIXTURE_WIDTH - w / 2, 8), FIXTURE_WIDTH - w - 8));
      const y = Math.round(Math.min(Math.max(ay * FIXTURE_HEIGHT - h / 2, 8), FIXTURE_HEIGHT - h - 8));
      specs.push({ label, size, x, y, w, h });
    }
  }
  return specs;
}

type Ctx = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

/** Draws one spec onto a FIXTURE_WIDTH × FIXTURE_HEIGHT context: dark room, a hint of a hand, the silhouette. */
export function drawFixture(ctx: Ctx, s: FixtureSpec): void {
  ctx.fillStyle = "#1a1d26";
  ctx.fillRect(0, 0, FIXTURE_WIDTH, FIXTURE_HEIGHT);
  // floor / wall split so the frame is not a flat colour
  ctx.fillStyle = "#23262f";
  ctx.fillRect(0, FIXTURE_HEIGHT * 0.7, FIXTURE_WIDTH, FIXTURE_HEIGHT * 0.3);
  const { x, y, w, h } = s;
  ctx.save();
  switch (s.label) {
    case "bottle": {
      ctx.fillStyle = "#3aa0e0";
      const neckW = w * 0.4;
      ctx.fillRect(x + (w - neckW) / 2, y, neckW, h * 0.25);
      roundRect(ctx, x, y + h * 0.22, w, h * 0.78, w * 0.3);
      ctx.fillStyle = "#e8f0ff";
      ctx.fillRect(x + w * 0.15, y + h * 0.45, w * 0.7, h * 0.25);
      break;
    }
    case "umbrella": {
      ctx.fillStyle = "#e8434f";
      ctx.beginPath();
      ctx.moveTo(x, y + h * 0.45);
      ctx.quadraticCurveTo(x + w / 2, y - h * 0.15, x + w, y + h * 0.45);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "#5b6375";
      ctx.lineWidth = Math.max(2, w * 0.03);
      ctx.beginPath();
      ctx.moveTo(x + w / 2, y + h * 0.45);
      ctx.lineTo(x + w / 2, y + h);
      ctx.stroke();
      break;
    }
    case "tennis racket": {
      // oval head with string grid, then a handle
      ctx.fillStyle = "#d8dde8";
      ctx.beginPath();
      ctx.ellipse(x + w / 2, y + h * 0.3, w / 2, h * 0.3, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#5b6375";
      ctx.lineWidth = Math.max(1, w * 0.02);
      for (let k = 1; k < 6; k++) {
        const gx = x + (w * k) / 6;
        ctx.beginPath();
        ctx.moveTo(gx, y + h * 0.05);
        ctx.lineTo(gx, y + h * 0.55);
        ctx.stroke();
        const gy = y + (h * 0.6 * k) / 6;
        ctx.beginPath();
        ctx.moveTo(x + w * 0.05, gy);
        ctx.lineTo(x + w * 0.95, gy);
        ctx.stroke();
      }
      ctx.fillStyle = "#e8434f";
      ctx.fillRect(x + w * 0.42, y + h * 0.58, w * 0.16, h * 0.42);
      break;
    }
    case "backpack": {
      ctx.fillStyle = "#2f8f5b";
      roundRect(ctx, x, y + h * 0.15, w, h * 0.85, w * 0.2);
      ctx.fillStyle = "#1f5f3d";
      roundRect(ctx, x + w * 0.2, y + h * 0.55, w * 0.6, h * 0.35, w * 0.1);
      ctx.strokeStyle = "#1f5f3d";
      ctx.lineWidth = Math.max(3, w * 0.08);
      ctx.beginPath();
      ctx.moveTo(x + w * 0.3, y + h * 0.15);
      ctx.quadraticCurveTo(x + w / 2, y - h * 0.05, x + w * 0.7, y + h * 0.15);
      ctx.stroke();
      break;
    }
    case "banana": {
      ctx.strokeStyle = "#f2d13d";
      ctx.lineWidth = Math.max(4, h * 0.3);
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(x + w * 0.05, y + h * 0.35);
      ctx.quadraticCurveTo(x + w / 2, y + h * 1.1, x + w * 0.95, y + h * 0.35);
      ctx.stroke();
      break;
    }
    default: { // cell phone
      ctx.fillStyle = "#0b0d14";
      roundRect(ctx, x, y, w, h, w * 0.12);
      ctx.fillStyle = "#4fe3f5";
      roundRect(ctx, x + w * 0.08, y + h * 0.06, w * 0.84, h * 0.88, w * 0.06);
      break;
    }
  }
  ctx.restore();
}

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
  ctx.fill();
}
