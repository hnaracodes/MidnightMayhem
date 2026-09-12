import { describe, expect, it } from "vitest";
import type { Baseline } from "../src/vision/calibration";
import { fistFor } from "../src/vision/hands";
import { computeMetrics, createMetricBuffers, type Metrics } from "../src/vision/metrics";
import { Block } from "../src/vision/gestures/block";
import { Jump } from "../src/vision/gestures/jump";
import { Punch } from "../src/vision/gestures/punch";
import { Walk } from "../src/vision/gestures/walk";
import { THRUST_WINDOW_MS } from "../src/vision/thresholds";
import type { Landmark } from "../src/vision/workerClient";

const FRAME = 33;

function metrics(o: Partial<Metrics> = {}): Metrics {
  return {
    lean: 0,
    riseHip: 0,
    riseShoulder: 0,
    midX: 0.5,
    crossed: false,
    extL: 1,
    extR: 1,
    depthL: 0,
    depthR: 0,
    atHeightL: false,
    atHeightR: false,
    thrustL: false,
    thrustR: false,
    dropL: 0,
    dropR: 0,
    guard: false,
    ...o,
  };
}

/** Runs `n` frames of the same metrics through a gesture, returning the last output. */
function run<T>(g: { update(m: Metrics, ts: number): T }, m: Metrics, n: number, from = 0): T {
  let out!: T;
  for (let i = 0; i < n; i++) out = g.update(m, from + i * FRAME);
  return out;
}

describe("hands stub", () => {
  it("never knows", () => {
    expect(fistFor("L")).toBeUndefined();
    expect(fistFor("R")).toBeUndefined();
  });
});

describe("Walk", () => {
  it("lean 0.3 for 3 frames turns right on; 0.2 keeps it; 0.1 turns it off", () => {
    const w = new Walk();
    expect(run(w, metrics({ lean: 0.3 }), 2)).toEqual({ left: false, right: false });
    expect(w.update(metrics({ lean: 0.3 }), 66)).toEqual({ left: false, right: true });
    expect(run(w, metrics({ lean: 0.2 }), 10, 99)).toEqual({ left: false, right: true });
    expect(run(w, metrics({ lean: 0.1 }), 3, 500)).toEqual({ left: false, right: false });
  });

  it("negative lean walks left and the two are exclusive", () => {
    const w = new Walk();
    expect(run(w, metrics({ lean: -0.3 }), 3)).toEqual({ left: true, right: false });
    const out = run(w, metrics({ lean: 0.3 }), 3, 100);
    expect(out.left && out.right).toBe(false);
    expect(out.right).toBe(true);
  });

  it("reset clears the state", () => {
    const w = new Walk();
    run(w, metrics({ lean: 0.3 }), 3);
    w.reset();
    expect(w.update(metrics({ lean: 0.2 }), 200)).toEqual({ left: false, right: false });
  });
});

describe("Jump", () => {
  it("both rising to 0.15 within 250 ms jumps, and landing ends it after 2 frames", () => {
    const j = new Jump();
    expect(j.update(metrics(), 0)).toBe(false);
    expect(j.update(metrics({ riseHip: 0.08, riseShoulder: 0.08 }), 100)).toBe(false);
    expect(j.update(metrics({ riseHip: 0.15, riseShoulder: 0.15 }), 200)).toBe(true);
    expect(j.update(metrics({ riseHip: 0.2, riseShoulder: 0.2 }), 300)).toBe(true);
    expect(j.update(metrics({ riseHip: 0.02, riseShoulder: 0.02 }), 400)).toBe(true);
    expect(j.update(metrics({ riseHip: 0.0, riseShoulder: 0.0 }), 433)).toBe(false);
  });

  it("a slow rise onto the toes never jumps", () => {
    const j = new Jump();
    let out = false;
    for (let i = 0; i <= 40; i++) {
      const r = (i / 40) * 0.2; // 0.2 over 1.3 s
      out = j.update(metrics({ riseHip: r, riseShoulder: r }), i * FRAME) || out;
    }
    expect(out).toBe(false);
  });

  it("hip-only rise never jumps", () => {
    const j = new Jump();
    j.update(metrics(), 0);
    expect(j.update(metrics({ riseHip: 0.2, riseShoulder: 0.0 }), 100)).toBe(false);
    expect(j.update(metrics({ riseHip: 0.2, riseShoulder: 0.0 }), 133)).toBe(false);
  });
});

describe("Block", () => {
  it("crossed geometry for 3 frames blocks; uncrossing for 3 frames releases", () => {
    const b = new Block();
    expect(run(b, metrics({ crossed: true }), 2)).toBe(false);
    expect(b.update(metrics({ crossed: true }), 66)).toBe(true);
    expect(run(b, metrics({ crossed: false }), 2, 99)).toBe(true);
    expect(b.update(metrics({ crossed: false }), 165)).toBe(false);
  });

  it("hands on hips never blocks", () => {
    const b = new Block();
    expect(run(b, metrics({ crossed: false }), 20)).toBe(false);
  });
});

describe("Punch", () => {
  const thrown = metrics({ extL: 0.4, depthL: 0.5, atHeightL: true, thrustL: true });

  it("ext 0.4 with depth 0.5 after a fast drop punches after 2 frames", () => {
    const p = new Punch("L");
    expect(p.update(thrown, 0)).toBe(false);
    expect(p.update(thrown, 33)).toBe(true);
  });

  it("a slow extension (no thrust) never punches", () => {
    const p = new Punch("L");
    expect(run(p, metrics({ extL: 0.4, depthL: 0.5, atHeightL: true, thrustL: false }), 10)).toBe(false);
  });

  it("overhead never punches", () => {
    const p = new Punch("L");
    expect(run(p, metrics({ extL: 0.4, depthL: 0.5, atHeightL: false, thrustL: true }), 10)).toBe(false);
  });

  it("a hook (ext stays 0.9) never punches", () => {
    const p = new Punch("L");
    expect(run(p, metrics({ extL: 0.9, depthL: 0.5, atHeightL: true, thrustL: true }), 10)).toBe(false);
  });

  it("holds at least 100 ms, then releases when the arm retracts", () => {
    const p = new Punch("R");
    const thrownR = metrics({ extR: 0.4, depthR: 0.5, atHeightR: true, thrustR: true });
    p.update(thrownR, 0);
    expect(p.update(thrownR, 33)).toBe(true);
    const retracted = metrics({ extR: 0.9, depthR: 0.0 });
    expect(p.update(retracted, 50)).toBe(true);
    expect(p.update(retracted, 70)).toBe(true);
    expect(p.update(retracted, 90)).toBe(true);
    expect(p.update(retracted, 140)).toBe(false);
  });

  it("uses only its own arm", () => {
    const p = new Punch("R");
    expect(run(p, thrown, 10)).toBe(false);
  });
});

// ---- computeMetrics on synthetic landmarks ----

const baseline: Baseline = { S: 0.2, leanZero: 0, hipY: 0.6, shoulderY: 0.35, noseY: 0.2, eyeY: 0.18, armLen: 0.4 };

function pose(over: Partial<Record<number, Partial<Landmark>>> = {}): Landmark[] {
  const lms: Landmark[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.9 }));
  const set = (i: number, x: number, y: number) => {
    lms[i] = { x, y, z: 0, visibility: 0.9 };
  };
  set(11, 0.4, 0.35);
  set(12, 0.6, 0.35);
  set(15, 0.38, 0.75);
  set(16, 0.62, 0.75);
  set(23, 0.45, 0.6);
  set(24, 0.55, 0.6);
  for (const [i, o] of Object.entries(over)) lms[Number(i)] = { ...(lms[Number(i)] as Landmark), ...o };
  return lms;
}

function world(over: Partial<Record<number, Partial<Landmark>>> = {}): Landmark[] {
  const lms: Landmark[] = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 0.9 }));
  for (const [i, o] of Object.entries(over)) lms[Number(i)] = { ...(lms[Number(i)] as Landmark), ...o };
  return lms;
}

describe("computeMetrics", () => {
  it("is zero at rest", () => {
    const m = computeMetrics(pose(), world(), baseline, 0, createMetricBuffers());
    expect(m.lean).toBeCloseTo(0);
    expect(m.riseHip).toBeCloseTo(0);
    expect(m.riseShoulder).toBeCloseTo(0);
    expect(m.midX).toBeCloseTo(0.5);
    expect(m.crossed).toBe(false);
    expect(m.extL).toBeCloseTo(1, 1);
    expect(m.depthL).toBe(0);
    expect(m.thrustL).toBe(false);
    expect(m.guard).toBe(false);
  });

  it("lean is the mirrored shoulder-over-hip offset in units of S", () => {
    // Shoulders shift 0.06 to the raw right, which is mirrored left: lean = -0.06 / 0.2
    const m = computeMetrics(pose({ 11: { x: 0.46 }, 12: { x: 0.66 } }), world(), baseline, 0, createMetricBuffers());
    expect(m.lean).toBeCloseTo(-0.3);
  });

  it("rise is positive when the body is higher than at rest", () => {
    const p = pose({ 11: { y: 0.31 }, 12: { y: 0.31 }, 23: { y: 0.57 }, 24: { y: 0.57 } });
    const m = computeMetrics(p, world(), baseline, 0, createMetricBuffers());
    expect(m.riseShoulder).toBeCloseTo(0.2);
    expect(m.riseHip).toBeCloseTo(0.15);
  });

  it("crossed wrists at chest height", () => {
    // Mirrored: left wrist (15) must be right of midX, so its raw x must be smaller.
    const p = pose({ 15: { x: 0.4, y: 0.45 }, 16: { x: 0.6, y: 0.45 } });
    expect(computeMetrics(p, world(), baseline, 0, createMetricBuffers()).crossed).toBe(true);
    const hips = pose({ 15: { x: 0.4, y: 0.62 }, 16: { x: 0.6, y: 0.62 } });
    expect(computeMetrics(hips, world(), baseline, 0, createMetricBuffers()).crossed).toBe(false);
    const uncrossed = pose({ 15: { x: 0.6, y: 0.45 }, 16: { x: 0.4, y: 0.45 } });
    expect(computeMetrics(uncrossed, world(), baseline, 0, createMetricBuffers()).crossed).toBe(false);
  });

  it("extension, depth, height and thrust per arm", () => {
    const buffers = createMetricBuffers();
    computeMetrics(pose(), world(), baseline, 0, buffers);
    const punched = pose({ 15: { x: 0.42, y: 0.4 } }); // wrist near the shoulder in the image
    const w = world({ 11: { z: 0 }, 15: { z: -0.45 } });
    const m = computeMetrics(punched, w, baseline, THRUST_WINDOW_MS / 2, buffers);
    expect(m.extL).toBeCloseTo(Math.hypot(0.02, 0.05) / 0.4);
    expect(m.depthL).toBeCloseTo(0.45);
    expect(m.atHeightL).toBe(true);
    expect(m.thrustL).toBe(true);
    expect(m.dropL).toBeGreaterThan(0.25);
    expect(m.extR).toBeCloseTo(1, 1);
    expect(m.thrustR).toBe(false);
  });
});
