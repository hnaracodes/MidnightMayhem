import { describe, expect, it, vi } from "vitest";
import { EMPTY_FRAME, INPUT_KEYS } from "@midnight/shared";
import {
  DOT_KEYS, DOT_LABELS, type PreviewFrame, type PunchDiag, debugFanOut, previewModel,
} from "../src/app/cameraPreview";

function frame(overrides: Partial<PreviewFrame> = {}): PreviewFrame {
  return {
    landmarks: null,
    metrics: null,
    gestures: { left: false, right: false, jump: false, punchL: false, punchR: false, block: false },
    frame: EMPTY_FRAME,
    calibration: { phase: "ready", progress: 1, baseline: null },
    ts: 0,
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
  it("lists one dot per input key in display order L R J PL PR B", () => {
    expect(DOT_LABELS).toEqual(["L", "R", "J", "PL", "PR", "B"]);
    // The `special` dot (and the item label) join the preview in 09.04.
    expect([...DOT_KEYS].sort()).toEqual([...INPUT_KEYS].filter((k) => k !== "special").sort());
    expect(DOT_KEYS).toEqual(["left", "right", "jump", "punchL", "punchR", "block"]);
  });

  it("shows no camera and dark dots before the first frame", () => {
    const m = previewModel(null);
    expect(m.dots).toEqual([false, false, false, false, false, false]);
    expect(m.status).toBe("no camera");
    expect(m.gates).toBeNull();
  });

  it("lights the dots whose InputFrame key is true", () => {
    const m = previewModel(frame({ frame: { ...EMPTY_FRAME, right: true, punchL: true } }));
    expect(m.dots).toEqual([false, true, false, true, false, false]);
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
