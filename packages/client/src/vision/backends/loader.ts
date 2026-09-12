/**
 * Backend selection and the throw guard the worker runs (9.07), kept pure so they are unit-tested: `loadBackend`
 * implements rule 1 (YOLO → MediaPipe → none, without ever blocking the pose), `GuardedBackend` the invariant
 * that a backend which throws on `BACKEND_MAX_THROWS` consecutive frames is disabled for the session.
 */
import { BACKEND_MAX_THROWS } from "../thresholds";
import type { ObjectBox } from "../workerClient";
import type { DetectorId, ObjectBackend } from "./ObjectBackend";

export interface BackendFactories {
  /** Async so the worker can lazy-`import()` the YOLO module: a MediaPipe session never downloads the runtime. */
  yolo(): Promise<ObjectBackend>;
  mediapipe(): ObjectBackend;
}

export interface LoadedBackend {
  /** null = objects off, pose-only play. */
  backend: ObjectBackend | null;
  /** True only when YOLO was requested and failed to load (MediaPipe or nothing took over). */
  fallback: boolean;
}

/** Rule 1: `yolo` falls back to MediaPipe with one warning; a missing detector is never fatal. */
export async function loadBackend(detector: DetectorId, delegate: "GPU" | "CPU", f: BackendFactories): Promise<LoadedBackend> {
  if (detector === "yolo") {
    try {
      const yolo = await f.yolo();
      await yolo.init(delegate);
      return { backend: yolo, fallback: false };
    } catch (err) {
      console.warn("[vision] yolo failed to load, falling back to mediapipe", err);
      return { backend: await tryMediapipe(delegate, f), fallback: true };
    }
  }
  return { backend: await tryMediapipe(delegate, f), fallback: false };
}

async function tryMediapipe(delegate: "GPU" | "CPU", f: BackendFactories): Promise<ObjectBackend | null> {
  try {
    const mp = f.mediapipe();
    await mp.init(delegate);
    return mp;
  } catch (err) {
    console.warn("[vision] object detector unavailable, playing pose-only", err);
    return null;
  }
}

/**
 * Wraps the loaded backend so `detect` never throws: a failure yields `objects: null` (logged once); after
 * `maxThrows` consecutive failures the backend is disposed and `id` becomes null for the rest of the session.
 */
export class GuardedBackend {
  private backend: ObjectBackend | null;
  private consecutiveThrows = 0;
  private logged = false;

  constructor(backend: ObjectBackend | null, private readonly maxThrows = BACKEND_MAX_THROWS) {
    this.backend = backend;
  }

  /** The live backend's id; null when objects are off (never loaded, or disabled after repeated throws). */
  get id(): DetectorId | null {
    return this.backend?.id ?? null;
  }

  async detect(bitmap: ImageBitmap, ts: number): Promise<{ boxes: ObjectBox[] | null; ms: number }> {
    const backend = this.backend;
    if (!backend) return { boxes: null, ms: 0 };
    try {
      const boxes = await backend.detect(bitmap, ts);
      this.consecutiveThrows = 0;
      return { boxes, ms: backend.lastMs };
    } catch (err) {
      this.consecutiveThrows++;
      if (!this.logged) {
        this.logged = true;
        console.error("[vision] object detector failed; this frame reports objects: null", err);
      }
      if (this.consecutiveThrows >= this.maxThrows) {
        console.error(`[vision] object detector disabled after ${this.consecutiveThrows} consecutive failures`);
        this.backend = null;
        backend.dispose();
      }
      return { boxes: null, ms: 0 };
    }
  }
}
