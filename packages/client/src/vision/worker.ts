/// <reference lib="webworker" />
/**
 * Web Worker entry. Owns the Pose Landmarker and (9.04 / 9.07) one object-detection backend; the main thread
 * only ever sees plain landmark arrays and plain boxes. Protocol: see WorkerInbound / WorkerOutbound in
 * workerClient.ts. `init` names the backend; YOLO falls back to MediaPipe when it cannot load (rule 1).
 */
import type { PoseLandmarker } from "@mediapipe/tasks-vision";
import { createPose, type Delegate } from "./landmarkers";
import { createMediapipeBackend } from "./backends/mediapipe";
import type { DetectorId, ObjectBackend } from "./backends/ObjectBackend";
import { BACKEND_MAX_THROWS, OBJECT_EVERY_N, YOLO_EVERY_N, YOLO_INPUT, YOLO_MODEL_URL } from "./thresholds";
import type { ObjectBox, PoseResult, WorkerInbound, WorkerOutbound } from "./workerClient";

const ctx = self as unknown as DedicatedWorkerGlobalScope;
const post = (msg: WorkerOutbound): void => ctx.postMessage(msg);

let pose: PoseLandmarker | null = null;
let backend: ObjectBackend | null = null;
let delegate: Delegate = "GPU";
let lastTs = -1;
/** Pose frames seen so far; the detector runs when this is a multiple of its EVERY_N. */
let poseFrames = 0;
let consecutiveThrows = 0;

/** The cadence for the loaded backend: YOLO is heavier, so it runs less often. */
function everyN(): number {
  return backend?.id === "yolo" ? YOLO_EVERY_N : OBJECT_EVERY_N;
}

async function loadBackend(detector: DetectorId): Promise<{ backend: ObjectBackend | null; fallback: boolean }> {
  if (detector === "yolo") {
    try {
      const { createYoloBackend } = await import("./backends/yolo");
      const yolo = createYoloBackend({ modelUrl: YOLO_MODEL_URL, inputSize: YOLO_INPUT });
      await yolo.init(delegate);
      return { backend: yolo, fallback: false };
    } catch (err) {
      console.warn("[vision] yolo failed to load, falling back to mediapipe", err);
      const mp = await tryMediapipe();
      return { backend: mp, fallback: true };
    }
  }
  const mp = await tryMediapipe();
  return { backend: mp, fallback: mp === null };
}

/** The detector is optional: a missing model never blocks calibration or play. */
async function tryMediapipe(): Promise<ObjectBackend | null> {
  try {
    const mp = createMediapipeBackend();
    await mp.init(delegate);
    return mp;
  } catch (err) {
    console.warn("[vision] object detector unavailable, playing pose-only", err);
    return null;
  }
}

async function init(detector: DetectorId): Promise<void> {
  try {
    pose = await createPose("GPU");
    delegate = "GPU";
  } catch (gpuErr) {
    console.warn("[vision] GPU delegate failed, falling back to CPU", gpuErr);
    try {
      pose = await createPose("CPU");
      delegate = "CPU";
    } catch (cpuErr) {
      console.error("[vision] model load failed", cpuErr);
      post({ type: "error", code: "model-load" });
      return;
    }
  }
  const loaded = await loadBackend(detector);
  backend = loaded.backend;
  post({ type: "ready", delegate, objects: backend !== null, backend: backend?.id ?? null, fallback: loaded.fallback });
}

/**
 * Runs the backend on the same bitmap the pose just used. Never throws: a failure yields null; after
 * BACKEND_MAX_THROWS consecutive failures the backend is disabled for the session (invariant).
 */
async function detectObjects(bitmap: ImageBitmap, ts: number): Promise<{ boxes: ObjectBox[] | null; ms: number }> {
  if (!backend) return { boxes: null, ms: 0 };
  try {
    const boxes = await backend.detect(bitmap, ts);
    consecutiveThrows = 0;
    return { boxes, ms: backend.lastMs };
  } catch (err) {
    consecutiveThrows++;
    if (consecutiveThrows === 1) console.error("[vision] object detector failed; this frame reports objects: null", err);
    if (consecutiveThrows >= BACKEND_MAX_THROWS) {
      console.error(`[vision] object detector disabled after ${consecutiveThrows} consecutive failures`);
      backend.dispose();
      backend = null;
    }
    return { boxes: null, ms: 0 };
  }
}

async function detect(bitmap: ImageBitmap, ts: number): Promise<void> {
  try {
    if (!pose) {
      post({ type: "result", ts, pose: null, poseMs: 0, delegate, objects: null, objectMs: 0, backend: null });
      return;
    }
    // detectForVideo requires strictly increasing timestamps.
    if (ts <= lastTs) ts = lastTs + 1;
    lastTs = ts;

    const t0 = performance.now();
    const result = pose.detectForVideo(bitmap, ts);
    const poseMs = performance.now() - t0;

    const landmarks = result.landmarks[0];
    const worldLandmarks = result.worldLandmarks[0];
    const out: PoseResult | null =
      landmarks && worldLandmarks ? { landmarks, worldLandmarks } : null;

    let boxes: ObjectBox[] | null = null;
    let objectMs = 0;
    if (out) {
      poseFrames++;
      if (poseFrames % everyN() === 0) ({ boxes, ms: objectMs } = await detectObjects(bitmap, ts));
    }
    post({ type: "result", ts, pose: out, poseMs, delegate, objects: boxes, objectMs, backend: backend?.id ?? null });
  } finally {
    bitmap.close();
  }
}

ctx.onmessage = (e: MessageEvent<WorkerInbound>) => {
  const msg = e.data;
  switch (msg.type) {
    case "init":
      void init(msg.detector);
      return;
    case "frame":
      // One frame in flight at a time (WorkerClient), so the async detect never overlaps itself.
      void detect(msg.bitmap, msg.ts);
      return;
  }
};
