import { describe, expect, it } from "vitest";
import { ARSENAL, BALANCE, EMPTY_FRAME, WORLD, createMatch, step, type FighterState } from "@midnight/shared";
import {
  ATTRACT, INVULN_ALPHA, attractInputs, attractSetup, attractWalker, drawOrder, fighterAlpha, fireLoopTransition, posedFighter,
} from "../src/game/arenaGlue";

describe("drawOrder", () => {
  it("puts the fighter nearest the camera centre last and the farthest first", () => {
    const fighters = [{ x: 120 }, { x: 250 }, { x: 710 }, { x: 840 }];
    expect(drawOrder(fighters)).toEqual([0, 3, 1, 2]);
  });

  it("keeps slot order on ties and handles two fighters", () => {
    expect(drawOrder([{ x: 280 }, { x: 680 }])).toEqual([0, 1]);
    expect(drawOrder([{ x: WORLD.WIDTH / 2 }, { x: WORLD.WIDTH / 2 }, { x: 0 }])).toEqual([2, 0, 1]);
  });

  it("returns an empty order for no fighters", () => {
    expect(drawOrder([])).toEqual([]);
  });
});

describe("fireLoopTransition", () => {
  it("starts on the first fire, stops on the last, and is silent otherwise", () => {
    expect(fireLoopTransition(false, true)).toBe("start");
    expect(fireLoopTransition(true, false)).toBe("stop");
    expect(fireLoopTransition(true, true)).toBeNull();
    expect(fireLoopTransition(false, false)).toBeNull();
  });
});

describe("attractInputs", () => {
  it("walks the walker right, rests, walks left, rests over a 360-tick loop", () => {
    const at = (tick: number) => attractInputs(tick)[attractWalker(4)]!;
    expect(at(0)).toMatchObject({ right: true, left: false });
    expect(at(ATTRACT.WALK_TICKS - 1)).toMatchObject({ right: true, left: false });
    expect(at(ATTRACT.WALK_TICKS)).toEqual(EMPTY_FRAME);
    expect(at(2 * ATTRACT.WALK_TICKS)).toMatchObject({ right: false, left: true });
    expect(at(3 * ATTRACT.WALK_TICKS)).toEqual(EMPTY_FRAME);
    expect(at(ATTRACT.LOOP_TICKS)).toMatchObject({ right: true });
  });

  it("gives every other fighter an idle frame and sizes to the player count", () => {
    const inputs = attractInputs(10, 4);
    expect(inputs).toHaveLength(4);
    for (const [i, frame] of inputs.entries()) {
      if (i === attractWalker(4)) continue;
      expect(frame).toEqual(EMPTY_FRAME);
    }
    expect(attractInputs(10, 2)).toHaveLength(2);
    expect(attractInputs(10, 2)[1]).toMatchObject({ right: true });
    expect(attractWalker(3)).toBe(2);
  });

  it("never punches, jumps, blocks, lasers or equips: the walker comes back to where it started", () => {
    const { config, roster } = attractSetup(["drifter", "conductor", "stoker", "claude"]);
    let state = createMatch(config, roster);
    const walker = attractWalker(config.players);
    const startX = state.fighters[walker]!.x;
    let minX = startX;
    // through the countdown, then two full loops: no damage of any kind, and the walker comes home each loop
    for (let tick = 0; tick < 180 + 2 * ATTRACT.LOOP_TICKS; tick += 1) {
      const r = step(state, attractInputs(state.tick, config.players));
      state = r.state;
      minX = Math.min(minX, state.fighters[walker]!.x);
      expect(r.events.filter((e) => e.type !== "LAND" && e.type !== "ROUND_START")).toEqual([]);
    }
    expect(state.phase).toBe("FIGHTING");
    expect(state.fighters.every((f) => f.hp === BALANCE.MAX_HP && f.action === null && f.item === null)).toBe(true);
    expect(state.fighters[walker]!.x).toBeCloseTo(startX, 5);
    expect(minX).toBeGreaterThan(WORLD.SOFT_EDGE_L);
  });
});

describe("attractSetup", () => {
  it("is a deathmatch on the roof with items off and one fighter per character", () => {
    const { config, roster } = attractSetup(["drifter", "conductor", "stoker", "claude"]);
    expect(config).toEqual({ players: 4, teams: "ffa", mode: "deathmatch", map: "roof", items: false });
    expect(roster.map((r) => r.character)).toEqual(["drifter", "conductor", "stoker", "claude"]);
    expect(attractSetup(["drifter"]).config.players).toBe(2);
  });
});

describe("posedFighter", () => {
  const base = (): FighterState => createMatch().fighters[0]!;

  it("leaves idle and punching fighters alone", () => {
    const f = base();
    expect(posedFighter(f)).toBe(f);
    const punching = { ...f, action: { kind: "punch" as const, arm: "L" as const, elapsed: 2, landed: false, sword: true } };
    expect(posedFighter(punching)).toBe(punching);
  });

  it("12.04: throws and lasers reach computePose untouched (pose.ts poses them itself)", () => {
    const throwing: FighterState = { ...base(), action: { kind: "throw", item: "molotov", arm: "R", phase: "charge", charge: 10, elapsed: 0, released: false } };
    expect(posedFighter(throwing)).toBe(throwing);
    const lasering: FighterState = { ...base(), vx: 3, action: { kind: "laser", elapsed: ARSENAL.LASER_CHARGE, hit: [] } };
    expect(posedFighter(lasering)).toBe(lasering);
  });
});

describe("fighterAlpha", () => {
  it("is 1 normally, 0.5 during respawn i-frames and 0 down a pit", () => {
    expect(fighterAlpha({ invuln: 0, pitTicks: 0 })).toBe(1);
    expect(fighterAlpha({ invuln: 30, pitTicks: 0 })).toBe(INVULN_ALPHA);
    expect(fighterAlpha({ invuln: 0, pitTicks: 12 })).toBe(0);
  });
});
