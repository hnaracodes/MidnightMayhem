/// <reference lib="webworker" />
/**
 * Web Worker entry. Owns the Pose Landmarker and (9.04 / 9.07) one object-detection backend; the main thread
 * only ever sees plain landmark arrays and plain boxes. Protocol: see WorkerInbound / WorkerOutbound in
 * workerClient.ts. `init` names the backend; YOLO falls back to MediaPipe when it cannot load (rule 1).
 */
import type { PoseLandmarker } from "@mediapipe/tasks-vision";
import { createPose, type Delegate } from "./landmarkers";
import { createMediapipeBackend } from "./backends/mediapipe";
import { GuardedBackend, loadBackend } from "./backends/loader";
import type { DetectorId } from "./backends/ObjectBackend";
import { OBJECT_EVERY_N, YOLO_EVERY_N, YOLO_INPUT, YOLO_MODEL_URL } from "./thresholds";
import type { ObjectBox, PoseResult, WorkerInbound, WorkerOutbound } from "./workerClient";

const ctx = self as unknown as DedicatedWorkerGlobalScope;
const post = (msg: WorkerOutbound): void => ctx.postMessage(msg);

let pose: PoseLandmarker | null = null;
let objects = new GuardedBackend(null);
let delegate: Delegate = "GPU";
let lastTs = -1;
/** Pose frames seen so far; the detector runs when this is a multiple of its EVERY_N. */
let poseFrames = 0;

/** The cadence for the loaded backend: YOLO is heavier, so it runs less often. */
function everyN(): number {
  return objects.id === "yolo" ? YOLO_EVERY_N : OBJECT_EVERY_N;
}

/** Rule 1 lives in backends/loader.ts; this only names the factories (YOLO lazy-imported, never for MediaPipe). */
const factories = {
  yolo: async () => {
    const { createYoloBackend } = await import("./backends/yolo");
    return createYoloBackend({ modelUrl: YOLO_MODEL_URL, inputSize: YOLO_INPUT });
  },
  mediapipe: () => createMediapipeBackend(),
};

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
  const loaded = await loadBackend(detector, delegate, factories);
  objects = new GuardedBackend(loaded.backend);
  post({ type: "ready", delegate, objects: objects.id !== null, backend: objects.id, fallback: loaded.fallback });
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
      if (poseFrames % everyN() === 0) ({ boxes, ms: objectMs } = await objects.detect(bitmap, ts));
    }
    post({ type: "result", ts, pose: out, poseMs, delegate, objects: boxes, objectMs, backend: objects.id });
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
