/**
 * YOLO behind the ObjectBackend interface (9.07), on onnxruntime-web. The runtime is imported lazily so a
 * MediaPipe session never downloads it. This is the only module outside src/bench that touches onnxruntime-web.
 *
 * Pipeline: letterbox the frame into a `size × size` OffscreenCanvas → Float32 NCHW tensor in [0, 1] →
 * `session.run` → decode either the Ultralytics YOLOv8/YOLO11 layout `[1, 84, N]` (cxcywh + 80 class scores,
 * class-filtered to the five COCO labels before NMS) or the yolov10 layout `[1, 300, 6]` (xyxy, score, class;
 * already NMS-free) → un-letterbox → image-normalised ObjectBox.
 */
import { ITEMS } from "@midnight/shared";
import { VisionInputError } from "../errors";
import { YOLO_IOU, YOLO_SCORE } from "../thresholds";
import type { ObjectBox } from "../workerClient";
import { letterbox, nms, unletterbox, type Candidate, type Letterbox } from "./nms";
import type { ObjectBackend } from "./ObjectBackend";

/** The 80 COCO class names in Ultralytics order (the index is the class id in every YOLO export). */
export const COCO_NAMES: readonly string[] = [
  "person", "bicycle", "car", "motorcycle", "airplane", "bus", "train", "truck", "boat", "traffic light",
  "fire hydrant", "stop sign", "parking meter", "bench", "bird", "cat", "dog", "horse", "sheep", "cow",
  "elephant", "bear", "zebra", "giraffe", "backpack", "umbrella", "handbag", "tie", "suitcase", "frisbee",
  "skis", "snowboard", "sports ball", "kite", "baseball bat", "baseball glove", "skateboard", "surfboard",
  "tennis racket", "bottle", "wine glass", "cup", "fork", "knife", "spoon", "bowl", "banana", "apple",
  "sandwich", "orange", "broccoli", "carrot", "hot dog", "pizza", "donut", "cake", "chair", "couch",
  "potted plant", "bed", "dining table", "toilet", "tv", "laptop", "mouse", "remote", "keyboard", "cell phone",
  "microwave", "oven", "toaster", "sink", "refrigerator", "book", "clock", "vase", "scissors", "teddy bear",
  "hair drier", "toothbrush",
];

/** Class id per COCO name. */
export const COCO_INDEX: Record<string, number> = Object.fromEntries(COCO_NAMES.map((n, i) => [n, i]));

/** The class ids of the five labels behind ITEMS, the only ones the game reports. */
export const ALLOWED_CLASSES: readonly number[] = Object.values(ITEMS).map((i) => COCO_INDEX[i.cocoLabel] as number);

// ---- runtime surface (the subset of onnxruntime-web the backend uses; injectable for tests) ----

export interface TensorLike {
  readonly type: string;
  readonly data: Float32Array;
  readonly dims: readonly number[];
}
export interface SessionLike {
  readonly inputNames: readonly string[];
  readonly outputNames: readonly string[];
  run(feeds: Record<string, TensorLike>): Promise<Record<string, { data: unknown; dims: readonly number[] }>>;
  release(): Promise<void>;
}
export interface OrtLike {
  env: { wasm: { wasmPaths?: unknown; numThreads?: number } };
  Tensor: new (type: "float32", data: Float32Array, dims: number[]) => TensorLike;
  InferenceSession: {
    create(model: Uint8Array, options: { executionProviders: string[] }): Promise<SessionLike>;
  };
}

export interface YoloOptions {
  modelUrl: string;
  inputSize: 640 | 416 | 320;
  score?: number;
  iou?: number;
}

export interface YoloDeps {
  loadOrt?: () => Promise<OrtLike>;
  fetch?: (url: string) => Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer> }>;
  createContext?: (size: number) => OffscreenCanvasRenderingContext2D;
}

// ---- pure pieces (tested) ----

/** RGBA pixels → planar RGB Float32 in [0, 1], NCHW with batch 1. */
export function imageToTensor(px: Uint8ClampedArray, w: number, h: number): Float32Array {
  const plane = w * h;
  const out = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    out[i] = (px[i * 4] as number) / 255;
    out[plane + i] = (px[i * 4 + 1] as number) / 255;
    out[2 * plane + i] = (px[i * 4 + 2] as number) / 255;
  }
  return out;
}

/** Ultralytics YOLOv8 / YOLO11 layout: `[1, 4 + 80, N]`, boxes as centre + size in input pixels. */
export function decodeV8(data: Float32Array, dims: readonly number[], score: number, iouThreshold: number): Candidate[] {
  const n = dims[2] ?? 0;
  const channels = dims[1] ?? 0;
  const cands: Candidate[] = [];
  for (let i = 0; i < n; i++) {
    let best = -1;
    let bestScore = 0;
    for (const cls of ALLOWED_CLASSES) {
      if (4 + cls >= channels) continue;
      const s = data[(4 + cls) * n + i] as number;
      if (s > bestScore) {
        bestScore = s;
        best = cls;
      }
    }
    if (best < 0 || bestScore < score) continue;
    const cx = data[0 * n + i] as number;
    const cy = data[1 * n + i] as number;
    const w = data[2 * n + i] as number;
    const h = data[3 * n + i] as number;
    cands.push({ label: COCO_NAMES[best] as string, score: bestScore, x: cx - w / 2, y: cy - h / 2, w, h });
  }
  return nms(cands, iouThreshold);
}

/** yolov10 layout: `[1, N, 6]` rows of x1, y1, x2, y2, score, class in input pixels; the model has no NMS to add. */
export function decodeV10(data: Float32Array, dims: readonly number[], score: number): Candidate[] {
  const n = dims[1] ?? 0;
  const out: Candidate[] = [];
  for (let i = 0; i < n; i++) {
    const o = i * 6;
    const s = data[o + 4] as number;
    if (s < score) continue;
    const cls = Math.round(data[o + 5] as number);
    if (!ALLOWED_CLASSES.includes(cls)) continue;
    const x1 = data[o] as number, y1 = data[o + 1] as number, x2 = data[o + 2] as number, y2 = data[o + 3] as number;
    out.push({ label: COCO_NAMES[cls] as string, score: s, x: x1, y: y1, w: x2 - x1, h: y2 - y1 });
  }
  return out;
}

/** Picks the decoder by the output's shape. */
export function decodeOutput(data: Float32Array, dims: readonly number[], score: number, iouThreshold: number): Candidate[] {
  if (dims.length === 3 && dims[2] === 6) return decodeV10(data, dims, score);
  if (dims.length === 3 && (dims[1] ?? 0) >= 5) return decodeV8(data, dims, score, iouThreshold);
  throw new Error(`unsupported YOLO output shape [${dims.join(", ")}]`);
}

/** Letterboxed input-pixel candidates → image-normalised ObjectBoxes. */
export function toObjectBoxes(cands: Candidate[], lb: Letterbox, width: number, height: number): ObjectBox[] {
  const w = width || 1;
  const h = height || 1;
  return cands.map((c) => {
    const b = unletterbox(c, lb);
    return { label: c.label, score: c.score, x: b.x / w, y: b.y / h, w: b.w / w, h: b.h / h };
  });
}

// ---- runtime loading ----

async function defaultLoadOrt(): Promise<OrtLike> {
  const [ort, { default: wasmUrl }] = await Promise.all([
    import("onnxruntime-web"),
    import("onnxruntime-web/ort-wasm-simd-threaded.jsep.wasm?url"),
  ]);
  // The bundle build inlines the JS loader; only the .wasm binary is fetched, from the URL Vite serves/emits.
  ort.env.wasm.wasmPaths = { wasm: wasmUrl };
  return ort as unknown as OrtLike;
}

const defaultCreateContext = (size: number): OffscreenCanvasRenderingContext2D => {
  const ctx = new OffscreenCanvas(size, size).getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("OffscreenCanvas 2d context unavailable");
  return ctx;
};

export function createYoloBackend(opts: YoloOptions, deps: YoloDeps = {}): ObjectBackend {
  const loadOrt = deps.loadOrt ?? defaultLoadOrt;
  const fetchFn = deps.fetch ?? ((url: string) => fetch(url));
  const createContext = deps.createContext ?? defaultCreateContext;
  const size = opts.inputSize;
  const scoreThreshold = opts.score ?? YOLO_SCORE;
  const iouThreshold = opts.iou ?? YOLO_IOU;

  let ort: OrtLike | null = null;
  let session: SessionLike | null = null;
  let ctx: OffscreenCanvasRenderingContext2D | null = null;
  let lastMs = 0;
  let provider = "";

  async function createSession(model: Uint8Array, providers: string[]): Promise<SessionLike> {
    if (!ort) throw new Error("runtime not loaded");
    return ort.InferenceSession.create(model, { executionProviders: providers });
  }

  return {
    id: "yolo",
    get lastMs() {
      return lastMs;
    },
    get provider() {
      return provider;
    },
    async init(delegate) {
      try {
        const [rt, res] = await Promise.all([loadOrt(), fetchFn(opts.modelUrl)]);
        ort = rt;
        if (!res.ok) throw new Error(`${opts.modelUrl} → HTTP ${res.status}`);
        const model = new Uint8Array(await res.arrayBuffer());
        if (delegate === "GPU") {
          try {
            session = await createSession(model, ["webgpu", "wasm"]);
            provider = "webgpu";
          } catch (err) {
            console.warn("[vision] yolo: webgpu unavailable, using wasm", err);
            session = await createSession(model, ["wasm"]);
            provider = "wasm";
          }
        } else {
          session = await createSession(model, ["wasm"]);
          provider = "wasm";
        }
        ctx = createContext(size);
      } catch (err) {
        session = null;
        throw new VisionInputError("model-load", err);
      }
    },
    async detect(bitmap, _ts) {
      if (!session || !ort || !ctx) throw new Error("yolo backend not initialised");
      const t0 = performance.now();
      const lb = letterbox(bitmap.width, bitmap.height, size);
      ctx.fillStyle = "#727272"; // Ultralytics pads with 114-grey
      ctx.fillRect(0, 0, size, size);
      ctx.drawImage(bitmap, lb.dx, lb.dy, bitmap.width * lb.scale, bitmap.height * lb.scale);
      const img = ctx.getImageData(0, 0, size, size);
      const tensor = new ort.Tensor("float32", imageToTensor(img.data, size, size), [1, 3, size, size]);
      const inputName = session.inputNames[0] ?? "images";
      const outputName = session.outputNames[0] ?? "output0";
      const out = await session.run({ [inputName]: tensor });
      const result = out[outputName];
      if (!result) throw new Error(`YOLO output ${outputName} missing`);
      const data = result.data instanceof Float32Array ? result.data : Float32Array.from(result.data as ArrayLike<number>);
      const cands = decodeOutput(data, result.dims, scoreThreshold, iouThreshold);
      lastMs = performance.now() - t0;
      return toObjectBoxes(cands, lb, bitmap.width, bitmap.height);
    },
    dispose() {
      const s = session;
      session = null;
      ctx = null;
      void s?.release().catch(() => {});
    },
  };
}
