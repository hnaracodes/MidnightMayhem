/**
 * Worker side only. This is the one module that imports @mediapipe/tasks-vision;
 * the main thread must never import it (directly or through this file).
 *
 * The wasm runtime is not served from public/: Vite forbids importing /public files from source, and
 * MediaPipe loads its wasm loader with a dynamic import() inside a module worker. Importing the two files
 * from the npm package with `?url` makes Vite serve them in dev and emit them as hashed assets in the
 * build, so the same code works under `vite dev` and under packages/server serving dist/.
 *
 * `vision_wasm_module_internal.*` is the ES-module build of the runtime: it sets `globalThis.ModuleFactory`
 * and has a default export, which is what MediaPipe's import() fallback needs. The classic build
 * (`vision_wasm_internal.js`) only works through importScripts, which module workers do not have.
 * The package's exports map exposes the files at the package root, not under `/wasm/`.
 */
import { ITEMS } from "@midnight/shared";
import { ObjectDetector, PoseLandmarker } from "@mediapipe/tasks-vision";
import wasmLoaderPath from "@mediapipe/tasks-vision/vision_wasm_module_internal.js?url";
import wasmBinaryPath from "@mediapipe/tasks-vision/vision_wasm_module_internal.wasm?url";
import { MODEL_URL, OBJECT_MODEL_URL, OBJECT_SCORE } from "./thresholds";

export type Delegate = "GPU" | "CPU";

/** Pose Landmarker, lite model, VIDEO mode, one pose. Throws if the wasm or model fails to load. */
export async function createPose(delegate: Delegate): Promise<PoseLandmarker> {
  return PoseLandmarker.createFromOptions({ wasmLoaderPath, wasmBinaryPath }, {
    baseOptions: { modelAssetPath: MODEL_URL, delegate },
    runningMode: "VIDEO",
    numPoses: 1,
  });
}

/**
 * Object Detector (9.04), EfficientDet-Lite0, VIDEO mode, restricted to the five COCO labels behind ITEMS.
 * Throws if the model fails to load; the worker treats that as non-fatal and plays pose-only.
 */
export async function createObjectDetector(delegate: Delegate): Promise<ObjectDetector> {
  return ObjectDetector.createFromOptions({ wasmLoaderPath, wasmBinaryPath }, {
    baseOptions: { modelAssetPath: OBJECT_MODEL_URL, delegate },
    runningMode: "VIDEO",
    scoreThreshold: OBJECT_SCORE,
    categoryAllowlist: Object.values(ITEMS).map((i) => i.cocoLabel),
    maxResults: 5,
  });
}

/** Reserved for the hands stretch plan. Always null until then. */
export async function createHands(_delegate: Delegate): Promise<null> {
  return null;
}
