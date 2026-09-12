/// <reference lib="webworker" />
/**
 * Web Worker entry. Owns the Pose Landmarker; the main thread only ever sees plain landmark arrays.
 * Protocol: see WorkerInbound / WorkerOutbound in workerClient.ts.
 */
import type { PoseLandmarker } from "@mediapipe/tasks-vision";
import { createPose, type Delegate } from "./landmarkers";
import type { PoseResult, WorkerInbound, WorkerOutbound } from "./workerClient";

const ctx = self as unknown as DedicatedWorkerGlobalScope;
const post = (msg: WorkerOutbound): void => ctx.postMessage(msg);

let pose: PoseLandmarker | null = null;
let delegate: Delegate = "GPU";
let lastTs = -1;

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
  post({ type: "ready", delegate });
}

function detect(bitmap: ImageBitmap, ts: number): void {
  try {
    if (!pose) {
      post({ type: "result", ts, pose: null, poseMs: 0, delegate });
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
    post({ type: "result", ts, pose: out, poseMs, delegate });
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
