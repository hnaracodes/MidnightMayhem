import { describe, expect, it } from "vitest";
import { PIXEL, snap, snapPt, snapUp } from "../src/game/pixel";
import { SPRITE_SCALE } from "../src/game/sprites/compose";

describe("12.01 pixel grid", () => {
  it("rule 1: PIXEL is the sprite scale", () => {
    expect(PIXEL).toBe(SPRITE_SCALE);
    expect(PIXEL).toBe(3);
  });

  it("rule 2: snap rounds to the nearest multiple, half-way up", () => {
    expect(snap(4)).toBe(3);
    expect(snap(5)).toBe(6);
    expect(snap(-4)).toBe(-3);
    expect(snap(4.5)).toBe(6);
    expect(snap(0)).toBe(0);
    for (let v = -50; v <= 50; v += 0.25) {
      const s = snap(v);
      expect(Math.abs(s % PIXEL)).toBe(0);
      expect(Math.abs(s - v)).toBeLessThanOrEqual(PIXEL / 2);
      expect(snap(s)).toBe(s);
    }
  });

  it("rule 2: snapUp never shrinks", () => {
    expect(snapUp(4)).toBe(6);
    expect(snapUp(6)).toBe(6);
    expect(snapUp(0.1)).toBe(3);
    expect(snapUp(0)).toBe(0);
  });

  it("snapPt keeps extra fields", () => {
    const p = snapPt({ x: 4, y: 7.4, r: 2.5 });
    expect(p).toEqual({ x: 3, y: 6, r: 2.5 });
  });
});
