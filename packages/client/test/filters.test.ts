import { describe, expect, it } from "vitest";
import { Debounce, Hysteresis, RingBuffer, emaLandmarks } from "../src/vision/filters";
import type { Landmark } from "../src/vision/workerClient";

const lm = (x: number, y = 0, z = 0, visibility = 1): Landmark => ({ x, y, z, visibility });

describe("emaLandmarks", () => {
  it("returns a copy of next when there is no previous", () => {
    const next = [lm(0.5, 0.25, 0.1)];
    const out = emaLandmarks(null, next, 0.6);
    expect(out).toEqual(next);
    expect(out).not.toBe(next);
  });

  it("blends each coordinate by alpha and keeps the latest visibility", () => {
    const prev = [lm(0, 0, 0, 0.2)];
    const next = [lm(1, 2, 4, 0.9)];
    expect(emaLandmarks(prev, next, 0.6)).toEqual([{ x: 0.6, y: 1.2, z: 2.4, visibility: 0.9 }]);
  });

  it("restarts from next when the landmark count changes", () => {
    const out = emaLandmarks([lm(0)], [lm(1), lm(2)], 0.5);
    expect(out).toEqual([lm(1), lm(2)]);
  });
});

describe("Hysteresis", () => {
  it("turns on above enter and stays on until below exit", () => {
    const h = new Hysteresis(0.25, 0.15);
    const seq = [0.1, 0.2, 0.3, 0.2, 0.16, 0.14, 0.2, 0.26];
    expect(seq.map((v) => h.update(v))).toEqual([false, false, true, true, true, false, false, true]);
  });

  it("reset clears the on state", () => {
    const h = new Hysteresis(0.5, 0.1);
    h.update(1);
    h.reset();
    expect(h.update(0.3)).toBe(false);
  });
});

describe("Debounce", () => {
  it("switches on after onFrames trues and off after offFrames falses", () => {
    const d = new Debounce(3, 2);
    const seq = [true, true, false, true, true, true, false, true, false, false, false];
    expect(seq.map((v) => d.update(v))).toEqual([
      false, false, false, false, false, true, true, true, true, false, false,
    ]);
  });

  it("onFrames of 1 switches on immediately", () => {
    const d = new Debounce(1, 2);
    expect(d.update(true)).toBe(true);
    expect(d.update(false)).toBe(true);
    expect(d.update(false)).toBe(false);
  });

  it("reset returns to off with cleared counters", () => {
    const d = new Debounce(2, 2);
    d.update(true);
    d.update(true);
    d.reset();
    expect(d.update(true)).toBe(false);
  });
});

describe("RingBuffer", () => {
  it("returns the oldest value inside the window relative to the latest push", () => {
    const b = new RingBuffer<number>(1000);
    b.push(0, 1);
    b.push(100, 2);
    b.push(300, 3);
    expect(b.oldestWithin(250)).toBe(2);
    expect(b.oldestWithin(300)).toBe(1);
    expect(b.oldestWithin(50)).toBe(3);
  });

  it("evicts entries older than maxAgeMs", () => {
    const b = new RingBuffer<number>(200);
    b.push(0, 1);
    b.push(150, 2);
    b.push(300, 3);
    expect(b.oldestWithin(1000)).toBe(2);
  });

  it("maxDropWithin is the largest fall from an earlier value to the latest", () => {
    const b = new RingBuffer<number>(1000);
    b.push(0, 1.0);
    b.push(50, 0.9);
    b.push(100, 0.7);
    b.push(150, 0.5);
    expect(b.maxDropWithin(200)).toBeCloseTo(0.5);
    expect(b.maxDropWithin(60)).toBeCloseTo(0.2);
    b.push(200, 0.8);
    expect(b.maxDropWithin(200)).toBeCloseTo(0.2);
  });

  it("is empty after clear", () => {
    const b = new RingBuffer<number>(1000);
    b.push(0, 1);
    b.clear();
    expect(b.oldestWithin(1000)).toBeUndefined();
    expect(b.maxDropWithin(1000)).toBe(0);
  });
});
