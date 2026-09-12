import { EMPTY_FRAME, type InputFrame, type InputSource, type ItemId } from "@midnight/shared";
import type { DetectorId } from "./backends/ObjectBackend";
import { type Baseline, Calibration, type CalibrationPhase } from "./calibration";
import { frameLoop, openCamera } from "./camera";
import { classify, type GestureFlags } from "./classify";
import { VisionInputError } from "./errors";
import { emaLandmarks, RingBuffer } from "./filters";
import { Block } from "./gestures/block";
import { Jump } from "./gestures/jump";
import { Laser } from "./gestures/laser";
import { Punch, type PunchDiag } from "./gestures/punch";
import { Slash, type SlashDiag } from "./gestures/slash";
import { Windup, type WindupDiag } from "./gestures/windup";
import { Walk } from "./gestures/walk";
import {
  clearMetricBuffers, computeMetrics, createMetricBuffers, type MetricBuffers, type Metrics,
} from "./metrics";
import { HoldTracker, heldItem } from "./objects";
import { DETECTOR_DEFAULT, EMA_ALPHA, RECORDER_SECONDS } from "./thresholds";
import {
  WorkerClient, type Landmark, type ObjectBox, type PoseResult, type ResultMessage, type WorkerStats,
} from "./workerClient";

/** Everything the harness and the calibration preview may look at. Landmarks leave the layer only here. */
export interface DebugFrame {
  /** Smoothed image landmarks, or null when no pose was found. */
  landmarks: Landmark[] | null;
  /** Null unless calibration is ready. */
  metrics: Metrics | null;
  gestures: GestureFlags;
  frame: Readonly<InputFrame>;
  calibration: { phase: CalibrationPhase; progress: number; baseline: Baseline | null };
  ts: number;
  /** Per-arm punch gates (integrator amendment); absent unless calibration is ready. */
  punch?: { L: PunchDiag; R: PunchDiag };
  /** Detector boxes for this result (9.04), or null when the detector did not run on it. */
  objects: ObjectBox[] | null;
  /** The debounced held item (9.04), or null. */
  item: ItemId | null;
  /** 9.10 wind-up gates per arm; absent unless calibration is ready. */
  windup?: { L: WindupDiag; R: WindupDiag };
  /** 9.10 slash gates per arm; absent unless calibration is ready. */
  slash?: { L: SlashDiag; R: SlashDiag };
}

export type { PunchDiag } from "./gestures/punch";
export type { SlashDiag } from "./gestures/slash";
export type { WindupDiag } from "./gestures/windup";

/** One recorder sample (integrator amendment): what the harness saw at `ts`, safe to serialise. */
export interface RecorderSample {
  ts: number;
  metrics: Metrics | null;
  gestures: GestureFlags;
  frame: Readonly<InputFrame>;
  punch?: { L: PunchDiag; R: PunchDiag };
  item: ItemId | null;
}

/**
 * Everything the per-result pipeline reads and mutates: smoothing state, calibration, ring buffers,
 * gesture debounces and the latest frame. One per VisionInputSource; tests build their own so the
 * exact code path the camera feeds can run on synthetic landmarks (integrator amendment to 5.04).
 */
export interface Pipeline {
  readonly calibration: Calibration;
  readonly buffers: MetricBuffers;
  readonly walk: Walk;
  readonly jump: Jump;
  readonly block: Block;
  readonly punchL: Punch;
  readonly punchR: Punch;
  readonly laser: Laser;
  readonly windupL: Windup;
  readonly windupR: Windup;
  readonly slashL: Slash;
  readonly slashR: Slash;
  readonly hold: HoldTracker;
  readonly gestures: GestureFlags;
  /** What the local fighter holds per the arena's last snapshot (9.10); null when nothing or unknown. */
  held: ItemId | null;
  smoothed: Landmark[] | null;
  smoothedWorld: Landmark[] | null;
  frame: Readonly<InputFrame>;
}

export function createPipeline(): Pipeline {
  return {
    calibration: new Calibration(),
    buffers: createMetricBuffers(),
    walk: new Walk(),
    jump: new Jump(),
    block: new Block(),
    punchL: new Punch("L"),
    punchR: new Punch("R"),
    laser: new Laser(),
    windupL: new Windup("L"),
    windupR: new Windup("R"),
    slashL: new Slash("L"),
    slashR: new Slash("R"),
    hold: new HoldTracker(),
    gestures: {
      left: false, right: false, jump: false, punchL: false, punchR: false, block: false, special: false, item: null,
      windupL: false, windupR: false, chop: false, sweep: false, slashL: false, slashR: false, held: null,
    },
    held: null,
    smoothed: null,
    smoothedWorld: null,
    frame: EMPTY_FRAME,
  };
}

/** 5.03 rule 5: gestures and their buffers restart whenever a frame cannot be classified. */
function resetGestures(p: Pipeline): void {
  p.walk.reset();
  p.jump.reset();
  p.block.reset();
  p.punchL.reset();
  p.punchR.reset();
  p.laser.reset();
  p.windupL.reset();
  p.windupR.reset();
  p.slashL.reset();
  p.slashR.reset();
  // The hold tracker deliberately survives a dropped pose frame: HOLD_OFF_MS times it out instead, so a held
  // item does not need a fresh HOLD_ON run after every one-frame tracking loss (review finding).
  clearMetricBuffers(p.buffers);
  const g = p.gestures;
  g.left = g.right = g.jump = g.punchL = g.punchR = g.block = g.special = false;
  g.windupL = g.windupR = g.chop = g.sweep = g.slashL = g.slashR = false;
  g.item = null;
  g.held = p.held;
}

/**
 * One worker result through the whole layer (5.04 rule 6): EMA → calibration.update → if ready:
 * metrics → gestures → held item → classify → store frame. Touches no camera, worker or DOM.
 * `objects` (9.04) is the detector's boxes for this result; null means it did not run, in which case
 * the hold tracker keeps its last item (it times out by itself).
 */
export function processLandmarks(
  p: Pipeline,
  pose: PoseResult | null,
  ts: number,
  objects: ObjectBox[] | null = null,
): DebugFrame {
  if (pose) {
    p.smoothed = emaLandmarks(p.smoothed, pose.landmarks, EMA_ALPHA);
    p.smoothedWorld = emaLandmarks(p.smoothedWorld, pose.worldLandmarks, EMA_ALPHA);
  } else {
    p.smoothed = null;
    p.smoothedWorld = null;
  }

  p.calibration.update(p.smoothed, ts);
  const baseline = p.calibration.baseline;
  const { phase, progress } = p.calibration.state();
  let metrics: Metrics | null = null;
  let punch: DebugFrame["punch"];
  let windup: DebugFrame["windup"];
  let slash: DebugFrame["slash"];

  if (phase === "ready" && baseline && p.smoothed && p.smoothedWorld) {
    metrics = computeMetrics(p.smoothed, p.smoothedWorld, baseline, ts, p.buffers, pose?.landmarks);
    const g = p.gestures;
    const walk = p.walk.update(metrics, ts);
    g.left = walk.left;
    g.right = walk.right;
    g.jump = p.jump.update(metrics, ts);
    g.block = p.block.update(metrics, ts);
    g.punchL = p.punchL.update(metrics, ts);
    g.punchR = p.punchR.update(metrics, ts);
    g.special = p.laser.update(metrics, ts);
    g.held = p.held;
    g.windupL = p.windupL.update(metrics, ts, p.held);
    g.windupR = p.windupR.update(metrics, ts, p.held);
    const sL = p.slashL.update(metrics, ts, p.held);
    const sR = p.slashR.update(metrics, ts, p.held);
    g.chop = sL.chop || sR.chop;
    g.sweep = sL.sweep || sR.sweep;
    g.slashL = sL.exclusive;
    g.slashR = sR.exclusive;
    g.item = objects !== null ? p.hold.update(heldItem(objects, p.smoothed, baseline.S), ts) : p.hold.peek(ts);
    p.frame = classify(g);
    punch = { L: p.punchL.diag(), R: p.punchR.diag() };
    windup = { L: p.windupL.diag(), R: p.windupR.diag() };
    slash = { L: p.slashL.diag(), R: p.slashR.diag() };
  } else {
    resetGestures(p);
    p.frame = EMPTY_FRAME;
  }

  return {
    landmarks: p.smoothed,
    metrics,
    gestures: p.gestures,
    frame: p.frame,
    calibration: { phase, progress, baseline },
    ts,
    ...(punch ? { punch } : {}),
    objects,
    item: p.gestures.item,
    ...(windup ? { windup } : {}),
    ...(slash ? { slash } : {}),
  };
}

export interface VisionInputSourceOptions {
  /** Which object detector the worker loads (9.07); defaults to DETECTOR_DEFAULT. */
  detector?: DetectorId;
}

export class VisionInputSource implements InputSource {
  private readonly worker = new WorkerClient();
  private readonly pipeline = createPipeline();
  private readonly detector: DetectorId;

  private videoEl: HTMLVideoElement | null = null;
  private stream: MediaStream | null = null;
  private stopLoop: (() => void) | null = null;
  private debugCb: ((f: DebugFrame) => void) | null = null;
  private running = false;
  private readonly recorder = new RingBuffer<RecorderSample>(RECORDER_SECONDS * 1000);

  constructor(opts: VisionInputSourceOptions = {}) {
    this.detector = opts.detector ?? DETECTOR_DEFAULT;
  }

  /** The hidden, mirrored camera element this source owns. Hosts may attach it for a preview. */
  get video(): HTMLVideoElement | null {
    return this.videoEl;
  }

  /** Opens the camera, loads the model, then calibrates. Resolves when calibration is ready. */
  async start(): Promise<void> {
    if (this.running) return this.calibrate();
    this.running = true;
    try {
      const { video, stream } = await openCamera();
      this.videoEl = video;
      this.stream = stream;
      await this.worker.start(this.detector);
      this.worker.onResult((r) => this.handleResult(r));
      this.stopLoop = frameLoop(video, (ts) => {
        this.worker.sendFrame(video, ts);
      });
      await this.calibrate();
    } catch (err) {
      this.stop();
      throw err instanceof VisionInputError ? err : new VisionInputError("worker-failed", err);
    }
  }

  stop(): void {
    this.stopLoop?.();
    this.stopLoop = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (this.videoEl) {
      this.videoEl.pause();
      this.videoEl.srcObject = null;
      this.videoEl = null;
    }
    this.worker.stop();
    resetGestures(this.pipeline);
    this.pipeline.hold.reset();
    this.pipeline.smoothed = null;
    this.pipeline.smoothedWorld = null;
    this.pipeline.frame = EMPTY_FRAME;
    this.running = false;
  }

  /** A property read: the latest classified frame, or EMPTY_FRAME when calibration is not ready. */
  sample(): Readonly<InputFrame> {
    return this.pipeline.frame;
  }

  calibrate(): Promise<void> {
    return this.pipeline.calibration.begin();
  }

  /**
   * 9.10: what the local fighter holds per the last snapshot (sim truth, not the detector). The arena calls
   * this every snapshot; the wind-up runs only for a throwable and the slashes only for the sword.
   */
  setHeldItem(item: ItemId | null): void {
    this.pipeline.held = item;
  }

  calibrationState(): { phase: CalibrationPhase; progress: number } {
    return this.pipeline.calibration.state();
  }

  stats(): WorkerStats {
    return this.worker.stats;
  }

  onDebug(cb: (frame: DebugFrame) => void): void {
    this.debugCb = cb;
  }

  /** The last RECORDER_SECONDS of samples, oldest first (integrator amendment). Landmarks are not included. */
  dump(): RecorderSample[] {
    return this.recorder.values();
  }

  private handleResult(r: ResultMessage): void {
    const debug = processLandmarks(this.pipeline, r.pose, r.ts, r.objects);
    // The pipeline reuses its gesture object, so the sample takes a copy; metrics, frame and punch are fresh.
    this.recorder.push(r.ts, {
      ts: debug.ts,
      metrics: debug.metrics,
      gestures: { ...debug.gestures },
      frame: debug.frame,
      ...(debug.punch ? { punch: debug.punch } : {}),
      item: debug.item,
    });
    this.debugCb?.(debug);
  }
}
