import { describe, expect, it } from "vitest";
import type { Baseline } from "../src/vision/calibration";
import { fistFor } from "../src/vision/hands";
import { computeMetrics, createMetricBuffers, type Metrics } from "../src/vision/metrics";
import { Block } from "../src/vision/gestures/block";
import { Jump } from "../src/vision/gestures/jump";
import { Punch } from "../src/vision/gestures/punch";
import { Walk } from "../src/vision/gestures/walk";
import {
  DEPTH_ENTER_NO_HAND, EXT_ENTER, JAB_EXIT, JAB_EXT, JAB_RISE, JAB_WINDOW_MS, PUNCH_RETRIGGER_COOLDOWN_MS,
  SIDE_JAB_ENABLED, THRUST_DROP, THRUST_WINDOW_MS,
} from "../src/vision/thresholds";
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
    sideL: 0,
    sideR: 0,
    jabRiseL: 0,
    jabRiseR: 0,
    wristGap: 2,
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

  it("emits one short pulse for a held pose and re-arms after the motion signal clears", () => {
    const p = new Punch("R");
    const thrownR = metrics({ extR: 0.4, depthR: 0.5, atHeightR: true, thrustR: true });
    expect(p.update(thrownR, 0)).toBe(false);
    expect(p.update(thrownR, 33)).toBe(true);
    expect(p.update(thrownR, 99)).toBe(true);
    expect(p.update(thrownR, 165)).toBe(false);
    // A held raised hand still meets the level gates, but cannot repeatedly pulse.
    expect(run(p, thrownR, 6, 198)).toBe(false);

    // Once the old motion event ages out, a new punch motion can generate one new pulse.
    const held = metrics({ extR: 0.4, depthR: 0.5, atHeightR: true, thrustR: false });
    expect(p.update(held, 400)).toBe(false);
    expect(p.update(thrownR, 433)).toBe(false);
    expect(p.update(thrownR, 466)).toBe(true);
  });

  it("does not retrigger from a retraction-sized motion during the short cooldown", () => {
    const p = new Punch("L");
    const thrownL = metrics({ extL: 0.4, depthL: 0.5, atHeightL: true, thrustL: true });
    const heldL = metrics({ extL: 0.4, depthL: 0.5, atHeightL: true, thrustL: false });

    expect(p.update(thrownL, 0)).toBe(false);
    expect(p.update(thrownL, 33)).toBe(true);
    // The held frame clears the previous motion; the retraction-shaped signal follows immediately.
    expect(p.update(heldL, 66)).toBe(true);
    // The original 100 ms pulse is still visible here; it must then clear instead of starting again.
    expect(p.update(thrownL, 132)).toBe(true);
    expect(p.update(thrownL, 165)).toBe(false);

    // A later, distinct motion can still start a new punch after the cooldown.
    expect(p.update(heldL, 33 + PUNCH_RETRIGGER_COOLDOWN_MS)).toBe(false);
    expect(p.update(thrownL, 66 + PUNCH_RETRIGGER_COOLDOWN_MS)).toBe(false);
    expect(p.update(thrownL, 99 + PUNCH_RETRIGGER_COOLDOWN_MS)).toBe(true);
  });

  it("uses only its own arm", () => {
    const p = new Punch("R");
    expect(run(p, thrown, 10)).toBe(false);
  });

  it("diag() names every gate with its live value", () => {
    const p = new Punch("L");
    expect(p.diag().out).toBe(false);
    p.update(metrics({ extL: 0.9, depthL: 0.05, atHeightL: true, thrustL: false, dropL: 0.04 }), 0);
    const d = p.diag();
    expect(d).toMatchObject({
      ext: 0.9, depth: 0.05, drop: 0.04, atHeight: true,
      extOk: false, depthOk: false, thrustOk: false, jabOk: false, active: false, out: false, path: null,
    });
    p.update(thrown, 33);
    expect(p.diag()).toMatchObject({ extOk: true, depthOk: true, thrustOk: true, active: true, out: false, path: "thrust" });
    p.update(thrown, 66);
    expect(p.diag()).toMatchObject({ active: true, out: true, path: "thrust" });
    p.reset();
    expect(p.diag().active).toBe(false);
  });
});

describe("Punch: side-jab entry", () => {
  // Arm straight out sideways at shoulder height after a fast rise: no depth, full extension.
  const jab = metrics({ extL: 1.0, depthL: 0.0, atHeightL: true, sideL: JAB_EXT + 0.08, jabRiseL: JAB_RISE + 0.3 });

  it("is enabled for the owner's first pass", () => {
    expect(SIDE_JAB_ENABLED).toBe(true);
  });

  it("a fast horizontal jab punches after 2 frames with zero depth and no thrust", () => {
    const p = new Punch("L");
    expect(p.update(jab, 0)).toBe(false);
    expect(p.update(jab, 33)).toBe(true);
    expect(p.diag()).toMatchObject({ jabOk: true, extOk: false, depthOk: false, thrustOk: false, path: "jab" });
  });

  it("pulses once per jab motion instead of holding the indicator while the arm is out", () => {
    const p = new Punch("R");
    const jabR = metrics({ extR: 1.0, atHeightR: true, sideR: JAB_EXT + 0.08, jabRiseR: JAB_RISE + 0.3 });
    run(p, jabR, 2);
    // Still out past the jab window: the level holds but the old motion signal expires, so the pulse clears.
    const held = metrics({ extR: 1.0, atHeightR: true, sideR: JAB_EXT + 0.05, jabRiseR: 0 });
    expect(run(p, held, 10, 66)).toBe(false);
    // The next fast jab is a separate motion and pulses after debounce.
    expect(p.update(jabR, 500)).toBe(false);
    expect(p.update(jabR, 533)).toBe(true);
  });

  it("crossed arms (side negative) never jab-punch even with a fast move", () => {
    const p = new Punch("L");
    const crossed = metrics({ extL: 0.3, depthL: 0.0, atHeightL: true, sideL: -0.5, jabRiseL: 0.6 });
    expect(run(p, crossed, 10)).toBe(false);
    expect(p.diag().jabOk).toBe(false);
  });

  it("an arm swinging up to block (off height, not out sideways) never jab-punches", () => {
    const p = new Punch("L");
    const up = metrics({ extL: 1.0, depthL: 0.0, atHeightL: false, sideL: 0.2, jabRiseL: 0.1 });
    expect(run(p, up, 10)).toBe(false);
    const overhead = metrics({ extL: 1.0, depthL: 0.0, atHeightL: false, sideL: JAB_EXT + 0.05, jabRiseL: 0.6 });
    expect(run(p, overhead, 10)).toBe(false);
  });

  it("a slow sideways raise (rise below JAB_RISE) never jab-punches", () => {
    const p = new Punch("L");
    const slow = metrics({ extL: 1.0, atHeightL: true, sideL: JAB_EXT + 0.08, jabRiseL: JAB_RISE - 0.1 });
    expect(run(p, slow, 20)).toBe(false);
  });

  it("thrust thresholds after the first tuning pass", () => {
    expect(EXT_ENTER).toBe(0.62);
    expect(DEPTH_ENTER_NO_HAND).toBe(0.22);
    expect(THRUST_DROP).toBe(0.15);
    expect(THRUST_WINDOW_MS).toBe(320);
    expect(JAB_WINDOW_MS).toBe(250);
  });
});

// ---- computeMetrics on synthetic landmarks ----

const baseline: Baseline = { S: 0.2, leanZero: 0, hipY: 0.6, shoulderY: 0.35, noseY: 0.2, eyeY: 0.18, armLen: 0.4 };

function pose(over: Partial<Record<number, Partial<Landmark>>> = {}): Landmark[] {
  const lms: Landmark[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.9 }));
  const set = (i: number, x: number, y: number) => {
    lms[i] = { x, y, z: 0, visibility: 0.9 };
  };
  // Raw image x: the person's left side (11/15/23) is on the image's right, so it has the smaller mirrored xm.
  set(11, 0.6, 0.35);
  set(12, 0.4, 0.35);
  set(15, 0.62, 0.75);
  set(16, 0.38, 0.75);
  set(23, 0.55, 0.6);
  set(24, 0.45, 0.6);
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
    const m = computeMetrics(pose({ 11: { x: 0.66 }, 12: { x: 0.46 } }), world(), baseline, 0, createMetricBuffers());
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
    const punched = pose({ 15: { x: 0.58, y: 0.4 } }); // wrist near the shoulder in the image
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

  it("side is the outward horizontal offset over arm length, per arm, negative when crossed", () => {
    const b = createMetricBuffers();
    // Person's left arm (11/15) is on the mirrored left: raw x larger = further out.
    const outL = pose({ 15: { x: 1.0, y: 0.35 } }); // 0.4 image units out from shoulder 11 at x 0.6
    const m = computeMetrics(outL, world(), baseline, 0, b);
    expect(m.sideL).toBeCloseTo(1.0);
    expect(m.atHeightL).toBe(true);
    expect(m.sideR).toBeCloseTo(0.05); // hanging: wrist 16 at raw x 0.38 is 0.02 outward of shoulder 12 at 0.4
    const crossed = computeMetrics(pose({ 15: { x: 0.4, y: 0.45 } }), world(), baseline, 33, b);
    expect(crossed.sideL).toBeCloseTo(-0.5);
  });

  it("jabRise is the raw side rise inside JAB_WINDOW_MS; thrust drop reads the raw landmarks too", () => {
    const b = createMetricBuffers();
    computeMetrics(pose(), world(), baseline, 0, b);
    const outL = pose({ 15: { x: 1.0, y: 0.35 } });
    const m = computeMetrics(outL, world(), baseline, 100, b);
    expect(m.jabRiseL).toBeCloseTo(1.0 - m.sideL + m.jabRiseL, 5); // rose from ~0 to ~1
    expect(m.jabRiseL).toBeGreaterThan(JAB_RISE);
    expect(m.jabRiseR).toBe(0);
    // Smoothed says "hanging" but the raw wrist is already at the shoulder: the drop comes from raw.
    const b2 = createMetricBuffers();
    computeMetrics(pose(), world(), baseline, 0, b2);
    const raw = pose({ 15: { x: 0.58, y: 0.4 } });
    const m2 = computeMetrics(pose(), world(), baseline, 50, b2, raw);
    expect(m2.extL).toBeCloseTo(1, 1);
    expect(m2.dropL).toBeGreaterThan(THRUST_DROP);
    expect(m2.thrustL).toBe(true);
    // Aged out of the window, the rise disappears while the level stays.
    const late = computeMetrics(outL, world(), baseline, 100 + JAB_WINDOW_MS + 50, b);
    expect(late.sideL).toBeCloseTo(1.0);
    expect(late.jabRiseL).toBe(0);
  });
});
