import { describe, expect, it } from "vitest";
import { CHARACTERS } from "@midnight/shared";
import { portraitPixels } from "../src/app/sprites/portrait";
import { P } from "../src/game/palette";
import { rgbOf } from "../src/game/sprites/grid";

describe("portrait pixels (11.01 parts)", () => {
  it("every character fills the cell with an outlined head over shoulders, distinct per character", () => {
    const seen = new Set<string>();
    for (const id of CHARACTERS) {
      const c = portraitPixels(id);
      const b = c.bounds();
      expect(b).not.toBeNull();
      // head rows start near the top and the torso runs off the bottom edge
      expect(b!.y0).toBeLessThanOrEqual(2);
      expect(b!.y1).toBe(c.h - 1);
      let outline = 0;
      let opaque = 0;
      for (let y = 0; y < c.h; y++) for (let x = 0; x < c.w; x++) {
        const px = c.get(x, y);
        if (px === 0) continue;
        opaque++;
        if (rgbOf(px) === P.outline) outline++;
      }
      expect(opaque).toBeGreaterThan(150);
      expect(outline).toBeGreaterThan(20);
      seen.add(Array.from(c.data).join(","));
    }
    expect(seen.size).toBe(CHARACTERS.length);
  });
});
