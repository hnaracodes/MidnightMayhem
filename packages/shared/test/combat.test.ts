import { describe, expect, it } from "vitest";
import { BALANCE, EMPTY_FRAME, WORLD, type InputFrame } from "../src";
import { createMatch } from "../src/sim/create";
import { step } from "../src/sim/step";
import { hurtbox, punchHitbox } from "../src/sim/combat";
import { P_L, fighting, run } from "./helpers";

const TOTAL = BALANCE.PUNCH_STARTUP + BALANCE.PUNCH_ACTIVE + BALANCE.PUNCH_RECOVERY;

describe("boxes", () => {
  it("hurtbox anchored bottom-centre", () => {
    const f = createMatch().fighters[0]!;
    expect(hurtbox(f)).toEqual({ x: 244, y: WORLD.ROOF_Y - 140, w: 72, h: 140 });
  });
  it("punch hitbox only on active ticks, both facings", () => {
    const f = createMatch().fighters[0]!;
    expect(punchHitbox(f)).toBeNull();
    f.action = { kind: "punch", arm: "L", elapsed: BALANCE.PUNCH_STARTUP, landed: false, sword: false };
    expect(punchHitbox(f)).toEqual({ x: 290, y: WORLD.ROOF_Y - 120, w: 70, h: 60 });
    f.facing = -1;
    expect(punchHitbox(f)).toEqual({ x: 200, y: WORLD.ROOF_Y - 120, w: 70, h: 60 });
    f.action.elapsed = BALANCE.PUNCH_STARTUP - 1;
    expect(punchHitbox(f)).toBeNull();
  });
});

describe("punch resolution", () => {
  it("in range lands once for PUNCH_DAMAGE", () => {
    const { s, events } = run(fighting(60), TOTAL, [P_L, EMPTY_FRAME]);
    const hits = events.filter((e) => e.type === "HIT");
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ attacker: 0, target: 1, damage: 12, blocked: false });
    expect(s.fighters[1]!.hp).toBe(BALANCE.MAX_HP - 12);
  });
  it("contact lands on tick STARTUP+1 after the edge", () => {
    let s = fighting(60); let hitTick = -1;
    for (let i = 1; i <= TOTAL; i++) { const r = step(s, [P_L, EMPTY_FRAME]); s = r.state; if (r.events.some((e) => e.type === "HIT")) { hitTick = i; break; } }
    expect(hitTick).toBe(BALANCE.PUNCH_STARTUP + 1);
  });
  it("out of range misses", () => {
    expect(run(fighting(200), TOTAL, [P_L, EMPTY_FRAME]).s.fighters[1]!.hp).toBe(BALANCE.MAX_HP);
  });
  it("blocked: chip damage, no hitstun, still blocking", () => {
    const { s, events } = run(fighting(60), TOTAL, [P_L, { ...EMPTY_FRAME, block: true }]);
    expect(events.find((e) => e.type === "HIT")).toMatchObject({ damage: 3, blocked: true });
    expect(s.fighters[1]!.hp).toBe(BALANCE.MAX_HP - 3);
    expect(s.fighters[1]!.hitstun).toBe(0); expect(s.fighters[1]!.blocking).toBe(true);
  });
  it("hitstun ignores input and knocks back", () => {
    let s = run(fighting(60), BALANCE.PUNCH_STARTUP + 1, [P_L, EMPTY_FRAME]).s;
    expect(s.fighters[1]!.hitstun).toBe(12);
    const x0 = s.fighters[1]!.x;
    s = run(s, 12, [EMPTY_FRAME, { ...EMPTY_FRAME, punchL: true, left: true }]).s;
    expect(s.fighters[1]!.action).toBeNull();
    expect(s.fighters[1]!.x - x0).toBeCloseTo(144 * 11 / 12, 5);
    expect(s.fighters[1]!.hitstun).toBe(0);
  });
  it("a hit cancels the target's punch", () => {
    const s = fighting(60); s.fighters[1]!.action = { kind: "punch", arm: "R", elapsed: BALANCE.PUNCH_STARTUP + BALANCE.PUNCH_ACTIVE, landed: false, sword: false }; // in recovery
    expect(run(s, BALANCE.PUNCH_STARTUP + 1, [P_L, EMPTY_FRAME]).s.fighters[1]!.action).toBeNull();
  });
  it("same-tick trade lands both", () => {
    const { s, events } = run(fighting(60), TOTAL, [P_L, P_L]);
    expect(events.filter((e) => e.type === "HIT")).toHaveLength(2);
    expect(s.fighters[0]!.hp).toBe(28); expect(s.fighters[1]!.hp).toBe(28);
  });
  it("held punch does not repeat", () => {
    expect(run(fighting(60), TOTAL * 3, [P_L, EMPTY_FRAME]).events.filter((e) => e.type === "PUNCH")).toHaveLength(1);
  });
  it("punch allowed mid-air", () => {
    const s = run(fighting(60), 3, [{ ...EMPTY_FRAME, jump: true }, EMPTY_FRAME]).s;
    expect(run(s, 2, [{ ...EMPTY_FRAME, jump: true, punchL: true }, EMPTY_FRAME]).events.some((e) => e.type === "PUNCH")).toBe(true);
  });
  it("jump i-frames: not hit on jumpTicks 3..10, hit on 2 and 11", () => {
    const hitAt = (jt: number): boolean => {
      const s = fighting(60);
      s.fighters[1]!.grounded = false; s.fighters[1]!.jumpTicks = jt - 1; s.fighters[1]!.y = 400; s.fighters[1]!.vy = 0;
      s.fighters[0]!.action = { kind: "punch", arm: "L", elapsed: BALANCE.PUNCH_STARTUP - 1, landed: false, sword: false };
      return step(s, [EMPTY_FRAME, EMPTY_FRAME]).events.some((e) => e.type === "HIT");
    };
    expect(hitAt(2)).toBe(true);
    for (let t = 3; t <= 10; t++) expect(hitAt(t)).toBe(false);
    expect(hitAt(11)).toBe(true);
  });
});
