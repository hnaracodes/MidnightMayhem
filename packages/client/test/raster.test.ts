import { describe, expect, it } from "vitest";
import { upscaleBlock } from "../src/game/raster";
import { scalePart, parsePart, rgba, type Part } from "../src/game/sprites/grid";
import { P } from "../src/game/palette";

describe("13.01 upscaleBlock", () => {
  it("copies every source pixel into an exact k × k block, transparent stays zero, no offset", () => {
    const src = new Uint32Array([rgba(0x112233), 0, 0, rgba(0x445566, 128)]);
    const out = upscaleBlock(src, 2, 2, 3);
    expect(out.length).toBe(6 * 6 * 4);
    const at = (x: number, y: number): number[] => Array.from(out.slice((y * 6 + x) * 4, (y * 6 + x) * 4 + 4));
    for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) expect(at(x, y)).toEqual([0x11, 0x22, 0x33, 255]);
    for (let y = 0; y < 3; y++) for (let x = 3; x < 6; x++) expect(at(x, y)).toEqual([0, 0, 0, 0]);
    for (let y = 3; y < 6; y++) for (let x = 3; x < 6; x++) expect(at(x, y)).toEqual([0x44, 0x55, 0x66, 128]);
    expect(at(2, 3)).toEqual([0, 0, 0, 0]);
  });
});

describe("13.01 scalePart", () => {
  const part: Part = { grid: ["ab", "cd"], anchor: { x: 1, y: 0 }, palette: { a: P.moon, b: P.amber1, c: P.danger, d: null } };
  it("resamples nearest-neighbour and scales the anchor", () => {
    const s = scalePart(part, 2);
    expect(s.grid).toEqual(["aabb", "aabb", "ccdd", "ccdd"]);
    expect(s.anchor).toEqual({ x: 2, y: 0 });
    expect(s.palette).toBe(part.palette);
    expect(() => parsePart(s)).not.toThrow();
  });
  it("handles non-integer factors without dropping rows or columns", () => {
    const s = scalePart(part, 2.1);
    expect(s.grid.length).toBe(4);
    expect(s.grid.every((row) => row.length === 4)).toBe(true);
    const big = scalePart({ grid: ["abcde"], anchor: { x: 4, y: 0 } }, 2.1);
    expect(big.grid[0]!.length).toBe(11);
    expect(big.grid[0]![10]).toBe("e");
    expect(big.anchor.x).toBe(8);
  });
});
