import { describe, expect, it } from "vitest";
import { ITEMS } from "@midnight/shared";
import { FIXTURE_HEIGHT, FIXTURE_WIDTH, fixtureSpecs } from "../src/bench/fixtures";

describe("bench fixtures (9.07)", () => {
  it("is a 40-frame set covering the five labels at three sizes, inside the frame", () => {
    const specs = fixtureSpecs();
    expect(specs).toHaveLength(40);
    const labels = new Set(specs.map((s) => s.label));
    expect(labels).toEqual(new Set(Object.values(ITEMS).map((i) => i.cocoLabel)));
    const sizes = new Set(specs.map((s) => s.size));
    expect(sizes).toEqual(new Set(["small", "medium", "large"]));
    for (const s of specs) {
      expect(s.x).toBeGreaterThanOrEqual(0);
      expect(s.y).toBeGreaterThanOrEqual(0);
      expect(s.x + s.w).toBeLessThanOrEqual(FIXTURE_WIDTH);
      expect(s.y + s.h).toBeLessThanOrEqual(FIXTURE_HEIGHT);
    }
  });

  it("is deterministic", () => {
    expect(fixtureSpecs()).toEqual(fixtureSpecs());
  });
});
