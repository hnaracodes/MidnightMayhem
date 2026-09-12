/**
 * Phase 6 calibration overlay. Renders `VisionInputSource.calibrationState()` into `#calibration` every
 * animation frame: prompt, 360 px progress (`.progress`), mirrored 320 px camera preview with the smoothed
 * skeleton from `onDebug`, and a Recalibrate button during the match.
 *
 * Two modes. `full` covers the screen while the lobby is up (index.html `.overlay .calib`). `compact` is a
 * small top-left box that never blocks the arena (pointer-events none except the button) so a lost player
 * sees why their fighter stopped. The pure `overlayModel` decides what each mode shows; the class only
 * paints it.
 */
import type { CalibrationPhase } from "../vision/calibration";
import type { DebugFrame, VisionInputSource } from "../vision/VisionInputSource";
import { COLOR_MARKER, COLOR_POSE } from "../vision/thresholds";
import type { Landmark } from "../vision/workerClient";
import type { DebugFeed } from "./cameraPreview";

export const STAND_STILL_PROMPT = "Stand still, arms at your sides";
export const LOST_PROMPT = "Tracking lost — step back into view";
export const STARTING_PROMPT = "Starting camera…";

export type OverlayMode = "full" | "compact";

export interface OverlayModel {
  visible: boolean;
  /** Null hides the prompt and the bar. */
  prompt: string | null;
  /** 0..1 fill of the progress bar. */
  progress: number;
  /** Show the mirrored preview with the skeleton. */
  preview: boolean;
  /** Show the Recalibrate button. */
  recalibrate: boolean;
}

const HIDDEN: OverlayModel = { visible: false, prompt: null, progress: 0, preview: false, recalibrate: false };

/** State → what to draw. Pure so it runs in node tests. */
export function overlayModel(state: { phase: CalibrationPhase; progress: number }, mode: OverlayMode): OverlayModel {
  const inMatch = mode === "compact";
  switch (state.phase) {
    case "idle":
      return inMatch
        ? HIDDEN
        : { visible: true, prompt: STARTING_PROMPT, progress: 0, preview: false, recalibrate: false };
    case "calibrating":
      return { visible: true, prompt: STAND_STILL_PROMPT, progress: state.progress, preview: true, recalibrate: inMatch };
    case "lost":
      return { visible: true, prompt: LOST_PROMPT, progress: 0, preview: true, recalibrate: inMatch };
    case "ready":
      return inMatch ? { visible: true, prompt: null, progress: 1, preview: false, recalibrate: true } : HIDDEN;
  }
}

/** MediaPipe pose connections drawn in the preview: torso, arms, legs, nose to eyes (same set as the harness). */
const BONES: [number, number][] = [
  [0, 2], [0, 5], [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28],
];
const MARKERS = [0, 11, 12, 15, 16, 23, 24];
/** Preview width in px: 4.08 rule 7 in the lobby, small enough to clear the HUD during the match. */
const PREVIEW_WIDTH = { full: 320, compact: 160 } as const;

export class CalibrationOverlay {
  private readonly root: HTMLElement;
  private readonly prompt: HTMLParagraphElement;
  private readonly progress: HTMLDivElement;
  private readonly fill: HTMLSpanElement;
  private readonly preview: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly actions: HTMLDivElement;
  private readonly recalibrate: HTMLButtonElement;
  private readonly back: HTMLButtonElement;

  private source: VisionInputSource | null = null;
  private video: HTMLVideoElement | null = null;
  private landmarks: Landmark[] | null = null;
  private mode: OverlayMode = "full";
  private raf = 0;
  private shown = false;
  /** "Back to lobby" or tracking loss while in the lobby: use the compact box so Ready stays reachable. */
  private collapsed = false;

  constructor() {
    const root = document.getElementById("calibration");
    if (!root) throw new Error("Missing #calibration");
    this.root = root;

    this.prompt = document.createElement("p");
    this.progress = document.createElement("div");
    this.progress.className = "progress";
    this.progress.setAttribute("role", "progressbar");
    this.fill = document.createElement("span");
    this.progress.append(this.fill);

    this.preview = document.createElement("div");
    this.preview.className = "calib-preview";
    this.canvas = document.createElement("canvas");
    this.canvas.width = 640;
    this.canvas.height = 480;
    this.preview.append(this.canvas);
    placePreviewChild(this.canvas);

    this.recalibrate = button("Recalibrate");
    this.recalibrate.addEventListener("click", () => {
      void this.source?.recalibrate();
    });
    this.back = button("Back to lobby");
    this.back.addEventListener("click", () => {
      this.collapsed = true;
    });
    this.actions = document.createElement("div");
    this.actions.className = "actions";
    this.actions.append(this.recalibrate, this.back);

    this.root.replaceChildren(this.prompt, this.progress, this.actions, this.preview);
  }

  /** `feed` defaults to the source; pass a `debugFanOut` when the camera preview also listens to onDebug. */
  bind(source: VisionInputSource, feed: DebugFeed = source): void {
    this.source = source;
    this.collapsed = false;
    feed.onDebug((frame: DebugFrame) => {
      this.landmarks = frame.landmarks;
    });
  }

  /** `full` while the lobby is on screen, `compact` once the match runs. */
  setMode(mode: OverlayMode): void {
    if (mode === "compact") this.collapsed = false;
    this.mode = mode;
  }

  show(): void {
    if (this.shown) return;
    this.shown = true;
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

  private render(): void {
    const state = this.source?.calibrationState() ?? { phase: "idle" as const, progress: 0 };
    const compact = this.mode === "compact" || this.collapsed;
    // A lost pose while the lobby is up hands the screen back so Ready stays reachable (rule 2, invariant).
    if (this.mode === "full" && state.phase === "lost") this.collapsed = true;
    const model = overlayModel(state, compact ? "compact" : "full");

    this.root.hidden = !model.visible;
    this.root.dataset["mode"] = compact ? "compact" : "full";
    if (!model.visible) return;

    applyLayout({ root: this.root, prompt: this.prompt, progress: this.progress, preview: this.preview }, compact);
    this.prompt.hidden = model.prompt === null;
    this.prompt.textContent = model.prompt ?? "";
    this.progress.hidden = model.prompt === null;
    this.fill.style.width = `${Math.round(model.progress * 100)}%`;
    this.progress.setAttribute("aria-valuenow", String(Math.round(model.progress * 100)));
    this.recalibrate.hidden = !model.recalibrate;
    this.back.hidden = compact;
    this.actions.hidden = this.recalibrate.hidden && this.back.hidden;

    this.preview.hidden = !model.preview;
    if (model.preview) {
      this.attachVideo();
      this.drawSkeleton();
    }
  }

  private attachVideo(): void {
    const video = this.source?.video ?? null;
    if (video === this.video) return;
    this.video?.remove();
    this.video = video;
    if (video) {
      placePreviewChild(video);
      this.preview.prepend(video);
    }
  }

  /** Mirrored to match the CSS-mirrored video (x → 1 − x), like the harness overlay. */
  private drawSkeleton(): void {
    const ctx = this.canvas.getContext("2d");
    if (!ctx) return;
    const { width: w, height: h } = this.canvas;
    ctx.clearRect(0, 0, w, h);
    const lms = this.landmarks;
    if (!lms) return;
    const px = (l: Landmark) => ({ x: (1 - l.x) * w, y: l.y * h });

    ctx.lineWidth = 4;
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
    for (const i of MARKERS) {
      const l = lms[i];
      if (!l || l.visibility < 0.5) continue;
      const p = px(l);
      ctx.fillStyle = i === 15 || i === 16 ? COLOR_MARKER : COLOR_POSE;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 7, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/**
 * Full mode relies on the stylesheet (`.overlay .calib`). Compact mode overrides it inline: a small top-left
 * box that lets pointer events through to the arena; only the buttons are clickable. The preview box is
 * pinned bottom-left at 320 px in full mode (4.08 rule 7) and sits inside the box at 160 px in compact mode.
 */
function applyLayout(
  { root, prompt, progress, preview }: { root: HTMLElement; prompt: HTMLElement; progress: HTMLElement; preview: HTMLElement },
  compact: boolean,
): void {
  const layout = compact ? "compact" : "full";
  if (root.dataset["layout"] === layout) return;
  root.dataset["layout"] = layout;
  const width = PREVIEW_WIDTH[layout];
  const height = Math.round(width * 0.75);

  root.removeAttribute("style");
  prompt.style.fontSize = compact ? "16px" : "";
  progress.style.width = compact ? `${width}px` : "";
  progress.style.height = compact ? "10px" : "";
  if (compact) {
    Object.assign(root.style, {
      inset: "auto",
      top: "max(120px, 24vh)", // below the HUD band and the .banner--match strip
      left: "16px",
      width: `${width + 36}px`,
      padding: "12px 16px",
      gap: "10px",
      alignItems: "flex-start",
      justifyContent: "flex-start",
      textAlign: "left",
      fontSize: "16px",
      background: "rgba(7, 11, 24, 0.85)",
      border: "2px solid var(--steel-1)",
      borderRadius: "8px",
      pointerEvents: "none",
      overflow: "visible",
    } satisfies Partial<CSSStyleDeclaration>);
  }
  Object.assign(preview.style, {
    position: compact ? "relative" : "fixed",
    left: compact ? "" : "16px",
    bottom: compact ? "" : "16px",
    width: `${width}px`,
    height: `${height}px`,
    border: "2px solid var(--steel-2)",
    borderRadius: "6px",
    overflow: "hidden",
    background: "var(--night-0)",
  } satisfies Partial<CSSStyleDeclaration>);
  for (const el of Array.from(preview.children) as HTMLElement[]) placePreviewChild(el);
}

/** Video and canvas both fill the preview box; the stylesheet's fixed pin is overridden. */
function placePreviewChild(el: HTMLElement): void {
  Object.assign(el.style, {
    position: "absolute",
    inset: "0",
    width: "100%",
    height: "100%",
    maxWidth: "none",
    border: "0",
    borderRadius: "0",
    background: "transparent",
    pointerEvents: "none",
    objectFit: "cover",
  } satisfies Partial<CSSStyleDeclaration>);
  if (el instanceof HTMLVideoElement) el.style.transform = "scaleX(-1)";
}

function button(label: string): HTMLButtonElement {
  const el = document.createElement("button");
  el.type = "button";
  el.className = "btn";
  el.textContent = label;
  el.style.pointerEvents = "auto";
  el.style.fontSize = "14px";
  el.style.padding = "8px 14px";
  return el;
}
