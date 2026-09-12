import { describe, expect, it } from "vitest";
import { BALANCE, EMPTY_FRAME, WORLD } from "../src";
import { createMatch } from "../src/sim/create";
import { step } from "../src/sim/step";
import { NONE, fighting, run } from "./helpers";

describe("movement", () => {
  it("spawns at start positions facing each other with full hp", () => {
    const s = createMatch();
    expect(s.fighters[0]!.x).toBe(280); expect(s.fighters[1]!.x).toBe(680);
    expect(s.fighters[0]!.facing).toBe(1); expect(s.fighters[1]!.facing).toBe(-1);
    expect(s.fighters[0]!.hp).toBe(BALANCE.MAX_HP);
  });
  it("walks right 10 ticks = +30", () => {
    expect(run(fighting(), 10, [{ ...EMPTY_FRAME, right: true }, EMPTY_FRAME]).s.fighters[0]!.x).toBe(310);
  });
  it("left and right cancel", () => {
    expect(run(fighting(), 5, [{ ...EMPTY_FRAME, left: true, right: true }, EMPTY_FRAME]).s.fighters[0]!.x).toBe(280);
  });
  it("no movement during COUNTDOWN", () => {
    expect(run(createMatch(), 5, [{ ...EMPTY_FRAME, right: true }, EMPTY_FRAME]).s.fighters[0]!.x).toBe(280);
  });
  it("jump apex ~120 at tick 30, lands by 61, jumpTicks resets", () => {
    const J: [typeof EMPTY_FRAME, typeof EMPTY_FRAME] = [{ ...EMPTY_FRAME, jump: true }, EMPTY_FRAME];
    let { s } = run(fighting(), 1, J);
    expect(s.fighters[0]!.grounded).toBe(false);
    s = run(s, 29, J).s;
    expect(WORLD.ROOF_Y - s.fighters[0]!.y).toBeGreaterThan(110);
    expect(WORLD.ROOF_Y - s.fighters[0]!.y).toBeLessThan(125);
    s = run(s, 31).s;
    expect(s.fighters[0]!.grounded).toBe(true); expect(s.fighters[0]!.y).toBe(WORLD.ROOF_Y); expect(s.fighters[0]!.jumpTicks).toBe(0);
  });
  it("held jump does not re-jump on landing", () => {
    const { s, events } = run(fighting(), 70, [{ ...EMPTY_FRAME, jump: true }, EMPTY_FRAME]);
    expect(s.fighters[0]!.grounded).toBe(true);
    expect(events.filter((e) => e.type === "JUMP")).toHaveLength(1);
  });
  it("facing flips when fighters cross", () => {
    const s = fighting(); s.fighters[0]!.x = 700; s.fighters[1]!.x = 600;
    const r = step(s, NONE).state;
    expect(r.fighters[0]!.facing).toBe(-1); expect(r.fighters[1]!.facing).toBe(1);
  });
  it("clamps at 0 and 960", () => {
    expect(run(fighting(), 200, [{ ...EMPTY_FRAME, left: true }, { ...EMPTY_FRAME, right: true }]).s.fighters[0]!.x).toBe(0);
    expect(run(fighting(), 200, [{ ...EMPTY_FRAME, left: true }, { ...EMPTY_FRAME, right: true }]).s.fighters[1]!.x).toBe(960);
  });
  it("block requires grounded and zeroes vx", () => {
    const { s } = run(fighting(), 3, [{ ...EMPTY_FRAME, block: true, right: true }, EMPTY_FRAME]);
    expect(s.fighters[0]!.blocking).toBe(true); expect(s.fighters[0]!.x).toBe(280);
    const up = run(fighting(), 3, [{ ...EMPTY_FRAME, jump: true }, EMPTY_FRAME]).s;
    const air = run(up, 2, [{ ...EMPTY_FRAME, jump: true, block: true }, EMPTY_FRAME]).s;
    expect(air.fighters[0]!.grounded).toBe(false); expect(air.fighters[0]!.blocking).toBe(false);
  });
  it("step does not mutate its input", () => {
    const s = fighting(); const before = JSON.stringify(s);
    step(s, [{ ...EMPTY_FRAME, right: true, punchL: true }, EMPTY_FRAME]);
    expect(JSON.stringify(s)).toBe(before);
  });
});
