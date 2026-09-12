/**
 * In-match camera preview (integrator amendment to Phase 6): a fixed 240 px box in the bottom-left corner
 * showing the mirrored camera with the smoothed skeleton, a row of six input dots (L R J PL PR B), a status
 * line and, when the vision layer reports punch diagnostics, one gate row per hand. Pointer events pass
 * through to the arena. The pure `previewModel` decides what the rows show; the class only paints it.
 *
 * The camera stream is never opened twice: every animation frame the source's own `<video>` is drawn onto
 * the preview canvas (mirrored), so the element itself can stay wherever the calibration overlay put it.
 */
import type { InputKey } from "@midnight/shared";
import type { CalibrationPhase } from "../vision/calibration";
import { COLOR_LABEL, COLOR_MARKER, COLOR_POSE } from "../vision/thresholds";
import type { PunchDiag } from "../vision/gestures/punch";
export type { PunchDiag };
import type { DebugFrame, VisionInputSource } from "../vision/VisionInputSource";
import type { Landmark } from "../vision/workerClient";

export type PreviewFrame = DebugFrame & { fps?: number };

export const DOT_KEYS: readonly InputKey[] = ["left", "right", "jump", "punchL", "punchR", "block"];
export const DOT_LABELS: readonly string[] = ["L", "R", "J", "PL", "PR", "B"];
export const GATE_NAMES = ["ext", "depth", "thrust", "jab"] as const;
export type GateName = (typeof GATE_NAMES)[number];

export interface GateRow {
  ext: boolean;
  depth: boolean;
  thrust: boolean;
  jab: boolean;
  /** The debounced punch output for that hand. */
  out: boolean;
}

export interface PreviewModel {
  /** One per DOT_KEYS entry, in order. */
  dots: boolean[];
  /** e.g. "calibrating 40% · 28 fps", "ready · 30 fps", "lost", "no camera". */
  status: string;
  /** Null until the frame carries punch diagnostics. */
  gates: { L: GateRow; R: GateRow } | null;
}

export function previewModel(frame: PreviewFrame | null, fps?: number): PreviewModel {
  if (!frame) return { dots: DOT_KEYS.map(() => false), status: "no camera", gates: null };
  const dots = DOT_KEYS.map((key) => frame.frame[key]);
  const status = statusText(frame.calibration.phase, frame.calibration.progress, frame.fps ?? fps);
  const punch = frame.punch;
  const gates = punch ? { L: gateRow(punch.L), R: gateRow(punch.R) } : null;
  return { dots, status, gates };
}

function statusText(phase: CalibrationPhase, progress: number, fps: number | undefined): string {
  const parts = [phase === "calibrating" ? `calibrating ${Math.round(progress * 100)}%` : phase];
  if (fps !== undefined && fps > 0) parts.push(`${Math.round(fps)} fps`);
  return parts.join(" · ");
}

function gateRow(d: PunchDiag): GateRow {
  return { ext: d.extOk, depth: d.depthOk, thrust: d.thrustOk, jab: d.jabOk, out: d.out };
}

/** Same bone list and markers as the harness overlay: torso, arms, legs, nose to eyes. */
const BONES: [number, number][] = [
  [0, 2], [0, 5], [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28],
];
const MARKERS = [0, 11, 12, 15, 16, 23, 24];
const CANVAS_W = 320;
const CANVAS_H = 240;

/**
 * `VisionInputSource.onDebug` holds a single callback. Subscribe once here and fan the frames out to every
 * consumer (calibration overlay, preview) so binding one never silently unhooks the other.
 */
export interface DebugFeed {
  onDebug(cb: (frame: DebugFrame) => void): void;
}

export function debugFanOut(source: DebugFeed): DebugFeed {
  const listeners: Array<(frame: DebugFrame) => void> = [];
  source.onDebug((frame) => {
    for (const cb of listeners) cb(frame);
  });
  return { onDebug: (cb) => void listeners.push(cb) };
}

export class CameraPreview {
  private readonly root: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly dots: HTMLSpanElement[] = [];
  private readonly status: HTMLDivElement;
  private readonly gates: HTMLDivElement;
  private readonly gateGlyphs: Record<"L" | "R", { label: HTMLSpanElement; glyphs: Record<GateName, HTMLSpanElement> }>;

  private source: VisionInputSource | null = null;
  private frame: PreviewFrame | null = null;
  private raf = 0;
  private shown = false;

  constructor() {
    const root = document.getElementById("campreview");
    if (!root) throw new Error("Missing #campreview");
    this.root = root;

    const view = document.createElement("div");
    view.className = "campreview-view";
    this.canvas = document.createElement("canvas");
    this.canvas.width = CANVAS_W;
    this.canvas.height = CANVAS_H;
    view.append(this.canvas);

    const dots = document.createElement("div");
    dots.className = "campreview-dots";
    for (const label of DOT_LABELS) {
      const dot = document.createElement("span");
      dot.textContent = label;
      dots.append(dot);
      this.dots.push(dot);
    }

    this.status = document.createElement("div");
    this.status.className = "campreview-status";

    this.gates = document.createElement("div");
    this.gates.className = "campreview-gates";
    this.gates.hidden = true;
    const rowFor = (hand: "L" | "R") => {
      const row = document.createElement("div");
      const label = document.createElement("span");
      label.className = "campreview-hand";
      label.textContent = hand;
      row.append(label);
      const glyphs = {} as Record<GateName, HTMLSpanElement>;
      for (const name of GATE_NAMES) {
        const cell = document.createElement("span");
        cell.className = "campreview-gate";
        const glyph = document.createElement("b");
        cell.append(name, glyph);
        row.append(cell);
        glyphs[name] = glyph;
      }
      this.gates.append(row);
      return { label, glyphs };
    };
    this.gateGlyphs = { L: rowFor("L"), R: rowFor("R") };

    this.root.replaceChildren(view, dots, this.status, this.gates);
  }

  /** `feed` defaults to the source; pass a `debugFanOut` when something else also listens to onDebug. */
  bind(source: VisionInputSource, feed: DebugFeed = source): void {
    this.source = source;
    feed.onDebug((frame) => {
      this.frame = frame as PreviewFrame;
    });
  }

  get visible(): boolean {
    return this.shown;
  }

  show(): void {
    if (this.shown || !this.source) return;
    this.shown = true;
    this.root.hidden = false;
    const tick = (): void => {
      this.render();
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
    this.render();
  }

  hide(): void {
    if (!this.shown) return;
    this.shown = false;
    cancelAnimationFrame(this.raf);
    this.root.hidden = true;
  }

  toggle(): void {
    if (this.shown) this.hide();
    else this.show();
  }

  private render(): void {
    const model = previewModel(this.frame, this.source?.stats().fps);
    this.dots.forEach((dot, i) => dot.classList.toggle("on", model.dots[i] ?? false));
    this.status.textContent = model.status;
    this.gates.hidden = model.gates === null;
    if (model.gates) {
      for (const hand of ["L", "R"] as const) {
        const row = model.gates[hand];
        const els = this.gateGlyphs[hand];
        els.label.classList.toggle("on", row.out);
        for (const name of GATE_NAMES) {
          const ok = row[name];
          els.glyphs[name].textContent = ok ? "✓" : "✗";
          els.glyphs[name].className = ok ? "ok" : "no";
        }
      }
    }
    this.draw();
  }

  /** Mirrored video frame plus the skeleton in mirrored coordinates (x → 1 − x), like the harness. */
  private draw(): void {
    const ctx = this.canvas.getContext("2d");
    if (!ctx) return;
    const w = CANVAS_W;
    const h = CANVAS_H;
    ctx.clearRect(0, 0, w, h);

    const video = this.source?.video;
    if (video && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      ctx.save();
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(video, 0, 0, w, h);
      ctx.restore();
    }

    const f = this.frame;
    const lms = f?.landmarks;
    if (!f || !lms) return;
    const px = (l: Landmark) => ({ x: (1 - l.x) * w, y: l.y * h });

    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.strokeStyle = COLOR_POSE;
    for (const [a, b] of BONES) {
      const la = lms[a];
      const lb = lms[b];
      if (!la || !lb || la.visibility < 0.5 || lb.visibility < 0.5) continue;
      const pa = px(la);
      const pb = px(lb);
      ctx.beginPath();
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
      ctx.stroke();
    }

    const crossed = f.metrics?.crossed ?? false;
    const wristHot = (i: number) => crossed || (i === 15 ? f.gestures.punchL : i === 16 ? f.gestures.punchR : false);
    for (const i of MARKERS) {
      const l = lms[i];
      if (!l || l.visibility < 0.5) continue;
      const p = px(l);
      const hot = (i === 15 || i === 16) && wristHot(i);
      ctx.fillStyle = hot ? COLOR_MARKER : COLOR_POSE;
      ctx.beginPath();
      ctx.arc(p.x, p.y, hot ? 8 : 5, 0, Math.PI * 2);
      ctx.fill();
      if (i === 15 || i === 16) {
        ctx.fillStyle = COLOR_LABEL;
        ctx.font = "bold 12px system-ui, sans-serif";
        ctx.fillText(i === 15 ? "L" : "R", p.x + 10, p.y - 7);
      }
    }
  }
}
