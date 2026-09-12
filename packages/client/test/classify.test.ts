import { describe, expect, it } from "vitest";
import { classify } from "../src/vision/classify";

const g = (o: Partial<Record<"left" | "right" | "jump" | "punchL" | "punchR" | "block", boolean>> = {}) => ({
  left: false,
  right: false,
  jump: false,
  punchL: false,
  punchR: false,
  block: false,
  ...o,
});

describe("classify priority", () => {
  it("jump beats block and punches", () => {
    expect(classify(g({ jump: true, block: true, punchL: true, punchR: true }))).toEqual(
      g({ jump: true }),
    );
  });

  it("block beats punches", () => {
    expect(classify(g({ block: true, punchL: true, punchR: true }))).toEqual(g({ block: true }));
  });

  it("punches pass through alone", () => {
    expect(classify(g({ punchL: true, punchR: true }))).toEqual(g({ punchL: true, punchR: true }));
  });

  it("walk passes through with everything", () => {
    expect(classify(g({ left: true, jump: true, block: true }))).toEqual(g({ left: true, jump: true }));
    expect(classify(g({ right: true, block: true, punchR: true }))).toEqual(g({ right: true, block: true }));
  });

  it("returns a frozen object reused until a field changes", () => {
    const a = classify(g({ right: true }));
    const b = classify(g({ right: true }));
    expect(Object.isFrozen(a)).toBe(true);
    expect(b).toBe(a);
    const c = classify(g({ right: true, punchL: true }));
    expect(c).not.toBe(a);
    expect(c.punchL).toBe(true);
    // Priority-equal inputs also reuse the object.
    const d = classify(g({ right: true, punchL: true, jump: true }));
    const e = classify(g({ right: true, jump: true }));
    expect(e).toBe(d);
  });
});
