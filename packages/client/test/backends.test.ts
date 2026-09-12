import { describe, expect, it } from "vitest";
import { createMediapipeBackend, type ObjectDetectorLike } from "../src/vision/backends/mediapipe";
import { letterbox, toLetterbox } from "../src/vision/backends/nms";
import {
  COCO_INDEX, createYoloBackend, decodeV10, decodeV8, imageToTensor, type OrtLike, type SessionLike, type TensorLike,
} from "../src/vision/backends/yolo";
import { VisionInputError } from "../src/vision/errors";
import { YOLO_SCORE } from "../src/vision/thresholds";
import type { ObjectBox } from "../src/vision/workerClient";

/** COCO class id by name. */
const cls = (name: string): number => COCO_INDEX[name] as number;

const bitmap = (width: number, height: number) => ({ width, height, close() {} }) as unknown as ImageBitmap;

// ---- rule 3: decoders ----

/** A [1, 84, N] tensor with N candidates; each candidate is { cx, cy, w, h, classScores: [index, score][] }. */
function v8Tensor(cands: { cx: number; cy: number; w: number; h: number; cls: [number, number][] }[]): Float32Array {
  const n = cands.length;
  const data = new Float32Array(84 * n);
  cands.forEach((c, i) => {
    data[0 * n + i] = c.cx;
    data[1 * n + i] = c.cy;
    data[2 * n + i] = c.w;
    data[3 * n + i] = c.h;
    for (const [k, s] of c.cls) data[(4 + k) * n + i] = s;
  });
  return data;
}

describe("decodeV8 (Ultralytics [1, 84, N])", () => {
  it("rule 3: keeps two boxes after the class filter and NMS on a synthetic [1, 84, 3] tensor", () => {
    const data = v8Tensor([
      { cx: 100, cy: 100, w: 40, h: 40, cls: [[cls("bottle"), 0.9]] },
      { cx: 104, cy: 100, w: 40, h: 40, cls: [[cls("bottle"), 0.6]] }, // same bottle, suppressed
      { cx: 250, cy: 200, w: 60, h: 20, cls: [[cls("banana"), 0.8], [0, 0.95]] }, // person score is ignored
    ]);
    const out = decodeV8(data, [1, 84, 3], YOLO_SCORE, 0.5);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ label: "bottle", x: 80, y: 80, w: 40, h: 40 });
    expect(out[0]?.score).toBeCloseTo(0.9);
    expect(out[1]).toMatchObject({ label: "banana", x: 220, y: 190, w: 60, h: 20 });
    expect(out[1]?.score).toBeCloseTo(0.8);
  });

  it("drops candidates whose best allowed class is under the score threshold or outside the five labels", () => {
    const data = v8Tensor([
      { cx: 100, cy: 100, w: 40, h: 40, cls: [[cls("bottle"), 0.2]] },
      { cx: 200, cy: 100, w: 40, h: 40, cls: [[0, 0.99]] }, // person only
    ]);
    expect(decodeV8(data, [1, 84, 2], YOLO_SCORE, 0.5)).toEqual([]);
  });
});

describe("decodeV10 (NMS-free [1, 300, 6])", () => {
  it("rule 3: decodes xyxy, score, class rows without NMS and filters to the five labels", () => {
    const rows = [
      [10, 20, 50, 80, 0.9, cls("umbrella")],
      [12, 20, 52, 80, 0.7, cls("umbrella")], // overlapping duplicate is kept: the model already ran NMS
      [100, 100, 140, 140, 0.95, 0], // person
      [200, 200, 220, 260, 0.1, cls("cell phone")], // under threshold
      [0, 0, 0, 0, 0, 0], // padding row
    ];
    const data = new Float32Array(rows.flat());
    const out = decodeV10(data, [1, rows.length, 6], YOLO_SCORE);
    expect(out.map((c) => ({ ...c, score: Number(c.score.toFixed(3)) }))).toEqual([
      { label: "umbrella", score: 0.9, x: 10, y: 20, w: 40, h: 60 },
      { label: "umbrella", score: 0.7, x: 12, y: 20, w: 40, h: 60 },
    ]);
  });
});

describe("imageToTensor", () => {
  it("writes planar RGB in [0, 1] (NCHW) and ignores alpha", () => {
    const px = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 51, 51, 51, 0]);
    const t = Array.from(imageToTensor(px, 2, 2), (v) => Number(v.toFixed(3)));
    expect(t.slice(0, 4)).toEqual([1, 0, 0, 0.2]); // R plane
    expect(t.slice(4, 8)).toEqual([0, 1, 0, 0.2]); // G plane
    expect(t.slice(8, 12)).toEqual([0, 0, 1, 0.2]); // B plane
  });
});

// ---- fake runtime ----

interface FakeSessionOpts {
  dims: number[];
  data: () => Float32Array;
  createFails?: (providers: string[]) => boolean;
  runThrows?: boolean;
}

function fakeOrt(opts: FakeSessionOpts) {
  const log: { providers: string[][]; inputs: TensorLike[]; disposed: number; wasmPaths: unknown } = {
    providers: [], inputs: [], disposed: 0, wasmPaths: null,
  };
  const session: SessionLike = {
    inputNames: ["images"],
    outputNames: ["output0"],
    async run(feeds) {
      if (opts.runThrows) throw new Error("run failed");
      log.inputs.push(feeds.images as TensorLike);
      return { output0: { data: opts.data(), dims: opts.dims } };
    },
    async release() {
      log.disposed++;
    },
  };
  const ort: OrtLike = {
    env: { wasm: {} },
    Tensor: class {
      constructor(readonly type: string, readonly data: Float32Array, readonly dims: number[]) {}
    },
    InferenceSession: {
      async create(_model, options) {
        const providers = options.executionProviders;
        log.providers.push(providers);
        if (opts.createFails?.(providers)) throw new Error(`no ${providers[0]}`);
        return session;
      },
    },
  };
  return { ort, log };
}

/** A 2D context stub that reports what was drawn and returns a blank image. */
function fakeCanvas(size: number) {
  const draws: { dx: number; dy: number; dw: number; dh: number }[] = [];
  const ctx = {
    fillStyle: "",
    fillRect() {},
    drawImage(_img: unknown, dx: number, dy: number, dw: number, dh: number) {
      draws.push({ dx, dy, dw, dh });
    },
    getImageData: () => ({ data: new Uint8ClampedArray(size * size * 4), width: size, height: size }),
  };
  return { ctx, draws };
}

const fetchOk = async () => ({ ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(8) });

// ---- yolo backend ----

describe("createYoloBackend", () => {
  it("letterboxes the frame into the square input and returns boxes in image-normalised units", async () => {
    // A 640×480 frame; the model reports one bottle at letterboxed (80..240, 100..220) for size 320 → dy 40.
    const { ort, log } = fakeOrt({ dims: [1, 1, 6], data: () => new Float32Array([80, 100, 240, 220, 0.8, cls("bottle")]) });
    const { ctx, draws } = fakeCanvas(320);
    const yolo = createYoloBackend({ modelUrl: "/models/yolo.onnx", inputSize: 320 }, {
      loadOrt: async () => ort, fetch: fetchOk, createContext: () => ctx as unknown as OffscreenCanvasRenderingContext2D,
    });
    await yolo.init("CPU");
    expect(log.providers).toEqual([["wasm"]]);
    expect(yolo.provider).toBe("wasm");
    const boxes = await yolo.detect(bitmap(640, 480), 1);
    expect(draws).toEqual([{ dx: 0, dy: 40, dw: 320, dh: 240 }]);
    expect(log.inputs[0]?.dims).toEqual([1, 3, 320, 320]);
    expect(boxes).toHaveLength(1);
    const b = boxes[0] as ObjectBox;
    expect(b.label).toBe("bottle");
    expect(b.score).toBeCloseTo(0.8);
    expect(b.x).toBeCloseTo(160 / 640);
    expect(b.y).toBeCloseTo(120 / 480);
    expect(b.w).toBeCloseTo(320 / 640);
    expect(b.h).toBeCloseTo(240 / 480);
    expect(yolo.lastMs).toBeGreaterThanOrEqual(0);
    yolo.dispose();
    await Promise.resolve();
    expect(log.disposed).toBe(1);
  });

  it("asks for webgpu then wasm on GPU and falls back to wasm when webgpu is refused", async () => {
    const { ort, log } = fakeOrt({
      dims: [1, 0, 6], data: () => new Float32Array(0), createFails: (p) => p[0] === "webgpu",
    });
    const yolo = createYoloBackend({ modelUrl: "/models/yolo.onnx", inputSize: 320 }, {
      loadOrt: async () => ort, fetch: fetchOk, createContext: () => fakeCanvas(320).ctx as unknown as OffscreenCanvasRenderingContext2D,
    });
    await yolo.init("GPU");
    expect(log.providers).toEqual([["webgpu", "wasm"], ["wasm"]]);
    expect(yolo.provider).toBe("wasm");
  });

  it("rejects with model-load when the model is missing or the runtime cannot create a session", async () => {
    const { ort } = fakeOrt({ dims: [1, 0, 6], data: () => new Float32Array(0) });
    const missing = createYoloBackend({ modelUrl: "/models/yolo.onnx", inputSize: 320 }, {
      loadOrt: async () => ort,
      fetch: async () => ({ ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) }),
      createContext: () => fakeCanvas(320).ctx as unknown as OffscreenCanvasRenderingContext2D,
    });
    await expect(missing.init("CPU")).rejects.toMatchObject({ code: "model-load" });
    await expect(missing.init("CPU")).rejects.toBeInstanceOf(VisionInputError);

    const broken = createYoloBackend({ modelUrl: "/models/yolo.onnx", inputSize: 320 }, {
      loadOrt: async () => { throw new Error("no wasm"); },
      fetch: fetchOk,
      createContext: () => fakeCanvas(320).ctx as unknown as OffscreenCanvasRenderingContext2D,
    });
    await expect(broken.init("CPU")).rejects.toMatchObject({ code: "model-load" });
  });

  it("decodes the [1, 84, N] layout through NMS when the model reports it", async () => {
    const n = 2;
    const data = new Float32Array(84 * n);
    // two bottles at the same place; the 0.9 one survives
    data[0 * n + 0] = 160; data[1 * n + 0] = 160; data[2 * n + 0] = 80; data[3 * n + 0] = 80; data[(4 + cls("bottle")) * n + 0] = 0.9;
    data[0 * n + 1] = 162; data[1 * n + 1] = 160; data[2 * n + 1] = 80; data[3 * n + 1] = 80; data[(4 + cls("bottle")) * n + 1] = 0.5;
    const { ort } = fakeOrt({ dims: [1, 84, n], data: () => data });
    const yolo = createYoloBackend({ modelUrl: "/models/yolo.onnx", inputSize: 320 }, {
      loadOrt: async () => ort, fetch: fetchOk, createContext: () => fakeCanvas(320).ctx as unknown as OffscreenCanvasRenderingContext2D,
    });
    await yolo.init("CPU");
    const boxes = await yolo.detect(bitmap(320, 320), 1);
    expect(boxes).toHaveLength(1);
    expect(boxes[0]?.label).toBe("bottle");
    expect(boxes[0]?.score).toBeCloseTo(0.9);
    expect(boxes[0]?.x).toBeCloseTo(120 / 320);
  });

  it("detect before init throws rather than returning stale boxes", async () => {
    const { ort } = fakeOrt({ dims: [1, 0, 6], data: () => new Float32Array(0) });
    const yolo = createYoloBackend({ modelUrl: "/models/yolo.onnx", inputSize: 320 }, {
      loadOrt: async () => ort, fetch: fetchOk, createContext: () => fakeCanvas(320).ctx as unknown as OffscreenCanvasRenderingContext2D,
    });
    await expect(yolo.detect(bitmap(320, 320), 1)).rejects.toThrow();
  });
});

// ---- mediapipe backend ----

function fakeDetector(detections: { label: string; score: number; x: number; y: number; w: number; h: number }[]) {
  const calls: number[] = [];
  const detector: ObjectDetectorLike = {
    detectForVideo(_img, ts) {
      calls.push(ts);
      return {
        detections: detections.map((d) => ({
          categories: [{ categoryName: d.label, score: d.score }],
          boundingBox: { originX: d.x, originY: d.y, width: d.w, height: d.h },
        })),
      };
    },
    close() {
      calls.push(-1);
    },
  };
  return { detector, calls };
}

describe("createMediapipeBackend", () => {
  it("wraps 9.04's detector: pixel boxes become image-normalised ObjectBoxes", async () => {
    const { detector, calls } = fakeDetector([{ label: "bottle", score: 0.7, x: 160, y: 120, w: 320, h: 240 }]);
    const delegates: string[] = [];
    const mp = createMediapipeBackend(async (d) => { delegates.push(d); return detector; });
    await mp.init("GPU");
    expect(delegates).toEqual(["GPU"]);
    expect(mp.provider).toBe("GPU");
    const boxes = await mp.detect(bitmap(640, 480), 7);
    expect(calls).toEqual([7]);
    expect(boxes).toEqual([{ label: "bottle", score: 0.7, x: 0.25, y: 0.25, w: 0.5, h: 0.5 }]);
    mp.dispose();
    expect(calls).toEqual([7, -1]);
  });

  it("rejects with model-load when the detector cannot be created", async () => {
    const mp = createMediapipeBackend(async () => { throw new Error("404"); });
    await expect(mp.init("CPU")).rejects.toMatchObject({ code: "model-load" });
  });
});

// ---- rule 4: the two backends agree ----

describe("backend agreement", () => {
  it("rule 4: a hand-placed box comes out within 2 % from both backends", async () => {
    const W = 640, H = 480, SIZE = 320;
    const placed = { x: 200, y: 150, w: 120, h: 200 }; // source pixels
    const lb = letterbox(W, H, SIZE);
    const inLb = toLetterbox(placed, lb);
    const { ort } = fakeOrt({
      dims: [1, 1, 6],
      data: () => new Float32Array([inLb.x, inLb.y, inLb.x + inLb.w, inLb.y + inLb.h, 0.9, cls("backpack")]),
    });
    const yolo = createYoloBackend({ modelUrl: "/models/yolo.onnx", inputSize: SIZE }, {
      loadOrt: async () => ort, fetch: fetchOk, createContext: () => fakeCanvas(SIZE).ctx as unknown as OffscreenCanvasRenderingContext2D,
    });
    const mp = createMediapipeBackend(async () => fakeDetector([{ label: "backpack", score: 0.9, ...placed }]).detector);
    await Promise.all([yolo.init("CPU"), mp.init("CPU")]);
    const [a] = await yolo.detect(bitmap(W, H), 1);
    const [b] = await mp.detect(bitmap(W, H), 1);
    expect(a?.label).toBe("backpack");
    expect(b?.label).toBe("backpack");
    for (const k of ["x", "y", "w", "h"] as const) {
      expect(Math.abs((a as ObjectBox)[k] - (b as ObjectBox)[k])).toBeLessThan(0.02);
    }
  });
});
