import { describe, expect, it } from "vitest";
import type Phaser from "phaser";
import { MAPS } from "@midnight/shared";
import { MAX_PROPS, Props } from "../src/game/stage/props";

class FakeGraphics {
  calls: string[] = [];
  y = 0;
  destroyed = false;
  constructor() {
    return new Proxy(this, { get: (t, p, r) => (p in t ? Reflect.get(t, p, r) : (...args: unknown[]) => { t.calls.push(`${String(p)}:${JSON.stringify(args)}`); return r; }) });
  }
  setY(y: number): this { this.y = y; return this; }
  clear(): this { this.calls = []; return this; }
  destroy(): void { this.destroyed = true; }
}
function stub() {
  const gs: FakeGraphics[] = [];
  const gains: Record<number, number> = {};
  const scene = { add: { graphics: () => { const g = new FakeGraphics(); gs.push(g); return g; } } } as unknown as Phaser.Scene;
  return { scene, gs, lighting: { setLampGain: (i: number, k: number) => { gains[i] = k; } }, gains };
}
const DT = 1 / 60;
const spans = (map: keyof typeof MAPS) => {
  const def = MAPS[map];
  const gaps: { x0: number; x1: number }[] = [];
  for (let i = 1; i < def.ground.length; i++) gaps.push({ x0: def.ground[i - 1]!.x1, x1: def.ground[i]!.x0 });
  return { gaps, platforms: def.platforms };
};
const ON = (over: Partial<Parameters<Props["update"]>[1]> = {}) => ({ reducedMotion: false, quality: "high" as const, roofOffset: 0, bob: 0, clack: false, tunnel: false, ...over });

describe("13.06 ambient props", () => {
  it("caps hold over 30 s on chaos, the same seed draws the same calls and a different seed differs", () => {
    const a = stub(), b = stub(), c = stub();
    const pa = new Props(a.scene, a.lighting, 5), pb = new Props(b.scene, b.lighting, 5), pc = new Props(c.scene, c.lighting, 6);
    for (const p of [pa, pb, pc]) p.setMap(spans("chaos"));
    let max = 0;
    for (let k = 0; k < 30 * 60; k++) {
      const clack = k % 360 === 0;
      pa.update(DT, ON({ clack, roofOffset: k * 4 })); pb.update(DT, ON({ clack, roofOffset: k * 4 })); pc.update(DT, ON({ clack, roofOffset: k * 4 }));
      max = Math.max(max, pa.live());
      expect(pa.live()).toBeLessThanOrEqual(MAX_PROPS);
    }
    expect(max).toBeGreaterThan(6);
    expect(a.gs[1]!.calls).toEqual(b.gs[1]!.calls);
    expect(a.gs[1]!.calls).not.toEqual(c.gs[1]!.calls);
  });

  it("the failing lamp drops below half within 15 s and recovers to about 1; the first lamp only flickers", () => {
    const s = stub();
    const p = new Props(s.scene, s.lighting);
    let minGain = 1, minFirst = 1;
    for (let k = 0; k < 15 * 60; k++) { p.update(DT, ON()); minGain = Math.min(minGain, p.lampGain(1)); minFirst = Math.min(minFirst, p.lampGain(0)); }
    expect(minGain).toBeLessThan(0.5);
    expect(minFirst).toBeGreaterThan(0.85);
    let recovered = false;
    for (let k = 0; k < 4 * 60; k++) { p.update(DT, ON()); if (p.lampGain(1) > 0.9) recovered = true; }
    expect(recovered).toBe(true);
    expect(s.gains[1]).toBeCloseTo(p.lampGain(1), 9);
  });

  it("reduced motion freezes everything at gain 1 and no particles; low keeps only the lamps and the flap", () => {
    const s = stub();
    const p = new Props(s.scene, s.lighting);
    p.setMap(spans("chaos"));
    for (let k = 0; k < 120; k++) p.update(DT, ON({ clack: k === 0 }));
    expect(p.live()).toBeGreaterThan(3);
    p.update(DT, ON({ reducedMotion: true }));
    expect(p.lampGain(1)).toBe(1);
    expect(s.gains[0]).toBe(1);
    const lowS = stub();
    const low = new Props(lowS.scene, lowS.lighting);
    low.setMap(spans("chaos"));
    for (let k = 0; k < 120; k++) low.update(DT, ON({ quality: "low" }));
    expect(low.live()).toBe(3); // two lamps and the flap
    expect(lowS.gs[1]!.calls.filter((c) => c.startsWith("fill")).length).toBe(0); // no particles drawn on low
  });

  it("a clack kicks the flap up and it settles; setMap keeps at most two racks and two gaps", () => {
    const s = stub();
    const p = new Props(s.scene, s.lighting);
    p.setMap(spans("platforms"));
    p.update(DT, ON({ clack: true }));
    const lifted = s.gs[0]!.calls.find((c) => c.startsWith("fillRect"))!;
    p.update(DT, ON()); p.update(DT, ON()); p.update(DT, ON()); p.update(DT, ON()); p.update(DT, ON()); p.update(DT, ON()); p.update(DT, ON());
    const settled = s.gs[0]!.calls.find((c) => c.startsWith("fillRect"))!;
    // the flap rect's y is lower (larger) once settled than right after the clack
    const yOf = (call: string): number => JSON.parse(call.slice(call.indexOf(":") + 1))[1] as number;
    expect(yOf(settled)).toBeGreaterThan(yOf(lifted));
    p.bob(2);
    expect(s.gs[0]!.y).toBe(2);
    expect(s.gs[1]!.y).toBe(2);
    p.destroy();
    expect(s.gs[0]!.destroyed).toBe(true);
    expect(s.gains[0]).toBe(1);
  });
});
