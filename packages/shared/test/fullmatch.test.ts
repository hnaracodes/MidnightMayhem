import { describe, expect, it } from "vitest";
import { EMPTY_FRAME, type InputFrame, type SimEvent } from "../src";
import { createMatch } from "../src/sim/create";
import { step } from "../src/sim/step";

/** Headless scripted match: P0 walks in and punches on a cadence, P1 blocks sometimes. Must reach MATCH_END. */
describe("full match", () => {
  it("runs to MATCH_END with a winner and consistent events", () => {
    let s = createMatch();
    const events: SimEvent[] = [];
    for (let t = 0; t < 60 * 60 * 5 && s.phase !== "MATCH_END"; t++) {
      const p0: InputFrame = { ...EMPTY_FRAME, right: s.fighters[1].x - s.fighters[0].x > 90, punchL: t % 20 < 2 };
      const p1: InputFrame = { ...EMPTY_FRAME, block: t % 90 < 30 };
      const r = step(s, [p0, p1]); s = r.state; events.push(...r.events);
    }
    expect(s.phase).toBe("MATCH_END");
    expect(s.winner).not.toBeNull();
    expect(events.filter((e) => e.type === "ROUND_START").length).toBeGreaterThanOrEqual(2);
    expect(events.filter((e) => e.type === "MATCH_END")).toHaveLength(1);
    expect(events.filter((e) => e.type === "ROUND_END").length).toBe(events.filter((e) => e.type === "ROUND_START").length);
  });
  it("is deterministic", () => {
    const play = () => { let s = createMatch(); for (let t = 0; t < 2000; t++) s = step(s, [{ ...EMPTY_FRAME, right: t % 7 < 4, punchL: t % 13 === 0, jump: t % 50 === 0 }, { ...EMPTY_FRAME, left: t % 5 < 2, punchR: t % 11 === 0 }]).state; return JSON.stringify(s); };
    expect(play()).toBe(play());
  });
});
