import { describe, expect, it } from "vitest";
import { P } from "../src/game/palette";
import { PixelCanvas, materialPalette, parseGrid, rgba, rgbOf } from "../src/game/sprites/grid";
import { CREASE_MIN_DEG, jointCrease, rampFrom, stepFor, taperedLimb, type Ramp } from "../src/game/sprites/shade";

const lum = (rgb: number): number => 0.2126 * ((rgb >> 16) & 255) + 0.7152 * ((rgb >> 8) & 255) + 0.0722 * (rgb & 255);
const RAMP: Ramp = rampFrom(P.drifterKey);
const stepOf = (px: number): number => RAMP.findIndex((c) => rgba(c) === px);

/** Opaque pixels of a row as ramp step indices, left to right. */
function row(c: PixelCanvas, y: number): number[] {
  const out: number[] = [];
  for (let x = 0; x < c.w; x++) { const px = c.get(x, y); if (px !== 0) out.push(stepOf(px)); }
  return out;
}
function col(c: PixelCanvas, x: number): number[] {
  const out: number[] = [];
  for (let y = 0; y < c.h; y++) { const px = c.get(x, y); if (px !== 0) out.push(stepOf(px)); }
  return out;
}

describe("13.02 rule 6: ramps", () => {
  it("rampFrom gives four distinct steps with strictly falling luminance", () => {
    for (const base of [P.drifterKey, P.conductorKey, P.stokerSkin, 0x26262c]) {
      const r = rampFrom(base);
      expect(new Set(r).size).toBe(4);
      expect(r[1]).toBe(base);
      for (let i = 1; i < 4; i++) expect(lum(r[i]!)).toBeLessThan(lum(r[i - 1]!));
    }
  });
  it("materialPalette binds four glyphs and parses", () => {
    const pal = materialPalette("hkKc", RAMP);
    expect(pal).toEqual({ h: RAMP[0], k: RAMP[1], K: RAMP[2], c: RAMP[3] });
    expect(() => materialPalette("hk", RAMP)).toThrow();
    const p = parseGrid(["hkKc"], { ".": null, ...pal });
    expect(Array.from(p.data)).toEqual(RAMP.map((c) => rgba(c)));
  });
  it("stepFor is monotone in the light term and dithers only near a boundary", () => {
    let last = 0;
    for (let s = 1; s >= -1; s -= 0.05) { const st = stepFor(s, 0, 0, false); expect(st).toBeGreaterThanOrEqual(last); last = st; }
    expect(stepFor(0.5, 0, 0)).toBe(1);
    expect(stepFor(0.5, 1, 1)).toBe(1);
    const nearBoundary = new Set([stepFor(0.3, 0, 0), stepFor(0.3, 1, 0), stepFor(0.3, 0, 1), stepFor(0.3, 1, 1)]);
    expect(nearBoundary.size).toBe(2);
  });
});

describe("13.02 rules 1–2: tapered, lit capsules", () => {
  const a = { x: 30, y: 10 };
  const b = { x: 30, y: 60 };
  it("is wa wide at the start and wb wide at the end", () => {
    const c = new PixelCanvas(60, 80);
    taperedLimb(c, a, b, 9, 5, RAMP, null);
    expect(row(c, 12).length).toBe(9);
    expect(row(c, 58).length).toBe(5);
    expect(row(c, 35).length).toBe(7);
    expect(row(c, 3).length).toBe(0); // nothing far above the cap
  });
  it("lit from the left: the left column is highlight, the right column core; from the right it flips", () => {
    const left = new PixelCanvas(60, 80);
    taperedLimb(left, a, b, 9, 9, RAMP, { x: -1, y: 0 });
    const right = new PixelCanvas(60, 80);
    taperedLimb(right, a, b, 9, 9, RAMP, { x: 1, y: 0 });
    for (const y of [20, 30, 40, 50]) {
      const l = row(left, y);
      const r = row(right, y);
      expect(l[0]).toBe(0);
      expect(l[l.length - 1]).toBe(3);
      expect(r[0]).toBe(3);
      expect(r[r.length - 1]).toBe(0);
      // the middle carries the base step and every step appears across the width
      expect(l[4]).toBe(1);
      expect(new Set(l).size).toBe(4);
    }
  });
  it("the band rotates with the limb: a horizontal capsule lit from above is highlight on top", () => {
    const c = new PixelCanvas(80, 60);
    taperedLimb(c, { x: 10, y: 30 }, { x: 70, y: 30 }, 9, 9, RAMP, { x: 0, y: -1 });
    for (const x of [25, 40, 55]) {
      const k = col(c, x);
      expect(k[0]).toBe(0);
      expect(k[k.length - 1]).toBe(3);
    }
  });
  it("with no light the cylinder is lit from the camera: base in the middle, darker toward both edges, never highlight", () => {
    const c = new PixelCanvas(60, 80);
    taperedLimb(c, a, b, 9, 9, RAMP, null);
    let edgeDark = 0, edges = 0;
    for (const y of [20, 25, 30, 35, 40, 45, 50]) {
      const r = row(c, y);
      expect(r.length).toBe(9);
      expect(r[4]).toBe(1);
      expect(r.includes(0)).toBe(false);
      for (const e of [r[0]!, r[8]!]) { edges += 1; if (e >= 2) edgeDark += 1; }
    }
    expect(edgeDark).toBeGreaterThan(edges / 2);
  });
  it("flat mode paints the base step only, no dither", () => {
    const c = new PixelCanvas(60, 80);
    taperedLimb(c, a, b, 9, 5, RAMP, { x: -1, y: 0 }, true);
    const seen = new Set<number>();
    for (const px of c.data) if (px !== 0) seen.add(px);
    expect(Array.from(seen)).toEqual([rgba(RAMP[1])]);
  });
  it("records the canvas part id on every pixel it writes", () => {
    const c = new PixelCanvas(60, 80);
    c.id = 6;
    taperedLimb(c, a, b, 9, 5, RAMP, null);
    expect(c.idAt(30, 35)).toBe(6);
    expect(c.idAt(2, 2)).toBe(0);
  });
});

describe("13.02 rule 4: joint crease", () => {
  const hip = { x: 30, y: 10 };
  const knee = { x: 30, y: 40 };
  const straightAnkle = { x: 30, y: 70 };
  const bentAnkle = { x: 55, y: 60 }; // the shin swings toward +x: the concave side is +x
  it("does nothing on a straight joint and darkens only the concave side of a bent one", () => {
    const straight = new PixelCanvas(80, 80);
    taperedLimb(straight, hip, knee, 7, 7, RAMP, null);
    taperedLimb(straight, knee, straightAnkle, 7, 7, RAMP, null);
    const before = Array.from(straight.data);
    jointCrease(straight, knee, hip, straightAnkle, 3.5, RAMP);
    expect(Array.from(straight.data)).toEqual(before);

    const bent = new PixelCanvas(80, 80);
    taperedLimb(bent, hip, knee, 7, 7, RAMP, null);
    taperedLimb(bent, knee, bentAnkle, 7, 7, RAMP, null);
    const was = Array.from(bent.data);
    jointCrease(bent, knee, hip, bentAnkle, 3.5, RAMP);
    let changed = 0;
    for (let i = 0; i < was.length; i++) {
      if (was[i] === bent.data[i]) continue;
      changed += 1;
      const x = i % bent.w;
      const y = Math.floor(i / bent.w);
      expect(x).toBeGreaterThanOrEqual(knee.x); // never on the outer (−x) side
      expect(Math.hypot(x - knee.x, y - knee.y)).toBeLessThanOrEqual(3.5);
      expect(lum(rgbOf(bent.data[i]!))).toBeLessThan(lum(rgbOf(was[i]!)));
    }
    expect(changed).toBeGreaterThan(0);
    expect(CREASE_MIN_DEG).toBe(25);
  });
});
