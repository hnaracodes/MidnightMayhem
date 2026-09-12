/// <reference lib="webworker" />
/**
 * Web Worker entry. Owns the Pose Landmarker and (9.04) the Object Detector; the main thread only ever
 * sees plain landmark arrays and plain boxes. Protocol: see WorkerInbound / WorkerOutbound in workerClient.ts.
 */
import type { ObjectDetector, PoseLandmarker } from "@mediapipe/tasks-vision";
import { createObjectDetector, createPose, type Delegate } from "./landmarkers";
import { OBJECT_EVERY_N } from "./thresholds";
import type { ObjectBox, PoseResult, WorkerInbound, WorkerOutbound } from "./workerClient";

const ctx = self as unknown as DedicatedWorkerGlobalScope;
const post = (msg: WorkerOutbound): void => ctx.postMessage(msg);

let pose: PoseLandmarker | null = null;
let objects: ObjectDetector | null = null;
let delegate: Delegate = "GPU";
let lastTs = -1;
/** Pose frames seen so far; the detector runs when this is a multiple of OBJECT_EVERY_N. */
let poseFrames = 0;
let objectErrorLogged = false;

async function init(): Promise<void> {
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
  // The detector is optional: a missing model never blocks calibration or play.
  try {
    objects = await createObjectDetector(delegate);
  } catch (err) {
    console.warn("[vision] object detector unavailable, playing pose-only", err);
    objects = null;
  }
  post({ type: "ready", delegate, objects: objects !== null });
}

/** Runs the detector on the same bitmap the pose just used. Never throws: a failure yields null and logs once. */
function detectObjects(bitmap: ImageBitmap, ts: number): { boxes: ObjectBox[] | null; ms: number } {
  if (!objects) return { boxes: null, ms: 0 };
  try {
    const t0 = performance.now();
    const result = objects.detectForVideo(bitmap, ts);
    const ms = performance.now() - t0;
    const w = bitmap.width || 1;
    const h = bitmap.height || 1;
    const boxes: ObjectBox[] = [];
    for (const d of result.detections) {
      const cat = d.categories[0];
      const bb = d.boundingBox;
      if (!cat || !bb) continue;
      boxes.push({
        label: cat.categoryName,
        score: cat.score,
        x: bb.originX / w,
        y: bb.originY / h,
        w: bb.width / w,
        h: bb.height / h,
      });
    }
    return { boxes, ms };
  } catch (err) {
    if (!objectErrorLogged) {
      objectErrorLogged = true;
      console.error("[vision] object detector failed; this frame reports objects: null", err);
    }
    return { boxes: null, ms: 0 };
  }
}

function detect(bitmap: ImageBitmap, ts: number): void {
  try {
    if (!pose) {
      post({ type: "result", ts, pose: null, poseMs: 0, delegate, objects: null, objectMs: 0 });
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
      if (poseFrames % OBJECT_EVERY_N === 0) ({ boxes, ms: objectMs } = detectObjects(bitmap, ts));
    }
    post({ type: "result", ts, pose: out, poseMs, delegate, objects: boxes, objectMs });
  } finally {
    bitmap.close();
  }
}

ctx.onmessage = (e: MessageEvent<WorkerInbound>) => {
  const msg = e.data;
  switch (msg.type) {
    case "init":
      void init();
      return;
    case "frame":
      detect(msg.bitmap, msg.ts);
      return;
  }
};
