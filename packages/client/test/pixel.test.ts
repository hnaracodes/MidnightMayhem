import { describe, expect, it } from "vitest";
import { PIXEL, snap, snapPt, snapUp } from "../src/game/pixel";
import { SPRITE_SCALE } from "../src/game/sprites/compose";

describe("12.01 pixel grid (13.01: a 2 px grid for effects and backgrounds, fighters at 1 px)", () => {
  it("rule 1: PIXEL is the 2 px world grid; the sprite grid is finer by design", () => {
    expect(PIXEL).toBe(2);
    expect(SPRITE_SCALE).toBe(1);
    expect(PIXEL % SPRITE_SCALE).toBe(0);
  });

  it("rule 2: snap rounds to the nearest multiple, half-way up", () => {
    expect(snap(3)).toBe(4);
    expect(snap(5)).toBe(6);
    expect(snap(-3)).toBe(-2); // toward +∞, like Math.round
    expect(snap(-5)).toBe(-4);
    expect(snap(1)).toBe(2);
    expect(snap(0.9)).toBe(0);
    expect(snap(0)).toBe(0);
    for (let v = -50; v <= 50; v += 0.25) {
      const s = snap(v);
      expect(Math.abs(s % PIXEL)).toBe(0);
      expect(Math.abs(s - v)).toBeLessThanOrEqual(PIXEL / 2);
      expect(snap(s)).toBe(s);
    }
  });

  it("rule 2: snapUp never shrinks", () => {
    expect(snapUp(3)).toBe(4);
    expect(snapUp(4)).toBe(4);
    expect(snapUp(0.1)).toBe(2);
    expect(snapUp(0)).toBe(0);
  });

  it("snapPt keeps extra fields", () => {
    const p = snapPt({ x: 3, y: 7.4, r: 2.5 });
    expect(p).toEqual({ x: 4, y: 8, r: 2.5 });
  });
});
