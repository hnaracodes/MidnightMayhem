import { describe, expect, it } from "vitest";
import type Phaser from "phaser";
import {
  ARSENAL, CHARACTER_LABEL, ITEM_IDS, ITEMS, MODES, WORLD, createMatch, type ItemId, type MatchState, type PlayerIndex,
} from "@midnight/shared";
import {
  HUD_BAND, Hud, TOAST, bannerFor, barHeight, barLayout, blinkOn, cooldownFraction, isOut, itemEdge, itemGlyph, pipCount,
  readyEdge, roundPipRow, setColorIfChanged, teamColor, timerText, toastLayout, toastSlide, itemTimerFraction, itemTimerFlash, toastLabel, TIMER_FLASH_TICKS, TIMER_FLASH_PERIOD,
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
    const glyphs = ITEM_IDS.map((kind: ItemId) => itemGlyph({ kind, uses: 1, ticksLeft: null }));
    expect(new Set(glyphs).size).toBe(ITEM_IDS.length);
    for (const g of glyphs) expect(g.length).toBeGreaterThan(0);
    expect(itemGlyph({ kind: "molotov", uses: 2, ticksLeft: null })).toBe("▲");
    expect(itemGlyph({ kind: "sword", uses: 6, ticksLeft: null })).toBe("/");
    expect(itemGlyph({ kind: "shield", uses: 3, ticksLeft: null })).toBe("▣");
    expect(itemGlyph({ kind: "banana", uses: 1, ticksLeft: null })).toBe("◗");
    expect(itemGlyph({ kind: "flash", uses: 1, ticksLeft: null })).toBe("✦");
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

describe("setColorIfChanged (11.05 update budget)", () => {
  it("calls setColor only when the colour differs from the style's current one", () => {
    const calls: string[] = [];
    const text = { style: { color: "#ffffff" }, setColor(css: string) { this.style.color = css; calls.push(css); return this; } };
    setColorIfChanged(text, "#ffffff");
    expect(calls).toEqual([]);
    setColorIfChanged(text, "#ff0000");
    setColorIfChanged(text, "#ff0000");
    expect(calls).toEqual(["#ff0000"]);
    expect(setColorIfChanged(text, "#ffffff")).toBe(text);
    expect(calls).toEqual(["#ff0000", "#ffffff"]);
  });
});

describe("toastLayout (9.08 rule 2)", () => {
  const nameBox = (players: 2 | 3 | 4, i: PlayerIndex): Box => {
    const l = barLayout(players, i);
    const h = barHeight(players, i);
    const tight = players === 4 || (players === 3 && i === 2);
    const w = 140;
    return { x: l.align === "left" ? l.x : l.x + l.w - w, y: l.y + h + (tight ? 1 : 6), w, h: tight ? 12 : 14 };
  };

  for (const players of [2, 3, 4] as const) {
    it(`${players} players: toasts overlap no bar, no name row and no other toast, and stay on screen`, () => {
      const bars = boxes(players);
      const toasts: Box[] = [];
      for (let i = 0; i < players; i += 1) {
        const t = toastLayout(players, i as PlayerIndex);
        const box = { x: t.x, y: t.y, w: t.w, h: t.h };
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.w).toBeLessThanOrEqual(WORLD.WIDTH);
        expect(box.y + box.h).toBeLessThan(250); // above a standing rig's head
        for (const bar of bars) expect(overlaps(box, bar), `toast ${i} vs a bar`).toBe(false);
        for (let j = 0; j < players; j += 1) expect(overlaps(box, nameBox(players, j as PlayerIndex)), `toast ${i} vs name ${j}`).toBe(false);
        for (const other of toasts) expect(overlaps(box, other), `toast ${i} vs another toast`).toBe(false);
        toasts.push(box);
      }
    });
  }

  it("sits inside (toward the centre) for P0 / P2 and mirrored for P1 / P3, sliding in from that side", () => {
    const a = toastLayout(2, 0);
    const b = toastLayout(2, 1);
    expect(a.align).toBe("left");
    expect(b.align).toBe("right");
    expect(a.x).toBe(barLayout(2, 0).x);
    expect(b.x + b.w).toBe(barLayout(2, 1).x + barLayout(2, 1).w);
    expect(a.dx).toBeLessThan(0); // enters from the left edge
    expect(b.dx).toBeGreaterThan(0);
    expect(toastLayout(4, 0).align).toBe("left");
    expect(toastLayout(4, 1).align).toBe("left");
    expect(toastLayout(4, 2).align).toBe("right");
    expect(toastLayout(4, 3).align).toBe("right");
    const c = toastLayout(3, 2);
    expect(c.x + c.w / 2).toBe(WORLD.WIDTH / 2);
  });
});

describe("toastSlide and itemEdge (9.08 rule 2)", () => {
  it("slides in over 10 frames, holds, slides out over 10, then ends", () => {
    expect(toastSlide(0, TOAST.HOLD)).toBe(0);
    expect(toastSlide(5, TOAST.HOLD)).toBeGreaterThan(0);
    expect(toastSlide(5, TOAST.HOLD)).toBeLessThan(1);
    expect(toastSlide(TOAST.IN, TOAST.HOLD)).toBe(1);
    expect(toastSlide(TOAST.IN + TOAST.HOLD - 1, TOAST.HOLD)).toBe(1);
    expect(toastSlide(TOAST.IN + TOAST.HOLD + 5, TOAST.HOLD)).toBeLessThan(1);
    expect(toastSlide(TOAST.IN + TOAST.HOLD + TOAST.OUT - 1, TOAST.HOLD)).toBeGreaterThan(0);
    expect(toastSlide(TOAST.IN + TOAST.HOLD + TOAST.OUT, TOAST.HOLD)).toBeNull();
    expect(TOAST.IN).toBe(10);
    expect(TOAST.HOLD).toBe(90);
    expect(TOAST.OUT).toBe(10);
    expect(TOAST.BROKEN_HOLD).toBe(45);
  });

  it("reads equip / use / break from the held item's change", () => {
    expect(itemEdge(null, null)).toBeNull();
    expect(itemEdge(null, { kind: "molotov", uses: 2, ticksLeft: null })).toBe("equip");
    expect(itemEdge({ kind: "sword", uses: 3, ticksLeft: null }, { kind: "molotov", uses: 2, ticksLeft: null })).toBe("equip");
    expect(itemEdge({ kind: "molotov", uses: 2, ticksLeft: null }, { kind: "molotov", uses: 1, ticksLeft: null })).toBe("use");
    expect(itemEdge({ kind: "molotov", uses: 2, ticksLeft: null }, { kind: "molotov", uses: 2, ticksLeft: null })).toBeNull();
    expect(itemEdge({ kind: "molotov", uses: 1, ticksLeft: null }, null)).toBe("break");
  });
});

// ---- Hud lifecycle with a stub scene ----

class FakeText {
  visible = true;
  text = "";
  x = 0;
  y = 0;
  alpha = 1;
  displayWidth = 60;
  style: { color: unknown } = { color: "#000000" };
  constructor() {
    return new Proxy(this, {
      get: (target, prop, receiver) => {
        if (prop in target) return Reflect.get(target, prop, receiver);
        return () => receiver;
      },
    });
  }
  setVisible(v: boolean): this { this.visible = v; return this; }
  setText(t: string): this { this.text = String(t); return this; }
  setPosition(x: number, y: number): this { this.x = x; this.y = y; return this; }
  setAlpha(a: number): this { this.alpha = a; return this; }
  setColor(c: string): this { this.style.color = c; return this; }
}

function hudScene() {
  const texts: FakeText[] = [];
  const graphics = { calls: [] as string[] };
  const g = new Proxy(graphics, {
    get: (target, prop, receiver) => {
      if (prop in target) return Reflect.get(target, prop, receiver);
      return (...args: unknown[]) => { target.calls.push(`${String(prop)}(${args.map((a) => typeof a === "number" ? Math.round(a) : String(a)).join(",")})`); return receiver; };
    },
  });
  const scene = { add: { graphics: () => g, text: () => { const t = new FakeText(); texts.push(t); return t; } } };
  return { scene: scene as unknown as Phaser.Scene, texts, graphics };
}

describe("Hud equip toast lifecycle (9.08 rule 2)", () => {
  const DT = 1 / 60;
  const fighting = () => {
    const s = createMatch({ players: 2, teams: "ffa", mode: "rounds", map: "roof", items: true });
    s.phase = "FIGHTING";
    s.phaseTicks = 0;
    return s;
  };
  const shown = (texts: FakeText[], text: string) => texts.filter((t) => t.visible && t.text === text);

  it("an equip shows `MOLOTOV ×2` / `EQUIPPED` for 110 frames beside the bar, then hides", () => {
    const { scene, texts } = hudScene();
    const hud = new Hud(scene);
    const s = fighting();
    hud.update(s, DT);
    expect(shown(texts, "EQUIPPED")).toHaveLength(0);
    s.fighters[0]!.item = { kind: "molotov", uses: 2, ticksLeft: null };
    hud.update(s, DT); // frame 0 of the slide
    expect(shown(texts, "MOLOTOV ×2")).toHaveLength(1);
    expect(shown(texts, "EQUIPPED")).toHaveLength(1);
    const name = shown(texts, "MOLOTOV ×2")[0]!;
    const rest = toastLayout(2, 0);
    expect(name.x).toBeLessThan(rest.x + rest.w); // still sliding in from the left
    for (let k = 0; k < TOAST.IN; k += 1) hud.update(s, DT);
    expect(name.x).toBeGreaterThan(rest.x);
    expect(name.x).toBeLessThan(rest.x + rest.w);
    expect(name.style.color).toBe("#F2A03D");
    expect(shown(texts, "EQUIPPED")[0]!.style.color).toBe("#E9E2CF"); // 12.05: bone ink
    for (let k = 0; k < TOAST.HOLD + TOAST.OUT - 1; k += 1) hud.update(s, DT); // frames 11..109: the last visible one
    expect(shown(texts, "EQUIPPED")).toHaveLength(1);
    hud.update(s, DT);
    expect(shown(texts, "EQUIPPED")).toHaveLength(0);
  });

  it("a use updates the count and pulses the slot pips; a break shows BROKEN in danger for 45 frames", () => {
    const { scene, texts, graphics } = hudScene();
    const hud = new Hud(scene);
    const s = fighting();
    hud.update(s, DT);
    s.fighters[0]!.item = { kind: "molotov", uses: 2, ticksLeft: null };
    hud.update(s, DT);
    s.fighters[0]!.item = { kind: "molotov", uses: 1, ticksLeft: null };
    graphics.calls.length = 0;
    hud.update(s, DT);
    expect(shown(texts, "MOLOTOV ×1")).toHaveLength(1);
    expect(hud.pipPulse(0)).toBeGreaterThan(0);
    const before = graphics.calls.length;
    for (let k = 0; k < 20; k += 1) hud.update(s, DT);
    expect(hud.pipPulse(0)).toBe(0);
    expect(before).toBeGreaterThan(0);
    s.fighters[0]!.item = null;
    hud.update(s, DT);
    expect(shown(texts, "BROKEN")).toHaveLength(1);
    expect(shown(texts, "BROKEN")[0]!.style.color).toBe("#E8434F");
    expect(shown(texts, "MOLOTOV")).toHaveLength(1);
    for (let k = 0; k < TOAST.BROKEN_HOLD + TOAST.OUT - 1; k += 1) hud.update(s, DT); // already at rest: no slide-in
    expect(shown(texts, "BROKEN")).toHaveLength(1);
    hud.update(s, DT);
    expect(shown(texts, "BROKEN")).toHaveLength(0);
  });

  it("items cleared by a round reset are not a break, and the other bar's toast is mirrored", () => {
    const { scene, texts } = hudScene();
    const hud = new Hud(scene);
    const s = fighting();
    s.fighters[1]!.item = { kind: "sword", uses: 6, ticksLeft: null };
    hud.update(s, DT); // first sight of a held item: no toast
    expect(shown(texts, "EQUIPPED")).toHaveLength(0);
    s.phase = "ROUND_END";
    s.fighters[1]!.item = null;
    hud.update(s, DT);
    expect(shown(texts, "BROKEN")).toHaveLength(0);
    s.phase = "FIGHTING";
    s.fighters[1]!.item = { kind: "shield", uses: 3, ticksLeft: null };
    hud.update(s, DT);
    for (let k = 0; k < TOAST.IN; k += 1) hud.update(s, DT);
    const name = shown(texts, "SHIELD ×3")[0]!;
    expect(name).toBeDefined();
    const rest = toastLayout(2, 1);
    expect(name.x).toBeGreaterThan(rest.x);
    expect(name.x).toBeLessThanOrEqual(rest.x + rest.w);
  });
});

// ---- 12.05 ----

import { BALANCE } from "@midnight/shared";
import { HUD_FONT, LOW_HP_FRACTION, bannerFade, barGlowAlpha, lowHpPulse } from "../src/game/hud";

describe("12.05 HUD restyle helpers", () => {
  it("rule 1: the bar glow grows as health drops", () => {
    expect(barGlowAlpha(BALANCE.MAX_HP)).toBeCloseTo(0.1, 6);
    expect(barGlowAlpha(BALANCE.MAX_HP / 2)).toBeCloseTo(0.3, 6);
    expect(barGlowAlpha(1)).toBeGreaterThan(0.48);
    expect(barGlowAlpha(0)).toBeCloseTo(0.5, 6);
    expect(LOW_HP_FRACTION).toBe(0.25);
  });

  it("rule 5: the heartbeat stays in 0..1, repeats every 1.2 s and has two beats per cycle", () => {
    let peaks = 0;
    let prev = lowHpPulse(-0.01), prev2 = lowHpPulse(-0.02);
    for (let t = 0; t < 1.2; t += 0.005) {
      const v = lowHpPulse(t);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      if (prev > prev2 && prev >= v && prev > 0.3) peaks += 1;
      prev2 = prev; prev = v;
    }
    expect(peaks).toBe(2);
    expect(lowHpPulse(0.3)).toBeCloseTo(lowHpPulse(1.5), 6);
  });

  it("rule 6: the banner blooms from dark to full over 0.28 s with no scale", () => {
    expect(bannerFade(0)).toEqual({ alpha: 0, tint: P.void0 });
    const mid = bannerFade(0.1);
    expect(mid.alpha).toBeGreaterThan(0);
    expect(mid.alpha).toBeLessThan(1);
    expect(mid.tint).toBeGreaterThan(P.void0);
    expect(bannerFade(0.28)).toEqual({ alpha: 1, tint: 0xffffff });
    expect(bannerFade(5)).toEqual({ alpha: 1, tint: 0xffffff });
  });

  it("rule 2: the HUD uses the landing's condensed stack, no network fonts", () => {
    expect(HUD_FONT).toContain("Avenir Next Condensed");
    expect(HUD_FONT).not.toMatch(/https?:/);
  });
});

describe("9.10 timed item bar", () => {
  it("itemTimerFraction drains ticksLeft over the item's ttl and is null for a use-counted item", () => {
    const ttl = ITEMS.sword.ttl ?? 0;
    expect(ttl).toBeGreaterThan(0);
    expect(itemTimerFraction(null)).toBeNull();
    expect(itemTimerFraction({ kind: "molotov", uses: 2, ticksLeft: null })).toBeNull();
    expect(itemTimerFraction({ kind: "sword", uses: 0, ticksLeft: ttl })).toBe(1);
    expect(itemTimerFraction({ kind: "sword", uses: 0, ticksLeft: ttl / 2 })).toBeCloseTo(0.5);
    expect(itemTimerFraction({ kind: "sword", uses: 0, ticksLeft: 0 })).toBe(0);
  });

  it("the last 180 ticks flash on a 10-tick period; earlier never", () => {
    expect(itemTimerFlash({ kind: "sword", uses: 0, ticksLeft: TIMER_FLASH_TICKS + 1 })).toBe(false);
    expect(itemTimerFlash({ kind: "molotov", uses: 1, ticksLeft: null })).toBe(false);
    const on = itemTimerFlash({ kind: "sword", uses: 0, ticksLeft: 100 });
    const off = itemTimerFlash({ kind: "sword", uses: 0, ticksLeft: 100 - TIMER_FLASH_PERIOD / 2 });
    expect(on).not.toBe(off);
    expect(itemTimerFlash({ kind: "sword", uses: 0, ticksLeft: 100 - TIMER_FLASH_PERIOD })).toBe(on);
  });

  it("the equip toast reads SWORD 10s for the timed sword and MOLOTOV ×2 for a use-counted item", () => {
    expect(toastLabel("sword", 0)).toBe("SWORD 10s");
    expect(toastLabel("molotov", 2)).toBe("MOLOTOV ×2");
  });

  it("a draining timer is not a use edge", () => {
    expect(itemEdge({ kind: "sword", uses: 0, ticksLeft: 600 }, { kind: "sword", uses: 0, ticksLeft: 599 })).toBeNull();
    expect(itemEdge({ kind: "sword", uses: 0, ticksLeft: 1 }, null)).toBe("break");
  });
});
