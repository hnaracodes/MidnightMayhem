import { describe, expect, it, vi } from "vitest";
import { EMPTY_FRAME, INPUT_KEYS, ITEMS } from "@midnight/shared";
import {
  DOT_KEYS, DOT_LABELS, type PreviewFrame, type PunchDiag, debugFanOut, previewModel, retainBoxes,
} from "../src/app/cameraPreview";
import type { Landmark, ObjectBox } from "../src/vision/workerClient";

function frame(overrides: Partial<PreviewFrame> = {}): PreviewFrame {
  return {
    landmarks: null,
    metrics: null,
    gestures: {
      left: false, right: false, jump: false, punchL: false, punchR: false, block: false, special: false, item: null,
      windupL: false, windupR: false, chop: false, sweep: false, slashL: false, slashR: false, held: null,
    },
    frame: EMPTY_FRAME,
    calibration: { phase: "ready", progress: 1, baseline: null },
    ts: 0,
    objects: null,
    item: null,
    ...overrides,
  };
}

function diag(overrides: Partial<PunchDiag> = {}): PunchDiag {
  return {
    ext: 0.9, depth: 0, drop: 0, atHeight: true,
    extOk: false, depthOk: false, thrustOk: false, jabOk: false, active: false, out: false,
    side: 0, jabRise: 0, path: null,
    ...overrides,
  };
}

describe("previewModel", () => {
  it("lists one dot per input key in display order L R J PL PR B SP CH SW", () => {
    expect(DOT_LABELS).toEqual(["L", "R", "J", "PL", "PR", "B", "SP", "CH", "SW"]);
    expect([...DOT_KEYS].sort()).toEqual([...INPUT_KEYS].sort());
    expect(DOT_KEYS).toEqual(["left", "right", "jump", "punchL", "punchR", "block", "special", "chop", "sweep"]);
  });

  it("shows no camera and dark dots before the first frame", () => {
    const m = previewModel(null);
    expect(m.dots).toEqual([false, false, false, false, false, false, false, false, false]);
    expect(m.status).toBe("no camera");
    expect(m.gates).toBeNull();
    expect(m.item).toBeNull();
    expect(m.itemLabel).toBe("");
    expect(m.special).toBe(false);
  });

  it("lights the dots whose InputFrame key is true", () => {
    const m = previewModel(frame({ frame: { ...EMPTY_FRAME, right: true, punchL: true } }));
    expect(m.dots).toEqual([false, true, false, true, false, false, false, false, false]);
  });

  it("9.04: exposes special and the held item with its label", () => {
    const m = previewModel(frame({ frame: { ...EMPTY_FRAME, special: true, item: "molotov" } }));
    expect(m.dots[6]).toBe(true);
    expect(m.special).toBe(true);
    expect(m.item).toBe("molotov");
    expect(m.itemLabel).toBe(ITEMS.molotov.label);
    const none = previewModel(frame());
    expect(none.item).toBeNull();
    expect(none.itemLabel).toBe("");
  });

  it("9.04: retainBoxes keeps the last detector boxes across the detector's off frames and drops them with the pose", () => {
    const lms: Landmark[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.9 }));
    const bottle: ObjectBox = { label: "bottle", score: 0.8, x: 0.1, y: 0.1, w: 0.2, h: 0.2 };
    const phone: ObjectBox = { label: "cell phone", score: 0.6, x: 0.5, y: 0.5, w: 0.1, h: 0.1 };
    // Nothing yet: an off frame shows nothing.
    expect(retainBoxes(null, frame({ landmarks: lms, objects: null }))).toBeNull();
    // A detector frame replaces; the two off frames after it keep the same boxes.
    const a = retainBoxes(null, frame({ landmarks: lms, objects: [bottle] }));
    expect(a).toEqual([bottle]);
    expect(retainBoxes(a, frame({ landmarks: lms, objects: null }))).toBe(a);
    expect(retainBoxes(a, frame({ landmarks: lms, objects: null }))).toBe(a);
    // The next detector frame replaces, including with an empty list.
    expect(retainBoxes(a, frame({ landmarks: lms, objects: [phone] }))).toEqual([phone]);
    expect(retainBoxes(a, frame({ landmarks: lms, objects: [] }))).toEqual([]);
    // Losing the pose clears them.
    expect(retainBoxes(a, frame({ landmarks: null, objects: null }))).toBeNull();
  });

  it("reports the calibration phase with progress while calibrating", () => {
    const m = previewModel(frame({ calibration: { phase: "calibrating", progress: 0.4, baseline: null } }));
    expect(m.status).toBe("calibrating 40%");
  });

  it("appends the fps from the frame when it carries one, else from the source stats", () => {
    expect(previewModel(frame({ fps: 27.6 }), 12).status).toBe("ready · 28 fps");
    expect(previewModel(frame(), 30).status).toBe("ready · 30 fps");
    expect(previewModel(frame(), 0).status).toBe("ready");
    expect(previewModel(frame({ calibration: { phase: "lost", progress: 0, baseline: null } })).status).toBe("lost");
  });

  it("has no gate rows until the frame carries punch diagnostics", () => {
    expect(previewModel(frame()).gates).toBeNull();
  });

  it("maps each punch gate and the output per hand", () => {
    const m = previewModel(frame({
      punch: {
        L: diag({ extOk: true, depthOk: true, thrustOk: true, jabOk: false, out: true }),
        R: diag({ jabOk: true }),
      },
    }));
    expect(m.gates).toEqual({
      L: { ext: true, depth: true, thrust: true, jab: false, out: true },
      R: { ext: false, depth: false, thrust: false, jab: true, out: false },
    });
  });
});

describe("debugFanOut", () => {
  it("subscribes once and delivers every frame to every listener", () => {
    let handler: ((f: PreviewFrame) => void) | null = null;
    const source = { onDebug: vi.fn((cb: (f: PreviewFrame) => void) => { handler = cb; }) };
    const feed = debugFanOut(source);
    const a = vi.fn();
    const b = vi.fn();
    feed.onDebug(a);
    feed.onDebug(b);
    const f = frame();
    handler!(f);
    expect(source.onDebug).toHaveBeenCalledTimes(1);
    expect(a).toHaveBeenCalledWith(f);
    expect(b).toHaveBeenCalledWith(f);
  });
});
