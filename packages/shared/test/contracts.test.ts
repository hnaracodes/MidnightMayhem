import { describe, expect, it } from "vitest";
import {
  CHARACTERS, DEFAULT_CONFIG, DEFAULT_LOADOUT, EMPTY_FRAME, MATCH, MODES, SPAWN_X, WORLD,
  createMatch, framesEqual, normalizeConfig, parseClientMessage, risingEdges, roundWinner, step,
  type InputFrame, type MatchState,
} from "../src";

const j = (o: unknown) => JSON.stringify(o);

function inputsFor(s: MatchState): InputFrame[] {
  return s.fighters.map(() => EMPTY_FRAME);
}

function run(s: MatchState, n: number): MatchState {
  for (let k = 0; k < n; k++) s = step(s, inputsFor(s)).state;
  return s;
}

describe("8.01 contracts", () => {
  it("rule 1: createMatch() with no arguments is today's state plus zeroed new fields", () => {
    const s = createMatch();
    expect(s.config).toEqual(DEFAULT_CONFIG);
    expect(s.projectiles).toEqual([]);
    expect(s.hazards).toEqual([]);
    expect(s.nextId).toBe(1);
    expect(s.fighters).toHaveLength(2);
    expect(s.roundsWon).toEqual([0, 0]);
    expect(s.roundTicks).toBe(MATCH.ROUND_TICKS);
    expect(s.phase).toBe("COUNTDOWN");
    expect(s.fighters.map((f) => f.x)).toEqual([280, 680]);
    expect(s.fighters.map((f) => f.facing)).toEqual([1, -1]);
    s.fighters.forEach((f, i) => {
      expect(f.team).toBe(i);
      expect(f.character).toBe(CHARACTERS[i]);
      expect(f.loadout).toEqual(DEFAULT_LOADOUT);
      expect(f.item).toBeNull();
      expect(f.itemsUsed).toEqual([]);
      expect(f.laserCooldown).toBe(0);
      expect(f.blockTicks).toBe(0);
      expect(f.dazzle).toBe(0);
      expect(f.pitTicks).toBe(0);
      expect(f.invuln).toBe(0);
      expect(f.onPlatform).toBeNull();
      expect(f.prev).toEqual(EMPTY_FRAME);
      expect("weaponSlots" in f).toBe(false);
    });
  });

  it("rule 3: four players 2v2 spawn at SPAWN_X[4] with teams [0,0,1,1], outer pair inward, inner pair at the nearest opponent", () => {
    const s = createMatch({ players: 4, teams: "2v2", mode: "rounds", map: "roof", items: true });
    expect(s.fighters).toHaveLength(4);
    expect(s.fighters.map((f) => f.x)).toEqual([...SPAWN_X[4]]);
    expect(s.fighters.map((f) => f.team)).toEqual([0, 0, 1, 1]);
    expect(s.roundsWon).toEqual([0, 0]);
    expect(s.fighters[0]!.facing).toBe(1);
    expect(s.fighters[3]!.facing).toBe(-1);
    // inner two: fighter 1 (340) has its nearest opponent at 620, fighter 2 (620) at 340
    expect(s.fighters[1]!.facing).toBe(1);
    expect(s.fighters[2]!.facing).toBe(-1);
    // facing survives a fighting tick (nearest living opponent rule)
    const f = run({ ...s, phase: "FIGHTING" }, 1);
    expect(f.fighters.map((x) => x.facing)).toEqual([1, 1, -1, -1]);
    expect(f.fighters.every((x) => x.x > 0 && x.x < WORLD.WIDTH)).toBe(true);
  });

  it("normalizeConfig fills defaults and forces ffa unless four players", () => {
    expect(normalizeConfig({})).toEqual(DEFAULT_CONFIG);
    expect(normalizeConfig({ players: 3, teams: "2v2" }).teams).toBe("ffa");
    expect(normalizeConfig({ players: 4, teams: "2v2" }).teams).toBe("2v2");
    expect(normalizeConfig({ map: "chaos", mode: "timed", items: false })).toEqual({
      players: 2, teams: "ffa", mode: "timed", map: "chaos", items: false,
    });
  });

  it("rule 4: three fighters, one at 0 hp: no winner while two teams live, then the last team", () => {
    const s = createMatch({ players: 3, teams: "ffa", mode: "rounds", map: "roof", items: true });
    s.phase = "FIGHTING";
    s.fighters[2]!.hp = 0;
    expect(roundWinner(s)).toBeNull();
    s.fighters[0]!.hp = 0;
    expect(roundWinner(s)).toBe(1);
    s.fighters[1]!.hp = 0;
    expect(roundWinner(s)).toBe("draw");
  });

  it("rule 5: timed starts at 5400 ticks and ends the match after one round; deathmatch never times out", () => {
    const timed = createMatch({ ...DEFAULT_CONFIG, mode: "timed" });
    expect(timed.roundTicks).toBe(MODES.timed.roundTicks);
    expect(timed.roundTicks).toBe(5400);
    let t = run(timed, MATCH.COUNTDOWN_TICKS);
    expect(t.phase).toBe("FIGHTING");
    t.fighters[1]!.hp = 5;
    t = run(t, 5400);
    expect(t.phase).toBe("ROUND_END");
    expect(t.roundsWon).toEqual([1, 0]);
    t = run(t, MATCH.ROUND_END_TICKS);
    expect(t.phase).toBe("MATCH_END");
    expect(t.winner).toBe(0);

    const dm = createMatch({ ...DEFAULT_CONFIG, mode: "deathmatch" });
    expect(dm.roundTicks).toBe(0);
    let d = run(dm, MATCH.COUNTDOWN_TICKS);
    expect(d.phase).toBe("FIGHTING");
    d.fighters[1]!.hp = 5;
    d = run(d, 2000);
    expect(d.phase).toBe("FIGHTING");
    expect(d.roundTicks).toBe(0);
    d.fighters[1]!.hp = 0;
    d = run(d, 1);
    expect(d.phase).toBe("ROUND_END");
    expect(d.roundsWon).toEqual([1, 0]);
  });

  it("rule 6: parseClientMessage accepts CONFIG and CUSTOMIZE, rejects a duplicate loadout and an unknown map", () => {
    expect(parseClientMessage(j({ type: "CONFIG", config: DEFAULT_CONFIG })).ok).toBe(true);
    expect(parseClientMessage(j({ type: "CONFIG", config: { ...DEFAULT_CONFIG, map: "moon" } })).ok).toBe(false);
    expect(parseClientMessage(j({ type: "CUSTOMIZE", character: "stoker", loadout: ["sword", "flash"] })).ok).toBe(true);
    expect(parseClientMessage(j({ type: "CUSTOMIZE", character: "stoker", loadout: ["sword", "sword"] })).ok).toBe(false);
    expect(parseClientMessage(j({ type: "CUSTOMIZE", character: "nobody", loadout: ["sword", "flash"] })).ok).toBe(false);
    expect(parseClientMessage(j({ type: "INPUT", seq: 1, frame: { ...EMPTY_FRAME, special: true, item: "banana" } })).ok).toBe(true);
    expect(parseClientMessage(j({ type: "INPUT", seq: 1, frame: { ...EMPTY_FRAME, item: "rock" } })).ok).toBe(false);
  });

  it("rule 7: framesEqual differs on item; risingEdges never reports item", () => {
    expect(framesEqual(EMPTY_FRAME, { ...EMPTY_FRAME, item: "sword" })).toBe(false);
    expect(framesEqual({ ...EMPTY_FRAME, item: "sword" }, { ...EMPTY_FRAME, item: "sword" })).toBe(true);
    expect(EMPTY_FRAME.item).toBeNull();
    const edges = risingEdges(EMPTY_FRAME, { ...EMPTY_FRAME, item: "sword", special: true });
    expect(edges.item).toBeNull();
    expect(edges.special).toBe(true);
  });
});
