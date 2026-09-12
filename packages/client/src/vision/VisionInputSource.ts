import { EMPTY_FRAME, type InputFrame, type InputSource } from "@midnight/shared";
import { type Baseline, Calibration, type CalibrationPhase } from "./calibration";
import { frameLoop, openCamera } from "./camera";
import { classify, type GestureFlags } from "./classify";
import { VisionInputError } from "./errors";
import { emaLandmarks } from "./filters";
import { Block } from "./gestures/block";
import { Jump } from "./gestures/jump";
import { Punch } from "./gestures/punch";
import { Walk } from "./gestures/walk";
import {
  clearMetricBuffers, computeMetrics, createMetricBuffers, type MetricBuffers, type Metrics,
} from "./metrics";
import { EMA_ALPHA } from "./thresholds";
import {
  WorkerClient, type Landmark, type PoseResult, type ResultMessage, type WorkerStats,
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
  readonly gestures: GestureFlags;
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
    gestures: { left: false, right: false, jump: false, punchL: false, punchR: false, block: false },
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
  clearMetricBuffers(p.buffers);
  const g = p.gestures;
  g.left = g.right = g.jump = g.punchL = g.punchR = g.block = false;
}

/**
 * One worker result through the whole layer (5.04 rule 6): EMA → calibration.update → if ready:
 * metrics → gestures → classify → store frame. Touches no camera, worker or DOM.
 */
export function processLandmarks(p: Pipeline, pose: PoseResult | null, ts: number): DebugFrame {
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

  if (phase === "ready" && baseline && p.smoothed && p.smoothedWorld) {
    metrics = computeMetrics(p.smoothed, p.smoothedWorld, baseline, ts, p.buffers);
    const g = p.gestures;
    const walk = p.walk.update(metrics, ts);
    g.left = walk.left;
    g.right = walk.right;
    g.jump = p.jump.update(metrics, ts);
    g.block = p.block.update(metrics, ts);
    g.punchL = p.punchL.update(metrics, ts);
    g.punchR = p.punchR.update(metrics, ts);
    p.frame = classify(g);
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
  };
}

export class VisionInputSource implements InputSource {
  private readonly worker = new WorkerClient();
  private readonly pipeline = createPipeline();

  private videoEl: HTMLVideoElement | null = null;
  private stream: MediaStream | null = null;
  private stopLoop: (() => void) | null = null;
  private debugCb: ((f: DebugFrame) => void) | null = null;
  private running = false;

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
      await this.worker.start();
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

  calibrationState(): { phase: CalibrationPhase; progress: number } {
    return this.pipeline.calibration.state();
  }

  stats(): WorkerStats {
    return this.worker.stats;
  }

  onDebug(cb: (frame: DebugFrame) => void): void {
    this.debugCb = cb;
  }

  private handleResult(r: ResultMessage): void {
    const debug = processLandmarks(this.pipeline, r.pose, r.ts);
    this.debugCb?.(debug);
  }
}
