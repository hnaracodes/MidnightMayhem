import { describe, expect, it } from "vitest";
import { iou, letterbox, nms, toLetterbox, unletterbox, type Candidate } from "../src/vision/backends/nms";

const c = (x: number, y: number, w: number, h: number, score: number, label = "bottle"): Candidate => ({
  x, y, w, h, score, label,
});

describe("iou", () => {
  it("is 1 for identical boxes and 0 for disjoint ones", () => {
    expect(iou(c(0, 0, 10, 10, 1), c(0, 0, 10, 10, 1))).toBeCloseTo(1);
    expect(iou(c(0, 0, 10, 10, 1), c(20, 20, 10, 10, 1))).toBe(0);
  });

  it("is the overlap over the union", () => {
    // 10×10 boxes offset by 5 in x: overlap 50, union 150.
    expect(iou(c(0, 0, 10, 10, 1), c(5, 0, 10, 10, 1))).toBeCloseTo(50 / 150);
  });
});

describe("nms", () => {
  it("rule 2: two boxes with IoU 0.6 keep the higher score", () => {
    // 10×10 and a 10×10 shifted by 2.5 in x: overlap 75, union 125 → IoU 0.6.
    const a = c(0, 0, 10, 10, 0.5);
    const b = c(2.5, 0, 10, 10, 0.9);
    expect(iou(a, b)).toBeCloseTo(0.6);
    expect(nms([a, b], 0.5)).toEqual([b]);
  });

  it("rule 2: two boxes with IoU 0.3 keep both, higher score first", () => {
    // overlap 30 (3×10), union 170 → 0.176; use 10×10 vs shift 5.4 → overlap 46, union 154 → 0.299
    const a = c(0, 0, 10, 10, 0.4);
    const b = c(5.4, 0, 10, 10, 0.7);
    expect(iou(a, b)).toBeLessThan(0.31);
    expect(nms([a, b], 0.5)).toEqual([b, a]);
  });

  it("suppresses only within the same label", () => {
    const a = c(0, 0, 10, 10, 0.5, "bottle");
    const b = c(0, 0, 10, 10, 0.9, "banana");
    expect(nms([a, b], 0.5)).toEqual([b, a]);
  });

  it("returns an empty list for no candidates", () => {
    expect(nms([], 0.5)).toEqual([]);
  });
});

describe("letterbox", () => {
  it("scales the long side to the square and centres the short side", () => {
    const lb = letterbox(640, 480, 320);
    expect(lb.scale).toBeCloseTo(0.5);
    expect(lb.dx).toBe(0);
    expect(lb.dy).toBe(40);
  });

  it("handles a portrait source", () => {
    const lb = letterbox(480, 640, 320);
    expect(lb.dx).toBe(40);
    expect(lb.dy).toBe(0);
  });

  it("rule 2: round-trips a box within 0.5 px for 640×480 → 320", () => {
    const lb = letterbox(640, 480, 320);
    const box = { x: 100, y: 200, w: 50, h: 80 };
    const inLb = toLetterbox(box, lb);
    expect(inLb).toEqual({ x: 50, y: 140, w: 25, h: 40 });
    const back = unletterbox(inLb, lb);
    expect(Math.abs(back.x - box.x)).toBeLessThan(0.5);
    expect(Math.abs(back.y - box.y)).toBeLessThan(0.5);
    expect(Math.abs(back.w - box.w)).toBeLessThan(0.5);
    expect(Math.abs(back.h - box.h)).toBeLessThan(0.5);
  });
});
