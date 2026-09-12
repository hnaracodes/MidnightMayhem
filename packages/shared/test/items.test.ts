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
    expect(r1.state.fighters[0]!.item).toEqual({ kind: "sword", uses: ITEMS.sword.uses });
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
    expect(r3.state.fighters[0]!.item).toEqual({ kind: "sword", uses: ITEMS.sword.uses });
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
    expect(r.state.fighters[0]!.item).toEqual({ kind: "sword", uses: ITEMS.sword.uses });
    // holding the key through the countdown does not re-equip, and the item survives into FIGHTING
    let t = r.state;
    while (t.phase === "COUNTDOWN") t = step(t, [HOLD("sword"), EMPTY_FRAME]).state;
    expect(t.phase).toBe("FIGHTING");
    expect(t.fighters[0]!.item).toEqual({ kind: "sword", uses: ITEMS.sword.uses });
    expect(t.fighters[0]!.itemsUsed).toEqual(["sword"]);
  });
});

describe("items: sword", () => {
  it("3. reaches 120 px for 10 damage, breaks on the 6th swing, 7th punch is normal", () => {
    let s = equip(match(), 0, "sword");
    s.fighters[1]!.x = s.fighters[0]!.x + 120;
    // a normal punch from 120 px would miss
    const plain = match();
    plain.fighters[1]!.x = plain.fighters[0]!.x + 120;
    expect(types(stepN(plain, PUNCH_TOTAL, [F({ punchL: true }), EMPTY_FRAME]).events, "HIT")).toHaveLength(0);

    const swing = (st: MatchState) => {
      const a = stepN(st, PUNCH_TOTAL, [F({ punchL: true }), EMPTY_FRAME]);
      const b = step(a.s, NONE);
      return { s: b.state, events: [...a.events, ...b.events] };
    };

    let r = swing(s);
    expect(types(r.events, "PUNCH")).toHaveLength(1);
    expect(r.events).toContainEqual({ type: "ITEM_USE", player: 0, item: "sword" });
    const hit = types(r.events, "HIT");
    expect(hit).toHaveLength(1);
    expect(hit[0]).toMatchObject({ attacker: 0, target: 1, damage: ARSENAL.SWORD_DAMAGE, blocked: false });
    expect(r.s.fighters[0]!.item).toEqual({ kind: "sword", uses: ITEMS.sword.uses - 1 });
    s = r.s;
    // keep the target from being knocked out of reach
    for (let k = 2; k <= 5; k++) {
      s.fighters[1]!.x = s.fighters[0]!.x + 120; s.fighters[1]!.hitstun = 0; s.fighters[1]!.knockbackVx = 0; s.fighters[1]!.hp = 40;
      r = swing(s); s = r.s;
      expect(types(r.events, "ITEM_BREAK")).toHaveLength(0);
      expect(s.fighters[0]!.item).toEqual({ kind: "sword", uses: ITEMS.sword.uses - k });
    }
    // 6th swing: breaks
    s.fighters[1]!.x = s.fighters[0]!.x + 120; s.fighters[1]!.hitstun = 0; s.fighters[1]!.knockbackVx = 0; s.fighters[1]!.hp = 40;
    r = swing(s); s = r.s;
    expect(r.events).toContainEqual({ type: "ITEM_BREAK", player: 0, item: "sword" });
    expect(types(r.events, "HIT")[0]).toMatchObject({ damage: ARSENAL.SWORD_DAMAGE });
    expect(s.fighters[0]!.item).toBeNull();
    // 7th: a normal punch, misses at 120 px, no ITEM_USE
    s.fighters[1]!.x = s.fighters[0]!.x + 120; s.fighters[1]!.hitstun = 0; s.fighters[1]!.knockbackVx = 0; s.fighters[1]!.hp = 40;
    r = swing(s);
    expect(types(r.events, "PUNCH")).toHaveLength(1);
    expect(types(r.events, "ITEM_USE")).toHaveLength(0);
    expect(types(r.events, "HIT")).toHaveLength(0);
    expect(r.s.fighters[0]!.action === null || r.s.fighters[0]!.action.kind !== "punch" || !r.s.fighters[0]!.action.sword).toBe(true);
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
    expect(early.s.fighters[1]!.item).toEqual({ kind: "sword", uses: ITEMS.sword.uses });

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
        expect(s.fighters[1]!.item).toEqual({ kind: "shield", uses: 3 - n });
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
    expect(o.fighters[1]!.item).toEqual({ kind: "shield", uses: 3 });

    // applyDamage routes laser and hazard through the shield, never pit
    const d = equip(match(), 1, "shield");
    const ev: SimEvent[] = [];
    expect(applyDamage(d, 1, 10, "laser", 0, ev)).toEqual({ absorbed: true });
    expect(applyDamage(d, 1, 2, "hazard", null, ev)).toEqual({ absorbed: true });
    expect(d.fighters[1]!.hp).toBe(BALANCE.MAX_HP);
    expect(types(ev, "SHIELD_ABSORB").map((e) => (e as { left: number }).left)).toEqual([2, 1]);
    expect(applyDamage(d, 1, 8, "pit", null, ev)).toEqual({ absorbed: false });
    expect(d.fighters[1]!.hp).toBe(BALANCE.MAX_HP - 8);
    expect(d.fighters[1]!.item).toEqual({ kind: "shield", uses: 1 });
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
