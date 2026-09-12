import { describe, expect, it } from "vitest";
import {
  ARSENAL, BALANCE, EMPTY_FRAME, ITEMS, MATCH, WORLD,
  type InputFrame, type ItemId, type MatchState, type PlayerIndex, type RosterEntry, type SimEvent,
} from "../src";
import { createMatch, resetForRound } from "../src/sim/create";
import { step } from "../src/sim/step";
import { applyDamage } from "../src/sim/combat";
import { canEquip, tickCooldowns } from "../src/sim/items";

const PUNCH_TOTAL = BALANCE.PUNCH_STARTUP + BALANCE.PUNCH_ACTIVE + BALANCE.PUNCH_RECOVERY;

const ROSTER: RosterEntry[] = [
  { character: "drifter", loadout: ["sword", "shield"] },
  { character: "conductor", loadout: ["sword", "shield"] },
  { character: "stoker", loadout: ["shield", "flash"] },
];
const FLASH_ROSTER: RosterEntry[] = [ROSTER[0]!, { character: "conductor", loadout: ["flash", "sword"] }, ROSTER[2]!];

function match(players: 2 | 3 = 2, items = true, roster = ROSTER): MatchState {
  const s = createMatch({ players, teams: "ffa", mode: "rounds", map: "roof", items }, roster);
  s.phase = "FIGHTING"; s.roundTicks = MATCH.ROUND_TICKS;
  s.fighters[0]!.x = 400; s.fighters[1]!.x = 460;
  if (s.fighters[2]) s.fighters[2]!.x = 800;
  return s;
}

function stepN(s: MatchState, n: number, inputs: readonly InputFrame[]): { s: MatchState; events: SimEvent[] } {
  const events: SimEvent[] = [];
  for (let k = 0; k < n; k++) { const r = step(s, inputs); s = r.state; events.push(...r.events); }
  return { s, events };
}

const F = (o: Partial<InputFrame> = {}): InputFrame => ({ ...EMPTY_FRAME, ...o });
const HOLD = (item: ItemId): InputFrame => F({ item });
const NONE = [EMPTY_FRAME, EMPTY_FRAME] as const;

/** Equips `item` on player `i` in one tick (the item edge) and returns the state with the edge consumed. */
function equip(s: MatchState, i: PlayerIndex, item: ItemId): MatchState {
  const inputs = s.fighters.map((_, j) => (j === i ? HOLD(item) : EMPTY_FRAME));
  const r = step(s, inputs);
  expect(r.events).toContainEqual({ type: "ITEM_EQUIP", player: i, item });
  // release the key so a later edge is clean
  return step(r.state, s.fighters.map(() => EMPTY_FRAME)).state;
}

const types = (events: SimEvent[], t: SimEvent["type"]) => events.filter((e) => e.type === t);

describe("items: equip", () => {
  it("1. equips once per item per round; works again after resetForRound", () => {
    let s = match();
    const r1 = step(s, [HOLD("sword"), EMPTY_FRAME]);
    expect(r1.events).toContainEqual({ type: "ITEM_EQUIP", player: 0, item: "sword" });
    expect(r1.state.fighters[0]!.item).toEqual({ kind: "sword", uses: ITEMS.sword.uses, ticksLeft: ITEMS.sword.ttl });
    expect(r1.state.fighters[0]!.itemsUsed).toEqual(["sword"]);
    // holding the key does not re-equip
    s = stepN(r1.state, 3, [HOLD("sword"), EMPTY_FRAME]).s;
    expect(s.fighters[0]!.itemsUsed).toEqual(["sword"]);
    // drop the item and edge again in the same round: ignored
    s.fighters[0]!.item = null;
    s = step(s, NONE).state;
    const r2 = step(s, [HOLD("sword"), EMPTY_FRAME]);
    expect(types(r2.events, "ITEM_EQUIP")).toHaveLength(0);
    expect(r2.state.fighters[0]!.item).toBeNull();
    expect(r2.state.fighters[0]!.itemsUsed).toEqual(["sword"]);
    // next round: works again
    s = step(r2.state, NONE).state;
    resetForRound(s, 2);
    s.phase = "FIGHTING";
    const r3 = step(s, [HOLD("sword"), EMPTY_FRAME]);
    expect(r3.events).toContainEqual({ type: "ITEM_EQUIP", player: 0, item: "sword" });
    expect(r3.state.fighters[0]!.item).toEqual({ kind: "sword", uses: ITEMS.sword.uses, ticksLeft: ITEMS.sword.ttl });
  });

  it("2. refused while holding another item, in hitstun, outside the loadout, or with items off", () => {
    // holding another item
    let s = equip(match(), 0, "sword");
    let r = step(s, [HOLD("shield"), EMPTY_FRAME]);
    expect(types(r.events, "ITEM_EQUIP")).toHaveLength(0);
    expect(r.state.fighters[0]!.item!.kind).toBe("sword");
    expect(r.state.fighters[0]!.itemsUsed).toEqual(["sword"]);

    // in hitstun
    s = match();
    s.fighters[0]!.hitstun = 5;
    expect(canEquip(s, 0, "sword")).toBe(false);
    r = step(s, [HOLD("sword"), EMPTY_FRAME]);
    expect(types(r.events, "ITEM_EQUIP")).toHaveLength(0);
    expect(r.state.fighters[0]!.item).toBeNull();

    // not in the loadout (player 0 has sword + shield)
    s = match();
    expect(canEquip(s, 0, "flash")).toBe(false);
    r = step(s, [HOLD("flash"), EMPTY_FRAME]);
    expect(types(r.events, "ITEM_EQUIP")).toHaveLength(0);
    expect(r.state.fighters[0]!.itemsUsed).toEqual([]);

    // items disabled in config
    s = match(2, false);
    expect(canEquip(s, 0, "sword")).toBe(false);
    r = step(s, [HOLD("sword"), EMPTY_FRAME]);
    expect(types(r.events, "ITEM_EQUIP")).toHaveLength(0);
    expect(r.state.fighters[0]!.item).toBeNull();

    // ko'd or down a pit
    s = match();
    s.fighters[0]!.hp = 0;
    expect(canEquip(s, 0, "sword")).toBe(false);
    s = match();
    s.fighters[0]!.pitTicks = 10;
    expect(canEquip(s, 0, "sword")).toBe(false);
    // wrong phase
    s = match();
    s.phase = "ROUND_END";
    expect(canEquip(s, 0, "sword")).toBe(false);
    s.phase = "COUNTDOWN";
    expect(canEquip(s, 0, "sword")).toBe(true);
  });

  it("2b. an item edge during the countdown equips, and the item is in hand when FIGHT starts", () => {
    const s = createMatch({ players: 2, teams: "ffa", mode: "rounds", map: "roof", items: true }, ROSTER);
    expect(s.phase).toBe("COUNTDOWN");
    const r = step(s, [HOLD("sword"), EMPTY_FRAME]);
    expect(r.events).toContainEqual({ type: "ITEM_EQUIP", player: 0, item: "sword" });
    expect(r.state.fighters[0]!.item).toEqual({ kind: "sword", uses: ITEMS.sword.uses, ticksLeft: ITEMS.sword.ttl });
    // holding the key through the countdown does not re-equip, and the item survives into FIGHTING
    let t = r.state;
    while (t.phase === "COUNTDOWN") t = step(t, [HOLD("sword"), EMPTY_FRAME]).state;
    expect(t.phase).toBe("FIGHTING");
    expect(t.fighters[0]!.item).toEqual({ kind: "sword", uses: ITEMS.sword.uses, ticksLeft: ITEMS.sword.ttl });
    expect(t.fighters[0]!.itemsUsed).toEqual(["sword"]);
  });
});

describe("items: sword (9.10)", () => {
  const CHOP_TOTAL = ARSENAL.CHOP_STARTUP + ARSENAL.CHOP_ACTIVE + ARSENAL.CHOP_RECOVERY;
  const SWEEP_TOTAL = ARSENAL.SWEEP_STARTUP + ARSENAL.SWEEP_ACTIVE + ARSENAL.SWEEP_RECOVERY;
  const swing = (st: MatchState, key: Partial<InputFrame>, total: number, p1: InputFrame = EMPTY_FRAME) => {
    const a = stepN(st, total, [F(key), p1]);
    const b = step(a.s, [EMPTY_FRAME, p1]);
    return { s: b.state, events: [...a.events, ...b.events] };
  };

  it("3a. a punch with a sword is a plain punch: PUNCH_DAMAGE, PUNCH_REACH, no ITEM_USE", () => {
    const s = equip(match(), 0, "sword");
    s.fighters[1]!.x = s.fighters[0]!.x + 120;
    expect(types(swing(s, { punchL: true }, PUNCH_TOTAL).events, "HIT")).toHaveLength(0);
    const near = equip(match(), 0, "sword");
    near.fighters[1]!.x = near.fighters[0]!.x + 60;
    const r = swing(near, { punchL: true }, PUNCH_TOTAL);
    expect(types(r.events, "PUNCH")).toHaveLength(1);
    expect(types(r.events, "SLASH")).toHaveLength(0);
    expect(types(r.events, "ITEM_USE")).toHaveLength(0);
    expect(types(r.events, "HIT")[0]).toMatchObject({ attacker: 0, target: 1, damage: BALANCE.PUNCH_DAMAGE, blocked: false });
    expect(r.s.fighters[0]!.item).toMatchObject({ kind: "sword" });
  });

  it("3b. chop: hits at CHOP_REACH, misses beyond, CHOP_DAMAGE, emits SLASH, does not consume", () => {
    const s = equip(match(), 0, "sword");
    s.fighters[1]!.x = s.fighters[0]!.x + ARSENAL.CHOP_GAP + ARSENAL.CHOP_REACH - 5 + WORLD.HURTBOX_W / 2;
    const r = swing(s, { chop: true }, CHOP_TOTAL);
    expect(r.events).toContainEqual({ type: "SLASH", player: 0, style: "chop" });
    expect(types(r.events, "PUNCH")).toHaveLength(0);
    expect(types(r.events, "ITEM_USE")).toHaveLength(0);
    expect(types(r.events, "HIT")[0]).toMatchObject({ attacker: 0, target: 1, damage: ARSENAL.CHOP_DAMAGE, blocked: false });
    expect(r.s.fighters[0]!.action).toBeNull();
    expect(r.s.fighters[0]!.item).toMatchObject({ kind: "sword", uses: ITEMS.sword.uses });

    const far = equip(match(), 0, "sword");
    far.fighters[1]!.x = far.fighters[0]!.x + ARSENAL.CHOP_GAP + ARSENAL.CHOP_REACH + 5 + WORLD.HURTBOX_W / 2;
    const m = swing(far, { chop: true }, CHOP_TOTAL);
    expect(types(m.events, "SLASH")).toHaveLength(1);
    expect(types(m.events, "HIT")).toHaveLength(0);
  });

  it("3c. chop crushes guard: a blocking target takes CHOP_GUARD_FRACTION of CHOP_DAMAGE, not chip", () => {
    const s = equip(match(), 0, "sword");
    s.fighters[1]!.x = s.fighters[0]!.x + 60;
    // block long enough to be past the parry window (target has no sword anyway)
    const pre = stepN(s, ARSENAL.PARRY_WINDOW + 1, [EMPTY_FRAME, F({ block: true })]).s;
    const r = swing(pre, { chop: true }, CHOP_TOTAL, F({ block: true }));
    const hit = types(r.events, "HIT");
    expect(hit).toHaveLength(1);
    expect(hit[0]).toMatchObject({ damage: Math.round(ARSENAL.CHOP_DAMAGE * ARSENAL.CHOP_GUARD_FRACTION), blocked: true });
    expect(r.s.fighters[1]!.hp).toBe(BALANCE.MAX_HP - Math.round(ARSENAL.CHOP_DAMAGE * ARSENAL.CHOP_GUARD_FRACTION));
  });

  it("3d. sweep: wide low hitbox hits at SWEEP_REACH, misses beyond, knockback SWEEP_PUSH x a punch", () => {
    const s = equip(match(), 0, "sword");
    s.fighters[1]!.x = s.fighters[0]!.x + ARSENAL.SWEEP_GAP + ARSENAL.SWEEP_REACH - 5 + WORLD.HURTBOX_W / 2;
    const a = stepN(s, ARSENAL.SWEEP_STARTUP + 1, [F({ sweep: true }), EMPTY_FRAME]);
    expect(a.events).toContainEqual({ type: "SLASH", player: 0, style: "sweep" });
    expect(types(a.events, "HIT")[0]).toMatchObject({ attacker: 0, target: 1, damage: ARSENAL.SWEEP_DAMAGE, blocked: false });
    expect(a.s.fighters[1]!.knockbackVx).toBeCloseTo(ARSENAL.SWEEP_PUSH * (BALANCE.KNOCKBACK_PX / BALANCE.HITSTUN_TICKS));
    expect(a.s.fighters[1]!.hitstun).toBe(BALANCE.HITSTUN_TICKS);
    const r = swing(s, { sweep: true }, SWEEP_TOTAL);
    expect(r.s.fighters[0]!.action).toBeNull();

    const far = equip(match(), 0, "sword");
    far.fighters[1]!.x = far.fighters[0]!.x + ARSENAL.SWEEP_GAP + ARSENAL.SWEEP_REACH + 5 + WORLD.HURTBOX_W / 2;
    expect(types(swing(far, { sweep: true }, SWEEP_TOTAL).events, "HIT")).toHaveLength(0);

    // a punch's knockback is the baseline
    const p = equip(match(), 0, "sword");
    p.fighters[1]!.x = p.fighters[0]!.x + 60;
    const ph = stepN(p, BALANCE.PUNCH_STARTUP + 1, [F({ punchL: true }), EMPTY_FRAME]);
    expect(ph.s.fighters[1]!.knockbackVx).toBeCloseTo(BALANCE.KNOCKBACK_PX / BALANCE.HITSTUN_TICKS);
  });

  it("3e. no sword -> chop / sweep edges are ignored", () => {
    const s = match();
    s.fighters[1]!.x = s.fighters[0]!.x + 60;
    const r = stepN(s, CHOP_TOTAL, [F({ chop: true, sweep: true }), EMPTY_FRAME]);
    expect(types(r.events, "SLASH")).toHaveLength(0);
    expect(types(r.events, "HIT")).toHaveLength(0);
    expect(r.s.fighters[0]!.action).toBeNull();
    const sh = equip(match(), 0, "shield");
    expect(types(stepN(sh, 3, [F({ chop: true }), EMPTY_FRAME]).events, "SLASH")).toHaveLength(0);
  });

  it("3f. the sword lasts ITEMS.sword.ttl ticks, swings are free, then breaks with ITEM_BREAK; the clock runs while KO'd", () => {
    const ttl = ITEMS.sword.ttl!;
    const s = equip(match(), 0, "sword");
    // the equip tick counts cooldowns before applyEquip; only the release tick has ticked
    expect(s.fighters[0]!.item).toEqual({ kind: "sword", uses: ITEMS.sword.uses, ticksLeft: ttl - 1 });
    s.fighters[1]!.x = s.fighters[0]!.x + 400;
    // many swings, no uses spent
    let st = s;
    for (let k = 0; k < 8; k++) {
      const r = swing(st, { chop: true }, CHOP_TOTAL); st = r.s;
      expect(types(r.events, "ITEM_USE")).toHaveLength(0);
      expect(types(r.events, "ITEM_BREAK")).toHaveLength(0);
    }
    expect(st.fighters[0]!.item).toMatchObject({ kind: "sword" });
    const left = st.fighters[0]!.item!.ticksLeft!;
    const upTo = stepN(st, left - 1, NONE);
    expect(upTo.s.fighters[0]!.item).toEqual({ kind: "sword", uses: ITEMS.sword.uses, ticksLeft: 1 });
    const last = step(upTo.s, NONE);
    expect(last.events).toContainEqual({ type: "ITEM_BREAK", player: 0, item: "sword" });
    expect(last.state.fighters[0]!.item).toBeNull();

    // KO'd fighter: timer still runs
    const ko = equip(match(3), 0, "sword");
    ko.fighters[0]!.hp = 0;
    const k = stepN(ko, 10, [EMPTY_FRAME, EMPTY_FRAME, EMPTY_FRAME]);
    expect(k.s.fighters[0]!.item!.ticksLeft).toBe(ttl - 11);
  });
});

describe("items: parry", () => {
  /** Player 1 holds a sword and blocks from tick 1; player 0 punches so contact lands on `hitTick` of the block. */
  function parryScenario(hitTick: number) {
    const s = equip(match(), 1, "sword");
    const punchEdgeTick = hitTick - BALANCE.PUNCH_STARTUP; // contact is STARTUP+1 ticks after the edge
    const events: SimEvent[] = [];
    let st = s;
    for (let t = 1; t <= hitTick + 1; t++) {
      const p0 = t >= punchEdgeTick ? F({ punchL: true }) : EMPTY_FRAME;
      const r = step(st, [p0, F({ block: true })]);
      st = r.state; events.push(...r.events);
    }
    return { s: st, events };
  }

  it("4. connecting on tick <= 9 of the block parries; tick 10+ is an ordinary blocked hit", () => {
    const early = parryScenario(9);
    expect(early.events).toContainEqual({ type: "PARRY", player: 1, attacker: 0 });
    expect(types(early.events, "HIT")).toHaveLength(0);
    expect(early.s.fighters[1]!.hp).toBe(BALANCE.MAX_HP);
    expect(early.s.fighters[0]!.action).toBeNull();
    // one tick after contact the attacker has already counted one hitstun tick
    expect(early.s.fighters[0]!.hitstun).toBe(ARSENAL.PARRY_STUN - 1);
    expect(early.s.fighters[0]!.knockbackVx).toBe(0);
    expect(early.s.fighters[1]!.item).toMatchObject({ kind: "sword", uses: ITEMS.sword.uses });

    const late = parryScenario(10);
    expect(types(late.events, "PARRY")).toHaveLength(0);
    const hit = types(late.events, "HIT");
    expect(hit).toHaveLength(1);
    expect(hit[0]).toMatchObject({ attacker: 0, target: 1, damage: BALANCE.CHIP_DAMAGE, blocked: true });
    expect(late.s.fighters[1]!.hp).toBe(BALANCE.MAX_HP - BALANCE.CHIP_DAMAGE);
    expect(late.s.fighters[0]!.hitstun).toBe(0);
  });
});

describe("items: shield", () => {
  it("5. absorbs three hits with no damage or hitstun, breaks on the third, fourth deals 12; OOB never absorbed", () => {
    let s = equip(match(), 1, "shield");
    const swing = (st: MatchState) => {
      st.fighters[1]!.x = st.fighters[0]!.x + 60;
      const a = stepN(st, PUNCH_TOTAL, [F({ punchL: true }), EMPTY_FRAME]);
      const b = step(a.s, NONE);
      return { s: b.state, events: [...a.events, ...b.events] };
    };
    for (let n = 1; n <= 3; n++) {
      const r = swing(s); s = r.s;
      expect(r.events).toContainEqual({ type: "SHIELD_ABSORB", player: 1, left: 3 - n });
      expect(types(r.events, "HIT")).toHaveLength(1);
      expect(types(r.events, "HIT")[0]).toMatchObject({ target: 1, damage: 0, blocked: false });
      expect(s.fighters[1]!.hp).toBe(BALANCE.MAX_HP);
      expect(s.fighters[1]!.hitstun).toBe(0);
      if (n < 3) {
        expect(types(r.events, "ITEM_BREAK")).toHaveLength(0);
        expect(s.fighters[1]!.item).toEqual({ kind: "shield", uses: 3 - n, ticksLeft: null });
      } else {
        const idx = r.events.findIndex((e) => e.type === "SHIELD_ABSORB");
        const brk = r.events.findIndex((e) => e.type === "ITEM_BREAK");
        expect(brk).toBeGreaterThan(idx);
        expect(r.events[brk]).toEqual({ type: "ITEM_BREAK", player: 1, item: "shield" });
        expect(s.fighters[1]!.item).toBeNull();
      }
    }
    const r4 = swing(s);
    expect(types(r4.events, "SHIELD_ABSORB")).toHaveLength(0);
    expect(types(r4.events, "HIT")[0]).toMatchObject({ damage: BALANCE.PUNCH_DAMAGE });
    expect(r4.s.fighters[1]!.hp).toBe(BALANCE.MAX_HP - BALANCE.PUNCH_DAMAGE);

    // OOB damage goes straight to hp
    let o = equip(match(), 1, "shield");
    o.fighters[1]!.x = WORLD.WIDTH;
    o = stepN(o, BALANCE.OOB_EVERY_TICKS, [EMPTY_FRAME, F({ right: true })]).s;
    expect(o.fighters[1]!.hp).toBe(BALANCE.MAX_HP - BALANCE.OOB_DAMAGE);
    expect(o.fighters[1]!.item).toEqual({ kind: "shield", uses: 3, ticksLeft: null });

    // applyDamage routes laser and hazard through the shield, never pit
    const d = equip(match(), 1, "shield");
    const ev: SimEvent[] = [];
    expect(applyDamage(d, 1, 10, "laser", 0, ev)).toEqual({ absorbed: true });
    expect(applyDamage(d, 1, 2, "hazard", null, ev)).toEqual({ absorbed: true });
    expect(d.fighters[1]!.hp).toBe(BALANCE.MAX_HP);
    expect(types(ev, "SHIELD_ABSORB").map((e) => (e as { left: number }).left)).toEqual([2, 1]);
    expect(applyDamage(d, 1, 8, "pit", null, ev)).toEqual({ absorbed: false });
    expect(d.fighters[1]!.hp).toBe(BALANCE.MAX_HP - 8);
    expect(d.fighters[1]!.item).toEqual({ kind: "shield", uses: 1, ticksLeft: null });
  });
});

describe("items: flash", () => {
  it("6. dazzles every living opponent for 120 ticks, breaks, and the punch never connects", () => {
    let s = equip(match(3, true, FLASH_ROSTER), 1, "flash");
    s.fighters[0]!.x = s.fighters[1]!.x - 60; // in reach of an ordinary punch
    s.fighters[2]!.x = s.fighters[1]!.x + 60;
    const r = step(s, [EMPTY_FRAME, F({ punchR: true }), EMPTY_FRAME]);
    expect(r.events).toContainEqual({ type: "FLASH", player: 1 });
    expect(r.events).toContainEqual({ type: "ITEM_USE", player: 1, item: "flash" });
    expect(r.events).toContainEqual({ type: "ITEM_BREAK", player: 1, item: "flash" });
    expect(r.state.fighters[1]!.item).toBeNull();
    expect(r.state.fighters[0]!.dazzle).toBe(ARSENAL.DAZZLE_TICKS);
    expect(r.state.fighters[2]!.dazzle).toBe(ARSENAL.DAZZLE_TICKS);
    expect(r.state.fighters[1]!.dazzle).toBe(0);
    expect(r.state.fighters[1]!.action).toMatchObject({ kind: "punch", arm: "R", landed: true, sword: false });
    const rest = stepN(r.state, PUNCH_TOTAL, [EMPTY_FRAME, F({ punchR: true }), EMPTY_FRAME]);
    expect(types(rest.events, "HIT")).toHaveLength(0);
    expect(rest.s.fighters[0]!.hp).toBe(BALANCE.MAX_HP);
    expect(rest.s.fighters[2]!.hp).toBe(BALANCE.MAX_HP);
    expect(rest.s.fighters[0]!.dazzle).toBe(ARSENAL.DAZZLE_TICKS - PUNCH_TOTAL);
    // a dead opponent is not dazzled
    s = equip(match(3, true, FLASH_ROSTER), 1, "flash");
    s.fighters[2]!.hp = 0;
    const d = step(s, [EMPTY_FRAME, F({ punchL: true }), EMPTY_FRAME]);
    expect(d.state.fighters[0]!.dazzle).toBe(ARSENAL.DAZZLE_TICKS);
    expect(d.state.fighters[2]!.dazzle).toBe(0);
  });
});

describe("items: cooldowns", () => {
  it("7. tickCooldowns counts laserCooldown, dazzle and invuln down and never below 0", () => {
    const s = match();
    s.fighters[0]!.laserCooldown = 2; s.fighters[0]!.dazzle = 1; s.fighters[0]!.invuln = 0;
    tickCooldowns(s);
    expect(s.fighters[0]!).toMatchObject({ laserCooldown: 1, dazzle: 0, invuln: 0 });
    tickCooldowns(s);
    tickCooldowns(s);
    expect(s.fighters[0]!).toMatchObject({ laserCooldown: 0, dazzle: 0, invuln: 0 });
    expect(s.fighters[1]!).toMatchObject({ laserCooldown: 0, dazzle: 0, invuln: 0 });
  });
});
