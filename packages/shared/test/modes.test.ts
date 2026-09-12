import { describe, expect, it } from "vitest";
import { BALANCE, EMPTY_FRAME, MATCH, MODES, WORLD, type InputFrame, type MatchConfig, type MatchState, type SimEvent } from "../src";
import { canBeHit } from "../src/sim/combat";
import { createMatch, resetForRound } from "../src/sim/create";
import { hasTimer, teamCount, teamsOf, timerSeconds } from "../src/sim/modes";
import { step } from "../src/sim/step";

// 10-arenas/02 rules 2–10. Rule 1 (2-player `rounds`) is fullmatch.test.ts and rounds.test.ts, untouched.

function fighting(config: Partial<MatchConfig>): MatchState {
  const s = createMatch({ players: 2, teams: "ffa", mode: "rounds", map: "roof", items: true, ...config });
  s.phase = "FIGHTING";
  return s;
}

function run(s: MatchState, n: number, inputs: InputFrame[] = [], stopAt?: MatchState["phase"]) {
  const events: SimEvent[] = [];
  for (let i = 0; i < n; i++) {
    const r = step(s, inputs); s = r.state; events.push(...r.events);
    if (stopAt !== undefined && s.phase === stopAt) break;
  }
  return { s, events };
}

const types = (events: SimEvent[]) => events.map((e) => e.type);

describe("modes.ts helpers", () => {
  it("teamCount: 2v2 → 2, ffa → players", () => {
    expect(teamCount({ players: 4, teams: "2v2", mode: "rounds", map: "roof", items: true })).toBe(2);
    expect(teamCount({ players: 3, teams: "ffa", mode: "rounds", map: "roof", items: true })).toBe(3);
    expect(teamCount({ players: 4, teams: "ffa", mode: "rounds", map: "roof", items: true })).toBe(4);
  });
  it("teamsOf: player indices per team", () => {
    expect(teamsOf({ players: 4, teams: "2v2", mode: "rounds", map: "roof", items: true })).toEqual([[0, 1], [2, 3]]);
    expect(teamsOf({ players: 3, teams: "ffa", mode: "rounds", map: "roof", items: true })).toEqual([[0], [1], [2]]);
    expect(teamsOf({ players: 2, teams: "ffa", mode: "rounds", map: "roof", items: true })).toEqual([[0], [1]]);
  });
  it("hasTimer follows MODES[mode].roundTicks", () => {
    expect(hasTimer({ ...createMatch().config, mode: "rounds" })).toBe(true);
    expect(hasTimer({ ...createMatch().config, mode: "timed" })).toBe(true);
    expect(hasTimer({ ...createMatch().config, mode: "deathmatch" })).toBe(false);
  });
  it("rule 10: timerSeconds is null in deathmatch and 90 at the start of timed", () => {
    expect(timerSeconds(createMatch({ ...createMatch().config, mode: "deathmatch" }))).toBeNull();
    expect(timerSeconds(createMatch({ ...createMatch().config, mode: "timed" }))).toBe(90);
    const s = fighting({ mode: "timed" });
    expect(timerSeconds(run(s, 1).s)).toBe(90);
    expect(timerSeconds(run(s, 60).s)).toBe(89);
    expect(timerSeconds(createMatch())).toBe(30);
  });
});

describe("rule 2: timed", () => {
  it("roundTicks starts at 5400 and a no-hit round is a draw that ends the match", () => {
    const s = fighting({ mode: "timed" });
    expect(s.roundTicks).toBe(5400);
    const { s: e, events } = run(s, 5400 + MATCH.ROUND_END_TICKS);
    expect(types(events).filter((t) => t === "ROUND_END" || t === "MATCH_END")).toEqual(["ROUND_END", "MATCH_END"]);
    expect(events.find((ev) => ev.type === "ROUND_END")).toEqual({ type: "ROUND_END", round: 1, winner: "draw" });
    expect(e.phase).toBe("MATCH_END");
    expect(e.winner).toBe("draw");
    expect(e.round).toBe(1);
    expect(e.roundsWon).toEqual([1, 1]);
  });
  it("higher hp at expiry wins the match (P0 40, P1 28)", () => {
    const s = fighting({ mode: "timed" });
    s.fighters[1]!.hp = 28;
    const { s: e, events } = run(s, 5400 + MATCH.ROUND_END_TICKS);
    expect(events.find((ev) => ev.type === "ROUND_END")).toEqual({ type: "ROUND_END", round: 1, winner: 0 });
    expect(e.phase).toBe("MATCH_END");
    expect(e.winner).toBe(0);
    expect(events.at(-1)).toEqual({ type: "MATCH_END", winner: 0 });
  });
  it("does not end before the timer runs out", () => {
    const s = fighting({ mode: "timed" });
    expect(run(s, 5399).s.phase).toBe("FIGHTING");
  });
});

describe("rule 3: deathmatch", () => {
  it("20 000 ticks with no hits never ends the round and roundTicks stays put", () => {
    const s = fighting({ mode: "deathmatch" });
    const { s: e, events } = run(s, 20_000);
    expect(e.phase).toBe("FIGHTING");
    expect(e.roundTicks).toBe(0);
    expect(types(events)).not.toContain("ROUND_END");
  });
  it("a KO ends round and match at once", () => {
    const s = fighting({ mode: "deathmatch" });
    s.fighters[1]!.hp = 0;
    const { s: e, events } = run(s, 1 + MATCH.ROUND_END_TICKS);
    expect(types(events).filter((t) => t === "ROUND_END" || t === "MATCH_END")).toEqual(["ROUND_END", "MATCH_END"]);
    expect(e.phase).toBe("MATCH_END");
    expect(e.winner).toBe(0);
    expect(e.roundsWon).toEqual([1, 0]);
  });
});

describe("rule 4: 3-player FFA rounds", () => {
  it("one KO leaves no winner; the second gives the round to the survivor", () => {
    const s = fighting({ players: 3 });
    expect(s.roundsWon).toHaveLength(3);
    s.fighters[2]!.hp = 0;
    const a = run(s, 1).s;
    expect(a.phase).toBe("FIGHTING");
    a.fighters[1]!.hp = 0;
    const { s: b, events } = run(a, 1);
    expect(b.phase).toBe("ROUND_END");
    expect(events.at(-1)).toEqual({ type: "ROUND_END", round: 1, winner: 0 });
    expect(b.roundsWon).toEqual([1, 0, 0]);
    expect(b.roundsWon.length).toBe(teamCount(b.config));
  });
});

describe("rule 5: 4-player 2v2", () => {
  it("teams are [0,0,1,1] and roundsWon has two slots", () => {
    const s = fighting({ players: 4, teams: "2v2" });
    expect(s.fighters.map((f) => f.team)).toEqual([0, 0, 1, 1]);
    expect(s.roundsWon).toEqual([0, 0]);
  });
  it("P0 KO'd with P1 alive keeps fighting; P2 and P3 KO'd gives team 0 the round", () => {
    const s = fighting({ players: 4, teams: "2v2" });
    s.fighters[0]!.hp = 0;
    const a = run(s, 1).s;
    expect(a.phase).toBe("FIGHTING");
    a.fighters[2]!.hp = 0; a.fighters[3]!.hp = 0;
    const { s: b, events } = run(a, 1);
    expect(b.phase).toBe("ROUND_END");
    expect(events.at(-1)).toEqual({ type: "ROUND_END", round: 1, winner: 0 });
    expect(b.roundsWon).toEqual([1, 0]);
  });
  it("MATCH_END winner 0 after two such rounds", () => {
    let s = fighting({ players: 4, teams: "2v2" });
    const all: SimEvent[] = [];
    for (let r = 0; r < 2; r++) {
      s.fighters[2]!.hp = 0; s.fighters[3]!.hp = 0;
      const { s: next, events } = run(s, 1 + MATCH.ROUND_END_TICKS + MATCH.COUNTDOWN_TICKS, [], "MATCH_END");
      s = next; all.push(...events);
    }
    expect(s.phase).toBe("MATCH_END");
    expect(s.winner).toBe(0);
    expect(s.roundsWon).toEqual([2, 0]);
    expect(all.at(-1)).toEqual({ type: "MATCH_END", winner: 0 });
  });
});

describe("rule 6: a KO'd fighter stays down", () => {
  function threeWithP2Down(): MatchState {
    const s = fighting({ players: 3 });
    s.fighters[2]!.hp = 0;
    return s;
  }
  it("ignores input", () => {
    const s = threeWithP2Down();
    const x = s.fighters[2]!.x;
    const held: InputFrame = { ...EMPTY_FRAME, right: true, jump: true, punchL: true, block: true, special: true };
    const e = run(s, 30, [EMPTY_FRAME, EMPTY_FRAME, held]).s;
    const p2 = e.fighters[2]!;
    expect(p2.x).toBe(x);
    expect(p2.grounded).toBe(true);
    expect(p2.action).toBeNull();
    expect(p2.blocking).toBe(false);
  });
  it("cannot be hit again", () => {
    const s = threeWithP2Down();
    expect(canBeHit(s.fighters[2]!)).toBe(false);
    // P0 punches through P2's hurtbox: no HIT on P2, hp stays 0.
    s.fighters[0]!.x = 400; s.fighters[0]!.facing = 1;
    s.fighters[2]!.x = 450;
    s.fighters[1]!.x = 900;
    const { s: e, events } = run(s, 20, [{ ...EMPTY_FRAME, punchL: true }, EMPTY_FRAME, EMPTY_FRAME]);
    expect(events.filter((ev) => ev.type === "HIT" && ev.target === 2)).toHaveLength(0);
    expect(e.fighters[2]!.hp).toBe(0);
  });
  it("is not counted for OOB", () => {
    const s = threeWithP2Down();
    s.fighters[2]!.x = 0;
    const { s: e, events } = run(s, 90);
    expect(events.filter((ev) => ev.type === "OOB_DAMAGE")).toHaveLength(0);
    expect(e.fighters[2]!.oobTicks).toBe(0);
  });
  it("his punches never resolve, even a punch in flight when the KO lands", () => {
    // P2 is mid-startup on a punch aimed at P0 and takes the KO from OOB damage before it goes active.
    const s = fighting({ players: 3 });
    const p2 = s.fighters[2]!;
    p2.hp = BALANCE.OOB_DAMAGE; p2.x = WORLD.WIDTH; p2.facing = -1; p2.oobTicks = BALANCE.OOB_EVERY_TICKS - 1;
    p2.action = { kind: "punch", arm: "L", elapsed: 0, landed: false, sword: false };
    s.fighters[0]!.x = WORLD.WIDTH - 50;
    s.fighters[1]!.x = 100;
    const { s: e, events } = run(s, 20);
    expect(e.fighters[2]!.hp).toBe(0);
    expect(e.fighters[2]!.action).toBeNull();
    expect(events.filter((ev) => ev.type === "HIT" && ev.attacker === 2)).toHaveLength(0);
    expect(e.fighters[0]!.hp).toBe(BALANCE.MAX_HP);
  });
  it("a stale action on a KO'd fighter is cleared on the next tick", () => {
    const s = threeWithP2Down();
    s.fighters[2]!.action = { kind: "punch", arm: "R", elapsed: 1, landed: false, sword: false };
    s.fighters[2]!.blocking = true;
    const e = run(s, 1).s;
    expect(e.fighters[2]!.action).toBeNull();
    expect(e.fighters[2]!.blocking).toBe(false);
    expect(e.fighters[2]!.vx).toBe(0);
  });
});

describe("rule 7: 2v2 teammates", () => {
  it("a teammate is never hit by a punch", () => {
    const s = fighting({ players: 4, teams: "2v2" });
    // P0 and P1 (team 0) stand together; team 1 far away.
    s.fighters[0]!.x = 300; s.fighters[0]!.facing = 1;
    s.fighters[1]!.x = 350;
    s.fighters[2]!.x = 900; s.fighters[3]!.x = 940;
    const { s: e, events } = run(s, 20, [{ ...EMPTY_FRAME, punchL: true }, EMPTY_FRAME, EMPTY_FRAME, EMPTY_FRAME]);
    expect(events.filter((ev) => ev.type === "HIT")).toHaveLength(0);
    expect(e.fighters[1]!.hp).toBe(BALANCE.MAX_HP);
  });
  it("faces the nearest living opponent, not a teammate", () => {
    const s = fighting({ players: 4, teams: "2v2" });
    s.fighters[0]!.x = 300; s.fighters[1]!.x = 350; s.fighters[2]!.x = 200; s.fighters[3]!.x = 900;
    const e = run(s, 1).s;
    expect(e.fighters[0]!.facing).toBe(-1);
    expect(e.fighters[1]!.facing).toBe(-1);
  });
  it.todo("a teammate is never hit by a laser (needs 9.03 sim-laser)");
  it.todo("a teammate is never dazzled by a flash (needs 9.01 sim-items)");
  it.todo("a teammate IS hurt by fire (needs 9.02 sim-throwables)");
});

describe("rule 8: timer draw in 2v2", () => {
  it("equal team hp at expiry is a draw and both teams score", () => {
    const s = fighting({ players: 4, teams: "2v2" });
    s.fighters[0]!.hp = 10; s.fighters[1]!.hp = 30; // team 0: 40
    s.fighters[2]!.hp = 20; s.fighters[3]!.hp = 20; // team 1: 40
    const { s: e, events } = run(s, MATCH.ROUND_TICKS);
    expect(e.phase).toBe("ROUND_END");
    expect(events.at(-1)).toEqual({ type: "ROUND_END", round: 1, winner: "draw" });
    expect(e.roundsWon).toEqual([1, 1]);
  });
  it("higher team hp at expiry wins even with fewer survivors", () => {
    const s = fighting({ players: 4, teams: "2v2" });
    s.fighters[0]!.hp = 0; s.fighters[1]!.hp = 39; // team 0: 39
    s.fighters[2]!.hp = 20; s.fighters[3]!.hp = 18; // team 1: 38
    const { s: e, events } = run(s, MATCH.ROUND_TICKS);
    expect(events.at(-1)).toEqual({ type: "ROUND_END", round: 1, winner: 0 });
    expect(e.roundsWon).toEqual([1, 0]);
  });
});

describe("rule 9: resetForRound", () => {
  it("clears items, hazards, projectiles, dazzle and cooldowns; keeps characters, loadouts, teams, prev", () => {
    const s = fighting({ players: 4, teams: "2v2" });
    s.projectiles.push({ id: 1, kind: "molotov", owner: 0, x: 100, y: 300, vx: 6, vy: -7 });
    s.hazards.push({ id: 2, kind: "fire", owner: 0, x: 200, y: WORLD.ROOF_Y, w: 120, ticks: 240, age: 0 });
    const prevInput: InputFrame = { ...EMPTY_FRAME, right: true, item: "sword" };
    for (const f of s.fighters) {
      f.item = { kind: "sword", uses: 2 };
      f.itemsUsed = ["sword", "shield"];
      f.dazzle = 50; f.laserCooldown = 300; f.invuln = 10; f.blockTicks = 4; f.pitTicks = 5;
      f.hp = 7; f.x = 10; f.action = { kind: "laser", elapsed: 3, hit: [] };
      f.prev = prevInput;
    }
    const chars = s.fighters.map((f) => f.character);
    const loadouts = s.fighters.map((f) => f.loadout);
    const teams = s.fighters.map((f) => f.team);
    resetForRound(s, 2);
    expect(s.round).toBe(2);
    expect(s.phase).toBe("COUNTDOWN");
    expect(s.projectiles).toEqual([]);
    expect(s.hazards).toEqual([]);
    expect(s.roundTicks).toBe(MODES.rounds.roundTicks);
    s.fighters.forEach((f, i) => {
      expect(f.item).toBeNull();
      expect(f.itemsUsed).toEqual([]);
      expect(f.dazzle).toBe(0);
      expect(f.laserCooldown).toBe(0);
      expect(f.invuln).toBe(0);
      expect(f.blockTicks).toBe(0);
      expect(f.pitTicks).toBe(0);
      expect(f.action).toBeNull();
      expect(f.hp).toBe(BALANCE.MAX_HP);
      expect(f.character).toBe(chars[i]);
      expect(f.loadout).toEqual(loadouts[i]);
      expect(f.team).toBe(teams[i]);
      expect(f.prev).toEqual(prevInput);
    });
    expect(s.roundsWon).toHaveLength(teamCount(s.config));
  });
  it("in deathmatch the reset timer is 0 and never counts", () => {
    const s = fighting({ mode: "deathmatch" });
    resetForRound(s, 1);
    expect(s.roundTicks).toBe(0);
    expect(timerSeconds(s)).toBeNull();
  });
});

describe("invariants", () => {
  it("roundsWon.length === teamCount(config) for every player count and team setting", () => {
    for (const players of [2, 3, 4] as const) {
      for (const teams of ["ffa", "2v2"] as const) {
        const s = createMatch({ players, teams, mode: "rounds", map: "roof", items: true });
        expect(s.roundsWon).toHaveLength(teamCount(s.config));
        expect(teamsOf(s.config).flat().sort()).toEqual(s.fighters.map((_, i) => i));
      }
    }
  });
  it("a match never ends with winner null: two timer draws reach 2-2 together and the match is a draw", () => {
    let cur = fighting({ mode: "rounds" });
    const all: SimEvent[] = [];
    for (let r = 0; r < 3 && cur.phase !== "MATCH_END"; r++) {
      const { s: next, events } = run(cur, MATCH.ROUND_TICKS + MATCH.ROUND_END_TICKS + MATCH.COUNTDOWN_TICKS, [], "MATCH_END");
      cur = next; all.push(...events);
    }
    expect(cur.phase).toBe("MATCH_END");
    expect(cur.winner).toBe("draw");
    expect(cur.round).toBe(2);
    expect(cur.roundsWon).toEqual([2, 2]);
    expect(all.filter((e) => e.type === "MATCH_END")).toHaveLength(1);
  });
  it("a draw then a win: 2-1 after round 2 is not over; round 3 timer draw ends 3-2 to team 0", () => {
    let cur = fighting({ mode: "rounds" });
    cur = run(cur, MATCH.ROUND_TICKS, [], "ROUND_END").s;                 // draw → [1, 1]
    cur = run(cur, MATCH.ROUND_END_TICKS + MATCH.COUNTDOWN_TICKS).s;      // round 2 FIGHTING
    expect(cur.phase).toBe("FIGHTING"); expect(cur.round).toBe(2);
    cur.fighters[1]!.hp = 0;
    cur = run(cur, 1).s;                                                  // KO → [2, 1]
    expect(cur.roundsWon).toEqual([2, 1]);
    cur = run(cur, MATCH.ROUND_END_TICKS).s;
    expect(cur.phase).toBe("MATCH_END"); expect(cur.winner).toBe(0);      // team 0 reached roundsToWin alone
  });
  it("endRound zeroes velocity and clears actions and blocks for every fighter", () => {
    const s = fighting({ players: 3 });
    s.fighters[0]!.action = { kind: "punch", arm: "L", elapsed: 2, landed: false, sword: false };
    s.fighters[0]!.vx = 3; s.fighters[1]!.blocking = true; s.fighters[1]!.vx = -3;
    s.fighters[1]!.hp = 0; s.fighters[2]!.hp = 0;
    const e = run(s, 1).s;
    expect(e.phase).toBe("ROUND_END");
    for (const f of e.fighters) { expect(f.vx).toBe(0); expect(f.action).toBeNull(); expect(f.blocking).toBe(false); }
  });
});
