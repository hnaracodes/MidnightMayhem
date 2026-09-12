import { describe, expect, it } from "vitest";
import type { Baseline } from "../src/vision/calibration";
import { Laser } from "../src/vision/gestures/laser";
import { computeMetrics, createMetricBuffers, type Metrics } from "../src/vision/metrics";
import { LASER_DEBOUNCE_OFF, LASER_DEBOUNCE_ON } from "../src/vision/thresholds";
import type { Landmark } from "../src/vision/workerClient";

const FRAME = 33;

function metrics(o: Partial<Metrics> = {}): Metrics {
  return {
    lean: 0, riseHip: 0, riseShoulder: 0, midX: 0.5, crossed: false,
    extL: 1, extR: 1, depthL: 0, depthR: 0, atHeightL: false, atHeightR: false, wristHeightL: 0, wristHeightR: 0,
    thrustL: false, thrustR: false, dropL: 0, dropR: 0, sideL: 0, sideR: 0, jabRiseL: 0, jabRiseR: 0,
    wristGap: 2, guard: false,
    ...o,
  };
}

/** The player's right hand moves outward quickly; no left-hand pose is needed. */
const RIGHT_SPECIAL = metrics({ sideR: 0.8, jabRiseR: 0.4 });

function run(laser: Laser, m: Metrics, n: number, t0 = 0): boolean[] {
  const out: boolean[] = [];
  for (let i = 0; i < n; i++) out.push(laser.update(m, t0 + i * FRAME));
  return out;
}

describe("Laser gesture", () => {
  it("a fast rightward hand motion turns special on after debounce", () => {
    const laser = new Laser();
    const out = run(laser, RIGHT_SPECIAL, LASER_DEBOUNCE_ON + 1);
    expect(out.slice(0, LASER_DEBOUNCE_ON - 1).every((v) => v === false)).toBe(true);
    expect(out[LASER_DEBOUNCE_ON - 1]).toBe(true);
    expect(out[LASER_DEBOUNCE_ON]).toBe(true);
    expect(LASER_DEBOUNCE_ON).toBe(2);
  });

  it("the special pulse turns off after the rightward motion ends", () => {
    const laser = new Laser();
    run(laser, RIGHT_SPECIAL, LASER_DEBOUNCE_ON);
    const off = run(laser, metrics({ sideR: 0.8, jabRiseR: 0 }), LASER_DEBOUNCE_OFF + 1, 1000);
    expect(off.slice(0, LASER_DEBOUNCE_OFF - 1).every((v) => v === true)).toBe(true);
    expect(off[LASER_DEBOUNCE_OFF - 1]).toBe(false);
    expect(off[LASER_DEBOUNCE_OFF]).toBe(false);
    expect(LASER_DEBOUNCE_OFF).toBe(3);
  });

  it("a forward right-hand punch never sets special", () => {
    const laser = new Laser();
    const forwardPunch = metrics({ extR: 0.4, depthR: 0.5, thrustR: true });
    expect(run(laser, forwardPunch, 10).some(Boolean)).toBe(false);
  });

  it("the left hand and a slow or held-out right hand never set special", () => {
    expect(run(new Laser(), metrics({ sideL: 0.8, jabRiseL: 0.4 }), 10).some(Boolean)).toBe(false);
    expect(run(new Laser(), metrics({ sideR: 0.8, jabRiseR: 0.2 }), 10).some(Boolean)).toBe(false);
    expect(run(new Laser(), metrics({ sideR: 0.8, jabRiseR: 0 }), 10).some(Boolean)).toBe(false);
  });

  it("allows the rightward motion one shoulder-width above or below shoulder level", () => {
    const high = {
      ...RIGHT_SPECIAL, wristHeightR: -0.9,
    } as Metrics;
    const low = {
      ...RIGHT_SPECIAL, wristHeightR: 0.9,
    } as Metrics;
    expect(run(new Laser(), high, 10).some(Boolean)).toBe(true);
    expect(run(new Laser(), low, 10).some(Boolean)).toBe(true);
  });

  it("rejects the former two-hand Kamehameha pose", () => {
    const laser = new Laser();
    const straightForward = metrics({ extL: 0.4, extR: 0.4, atHeightL: true, atHeightR: true, wristGap: 0.3 });
    expect(run(laser, straightForward, 10).some(Boolean)).toBe(false);
  });

  it("reset drops the output and the debounce", () => {
    const laser = new Laser();
    run(laser, RIGHT_SPECIAL, LASER_DEBOUNCE_ON);
    laser.reset();
    expect(laser.update(RIGHT_SPECIAL, 5000)).toBe(false);
  });
});

describe("Metrics.wristGap", () => {
  const baseline: Baseline = { S: 0.2, leanZero: 0, hipY: 0.75, shoulderY: 0.5, noseY: 0.35, eyeY: 0.33, armLen: 0.4 };

  function lms(lw: { x: number; y: number }, rw: { x: number; y: number }): Landmark[] {
    const out: Landmark[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.95 }));
    const set = (i: number, x: number, y: number) => (out[i] = { x, y, z: 0, visibility: 0.95 });
    set(11, 0.4, 0.5);
    set(12, 0.6, 0.5);
    set(23, 0.45, 0.75);
    set(24, 0.55, 0.75);
    set(15, lw.x, lw.y);
    set(16, rw.x, rw.y);
    return out;
  }

  it("is the image distance between wrists 15 and 16 over S", () => {
    const world = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 0.95 }));
    const m = computeMetrics(lms({ x: 0.45, y: 0.5 }, { x: 0.55, y: 0.5 }), world, baseline, 0, createMetricBuffers());
    expect(m.wristGap).toBeCloseTo(0.5, 5);
    const m2 = computeMetrics(lms({ x: 0.4, y: 0.4 }, { x: 0.4, y: 0.6 }), world, baseline, FRAME, createMetricBuffers());
    expect(m2.wristGap).toBeCloseTo(1, 5);
  });
});
