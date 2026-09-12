/**
 * MediaPipe EfficientDet-Lite0 behind the ObjectBackend interface (9.07). Wraps 9.04's `createObjectDetector`;
 * the default factory is imported lazily so this module (and its tests) never pull @mediapipe/tasks-vision
 * on the main thread.
 */
import { VisionInputError } from "../errors";
import type { ObjectBox } from "../workerClient";
import type { ObjectBackend } from "./ObjectBackend";

/** The subset of MediaPipe's ObjectDetector the wrapper uses; injectable for tests. */
export interface ObjectDetectorLike {
  detectForVideo(image: ImageBitmap, ts: number): {
    detections: {
      categories: { categoryName: string; score: number }[];
      boundingBox?: { originX: number; originY: number; width: number; height: number };
    }[];
  };
  close(): void;
}

export type DetectorFactory = (delegate: "GPU" | "CPU") => Promise<ObjectDetectorLike>;

const defaultFactory: DetectorFactory = async (delegate) => {
  const { createObjectDetector } = await import("../landmarkers");
  return createObjectDetector(delegate);
};

/** Converts MediaPipe's pixel detections into image-normalised ObjectBoxes. Exported for the worker's tests. */
export function normaliseDetections(
  result: ReturnType<ObjectDetectorLike["detectForVideo"]>, width: number, height: number,
): ObjectBox[] {
  const w = width || 1;
  const h = height || 1;
  const boxes: ObjectBox[] = [];
  for (const d of result.detections) {
    const cat = d.categories[0];
    const bb = d.boundingBox;
    if (!cat || !bb) continue;
    boxes.push({
      label: cat.categoryName, score: cat.score, x: bb.originX / w, y: bb.originY / h, w: bb.width / w, h: bb.height / h,
    });
  }
  return boxes;
}

export function createMediapipeBackend(factory: DetectorFactory = defaultFactory): ObjectBackend {
  let detector: ObjectDetectorLike | null = null;
  let lastMs = 0;
  let provider = "";
  return {
    id: "mediapipe",
    get lastMs() {
      return lastMs;
    },
    get provider() {
      return provider;
    },
    async init(delegate) {
      try {
        detector = await factory(delegate);
        provider = delegate;
      } catch (err) {
        throw new VisionInputError("model-load", err);
      }
    },
    async detect(bitmap, ts) {
      if (!detector) throw new Error("mediapipe backend not initialised");
      const t0 = performance.now();
      const result = detector.detectForVideo(bitmap, ts);
      lastMs = performance.now() - t0;
      return normaliseDetections(result, bitmap.width, bitmap.height);
    },
    dispose() {
      detector?.close();
      detector = null;
    },
  };
}
