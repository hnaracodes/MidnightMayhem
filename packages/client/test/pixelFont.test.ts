// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { GLYPH_H, GLYPH_W, glyphCells, hasGlyph, measure, pixelText, rasterGlyph } from "../src/app/pixelFont";

describe("pixelFont", () => {
  it("has every uppercase letter and digit, and lowercase maps onto uppercase", () => {
    for (const ch of "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 -.,!?'/+:") expect(hasGlyph(ch), ch).toBe(true);
    expect(glyphCells("a")).toEqual(glyphCells("A"));
    expect(hasGlyph("é")).toBe(false);
  });

  it("glyphs are 5 × 7; heavy dilates one cell to the right", () => {
    const i = glyphCells("I");
    expect(i.length).toBe(GLYPH_H);
    expect(i[0]!.length).toBe(GLYPH_W);
    const heavy = glyphCells("I", "heavy");
    expect(heavy[0]!.length).toBe(GLYPH_W + 1);
    // the stem of the I (column 2) becomes columns 2 and 3
    expect(heavy[3]).toEqual([false, false, true, true, false, false]);
  });

  it("rasters pad for outline and shadow so nothing clips, and the face sits on top", () => {
    const c = rasterGlyph("I", { depth: 2 });
    expect(c.w).toBe(GLYPH_W + 1 + 3);
    expect(c.h).toBe(GLYPH_H + 1 + 3);
    expect(c.get(2, 3)).not.toBe(0); // stem is ink
    expect(c.get(1, 3)).not.toBe(0); // outline beside the stem
    expect(c.get(0, 3)).toBe(0); // then air
    expect(c.get(4, GLYPH_H + 1)).not.toBe(0); // shadow below the bottom bar
    const flat = rasterGlyph("I", { depth: 0, outline: null });
    expect(flat.w).toBe(GLYPH_W);
  });

  it("measures a run as letters plus tracking plus padding", () => {
    expect(measure("", {})).toBe(0);
    expect(measure("AB", { depth: 0, outline: null, tracking: 1 })).toBe(11);
    expect(measure("AB", { weight: "heavy", depth: 2, tracking: 2 })).toBe(6 + 2 + 6 + 1 + 3);
  });

  it("pixelText keeps the text readable as textContent and draws one canvas per letter", () => {
    const el = pixelText("YOU WIN", { cell: 4 });
    expect(el.textContent).toBe("YOU WIN");
    expect(el.querySelectorAll("canvas").length).toBe(6);
    expect(el.querySelectorAll(".px-word").length).toBe(2);
    expect(el.style.getPropertyValue("--cell")).toBe("4px");
    expect(pixelText("A", {}).style.getPropertyValue("--cell")).toBe("");
  });
});
