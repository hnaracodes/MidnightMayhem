import { EMPTY_FRAME, type InputFrame, type InputSource } from "@midnight/shared";
import { Calibration, type CalibrationPhase } from "./calibration";
import { frameLoop, openCamera } from "./camera";
import { classify, type GestureFlags } from "./classify";
import { VisionInputError } from "./errors";
import { emaLandmarks } from "./filters";
import { Block } from "./gestures/block";
import { Jump } from "./gestures/jump";
import { Punch } from "./gestures/punch";
import { Walk } from "./gestures/walk";
import { clearMetricBuffers, computeMetrics, createMetricBuffers, type Metrics } from "./metrics";
import { EMA_ALPHA } from "./thresholds";
import { WorkerClient, type Landmark, type ResultMessage, type WorkerStats } from "./workerClient";

/** Everything the harness and the calibration preview may look at. Landmarks leave the layer only here. */
export interface DebugFrame {
  /** Smoothed image landmarks, or null when no pose was found. */
  landmarks: Landmark[] | null;
  /** Null unless calibration is ready. */
  metrics: Metrics | null;
  gestures: GestureFlags;
  frame: Readonly<InputFrame>;
  ts: number;
}

export class VisionInputSource implements InputSource {
  private readonly worker = new WorkerClient();
  private readonly calibration = new Calibration();
  private readonly buffers = createMetricBuffers();
  private readonly walk = new Walk();
  private readonly jump = new Jump();
  private readonly block = new Block();
  private readonly punchL = new Punch("L");
  private readonly punchR = new Punch("R");
  private readonly gestures: GestureFlags = {
    left: false, right: false, jump: false, punchL: false, punchR: false, block: false,
  };

  private frame: Readonly<InputFrame> = EMPTY_FRAME;
  private smoothed: Landmark[] | null = null;
  private smoothedWorld: Landmark[] | null = null;
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
    this.resetGestures();
    this.smoothed = null;
    this.smoothedWorld = null;
    this.frame = EMPTY_FRAME;
    this.running = false;
  }

  /** A property read: the latest classified frame, or EMPTY_FRAME when calibration is not ready. */
  sample(): Readonly<InputFrame> {
    return this.frame;
  }

  calibrate(): Promise<void> {
    return this.calibration.begin();
  }

  calibrationState(): { phase: CalibrationPhase; progress: number } {
    return this.calibration.state();
  }

  stats(): WorkerStats {
    return this.worker.stats;
  }

  onDebug(cb: (frame: DebugFrame) => void): void {
    this.debugCb = cb;
  }

  private handleResult(r: ResultMessage): void {
    if (r.pose) {
      this.smoothed = emaLandmarks(this.smoothed, r.pose.landmarks, EMA_ALPHA);
      this.smoothedWorld = emaLandmarks(this.smoothedWorld, r.pose.worldLandmarks, EMA_ALPHA);
    } else {
      this.smoothed = null;
      this.smoothedWorld = null;
    }

    this.calibration.update(this.smoothed, r.ts);
    const baseline = this.calibration.baseline;
    let metrics: Metrics | null = null;

    if (this.calibration.state().phase === "ready" && baseline && this.smoothed && this.smoothedWorld) {
      metrics = computeMetrics(this.smoothed, this.smoothedWorld, baseline, r.ts, this.buffers);
      const g = this.gestures;
      const walk = this.walk.update(metrics, r.ts);
      g.left = walk.left;
      g.right = walk.right;
      g.jump = this.jump.update(metrics, r.ts);
      g.block = this.block.update(metrics, r.ts);
      g.punchL = this.punchL.update(metrics, r.ts);
      g.punchR = this.punchR.update(metrics, r.ts);
      this.frame = classify(g);
    } else {
      this.resetGestures();
      this.frame = EMPTY_FRAME;
    }

    this.debugCb?.({ landmarks: this.smoothed, metrics, gestures: this.gestures, frame: this.frame, ts: r.ts });
  }

  private resetGestures(): void {
    this.walk.reset();
    this.jump.reset();
    this.block.reset();
    this.punchL.reset();
    this.punchR.reset();
    clearMetricBuffers(this.buffers);
    const g = this.gestures;
    g.left = g.right = g.jump = g.punchL = g.punchR = g.block = false;
  }
}
