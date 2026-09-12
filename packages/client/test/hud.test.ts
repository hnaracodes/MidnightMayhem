import { describe, expect, it } from "vitest";
import {
  ARSENAL, CHARACTER_LABEL, ITEM_IDS, MODES, WORLD, createMatch, type ItemId, type MatchState, type PlayerIndex,
} from "@midnight/shared";
import {
  HUD_BAND, bannerFor, barHeight, barLayout, blinkOn, cooldownFraction, isOut, itemGlyph, pipCount, readyEdge, roundPipRow,
  teamColor, timerText,
} from "../src/game/hud";
import { P } from "../src/game/palette";

interface Box { x: number; y: number; w: number; h: number }

function boxes(players: 2 | 3 | 4): Box[] {
  const out: Box[] = [];
  for (let i = 0; i < players; i += 1) {
    const l = barLayout(players, i as PlayerIndex);
    out.push({ x: l.x, y: l.y, w: l.w, h: barHeight(players, i as PlayerIndex) });
  }
  return out;
}

function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

describe("barLayout", () => {
  for (const players of [2, 3, 4] as const) {
    it(`${players} players: bars never overlap and stay inside the width and the HUD band`, () => {
      const all = boxes(players);
      for (let i = 0; i < all.length; i += 1) {
        const a = all[i]!;
        expect(a.x).toBeGreaterThanOrEqual(0);
        expect(a.x + a.w).toBeLessThanOrEqual(WORLD.WIDTH);
        expect(a.y).toBeGreaterThanOrEqual(0);
        expect(a.y + a.h).toBeLessThan(HUD_BAND[players]);
        for (let j = i + 1; j < all.length; j += 1) expect(overlaps(a, all[j]!)).toBe(false);
      }
    });
  }

  it("2 players keeps today's 380 px bars from each edge", () => {
    expect(barLayout(2, 0)).toEqual({ x: 20, y: 24, w: 380, align: "left" });
    expect(barLayout(2, 1)).toEqual({ x: WORLD.WIDTH - 20 - 380, y: 24, w: 380, align: "right" });
  });

  it("3 players centres the third bar below the timer at 300 px", () => {
    const c = barLayout(3, 2);
    expect(c.w).toBe(300);
    expect(c.x + c.w / 2).toBe(WORLD.WIDTH / 2);
    expect(c.y).toBeGreaterThan(barLayout(3, 0).y);
    expect(barLayout(3, 0).align).toBe("left");
    expect(barLayout(3, 1).align).toBe("right");
  });

  it("4 players stacks two 320 px bars per side, 14 px tall", () => {
    const [a, b, c, d] = boxes(4) as [Box, Box, Box, Box];
    for (const bar of [a, b, c, d]) {
      expect(bar.w).toBe(320);
      expect(bar.h).toBe(14);
    }
    expect(a.x).toBe(b.x);
    expect(c.x).toBe(d.x);
    expect(b.y).toBeGreaterThan(a.y + a.h);
    expect(d.y).toBeGreaterThan(c.y + c.h);
    expect(barLayout(4, 0).align).toBe("left");
    expect(barLayout(4, 1).align).toBe("left");
    expect(barLayout(4, 2).align).toBe("right");
    expect(barLayout(4, 3).align).toBe("right");
  });
});

describe("timerText", () => {
  it("shows plain seconds in rounds mode", () => {
    const s = createMatch({ players: 2, teams: "ffa", mode: "rounds", map: "roof", items: true });
    expect(timerText(s)).toBe("30");
    s.roundTicks = 9 * 60;
    expect(timerText(s)).toBe("9");
    s.roundTicks = 1;
    expect(timerText(s)).toBe("1");
  });

  it("shows MM:SS at or above a minute in timed mode", () => {
    const s = createMatch({ players: 2, teams: "ffa", mode: "timed", map: "roof", items: true });
    expect(MODES.timed.roundTicks).toBe(5400);
    expect(timerText(s)).toBe("01:30");
    s.roundTicks = 60 * 60;
    expect(timerText(s)).toBe("01:00");
    s.roundTicks = 59 * 60;
    expect(timerText(s)).toBe("59");
  });

  it("shows the infinity sign in deathmatch", () => {
    const s = createMatch({ players: 2, teams: "ffa", mode: "deathmatch", map: "roof", items: true });
    expect(timerText(s)).toBe("∞");
  });
});

describe("itemGlyph", () => {
  it("maps every item to a distinct glyph and none to blank", () => {
    const glyphs = ITEM_IDS.map((kind: ItemId) => itemGlyph({ kind, uses: 1 }));
    expect(new Set(glyphs).size).toBe(ITEM_IDS.length);
    for (const g of glyphs) expect(g.length).toBeGreaterThan(0);
    expect(itemGlyph({ kind: "molotov", uses: 2 })).toBe("▲");
    expect(itemGlyph({ kind: "sword", uses: 6 })).toBe("/");
    expect(itemGlyph({ kind: "shield", uses: 3 })).toBe("▣");
    expect(itemGlyph({ kind: "banana", uses: 1 })).toBe("◗");
    expect(itemGlyph({ kind: "flash", uses: 1 })).toBe("✦");
    expect(itemGlyph(null)).toBe("");
  });
});

describe("cooldownFraction", () => {
  it("is 1 when ready, 0 at a full cooldown and clamped outside", () => {
    expect(cooldownFraction({ laserCooldown: 0 })).toBe(1);
    expect(cooldownFraction({ laserCooldown: ARSENAL.LASER_COOLDOWN })).toBe(0);
    expect(cooldownFraction({ laserCooldown: ARSENAL.LASER_COOLDOWN / 2 })).toBeCloseTo(0.5);
    expect(cooldownFraction({ laserCooldown: ARSENAL.LASER_COOLDOWN * 3 })).toBe(0);
    expect(cooldownFraction({ laserCooldown: -10 })).toBe(1);
  });
});

describe("teamColor", () => {
  it("uses the character key colour in free-for-all", () => {
    const s: MatchState = createMatch({ players: 4, teams: "ffa", mode: "rounds", map: "roof", items: true });
    expect(teamColor(s, 0)).toBe(P.drifterKey);
    expect(teamColor(s, 1)).toBe(P.conductorKey);
    expect(teamColor(s, 2)).not.toBe(teamColor(s, 3));
  });

  it("uses amber for team A and moon for team B in 2v2", () => {
    const s = createMatch({ players: 4, teams: "2v2", mode: "rounds", map: "roof", items: true });
    expect(teamColor(s, 0)).toBe(P.amber1);
    expect(teamColor(s, 1)).toBe(P.amber1);
    expect(teamColor(s, 2)).toBe(P.moon);
    expect(teamColor(s, 3)).toBe(P.moon);
  });
});

describe("roundPipRow (rule 6)", () => {
  it("draws one row per fighter in free-for-all, roundsToWin pips each", () => {
    const s = createMatch({ players: 3, teams: "ffa", mode: "rounds", map: "roof", items: true });
    for (const i of [0, 1, 2] as const) expect(roundPipRow(s, i)).toBe(true);
    expect(pipCount(s)).toBe(MODES.rounds.roundsToWin);
  });

  it("draws one row per team in 2v2, on the team's first bar only", () => {
    const s = createMatch({ players: 4, teams: "2v2", mode: "rounds", map: "roof", items: true });
    const rows = ([0, 1, 2, 3] as const).filter((i) => roundPipRow(s, i));
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((i) => s.fighters[i]!.team)).size).toBe(2);
  });

  it("uses a single pip in timed and deathmatch", () => {
    for (const mode of ["timed", "deathmatch"] as const) {
      expect(pipCount(createMatch({ players: 2, teams: "ffa", mode, map: "roof", items: true }))).toBe(1);
    }
  });
});

describe("isOut (rule 7)", () => {
  it("marks a fighter OUT only at 0 hp while the round is still running", () => {
    expect(isOut({ hp: 0 }, "FIGHTING")).toBe(true);
    expect(isOut({ hp: -3 }, "FIGHTING")).toBe(true);
    expect(isOut({ hp: 1 }, "FIGHTING")).toBe(false);
    expect(isOut({ hp: 0 }, "ROUND_END")).toBe(false);
    expect(isOut({ hp: 0 }, "COUNTDOWN")).toBe(false);
  });
});

describe("blinkOn (rule 8)", () => {
  it("toggles at 4 Hz", () => {
    expect(blinkOn(0)).toBe(true);
    expect(blinkOn(0.24)).toBe(true);
    expect(blinkOn(0.26)).toBe(false);
    expect(blinkOn(0.51)).toBe(true);
  });
});

describe("readyEdge (rule 4)", () => {
  it("fires once when the ring fills, never while it stays full or empty", () => {
    expect(readyEdge(false, 1)).toBe(true);
    expect(readyEdge(true, 1)).toBe(false);
    expect(readyEdge(false, 0.99)).toBe(false);
    expect(readyEdge(true, 0)).toBe(false);
  });
});

describe("bannerFor (rule 9)", () => {
  const cfg = (teams: "ffa" | "2v2", mode: "rounds" | "timed" | "deathmatch", players: 2 | 4 = 2) =>
    createMatch({ players, teams, mode, map: "roof", items: true });

  it("counts down in whole seconds", () => {
    const s = cfg("ffa", "rounds");
    s.phaseTicks = 180;
    expect(bannerFor(s, false)?.text).toBe("3");
    s.phaseTicks = 1;
    expect(bannerFor(s, false)?.text).toBe("1");
  });

  it("shows FIGHT for the first second of a timed round and on the phase edge in deathmatch", () => {
    const s = cfg("ffa", "rounds");
    s.phase = "FIGHTING";
    expect(bannerFor(s, false)?.text).toBe("FIGHT");
    s.roundTicks = MODES.rounds.roundTicks! - 60;
    expect(bannerFor(s, false)).toBeNull();
    const d = cfg("ffa", "deathmatch");
    d.phase = "FIGHTING";
    expect(bannerFor(d, false)).toBeNull();
    expect(bannerFor(d, true)?.text).toBe("FIGHT");
  });

  it("names the team in 2v2 and the character otherwise", () => {
    const t = cfg("2v2", "rounds", 4);
    t.phase = "ROUND_END";
    for (const f of t.fighters) if (f.team === 1) f.hp = 0;
    expect(bannerFor(t, false)?.text).toBe("TEAM A TAKES THE ROUND");
    t.phase = "MATCH_END";
    t.winner = 1;
    expect(bannerFor(t, false)?.text).toBe("TEAM B WINS");

    const f = cfg("ffa", "rounds");
    f.phase = "ROUND_END";
    f.fighters[0]!.hp = 0;
    expect(bannerFor(f, false)?.text).toBe(`ROUND 1: ${CHARACTER_LABEL.conductor.replace(/^THE /, "")}`);
    f.phase = "MATCH_END";
    f.winner = "draw";
    expect(bannerFor(f, false)?.text).toBe("MUTUAL DERAILMENT");
    f.winner = 0;
    expect(bannerFor(f, false)?.text).toBe(`${CHARACTER_LABEL.drifter} WINS`);
  });
});
