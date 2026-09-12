import { describe, expect, it } from "vitest";
import { BALANCE, EMPTY_FRAME, MATCH } from "../src";
import { createMatch } from "../src/sim/create";
import { run } from "./helpers";

describe("rounds", () => {
  it("countdown -> FIGHTING with ROUND_START at tick 180", () => {
    const { s, events } = run(createMatch(), MATCH.COUNTDOWN_TICKS);
    expect(s.phase).toBe("FIGHTING"); expect(s.tick).toBe(180);
    expect(events.at(-1)).toEqual({ type: "ROUND_START", round: 1 });
  });
  it("timer expiry: higher hp wins", () => {
    const s = run(createMatch(), MATCH.COUNTDOWN_TICKS).s; s.fighters[1]!.hp = 10;
    const { s: e, events } = run(s, MATCH.ROUND_TICKS);
    expect(e.phase).toBe("ROUND_END"); expect(e.roundsWon).toEqual([1, 0]);
    expect(events.at(-1)).toEqual({ type: "ROUND_END", round: 1, winner: 0 });
  });
  it("timer expiry with equal hp scores both", () => {
    const s = run(createMatch(), MATCH.COUNTDOWN_TICKS).s;
    expect(run(s, MATCH.ROUND_TICKS).s.roundsWon).toEqual([1, 1]);
  });
  it("hp 0 ends the round immediately", () => {
    const s = run(createMatch(), MATCH.COUNTDOWN_TICKS).s; s.fighters[0]!.hp = 0;
    const e = run(s, 1).s;
    expect(e.phase).toBe("ROUND_END"); expect(e.roundsWon).toEqual([0, 1]);
  });
  it("round 2 starts in the TUNNEL with reset fighters", () => {
    const s = run(createMatch(), MATCH.COUNTDOWN_TICKS).s; s.fighters[1]!.hp = 0; s.fighters[0]!.x = 100;
    const e = run(s, 1 + MATCH.ROUND_END_TICKS).s;
    expect(e.phase).toBe("COUNTDOWN"); expect(e.round).toBe(2); expect(e.trainCar).toBe("TUNNEL");
    expect(e.fighters[0]!.x).toBe(280); expect(e.fighters[1]!.hp).toBe(BALANCE.MAX_HP);
  });
  it("first to two rounds ends the match", () => {
    const s = createMatch(); s.roundsWon = [1, 0]; s.round = 2;
    const f = run(s, MATCH.COUNTDOWN_TICKS).s; f.fighters[1]!.hp = 0;
    const { s: e, events } = run(f, 1 + MATCH.ROUND_END_TICKS);
    expect(e.phase).toBe("MATCH_END"); expect(e.winner).toBe(0);
    expect(events.at(-1)).toEqual({ type: "MATCH_END", winner: 0 });
  });
  it("2-2 after round 3 is a match draw; 1-0 after round 3 wins", () => {
    const d = createMatch(); d.roundsWon = [1, 1]; d.round = 3;
    const dd = run(run(d, MATCH.COUNTDOWN_TICKS).s, MATCH.ROUND_TICKS + MATCH.ROUND_END_TICKS).s;
    expect(dd.phase).toBe("MATCH_END"); expect(dd.winner).toBe("draw");
    const w = createMatch(); w.roundsWon = [1, 0]; w.round = 3;
    const wf = run(w, MATCH.COUNTDOWN_TICKS).s; wf.fighters[1]!.hp = 1;
    const ww = run(wf, MATCH.ROUND_TICKS + MATCH.ROUND_END_TICKS).s;
    expect(ww.winner).toBe(0);
  });
  it("out of bounds: 3 hp per 30 ticks", () => {
    const s = run(createMatch(), MATCH.COUNTDOWN_TICKS).s; s.fighters[0]!.x = 0;
    const { s: e, events } = run(s, 60);
    expect(e.fighters[0]!.hp).toBe(BALANCE.MAX_HP - 6);
    expect(events.filter((ev) => ev.type === "OOB_DAMAGE")).toHaveLength(2);
  });
  it("inputs ignored in MATCH_END", () => {
    const s = createMatch(); s.phase = "MATCH_END"; s.winner = 0;
    expect(run(s, 5, [{ ...EMPTY_FRAME, right: true }, EMPTY_FRAME]).s.fighters[0]!.x).toBe(280);
  });
});
