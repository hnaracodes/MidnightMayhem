import { describe, expect, it } from "vitest";
import { Calibration } from "../src/vision/calibration";
import { CALIBRATION_MS, RELOST_MS } from "../src/vision/thresholds";
import type { Landmark } from "../src/vision/workerClient";

const FRAME_MS = 33;

/** A standing pose, arms at the sides, 33 landmarks. Only the indices calibration reads are meaningful. */
function standing(overrides: Partial<Record<number, Partial<Landmark>>> = {}): Landmark[] {
  const lms: Landmark[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.9 }));
  const set = (i: number, x: number, y: number) => {
    lms[i] = { x, y, z: 0, visibility: 0.9 };
  };
  set(0, 0.5, 0.2); // nose
  set(2, 0.48, 0.18); // left eye
  set(5, 0.52, 0.18); // right eye
  set(11, 0.4, 0.35); // left shoulder
  set(12, 0.6, 0.35); // right shoulder
  set(13, 0.38, 0.5); // elbows
  set(14, 0.62, 0.5);
  set(15, 0.38, 0.75); // wrists hanging
  set(16, 0.62, 0.75);
  set(23, 0.45, 0.6); // hips
  set(24, 0.55, 0.6);
  for (const [i, o] of Object.entries(overrides)) {
    const idx = Number(i);
    lms[idx] = { ...(lms[idx] as Landmark), ...o };
  }
  return lms;
}

/** Feeds `ms` worth of frames, returning the timestamp after the last one. */
function feed(c: Calibration, from: number, ms: number, make: () => Landmark[] | null): number {
  let t = from;
  const end = from + ms;
  while (t < end) {
    c.update(make(), t);
    t += FRAME_MS;
  }
  return t;
}

describe("Calibration", () => {
  it("starts idle and ignores frames until begin", () => {
    const c = new Calibration();
    expect(c.state()).toEqual({ phase: "idle", progress: 0 });
    feed(c, 0, 2000, standing);
    expect(c.state().phase).toBe("idle");
    expect(c.baseline).toBeNull();
  });

  it("completes after CALIBRATION_MS of stable frames and captures the baseline", async () => {
    const c = new Calibration();
    const done = c.begin();
    expect(c.state().phase).toBe("calibrating");
    let t = feed(c, 0, CALIBRATION_MS / 2, standing);
    expect(c.state().phase).toBe("calibrating");
    expect(c.state().progress).toBeGreaterThan(0.3);
    expect(c.state().progress).toBeLessThan(0.7);
    t = feed(c, t, CALIBRATION_MS / 2 + 3 * FRAME_MS, standing);
    expect(c.state()).toEqual({ phase: "ready", progress: 1 });
    await done;
    const b = c.baseline;
    expect(b).not.toBeNull();
    expect(b!.S).toBeCloseTo(0.2);
    expect(b!.leanZero).toBeCloseTo(0);
    expect(b!.hipY).toBeCloseTo(0.6);
    expect(b!.shoulderY).toBeCloseTo(0.35);
    expect(b!.noseY).toBeCloseTo(0.2);
    expect(b!.eyeY).toBeCloseTo(0.18);
    expect(b!.armLen).toBeCloseTo(Math.hypot(0.02, 0.4));
  });

  it("a fidget resets progress to zero", () => {
    const c = new Calibration();
    void c.begin();
    let t = feed(c, 0, 800, standing);
    expect(c.state().progress).toBeGreaterThan(0.4);
    c.update(standing({ 11: { x: 0.45 }, 12: { x: 0.65 } }), t); // shoulders jump 0.05
    expect(c.state().progress).toBe(0);
    t += FRAME_MS;
    t = feed(c, t, 800, () => standing({ 11: { x: 0.45 }, 12: { x: 0.65 } }));
    expect(c.state().phase).toBe("calibrating");
    feed(c, t, 800, () => standing({ 11: { x: 0.45 }, 12: { x: 0.65 } }));
    expect(c.state().phase).toBe("ready");
  });

  it("raised wrists are not stable", () => {
    const c = new Calibration();
    void c.begin();
    feed(c, 0, 2000, () => standing({ 15: { y: 0.4 } }));
    expect(c.state()).toEqual({ phase: "calibrating", progress: 0 });
  });

  it("low visibility on a calibration landmark is not stable", () => {
    const c = new Calibration();
    void c.begin();
    feed(c, 0, 2000, () => standing({ 23: { visibility: 0.3 } }));
    expect(c.state().phase).not.toBe("ready");
  });

  it("absence beyond RELOST_MS goes lost but keeps the baseline; the body coming back is ready at once (no recalibration)", () => {
    const c = new Calibration();
    void c.begin();
    let t = feed(c, 0, CALIBRATION_MS + 3 * FRAME_MS, standing);
    expect(c.state().phase).toBe("ready");
    const baseline = c.baseline;

    t = feed(c, t, RELOST_MS / 2, () => null);
    expect(c.state().phase).toBe("ready");
    expect(c.baseline).toBe(baseline);

    t = feed(c, t, RELOST_MS, () => null);
    expect(c.state()).toEqual({ phase: "lost", progress: 0 });
    expect(c.baseline).toBe(baseline);

    c.update(standing(), t);
    expect(c.state()).toEqual({ phase: "ready", progress: 1 });
    expect(c.baseline).toBe(baseline);
  });

  it("absence during calibration still restarts the capture from nothing", () => {
    const c = new Calibration();
    void c.begin();
    let t = feed(c, 0, CALIBRATION_MS / 2, standing);
    expect(c.state().phase).toBe("calibrating");
    t = feed(c, t, RELOST_MS + FRAME_MS, () => null);
    expect(c.state().phase).toBe("lost");
    expect(c.baseline).toBeNull();
    c.update(standing(), t);
    expect(c.state().phase).toBe("calibrating");
  });

  it("restore() is ready at once with the stored baseline and resolves begin() without a capture", async () => {
    const c = new Calibration();
    const stored = { S: 0.2, leanZero: 0, hipY: 0.6, shoulderY: 0.35, noseY: 0.2, eyeY: 0.18, armLen: 0.4 };
    c.restore(stored);
    expect(c.state()).toEqual({ phase: "ready", progress: 1 });
    expect(c.baseline).toEqual(stored);
    await c.begin(); // resolves immediately: nothing to capture
    expect(c.state().phase).toBe("ready");
    expect(c.baseline).toEqual(stored);
  });

  it("a restored baseline is kept when the first still window measures within RESTORE_TOLERANCE of it", () => {
    const c = new Calibration();
    // standing() has S = 0.2 and armLen ≈ 0.4; a stored baseline 10 % off is close enough
    const stored = { S: 0.22, leanZero: 0, hipY: 0.6, shoulderY: 0.35, noseY: 0.2, eyeY: 0.18, armLen: 0.44 };
    c.restore(stored);
    feed(c, 0, CALIBRATION_MS + 3 * FRAME_MS, standing);
    expect(c.state().phase).toBe("ready");
    expect(c.baseline).toEqual(stored);
    expect(c.provisional).toBe(false);
  });

  it("a restored baseline is replaced when the first still window measures more than RESTORE_TOLERANCE off (someone else, or a new distance)", () => {
    const c = new Calibration();
    const stored = { S: 0.3, leanZero: 0, hipY: 0.6, shoulderY: 0.35, noseY: 0.2, eyeY: 0.18, armLen: 0.6 };
    c.restore(stored);
    // fidgeting in between never produces a window; only a full still window decides
    let t = feed(c, 0, 10 * FRAME_MS, () => standing({ 11: { x: 0.4 + Math.random() * 0.1 } }));
    expect(c.baseline).toEqual(stored);
    feed(c, t, CALIBRATION_MS + 3 * FRAME_MS, standing);
    expect(c.state().phase).toBe("ready");
    expect(c.baseline!.S).toBeCloseTo(0.2, 5);
    expect(c.provisional).toBe(false);
  });

  it("a completed capture notifies onCapture with the baseline (what the source persists)", async () => {
    const c = new Calibration();
    const seen: unknown[] = [];
    c.onCapture((b) => seen.push(b));
    void c.begin();
    feed(c, 0, CALIBRATION_MS + 3 * FRAME_MS, standing);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual(c.baseline);
  });

  it("begin while ready recalibrates and resolves again", async () => {
    const c = new Calibration();
    void c.begin();
    let t = feed(c, 0, CALIBRATION_MS + 3 * FRAME_MS, standing);
    expect(c.state().phase).toBe("ready");
    const again = c.begin();
    expect(c.state()).toEqual({ phase: "calibrating", progress: 0 });
    expect(c.baseline).toBeNull();
    feed(c, t, CALIBRATION_MS + 3 * FRAME_MS, standing);
    await again;
    expect(c.state().phase).toBe("ready");
  });
});
