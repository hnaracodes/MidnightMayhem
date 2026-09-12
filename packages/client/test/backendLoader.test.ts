import { describe, expect, it } from "vitest";
import { GuardedBackend, loadBackend } from "../src/vision/backends/loader";
import type { ObjectBackend } from "../src/vision/backends/ObjectBackend";
import { BACKEND_MAX_THROWS } from "../src/vision/thresholds";
import type { ObjectBox } from "../src/vision/workerClient";

const bitmap = { width: 640, height: 480, close() {} } as unknown as ImageBitmap;

function fake(id: ObjectBackend["id"], opts: { initFails?: boolean; detect?: () => ObjectBox[] } = {}) {
  const log: string[] = [];
  const backend: ObjectBackend = {
    id,
    lastMs: 3,
    provider: "test",
    async init(delegate) {
      log.push(`init:${delegate}`);
      if (opts.initFails) throw new Error(`${id} cannot load`);
    },
    async detect() {
      log.push("detect");
      if (!opts.detect) throw new Error(`${id} detect failed`);
      return opts.detect();
    },
    dispose() {
      log.push("dispose");
    },
  };
  return { backend, log };
}

describe("loadBackend (9.07 rule 1)", () => {
  it("loads YOLO when asked and it initialises", async () => {
    const yolo = fake("yolo");
    const mp = fake("mediapipe");
    const r = await loadBackend("yolo", "GPU", { yolo: async () => yolo.backend, mediapipe: () => mp.backend });
    expect(r).toEqual({ backend: yolo.backend, fallback: false });
    expect(yolo.log).toEqual(["init:GPU"]);
    expect(mp.log).toEqual([]);
  });

  it("falls back to MediaPipe with fallback: true when YOLO cannot load", async () => {
    const yolo = fake("yolo", { initFails: true });
    const mp = fake("mediapipe");
    const r = await loadBackend("yolo", "CPU", { yolo: async () => yolo.backend, mediapipe: () => mp.backend });
    expect(r).toEqual({ backend: mp.backend, fallback: true });
    expect(mp.log).toEqual(["init:CPU"]);
  });

  it("falls back when the YOLO module itself cannot be imported", async () => {
    const mp = fake("mediapipe");
    const r = await loadBackend("yolo", "CPU", { yolo: async () => { throw new Error("chunk failed"); }, mediapipe: () => mp.backend });
    expect(r).toEqual({ backend: mp.backend, fallback: true });
  });

  it("reports objects off (null backend) with fallback: true when both fail", async () => {
    const yolo = fake("yolo", { initFails: true });
    const mp = fake("mediapipe", { initFails: true });
    const r = await loadBackend("yolo", "CPU", { yolo: async () => yolo.backend, mediapipe: () => mp.backend });
    expect(r).toEqual({ backend: null, fallback: true });
  });

  it("a MediaPipe request that fails is plain objects-off, not a fallback (nothing else was tried)", async () => {
    const mp = fake("mediapipe", { initFails: true });
    let yoloAsked = false;
    const r = await loadBackend("mediapipe", "GPU", {
      yolo: async () => { yoloAsked = true; return fake("yolo").backend; }, mediapipe: () => mp.backend,
    });
    expect(r).toEqual({ backend: null, fallback: false });
    expect(yoloAsked).toBe(false);
  });

  it("a MediaPipe request that loads never touches the YOLO module", async () => {
    const mp = fake("mediapipe");
    let yoloAsked = false;
    const r = await loadBackend("mediapipe", "GPU", {
      yolo: async () => { yoloAsked = true; return fake("yolo").backend; }, mediapipe: () => mp.backend,
    });
    expect(r).toEqual({ backend: mp.backend, fallback: false });
    expect(yoloAsked).toBe(false);
  });
});

describe("GuardedBackend (invariant: a throwing backend is disabled after 3 consecutive throws)", () => {
  const box: ObjectBox = { label: "bottle", score: 0.9, x: 0.1, y: 0.1, w: 0.2, h: 0.3 };

  it("returns the backend's boxes and its lastMs", async () => {
    const { backend } = fake("yolo", { detect: () => [box] });
    const g = new GuardedBackend(backend);
    await expect(g.detect(bitmap, 1)).resolves.toEqual({ boxes: [box], ms: 3 });
    expect(g.id).toBe("yolo");
  });

  it("a throw yields objects: null and keeps the backend until the third consecutive throw", async () => {
    const { backend, log } = fake("mediapipe");
    const g = new GuardedBackend(backend);
    for (let i = 1; i < BACKEND_MAX_THROWS; i++) {
      await expect(g.detect(bitmap, i)).resolves.toEqual({ boxes: null, ms: 0 });
      expect(g.id).toBe("mediapipe");
    }
    await expect(g.detect(bitmap, BACKEND_MAX_THROWS)).resolves.toEqual({ boxes: null, ms: 0 });
    expect(g.id).toBeNull();
    expect(log.filter((l) => l === "dispose")).toEqual(["dispose"]);
    // disabled: detect is a no-op, never calls the backend again
    await expect(g.detect(bitmap, 9)).resolves.toEqual({ boxes: null, ms: 0 });
    expect(log.filter((l) => l === "detect")).toHaveLength(BACKEND_MAX_THROWS);
  });

  it("a success resets the consecutive count", async () => {
    let fail = true;
    const backend: ObjectBackend = {
      ...fake("yolo").backend,
      async detect() {
        if (fail) throw new Error("boom");
        return [];
      },
    };
    const g = new GuardedBackend(backend);
    await g.detect(bitmap, 1);
    await g.detect(bitmap, 2);
    fail = false;
    await expect(g.detect(bitmap, 3)).resolves.toEqual({ boxes: [], ms: 3 });
    fail = true;
    await g.detect(bitmap, 4);
    await g.detect(bitmap, 5);
    expect(g.id).toBe("yolo");
    await g.detect(bitmap, 6);
    expect(g.id).toBeNull();
  });

  it("with no backend it reports null without throwing", async () => {
    const g = new GuardedBackend(null);
    await expect(g.detect(bitmap, 1)).resolves.toEqual({ boxes: null, ms: 0 });
    expect(g.id).toBeNull();
  });
});
