import { describe, expect, it } from "vitest";
import { BALANCE, EMPTY_FRAME, createMatch, isActivePunch, type FighterState, type InputFrame } from "@midnight/shared";
import { HINT_MAX_FRAMES, RenderClock, advanceHint, canHint, hintedFighter } from "../src/game/punchHint";

const edge = (key: keyof InputFrame): InputFrame => ({ ...EMPTY_FRAME, [key]: true });
const idle = (): FighterState => createMatch().fighters[0]!;

describe("punch hint", () => {
  it("starts on a punchL edge when the snapshot fighter is idle and the round is fighting", () => {
    expect(advanceHint(null, edge("punchL"), idle(), true)).toEqual({ arm: "L", frames: 0 });
    expect(advanceHint(null, edge("punchR"), idle(), true)).toEqual({ arm: "R", frames: 0 });
  });

  it("ignores non-punch edges and held keys", () => {
    expect(advanceHint(null, edge("jump"), idle(), true)).toBeNull();
    expect(advanceHint(null, EMPTY_FRAME, idle(), true)).toBeNull();
  });

  it("does not start while punching, in hitstun, blocking or outside FIGHTING", () => {
    const punching = { ...idle(), action: { kind: "punch" as const, arm: "L" as const, elapsed: 5, landed: false, sword: false } };
    expect(canHint(punching, true)).toBe(false);
    expect(canHint({ ...idle(), hitstun: 3 }, true)).toBe(false);
    expect(canHint({ ...idle(), blocking: true }, true)).toBe(false);
    expect(canHint({ ...idle(), item: { kind: "molotov", uses: 2, ticksLeft: null } }, true)).toBe(false); // 11.05: item punches are not hinted
    expect(canHint(idle(), false)).toBe(false);
    expect(advanceHint(null, edge("punchL"), punching, true)).toBeNull();
    expect(advanceHint(null, edge("punchL"), idle(), false)).toBeNull();
  });

  it("draws elapsed 0..3 over four frames, holds at 3, and never reaches the active pose", () => {
    let hint = advanceHint(null, edge("punchR"), idle(), true);
    const seen: number[] = [];
    for (let frame = 0; hint; frame += 1) {
      const drawn = hintedFighter(idle(), hint);
      expect(drawn.action).toMatchObject({ kind: "punch", arm: "R" });
      expect(isActivePunch(drawn)).toBe(false);
      seen.push(drawn.action!.elapsed);
      hint = advanceHint(hint, EMPTY_FRAME, idle(), true);
    }
    expect(seen).toEqual([0, 1, 2, 3, 3, 3]);
    expect(seen).toHaveLength(HINT_MAX_FRAMES);
    expect(BALANCE.PUNCH_STARTUP).toBe(4);
  });

  it("falls back as soon as a snapshot shows an action", () => {
    const hint = advanceHint(null, edge("punchL"), idle(), true);
    const confirmed = { ...idle(), action: { kind: "punch" as const, arm: "L" as const, elapsed: 0, landed: false, sword: false } };
    expect(advanceHint(hint, EMPTY_FRAME, confirmed, true)).toBeNull();
    expect(hintedFighter(confirmed, null)).toBe(confirmed);
  });

  it("ignores a second edge while a hint is already running", () => {
    const hint = advanceHint(null, edge("punchL"), idle(), true);
    expect(advanceHint(hint, edge("punchR"), idle(), true)).toEqual({ arm: "L", frames: 1 });
  });

  it("never mutates the snapshot fighter", () => {
    const f = idle();
    const before = structuredClone(f);
    hintedFighter(f, { arm: "L", frames: 2 });
    expect(f).toEqual(before);
  });
});

describe("render clock", () => {
  it("tracks wall time at scale 1", () => {
    const clock = new RenderClock();
    expect(clock.advance(1000, 1)).toBe(1000);
    expect(clock.advance(1016, 1)).toBe(1016);
    expect(clock.lagMs(1016)).toBe(0);
  });

  it("advances at a quarter speed during the KO slowdown", () => {
    const clock = new RenderClock();
    clock.advance(0, 1);
    expect(clock.advance(16, 0.25)).toBe(4);
    expect(clock.advance(32, 0.25)).toBe(8);
    expect(clock.lagMs(32)).toBe(24);
  });

  it("catches up after the slowdown and never runs ahead of wall time", () => {
    const clock = new RenderClock();
    clock.advance(0, 1);
    for (let now = 16; now <= 30 * 16; now += 16) clock.advance(now, 0.25);
    const lag = clock.lagMs(480);
    expect(lag).toBeCloseTo(360, 5);
    let now = 480;
    let steps = 0;
    while (clock.lagMs(now) > 0) {
      now += 16;
      const t = clock.advance(now, 1);
      expect(t).toBeLessThanOrEqual(now);
      steps += 1;
    }
    expect(steps).toBeLessThanOrEqual(Math.ceil(lag / 16) + 1);
    expect(clock.advance(now + 16, 1)).toBe(now + 16);
  });
});
