import { VisionInputError } from "./errors";

// ---- worker protocol (type-only for the worker; shared here so the main thread stays MediaPipe-free) ----

export type Delegate = "GPU" | "CPU";

/** Plain-object mirror of MediaPipe's NormalizedLandmark / Landmark. */
export interface Landmark {
  x: number;
  y: number;
  z: number;
  visibility: number;
}

export interface PoseResult {
  /** Image-normalised landmarks, 33 entries, x/y in [0, 1]. */
  landmarks: Landmark[];
  /** Metric landmarks relative to the hip centre; z is depth, positive away from the camera. */
  worldLandmarks: Landmark[];
}

export type WorkerInbound = { type: "init" } | { type: "frame"; bitmap: ImageBitmap; ts: number };

export type ResultMessage = {
  type: "result";
  ts: number;
  pose: PoseResult | null;
  poseMs: number;
  delegate: Delegate;
};

export type WorkerOutbound =
  | { type: "ready"; delegate: Delegate }
  | ResultMessage
  | { type: "error"; code: "model-load" };

/** The subset of Worker the client uses; injectable for tests. */
export interface WorkerLike {
  postMessage(message: WorkerInbound, transfer: Transferable[]): void;
  terminate(): void;
  onmessage: ((e: MessageEvent<WorkerOutbound>) => void) | null;
  onerror: ((e: ErrorEvent) => void) | null;
}

export interface WorkerStats {
  /** Results received in the last second. */
  fps: number;
  /** Inference time of the latest result, ms. */
  poseMs: number;
  /** Frames rejected by sendFrame because one was already in flight. */
  dropped: number;
  delegate: Delegate | null;
}

export interface WorkerClientOptions {
  createWorker?: () => WorkerLike;
  createBitmap?: (video: HTMLVideoElement) => Promise<ImageBitmap>;
  now?: () => number;
}

const defaultCreateWorker = (): WorkerLike =>
  new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
const defaultCreateBitmap = (video: HTMLVideoElement) => createImageBitmap(video);
const defaultNow = () => performance.now();

/** Main-thread side of the pose worker. Never more than one frame in flight. */
export class WorkerClient {
  readonly stats: WorkerStats = { fps: 0, poseMs: 0, dropped: 0, delegate: null };

  private readonly createWorker: () => WorkerLike;
  private readonly createBitmap: (video: HTMLVideoElement) => Promise<ImageBitmap>;
  private readonly now: () => number;

  private worker: WorkerLike | null = null;
  private ready = false;
  private inFlight = false;
  private resultCb: ((r: ResultMessage) => void) | null = null;
  private rejectStart: ((err: VisionInputError) => void) | null = null;
  private resultTimes: number[] = [];

  constructor(opts: WorkerClientOptions = {}) {
    this.createWorker = opts.createWorker ?? defaultCreateWorker;
    this.createBitmap = opts.createBitmap ?? defaultCreateBitmap;
    this.now = opts.now ?? defaultNow;
  }

  /** Spawns the worker and resolves once the model is loaded. */
  start(): Promise<{ delegate: Delegate }> {
    return new Promise((resolve, reject) => {
      let worker: WorkerLike;
      try {
        worker = this.createWorker();
      } catch (err) {
        reject(new VisionInputError("worker-failed", err));
        return;
      }
      this.worker = worker;
      this.rejectStart = reject;

      worker.onmessage = (e) => this.handleMessage(e.data, resolve);
      worker.onerror = (e) => {
        this.inFlight = false;
        if (!this.ready) {
          this.failStart(new VisionInputError("worker-failed", e.message ?? e));
        } else {
          console.error("[vision] worker error", e.message ?? e);
        }
      };
      worker.postMessage({ type: "init" }, []);
    });
  }

  /** Grabs the current video frame and sends it. Returns false (and counts a drop) if one is already in flight. */
  sendFrame(video: HTMLVideoElement, ts: number): boolean {
    if (!this.worker || !this.ready || this.inFlight) {
      this.stats.dropped++;
      return false;
    }
    this.inFlight = true;
    const worker = this.worker;
    this.createBitmap(video).then(
      (bitmap) => {
        if (this.worker !== worker) {
          bitmap.close();
          return;
        }
        worker.postMessage({ type: "frame", bitmap, ts }, [bitmap]);
      },
      (err: unknown) => {
        console.error("[vision] createImageBitmap failed", err);
        this.inFlight = false;
      },
    );
    return true;
  }

  onResult(cb: (r: ResultMessage) => void): void {
    this.resultCb = cb;
  }

  stop(): void {
    this.failStart(new VisionInputError("worker-failed", "stopped before ready"));
    this.worker?.terminate();
    this.worker = null;
    this.ready = false;
    this.inFlight = false;
    this.resultTimes = [];
  }

  private failStart(err: VisionInputError): void {
    const reject = this.rejectStart;
    this.rejectStart = null;
    reject?.(err);
  }

  private handleMessage(msg: WorkerOutbound, resolve: (v: { delegate: Delegate }) => void): void {
    switch (msg.type) {
      case "ready":
        this.ready = true;
        this.rejectStart = null;
        this.stats.delegate = msg.delegate;
        resolve({ delegate: msg.delegate });
        return;
      case "error":
        this.failStart(new VisionInputError(msg.code));
        return;
      case "result": {
        this.inFlight = false;
        this.stats.poseMs = msg.poseMs;
        this.stats.delegate = msg.delegate;
        const t = this.now();
        this.resultTimes.push(t);
        while (this.resultTimes.length > 0 && (this.resultTimes[0] as number) <= t - 1000) {
          this.resultTimes.shift();
        }
        this.stats.fps = this.resultTimes.length;
        this.resultCb?.(msg);
        return;
      }
    }
  }
}
