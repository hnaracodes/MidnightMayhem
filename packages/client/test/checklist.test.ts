import { describe, expect, it } from "vitest";
import { EMPTY_FRAME } from "@midnight/shared";
import { OCCASION_GAP_MS, OccasionCounter } from "../src/harness/checklist";

const on = { ...EMPTY_FRAME, punchL: true };

describe("OccasionCounter", () => {
  it("counts a detection once per occasion, with a new occasion after 500 ms false", () => {
    const c = new OccasionCounter();
    c.update(on, 0);
    c.update(on, 33);
    expect(c.count("punchL")).toBe(1);
    c.update(EMPTY_FRAME, 66);
    c.update(on, 200); // false for only 134 ms: same occasion
    expect(c.count("punchL")).toBe(1);
    c.update(EMPTY_FRAME, 233);
    c.update(on, 233 + OCCASION_GAP_MS);
    expect(c.count("punchL")).toBe(2);
    expect(c.count("punchR")).toBe(0);
  });

  it("reset clears counts", () => {
    const c = new OccasionCounter();
    c.update(on, 0);
    c.reset();
    expect(c.count("punchL")).toBe(0);
  });
});
