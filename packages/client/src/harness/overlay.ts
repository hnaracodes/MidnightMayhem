import type { DebugFrame } from "../vision/VisionInputSource";
import { COLOR_LABEL, COLOR_MARKER, COLOR_POSE } from "../vision/thresholds";
import type { Landmark } from "../vision/workerClient";

/** MediaPipe pose connections we draw: torso, arms, legs, nose to eyes. */
const BONES: [number, number][] = [
  [0, 2], [0, 5], [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28],
];
const MARKERS = [0, 11, 12, 15, 16, 23, 24];

export interface Overlay {
  draw(f: DebugFrame): void;
}

/** Skeleton overlay drawn in mirrored coordinates so it lines up with the CSS-mirrored video. */
export function createOverlay(canvas: HTMLCanvasElement, size: () => { w: number; h: number }): Overlay {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d context unavailable");

  const px = (l: Landmark, w: number, h: number) => ({ x: (1 - l.x) * w, y: l.y * h });

  return {
    draw(f) {
      const { w, h } = size();
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      ctx.clearRect(0, 0, w, h);
      const lms = f.landmarks;
      if (!lms) return;

      ctx.lineWidth = 3;
      ctx.strokeStyle = COLOR_POSE;
      ctx.lineCap = "round";
      for (const [a, b] of BONES) {
        const la = lms[a];
        const lb = lms[b];
        if (!la || !lb || la.visibility < 0.5 || lb.visibility < 0.5) continue;
        const pa = px(la, w, h);
        const pb = px(lb, w, h);
        ctx.beginPath();
        ctx.moveTo(pa.x, pa.y);
        ctx.lineTo(pb.x, pb.y);
        ctx.stroke();
      }

      const wristHot = (i: number) =>
        (f.metrics?.crossed ?? false) || (i === 15 ? f.gestures.punchL : i === 16 ? f.gestures.punchR : false);
      for (const i of MARKERS) {
        const l = lms[i];
        if (!l || l.visibility < 0.5) continue;
        const p = px(l, w, h);
        const hot = (i === 15 || i === 16) && wristHot(i);
        ctx.fillStyle = hot ? COLOR_MARKER : COLOR_POSE;
        ctx.beginPath();
        ctx.arc(p.x, p.y, hot ? 9 : 6, 0, Math.PI * 2);
        ctx.fill();
        if (i === 15 || i === 16) {
          ctx.fillStyle = COLOR_LABEL;
          ctx.font = "bold 14px system-ui, sans-serif";
          ctx.fillText(i === 15 ? "L" : "R", p.x + 12, p.y - 8);
        }
      }
    },
  };
}
