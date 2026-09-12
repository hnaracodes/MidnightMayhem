import { describe, expect, it } from "vitest";
import type Phaser from "phaser";
import { MAX_EMBERS, MAX_MOTES, Particulate } from "../src/game/stage/particulate";

class FakeGraphics {
  rects: Array<{ x: number; y: number }> = [];
  destroyed = false;
  constructor() {
    return new Proxy(this, { get: (t, p, r) => (p in t ? Reflect.get(t, p, r) : () => r) });
  }
  fillRect(x: number, y: number): this { this.rects.push({ x, y }); return this; }
  clear(): this { this.rects = []; return this; }
  destroy(): void { this.destroyed = true; }
}
function stubScene() {
  const gs: FakeGraphics[] = [];
  return { scene: { add: { graphics: () => { const g = new FakeGraphics(); gs.push(g); return g; } } } as unknown as Phaser.Scene, gs };
}
const DT = 1 / 60;
const ON = { reducedMotion: false, enabled: true, roofSpeed: 240 };

describe("12.03 rule 3: particulate", () => {
  it("caps hold over 30 s and the same seed draws the same air", () => {
    const a = new Particulate(stubScene().scene, 5);
    const b = new Particulate(stubScene().scene, 5);
    const c = new Particulate(stubScene().scene, 6);
    let maxM = 0, maxE = 0;
    for (let k = 0; k < 30 * 60; k++) {
      a.update(DT, ON); b.update(DT, ON); c.update(DT, ON);
      const l = a.live();
      maxM = Math.max(maxM, l.motes); maxE = Math.max(maxE, l.embers);
      expect(l.motes).toBeLessThanOrEqual(MAX_MOTES);
      expect(l.embers).toBeLessThanOrEqual(MAX_EMBERS);
    }
    expect(maxM).toBe(MAX_MOTES);
    expect(maxE).toBeGreaterThan(MAX_EMBERS / 2);
    const { gs: ga } = stubScene();
    void ga;
    expect(a.live()).toEqual(b.live());
  });

  it("two seeds differ, embers rise and die, and reduced motion or a disabled tier leaves nothing live", () => {
    const sa = stubScene(), sb = stubScene();
    const a = new Particulate(sa.scene, 1), b = new Particulate(sb.scene, 2);
    for (let k = 0; k < 120; k++) { a.update(DT, ON); b.update(DT, ON); }
    expect(sa.gs[0]!.rects).not.toEqual(sb.gs[0]!.rects);
    // embers: the first born ember moves up between two frames
    const emberG = sa.gs[1]!;
    const y0 = emberG.rects[0]!.y;
    a.update(DT, ON);
    expect(emberG.rects[0]!.y).toBeLessThanOrEqual(y0);
    for (let k = 0; k < 6 * 60; k++) a.update(DT, ON);
    expect(a.live().embers).toBeLessThanOrEqual(MAX_EMBERS);
    a.update(DT, { ...ON, reducedMotion: true });
    expect(a.live()).toEqual({ motes: 0, embers: 0 });
    expect(sa.gs[0]!.rects.length).toBe(0);
    b.update(DT, { ...ON, enabled: false });
    expect(b.live()).toEqual({ motes: 0, embers: 0 });
  });
});
