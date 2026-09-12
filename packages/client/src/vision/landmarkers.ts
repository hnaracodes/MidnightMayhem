/**
 * Worker side only. This is the one module that imports @mediapipe/tasks-vision;
 * the main thread must never import it (directly or through this file).
 */
import { FilesetResolver, PoseLandmarker } from "@mediapipe/tasks-vision";
import { MODEL_URL, WASM_URL } from "./thresholds";

export type Delegate = "GPU" | "CPU";

/** Pose Landmarker, lite model, VIDEO mode, one pose. Throws if the wasm or model fails to load. */
export async function createPose(delegate: Delegate): Promise<PoseLandmarker> {
  const fileset = await FilesetResolver.forVisionTasks(WASM_URL);
  return PoseLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: MODEL_URL, delegate },
    runningMode: "VIDEO",
    numPoses: 1,
  });
}

/** Reserved for the hands stretch plan. Always null until then. */
export async function createHands(_delegate: Delegate): Promise<null> {
  return null;
}
