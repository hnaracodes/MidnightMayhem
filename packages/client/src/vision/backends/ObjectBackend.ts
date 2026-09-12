/**
 * The object-detection interface both backends implement (9.07). The worker picks one at `init`, the bench page
 * runs both on the same frames. Boxes follow 9.04's ObjectBox contract: image-normalised, un-mirrored, filtered
 * to the five COCO labels behind ITEMS.
 */
import type { ObjectBox } from "../workerClient";

export type DetectorId = "mediapipe" | "yolo";

export const DETECTOR_IDS: readonly DetectorId[] = ["mediapipe", "yolo"];

export interface ObjectBackend {
  readonly id: DetectorId;
  /** Resolves when the model is loaded; rejects with VisionInputError("model-load") otherwise. */
  init(delegate: "GPU" | "CPU"): Promise<void>;
  /**
   * Same ObjectBox contract as 9.04: image-normalised, un-mirrored, filtered to the five COCO labels.
   * Async because onnxruntime-web's `run` is promise-only; the caller never has more than one frame in flight.
   */
  detect(bitmap: ImageBitmap, ts: number): Promise<ObjectBox[]>;
  /** Inference time of the last detect(), ms. */
  readonly lastMs: number;
  /** Which execution path the loaded model runs on ("GPU" / "CPU" for MediaPipe, "webgpu" / "wasm" for YOLO). */
  readonly provider: string;
  dispose(): void;
}
