/**
 * In-match camera preview (integrator amendment to Phase 6): a fixed 240 px box in the bottom-left corner
 * showing the mirrored camera with the smoothed skeleton and (9.04) the detector's boxes, a row of nine
 * input dots (L R J PL PR B SP CH SW) plus the held item's label, a status line and, when the vision layer reports
 * punch diagnostics, one gate row per hand. Pointer events pass through to the arena. The pure `previewModel`
 * decides what the rows show; the class only paints it.
 *
 * The camera stream is never opened twice: every animation frame the source's own `<video>` is drawn onto
 * the preview canvas (mirrored), so the element itself can stay wherever the calibration overlay put it.
 */
import { ITEMS, type InputKey, type ItemId } from "@midnight/shared";
import type { CalibrationPhase } from "../vision/calibration";
import {
  CHOP_DROP, COLOR_LABEL, COLOR_MARKER, COLOR_POSE, SWEEP_TRAVEL, WINDUP_ELBOW_DEG, WINDUP_RAISE,
} from "../vision/thresholds";
import type { PunchDiag } from "../vision/gestures/punch";
import type { SlashDiag } from "../vision/gestures/slash";
import type { WindupDiag } from "../vision/gestures/windup";
export type { PunchDiag };
import type { DebugFrame, VisionInputSource } from "../vision/VisionInputSource";
import type { Landmark, ObjectBox } from "../vision/workerClient";

export type PreviewFrame = DebugFrame & { fps?: number };

export const DOT_KEYS: readonly InputKey[] = [
  "left", "right", "jump", "punchL", "punchR", "block", "special", "chop", "sweep",
];
export const DOT_LABELS: readonly string[] = ["L", "R", "J", "PL", "PR", "B", "SP", "CH", "SW"];
export const GATE_NAMES = ["ext", "depth", "thrust", "jab"] as const;
/** 9.10 rows: the wind-up gates (elbow, raise, active) and the slash gates (chop, sweep). */
export const WINDUP_NAMES = ["elbow", "raise", "windup"] as const;
export const SLASH_NAMES = ["chop", "sweep"] as const;
export type WindupName = (typeof WINDUP_NAMES)[number];
export type SlashName = (typeof SLASH_NAMES)[number];

export interface WindupRow {
  /** elbow ≤ WINDUP_ELBOW_DEG */
  elbow: boolean;
  /** raise ≥ WINDUP_RAISE */
  raise: boolean;
  windup: boolean;
  /** Elbow angle in degrees, for the label. */
  elbowDeg: number;
}

export interface SlashRow {
  /** The chop gates all pass this frame (or the pulse fired). */
  chop: boolean;
  sweep: boolean;
  /** Punch suppressed by SLASH_EXCLUSIVE_MS. */
  exclusive: boolean;
}
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
  /** The held item (9.04), or null; `itemLabel` is ITEMS[item].label or "". */
  item: ItemId | null;
  itemLabel: string;
  /** The laser pose (9.04). */
  special: boolean;
  /** 9.10 wind-up row per arm, null until the frame carries wind-up diagnostics. */
  windup: { L: WindupRow; R: WindupRow } | null;
  /** 9.10 slash row per arm, null until the frame carries slash diagnostics. */
  slash: { L: SlashRow; R: SlashRow } | null;
}

export function previewModel(frame: PreviewFrame | null, fps?: number): PreviewModel {
  if (!frame) {
    return {
      dots: DOT_KEYS.map(() => false), status: "no camera", gates: null, item: null, itemLabel: "", special: false,
      windup: null, slash: null,
    };
  }
  const dots = DOT_KEYS.map((key) => frame.frame[key]);
  const status = statusText(frame.calibration.phase, frame.calibration.progress, frame.fps ?? fps);
  const punch = frame.punch;
  const gates = punch ? { L: gateRow(punch.L), R: gateRow(punch.R) } : null;
  const item = frame.frame.item;
  const w = frame.windup;
  const windup = w ? { L: windupRow(w.L), R: windupRow(w.R) } : null;
  const sl = frame.slash;
  const slash = sl ? { L: slashRow(sl.L), R: slashRow(sl.R) } : null;
  return {
    dots, status, gates, item, itemLabel: item ? ITEMS[item].label : "", special: frame.frame.special, windup, slash,
  };
}

/**
 * The boxes the preview should draw after `frame` (9.04): the detector runs on every OBJECT_EVERY_N-th pose
 * frame and the others carry `objects: null`, so the last detector result is kept until the next one to
 * avoid a one-frame-in-three flicker. Losing the pose drops them.
 */
export function retainBoxes(prev: ObjectBox[] | null, frame: PreviewFrame): ObjectBox[] | null {
  if (!frame.landmarks) return null;
  return frame.objects ?? prev;
}

function statusText(phase: CalibrationPhase, progress: number, fps: number | undefined): string {
  const parts = [phase === "calibrating" ? `calibrating ${Math.round(progress * 100)}%` : phase];
  if (fps !== undefined && fps > 0) parts.push(`${Math.round(fps)} fps`);
  return parts.join(" · ");
}

function windupRow(d: WindupDiag): WindupRow {
  return { elbow: d.elbow <= WINDUP_ELBOW_DEG, raise: d.raise >= WINDUP_RAISE, windup: d.active, elbowDeg: d.elbow };
}

function slashRow(d: SlashDiag): SlashRow {
  return {
    chop: d.chop || (d.aboveNose && d.chopExt) || d.chopDrop >= CHOP_DROP,
    sweep: d.sweep || (d.sweepCross && d.sweepTravel >= SWEEP_TRAVEL),
    exclusive: d.exclusive,
  };
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
  private readonly itemGlyph: HTMLSpanElement;
  /** Last detector boxes, kept across the detector's off frames (see retainBoxes). */
  private boxes: ObjectBox[] | null = null;
  private readonly status: HTMLDivElement;
  private readonly gates: HTMLDivElement;
  private readonly gateGlyphs: Record<"L" | "R", { label: HTMLSpanElement; glyphs: Record<GateName, HTMLSpanElement> }>;
  private readonly windupGlyphs: Record<
    "L" | "R", { row: HTMLDivElement; label: HTMLSpanElement; glyphs: Record<WindupName, HTMLSpanElement> }
  >;
  private readonly slashGlyphs: Record<
    "L" | "R", { row: HTMLDivElement; label: HTMLSpanElement; glyphs: Record<SlashName, HTMLSpanElement> }
  >;

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
    this.itemGlyph = document.createElement("span");
    this.itemGlyph.className = "campreview-item on";
    this.itemGlyph.hidden = true;
    dots.append(this.itemGlyph);

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
    const extraRow = <N extends string>(hand: "L" | "R", names: readonly N[], cls: string) => {
      const row = document.createElement("div");
      row.className = cls;
      const label = document.createElement("span");
      label.className = "campreview-hand";
      label.textContent = hand;
      row.append(label);
      const glyphs = {} as Record<N, HTMLSpanElement>;
      for (const name of names) {
        const cell = document.createElement("span");
        cell.className = "campreview-gate";
        const glyph = document.createElement("b");
        cell.append(name, glyph);
        row.append(cell);
        glyphs[name] = glyph;
      }
      this.gates.append(row);
      return { row, label, glyphs };
    };
    this.windupGlyphs = { L: extraRow("L", WINDUP_NAMES, "campreview-windup"), R: extraRow("R", WINDUP_NAMES, "campreview-windup") };
    this.slashGlyphs = { L: extraRow("L", SLASH_NAMES, "campreview-slash"), R: extraRow("R", SLASH_NAMES, "campreview-slash") };

    this.root.replaceChildren(view, dots, this.status, this.gates);
  }

  /** `feed` defaults to the source; pass a `debugFanOut` when something else also listens to onDebug. */
  bind(source: VisionInputSource, feed: DebugFeed = source): void {
    this.source = source;
    feed.onDebug((frame) => {
      this.frame = frame as PreviewFrame;
      this.boxes = retainBoxes(this.boxes, this.frame);
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
    this.itemGlyph.hidden = model.item === null;
    this.itemGlyph.textContent = model.itemLabel;
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
    for (const hand of ["L", "R"] as const) {
      const w = model.windup?.[hand];
      const we = this.windupGlyphs[hand];
      we.row.hidden = !w;
      if (w) {
        we.label.classList.toggle("on", w.windup);
        we.glyphs.elbow.textContent = `${w.elbowDeg.toFixed(0)}°${w.elbow ? "✓" : "✗"}`;
        we.glyphs.elbow.className = w.elbow ? "ok" : "no";
        we.glyphs.raise.textContent = w.raise ? "✓" : "✗";
        we.glyphs.raise.className = w.raise ? "ok" : "no";
        we.glyphs.windup.textContent = w.windup ? "✓" : "✗";
        we.glyphs.windup.className = w.windup ? "ok" : "no";
      }
      const sl = model.slash?.[hand];
      const se = this.slashGlyphs[hand];
      se.row.hidden = !sl;
      if (sl) {
        se.label.classList.toggle("on", sl.exclusive);
        for (const name of SLASH_NAMES) {
          const ok = sl[name];
          se.glyphs[name].textContent = ok ? "✓" : "✗";
          se.glyphs[name].className = ok ? "ok" : "no";
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
    if (!f) return;
    if (this.boxes) this.drawBoxes(ctx, this.boxes, f.item, w, h);
    const lms = f.landmarks;
    if (!lms) return;
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
    const special = f.gestures.special;
    const wristHot = (i: number) =>
      crossed || special || (i === 15 ? f.gestures.punchL : i === 16 ? f.gestures.punchR : false);
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

  /** Detector boxes (9.04), mirrored like the skeleton, labelled; the held item's label is drawn hot. */
  private drawBoxes(ctx: CanvasRenderingContext2D, boxes: ObjectBox[], item: ItemId | null, w: number, h: number): void {
    ctx.lineWidth = 2;
    ctx.font = "bold 11px system-ui, sans-serif";
    ctx.textBaseline = "bottom";
    for (const b of boxes) {
      const x = (1 - b.x - b.w) * w;
      const y = b.y * h;
      const bw = b.w * w;
      const bh = b.h * h;
      const held = item !== null && ITEMS[item].cocoLabel === b.label;
      ctx.strokeStyle = held ? COLOR_MARKER : COLOR_POSE;
      ctx.strokeRect(x, y, bw, bh);
      const text = `${b.label} ${Math.round(b.score * 100)}`;
      const tw = ctx.measureText(text).width + 6;
      ctx.fillStyle = held ? COLOR_MARKER : COLOR_POSE;
      ctx.fillRect(x, Math.max(0, y - 14), tw, 14);
      ctx.fillStyle = held ? COLOR_LABEL : "#070B18";
      ctx.fillText(text, x + 3, Math.max(14, y));
    }
  }
}
