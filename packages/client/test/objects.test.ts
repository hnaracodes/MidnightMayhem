import { describe, expect, it } from "vitest";
import { HoldTracker, cocoToItem, heldItem } from "../src/vision/objects";
import { HOLD_OFF_MS, HOLD_ON, HOLD_RADIUS } from "../src/vision/thresholds";
import type { Landmark, ObjectBox } from "../src/vision/workerClient";

const S = 0.2;
const LEFT_WRIST = { x: 0.3, y: 0.5 };
const RIGHT_WRIST = { x: 0.7, y: 0.5 };

/** 33 landmarks with only the two wrists placed. */
function landmarks(): Landmark[] {
  const lms: Landmark[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.2, z: 0, visibility: 0.95 }));
  lms[15] = { ...LEFT_WRIST, z: 0, visibility: 0.95 };
  lms[16] = { ...RIGHT_WRIST, z: 0, visibility: 0.95 };
  return lms;
}

/** A box of size `w × h` whose centre is at (cx, cy). */
function box(label: string, cx: number, cy: number, score = 0.8, w = 0.1, h = 0.1): ObjectBox {
  return { label, score, x: cx - w / 2, y: cy - h / 2, w, h };
}

describe("cocoToItem", () => {
  it("maps the five COCO labels to items and anything else to null", () => {
    expect(cocoToItem("bottle")).toBe("molotov");
    expect(cocoToItem("umbrella")).toBe("sword");
    expect(cocoToItem("backpack")).toBe("shield");
    expect(cocoToItem("banana")).toBe("banana");
    expect(cocoToItem("cell phone")).toBe("flash");
    expect(cocoToItem("person")).toBeNull();
    expect(cocoToItem("")).toBeNull();
  });
});

describe("heldItem", () => {
  it("a bottle box centred on the left wrist is a molotov", () => {
    expect(heldItem([box("bottle", LEFT_WRIST.x, LEFT_WRIST.y)], landmarks(), S)).toBe("molotov");
  });

  it("the same box 0.6 S away from both wrists is nothing", () => {
    const far = box("bottle", LEFT_WRIST.x + 0.6 * S, LEFT_WRIST.y);
    expect(heldItem([far], landmarks(), S)).toBeNull();
  });

  it("a box just inside HOLD_RADIUS of the right wrist counts, just outside does not", () => {
    const inside = box("umbrella", RIGHT_WRIST.x, RIGHT_WRIST.y + (HOLD_RADIUS - 0.02) * S);
    const outside = box("umbrella", RIGHT_WRIST.x, RIGHT_WRIST.y + (HOLD_RADIUS + 0.02) * S);
    expect(heldItem([inside], landmarks(), S)).toBe("sword");
    expect(heldItem([outside], landmarks(), S)).toBeNull();
  });

  it("a box containing a wrist but centred far away is the item", () => {
    // Centre 1.5 S to the right of the left wrist, but wide enough to cover it.
    const wide = box("backpack", LEFT_WRIST.x + 1.5 * S, LEFT_WRIST.y, 0.7, 4 * S, 0.1);
    expect(heldItem([wide], landmarks(), S)).toBe("shield");
  });

  it("picks the highest-scoring held box; unheld boxes never win regardless of score", () => {
    const near = box("banana", LEFT_WRIST.x, LEFT_WRIST.y, 0.5);
    const nearer = box("cell phone", RIGHT_WRIST.x, RIGHT_WRIST.y, 0.9);
    const farHigh = box("bottle", 0.5, 0.9, 0.99);
    expect(heldItem([near, farHigh, nearer], landmarks(), S)).toBe("flash");
    expect(heldItem([farHigh, near], landmarks(), S)).toBe("banana");
  });

  it("ignores boxes whose label is not an item and empty lists", () => {
    expect(heldItem([box("person", LEFT_WRIST.x, LEFT_WRIST.y, 0.99)], landmarks(), S)).toBeNull();
    expect(heldItem([], landmarks(), S)).toBeNull();
  });

  it("returns null when the wrists are missing", () => {
    expect(heldItem([box("bottle", 0.3, 0.5)], [], S)).toBeNull();
  });
});

describe("HoldTracker", () => {
  const FRAME = 100;

  it("a null inside the run breaks it: [molotov, molotov, null, molotov] never turns on", () => {
    const t = new HoldTracker();
    const out = (["molotov", "molotov", null, "molotov"] as const).map((c, i) => t.update(c, i * FRAME));
    expect(out).toEqual([null, null, null, null]);
  });

  it("HOLD_ON equal candidates turn the item on at the last one", () => {
    const t = new HoldTracker();
    const out: (string | null)[] = [];
    for (let i = 0; i < HOLD_ON; i++) out.push(t.update("molotov", i * FRAME));
    expect(out.slice(0, HOLD_ON - 1).every((v) => v === null)).toBe(true);
    expect(out[HOLD_ON - 1]).toBe("molotov");
  });

  it("stays on through 500 ms of null and drops after 700 ms", () => {
    const t = new HoldTracker();
    let ts = 0;
    for (let i = 0; i < HOLD_ON; i++, ts += FRAME) t.update("molotov", ts);
    const lastPositive = ts - FRAME;
    expect(t.update(null, lastPositive + 500)).toBe("molotov");
    expect(t.update(null, lastPositive + 700)).toBeNull();
    expect(HOLD_OFF_MS).toBeGreaterThan(500);
    expect(HOLD_OFF_MS).toBeLessThan(700);
  });

  it("a positive within HOLD_OFF_MS refreshes the timeout", () => {
    const t = new HoldTracker();
    let ts = 0;
    for (let i = 0; i < HOLD_ON; i++, ts += FRAME) t.update("molotov", ts);
    expect(t.update("molotov", 1000)).toBe("molotov");
    expect(t.update(null, 1500)).toBe("molotov");
    expect(t.update(null, 1700)).toBeNull();
  });

  it("a different item needs its own HOLD_ON run, and the old one holds meanwhile", () => {
    const t = new HoldTracker();
    let ts = 0;
    for (let i = 0; i < HOLD_ON; i++, ts += FRAME) t.update("molotov", ts);
    const out: (string | null)[] = [];
    for (let i = 0; i < HOLD_ON; i++, ts += FRAME) out.push(t.update("sword", ts));
    expect(out.slice(0, HOLD_ON - 1).every((v) => v === "molotov")).toBe(true);
    expect(out[HOLD_ON - 1]).toBe("sword");
  });

  it("reset clears the item and the run", () => {
    const t = new HoldTracker();
    for (let i = 0; i < HOLD_ON; i++) t.update("molotov", i * 100);
    t.reset();
    expect(t.update(null, 1000)).toBeNull();
    expect(t.update("molotov", 1100)).toBeNull();
  });
});
