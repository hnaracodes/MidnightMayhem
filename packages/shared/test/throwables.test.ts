import { describe, expect, it } from "vitest";
import {
  ARSENAL, BALANCE, EMPTY_FRAME, ITEMS, THROW, WORLD,
  type InputFrame, type ItemId, type MatchState, type SimEvent,
} from "../src";
import { createMatch, resetForRound } from "../src/sim/create";
import { step } from "../src/sim/step";
import { advanceProjectiles, chargeToRange, startThrow, throwVelocity, THROW_RELEASE_H } from "../src/sim/projectiles";
import { advanceHazards, hazardRect, spawnHazard } from "../src/sim/hazards";

const NONE: [InputFrame, InputFrame] = [EMPTY_FRAME, EMPTY_FRAME];
const P_L: InputFrame = { ...EMPTY_FRAME, punchL: true };
/** Ticks from the release (key up or CHARGE_MAX) until the action clears; combat.ts owns the clear. */
const THROW_TOTAL = THROW.RELEASE_TICKS + THROW.RECOVERY;
/** The hand lets go 20 px in front of the feet; ranges are measured from there. */
const HAND_X = 20;
const MEDIUM_RANGE = chargeToRange(THROW.VISION_CHARGE * THROW.CHARGE_MAX); // ≈ 484

function run(s: MatchState, n: number, inputs: [InputFrame, InputFrame] = NONE) {
  const events: SimEvent[] = [];
  for (let i = 0; i < n; i++) { const r = step(s, inputs); s = r.state; events.push(...r.events); }
  return { s, events };
}

/** Runs until the predicate matches an event, returning the 1-based tick index it happened on (or −1). */
function runUntil(s: MatchState, max: number, inputs: [InputFrame, InputFrame], pred: (e: SimEvent) => boolean) {
  const events: SimEvent[] = [];
  for (let i = 1; i <= max; i++) {
    const r = step(s, inputs); s = r.state; events.push(...r.events);
    if (r.events.some(pred)) return { s, events, tick: i };
  }
  return { s, events, tick: -1 };
}

function fighting(item: ItemId | null = "molotov", x0 = 280, x1 = 680): MatchState {
  const s = createMatch({ players: 2, teams: "ffa", mode: "deathmatch", map: "roof", items: true });
  s.phase = "FIGHTING";
  s.fighters[0]!.x = x0; s.fighters[1]!.x = x1;
  s.fighters[0]!.facing = x0 < x1 ? 1 : -1; s.fighters[1]!.facing = x1 < x0 ? 1 : -1;
  if (item) s.fighters[0]!.item = { kind: item, uses: ITEMS[item].uses };
  return s;
}

/** Holds punchL for `ticks` ticks (then lets go) and runs on with no input until `pred` fires. */
function holdThen(s: MatchState, ticks: number, pred: (e: SimEvent) => boolean, max = 300) {
  const held = run(s, ticks, [P_L, EMPTY_FRAME]);
  const r = runUntil(held.s, max, NONE, pred);
  return { s: r.s, events: [...held.events, ...r.events], tick: r.tick < 0 ? -1 : ticks + r.tick };
}

/** Taps punchL for one tick (a medium throw) and fights until the first hazard exists. */
function landed(item: "molotov" | "banana") {
  const r = holdThen(fighting(item), 1, (e) => e.type === "HAZARD_SPAWN");
  expect(r.tick).toBeGreaterThan(0);
  return { s: r.s, h: r.s.hazards[0]!, events: r.events };
}

/**
 * Distance from the hand's release point to the first hazard after holding punchL `ticks` ticks. Thrown from
 * x = 100 so a full-range landing (760) stays clear of the world-edge clamp.
 */
function landingDistance(ticks: number, item: "molotov" | "banana" = "molotov"): number {
  const r = holdThen(fighting(item, 100, 900), ticks, (e) => e.type === "HAZARD_SPAWN");
  expect(r.tick).toBeGreaterThan(0);
  return r.s.hazards[0]!.x - (100 + HAND_X);
}

/** Flies the sim's own integrator from the release point on flat ground; where it crosses the ground. */
function flightRange(range: number): number {
  const v = throwVelocity(range);
  let x = 0; let y = -THROW_RELEASE_H; let vy = v.vy;
  for (let t = 0; t < 1000; t++) {
    vy += BALANCE.GRAVITY; x += v.vx; y += vy;
    if (vy > 0 && y >= 0) return x;
  }
  throw new Error("never landed");
}

const hits = (events: SimEvent[], target?: number) =>
  events.filter((e) => e.type === "HAZARD_HIT" && (target === undefined || e.target === target));

describe("1. throw release (9.08 charged, aimed)", () => {
  it("a tap (held 1 tick) releases on the key up at VISION_CHARGE and spawns RELEASE_TICKS later from the hand", () => {
    const start = run(fighting(), 1, [P_L, EMPTY_FRAME]);
    expect(start.s.fighters[0]!.action).toEqual({ kind: "throw", item: "molotov", arm: "L", phase: "charge", charge: 1, elapsed: 0, released: false });
    expect(start.events.some((e) => e.type === "PUNCH")).toBe(false);
    const up = run(start.s, 1);
    expect(up.s.fighters[0]!.action).toMatchObject({ phase: "release", charge: THROW.VISION_CHARGE * THROW.CHARGE_MAX, elapsed: 0, released: false });
    const r = runUntil(up.s, 30, NONE, (e) => e.type === "PROJECTILE_SPAWN");
    expect(r.tick).toBe(THROW.RELEASE_TICKS);
    expect(r.events.find((e) => e.type === "PROJECTILE_SPAWN")).toMatchObject({ kind: "molotov", owner: 0 });
    const p = r.s.projectiles[0]!;
    const v = throwVelocity(MEDIUM_RANGE);
    // spawned at (x + 20, feet − 100) and already moved one tick in the facing direction (+x)
    expect(p.owner).toBe(0);
    expect(p.x).toBeCloseTo(280 + HAND_X + v.vx, 5);
    expect(p.y).toBeCloseTo(WORLD.ROOF_Y - THROW_RELEASE_H + v.vy + BALANCE.GRAVITY, 5);
    expect(p.vx).toBeCloseTo(v.vx, 5);
    expect(r.s.fighters[0]!.action).toMatchObject({ kind: "throw", item: "molotov", arm: "L", phase: "release", released: true });
    expect(r.events.filter((e) => e.type === "ITEM_USE")).toEqual([{ type: "ITEM_USE", player: 0, item: "molotov" }]);
    expect(r.s.fighters[0]!.item).toEqual({ kind: "molotov", uses: 1 });
  });
  it("rule 1: a tap lands ≈ 484 px (0.7 of the range) from the hand on roof", () => {
    const d = landingDistance(1);
    expect(d).toBeGreaterThanOrEqual(MEDIUM_RANGE - 15);
    expect(d).toBeLessThanOrEqual(MEDIUM_RANGE + 15);
    expect(MEDIUM_RANGE).toBeCloseTo(0.7 * (640 - 120) + 120, 5);
  });
  it("rule 2: held 45+ ticks lands 640 ± 15; held 22 ticks lands ≈ 374 ± 15", () => {
    const full = landingDistance(50);
    expect(full).toBeGreaterThanOrEqual(THROW.MAX_RANGE - 15);
    expect(full).toBeLessThanOrEqual(THROW.MAX_RANGE + 15);
    const half = landingDistance(22);
    expect(half).toBeGreaterThanOrEqual(chargeToRange(22) - 15);
    expect(half).toBeLessThanOrEqual(chargeToRange(22) + 15);
    expect(chargeToRange(22)).toBeCloseTo(374.2, 0);
  });
  it("rule 3: holding past CHARGE_MAX auto-releases at CHARGE_MAX", () => {
    const held = run(fighting(), THROW.CHARGE_MAX - 1, [P_L, EMPTY_FRAME]);
    expect(held.s.fighters[0]!.action).toMatchObject({ phase: "charge", charge: THROW.CHARGE_MAX - 1 });
    const max = run(held.s, 1, [P_L, EMPTY_FRAME]);
    expect(max.s.fighters[0]!.action).toMatchObject({ phase: "release", charge: THROW.CHARGE_MAX, elapsed: 0 });
    const r = runUntil(max.s, 30, [P_L, EMPTY_FRAME], (e) => e.type === "PROJECTILE_SPAWN");
    expect(r.tick).toBe(THROW.RELEASE_TICKS);
    const v = throwVelocity(THROW.MAX_RANGE);
    expect(r.s.projectiles[0]!.vx).toBeCloseTo(v.vx, 5);
    // still held after the recovery: no new throw without a fresh edge
    const after = run(r.s, THROW_TOTAL, [P_L, EMPTY_FRAME]);
    expect(after.s.fighters[0]!.action).toBeNull();
    expect(after.s.projectiles.length + after.s.hazards.length).toBe(1);
  });
  it("a charge released on the 2nd tick is still a tap; on the 3rd it is its own charge", () => {
    const two = run(run(fighting(), 2, [P_L, EMPTY_FRAME]).s, 1);
    expect(two.s.fighters[0]!.action).toMatchObject({ phase: "release", charge: THROW.VISION_CHARGE * THROW.CHARGE_MAX });
    const three = run(run(fighting(), 3, [P_L, EMPTY_FRAME]).s, 1);
    expect(three.s.fighters[0]!.action).toMatchObject({ phase: "release", charge: 3 });
  });
  it("facing left throws left", () => {
    const s = fighting("molotov", 680, 280);
    const r = holdThen(s, 1, (e) => e.type === "PROJECTILE_SPAWN");
    expect(r.s.projectiles[0]!.vx).toBeLessThan(0);
    expect(r.s.projectiles[0]!.x).toBeLessThan(680);
    expect(r.s.hazards).toHaveLength(0);
    const land = runUntil(r.s, 200, NONE, (e) => e.type === "HAZARD_SPAWN");
    expect(680 - HAND_X - land.s.hazards[0]!.x).toBeGreaterThanOrEqual(MEDIUM_RANGE - 15);
  });
  it("startThrow refuses a non-throwable or empty hand", () => {
    const s = fighting("sword");
    expect(startThrow(s, 0, "L", [])).toBe(false);
    expect(s.fighters[0]!.action).toBeNull();
    s.fighters[0]!.item = null;
    expect(startThrow(s, 0, "L", [])).toBe(false);
    s.fighters[0]!.item = { kind: "banana", uses: 1 };
    expect(startThrow(s, 0, "R", [])).toBe(true);
    expect(s.fighters[0]!.action).toEqual({ kind: "throw", item: "banana", arm: "R", phase: "charge", charge: 0, elapsed: 0, released: false });
  });
  it("the right punch key charges the R arm and its own key releases it", () => {
    const P_R: InputFrame = { ...EMPTY_FRAME, punchR: true };
    const s = run(fighting(), 5, [P_R, EMPTY_FRAME]);
    expect(s.s.fighters[0]!.action).toMatchObject({ arm: "R", phase: "charge", charge: 5 });
    // the other key going down does not release it
    const other = run(s.s, 2, [{ ...EMPTY_FRAME, punchR: true, punchL: true }, EMPTY_FRAME]);
    expect(other.s.fighters[0]!.action).toMatchObject({ arm: "R", phase: "charge", charge: 7 });
    const up = run(other.s, 1, [P_L, EMPTY_FRAME]);
    expect(up.s.fighters[0]!.action).toMatchObject({ arm: "R", phase: "release", charge: 7 });
  });
});

describe("throwVelocity / chargeToRange", () => {
  it.each([120, 380, 640])("lands within ±10 px of %i on the sim integrator", (range) => {
    expect(Math.abs(flightRange(range) - range)).toBeLessThanOrEqual(10);
  });
  it("launches at ANGLE_DEG: vx and the rise speed are equal at 45°", () => {
    const v = throwVelocity(400);
    expect(v.vx).toBeGreaterThan(0);
    expect(v.vy).toBeLessThan(0);
    expect(-v.vy - BALANCE.GRAVITY / 2).toBeCloseTo(v.vx * Math.tan((THROW.ANGLE_DEG * Math.PI) / 180), 6);
  });
  it("chargeToRange is linear MIN → MAX over 0 → CHARGE_MAX and clamps", () => {
    expect(chargeToRange(0)).toBe(THROW.MIN_RANGE);
    expect(chargeToRange(THROW.CHARGE_MAX)).toBe(THROW.MAX_RANGE);
    expect(chargeToRange(THROW.CHARGE_MAX / 2)).toBeCloseTo((THROW.MIN_RANGE + THROW.MAX_RANGE) / 2, 6);
    expect(chargeToRange(-5)).toBe(THROW.MIN_RANGE);
    expect(chargeToRange(999)).toBe(THROW.MAX_RANGE);
  });
});

describe("2. molotov flight and landing", () => {
  it("lands on the roof in front of the thrower and becomes a 240-tick fire", () => {
    const { s, h, events } = landed("molotov");
    expect(s.projectiles).toHaveLength(0);
    expect(h).toMatchObject({ kind: "fire", owner: 0, y: WORLD.ROOF_Y, w: ARSENAL.FIRE_W, ticks: ARSENAL.FIRE_TICKS - 1, age: 1 }); // aged once on the landing tick
    // 9.08 rule 1 replaces the 9.02 "70–130 px" lob: a tap is the medium throw, ≈ 484 px from the hand.
    const dist = h.x - (280 + HAND_X);
    expect(dist).toBeGreaterThanOrEqual(MEDIUM_RANGE - 15);
    expect(dist).toBeLessThanOrEqual(MEDIUM_RANGE + 15);
    expect(events.find((e) => e.type === "HAZARD_SPAWN")).toEqual({ type: "HAZARD_SPAWN", id: h.id, kind: "fire", x: h.x });
  });
  it("follows the arc: gravity each tick, x by vx", () => {
    const s = fighting();
    s.projectiles.push({ id: s.nextId++, kind: "molotov", owner: 0, x: 300, y: 330, vx: 6, vy: -7 });
    const ev: SimEvent[] = [];
    advanceProjectiles(s, ev);
    expect(s.projectiles[0]).toMatchObject({ x: 306, vy: -7 + BALANCE.GRAVITY, y: 330 - 7 + BALANCE.GRAVITY });
  });
});

describe("3. fire damage", () => {
  it("2 damage at ages 20, 40, … to anyone grounded in it (owner too); 24 hp over the full burn", () => {
    const { s: s0, h } = landed("molotov");
    const s = structuredClone(s0);
    s.fighters[0]!.x = h.x - 20; s.fighters[1]!.x = h.x + 20;
    s.fighters[0]!.action = null;
    const { s: end, events } = run(s, ARSENAL.FIRE_TICKS);
    const h0 = hits(events, 0); const h1 = hits(events, 1);
    expect(h0).toHaveLength(12); expect(h1).toHaveLength(12);
    expect(h0[0]).toEqual({ type: "HAZARD_HIT", id: h.id, kind: "fire", target: 0, damage: ARSENAL.FIRE_DAMAGE });
    expect(end.fighters[0]!.hp).toBe(BALANCE.MAX_HP - 24);
    expect(end.fighters[1]!.hp).toBe(BALANCE.MAX_HP - 24);
    expect(end.fighters[0]!.hitstun).toBe(0);
    expect(end.hazards).toHaveLength(0);
  });
  it("damage ticks land exactly at age 20 and 40", () => {
    const { s: s0, h } = landed("molotov");
    const s = structuredClone(s0);
    s.fighters[1]!.x = h.x; s.fighters[0]!.x = 100;
    let cur = s; const at: number[] = [];
    for (let t = 1; t <= 45; t++) { const r = step(cur, NONE); cur = r.state; if (hits(r.events, 1).length) at.push(t); }
    expect(at).toEqual([ARSENAL.FIRE_EVERY - 1, 2 * ARSENAL.FIRE_EVERY - 1]); // the hazard is already age 1 after landing
  });
  it("a fighter one jump above it takes none", () => {
    const { s: s0, h } = landed("molotov");
    const s = structuredClone(s0);
    s.fighters[1]!.x = h.x; s.fighters[0]!.x = 100;
    let cur = run(s, 10).s;
    const events: SimEvent[] = [];
    for (let t = 0; t < 40; t++) {
      const r = step(cur, [EMPTY_FRAME, { ...EMPTY_FRAME, jump: t === 0 }]); cur = r.state; events.push(...r.events);
    }
    expect(events.some((e) => e.type === "JUMP")).toBe(true);
    expect(cur.fighters[1]!.grounded).toBe(false);
    expect(hits(events, 1)).toHaveLength(0);
    expect(cur.fighters[1]!.hp).toBe(BALANCE.MAX_HP);
  });
  it("burns every grounded fighter in a four-player match, not just the first two", () => {
    const s = createMatch({ players: 4, teams: "ffa", mode: "deathmatch", map: "roof", items: true });
    s.phase = "FIGHTING";
    spawnHazard(s, "fire", 3, 480, WORLD.ROOF_Y, []);
    for (const f of s.fighters) f.x = 480;
    const ev: SimEvent[] = [];
    for (let t = 0; t < ARSENAL.FIRE_EVERY; t++) advanceHazards(s, ev);
    expect(hits(ev).map((e) => (e as { target: number }).target)).toEqual([0, 1, 2, 3]);
    expect(s.fighters.map((f) => f.hp)).toEqual([1, 1, 1, 1].map(() => BALANCE.MAX_HP - ARSENAL.FIRE_DAMAGE));
  });
  it("a fighter outside the patch takes none", () => {
    const { s: s0, h } = landed("molotov");
    const s = structuredClone(s0);
    s.fighters[1]!.x = h.x + ARSENAL.FIRE_W / 2 + WORLD.HURTBOX_W / 2 + 1; s.fighters[0]!.x = 100;
    expect(hits(run(s, 60).events, 1)).toHaveLength(0);
  });
  it("fire on a cargo rack burns the fighter standing on the rack, not the one on the roof beneath it", () => {
    const s = createMatch({ players: 2, teams: "ffa", mode: "deathmatch", map: "platforms", items: true });
    s.phase = "FIGHTING";
    const rackY = 330;
    spawnHazard(s, "fire", 1, 240, rackY, []);
    s.fighters[0]!.x = 240; s.fighters[0]!.y = WORLD.ROOF_Y;
    s.fighters[1]!.x = 240; s.fighters[1]!.y = rackY;
    const { s: end, events } = run(s, 60);
    expect(hits(events, 0)).toHaveLength(0);
    expect(end.fighters[0]!.hp).toBe(BALANCE.MAX_HP);
    expect(hits(events, 1)).toHaveLength(3);
    expect(end.fighters[1]!.hp).toBe(BALANCE.MAX_HP - 3 * ARSENAL.FIRE_DAMAGE);
  });
  it("a peel on a rack does not slip a walker on the roof beneath it", () => {
    const s = createMatch({ players: 2, teams: "ffa", mode: "deathmatch", map: "platforms", items: true });
    s.phase = "FIGHTING";
    spawnHazard(s, "peel", 1, 240, 330, []);
    s.hazards[0]!.age = ARSENAL.PEEL_OWNER_IMMUNE + 1;
    s.fighters[0]!.x = 200; s.fighters[0]!.y = WORLD.ROOF_Y; s.fighters[1]!.x = 800;
    const { s: end, events } = run(s, 30, [{ ...EMPTY_FRAME, right: true }, EMPTY_FRAME]);
    expect(hits(events, 0)).toHaveLength(0);
    expect(end.fighters[0]!.hitstun).toBe(0);
    expect(end.hazards).toHaveLength(1);
  });
  it("a shield absorbs the first three fire ticks (HAZARD_HIT damage 0), breaks, then hp goes down", () => {
    const s = createMatch({ players: 2, teams: "ffa", mode: "deathmatch", map: "roof", items: true });
    s.phase = "FIGHTING";
    spawnHazard(s, "fire", 0, 480, WORLD.ROOF_Y, []);
    s.fighters[1]!.x = 480; s.fighters[1]!.item = { kind: "shield", uses: 3 }; s.fighters[0]!.x = 100;
    const { s: mid, events } = run(s, 3 * ARSENAL.FIRE_EVERY);
    expect(events.filter((e) => e.type === "SHIELD_ABSORB")).toHaveLength(3);
    expect(events.filter((e) => e.type === "ITEM_BREAK")).toHaveLength(1);
    expect(hits(events, 1).map((e) => (e as { damage: number }).damage)).toEqual([0, 0, 0]);
    expect(mid.fighters[1]!.hp).toBe(BALANCE.MAX_HP);
    expect(mid.fighters[1]!.item).toBeNull();
    const after = run(mid, ARSENAL.FIRE_EVERY);
    expect(hits(after.events, 1).map((e) => (e as { damage: number }).damage)).toEqual([ARSENAL.FIRE_DAMAGE]);
    expect(after.s.fighters[1]!.hp).toBe(BALANCE.MAX_HP - ARSENAL.FIRE_DAMAGE);
  });
});

describe("4. uses", () => {
  it("second molotov breaks the item; a third punch is a normal punch", () => {
    let s = fighting();
    const first = holdThen(s, 1, (e) => e.type === "PROJECTILE_SPAWN");
    s = run(first.s, THROW_TOTAL).s;
    expect(s.fighters[0]!.action).toBeNull();
    const second = holdThen(s, 1, (e) => e.type === "PROJECTILE_SPAWN");
    expect(second.tick).toBe(1 + 1 + THROW.RELEASE_TICKS); // tap tick, key-up tick (release), RELEASE_TICKS
    expect(second.events.filter((e) => e.type === "ITEM_BREAK")).toEqual([{ type: "ITEM_BREAK", player: 0, item: "molotov" }]);
    expect(second.s.fighters[0]!.item).toBeNull();
    s = run(second.s, THROW_TOTAL).s;
    const third = run(s, 3, [P_L, EMPTY_FRAME]);
    expect(third.events.some((e) => e.type === "PUNCH")).toBe(true);
    expect(third.s.fighters[0]!.action).toMatchObject({ kind: "punch" });
    expect(third.events.some((e) => e.type === "PROJECTILE_SPAWN" || e.type === "ITEM_USE")).toBe(false);
  });
});

describe("5. banana peel", () => {
  it("lands in front, persists 900 ticks, one use", () => {
    const { s, h, events } = landed("banana");
    expect(h).toMatchObject({ kind: "peel", owner: 0, y: WORLD.ROOF_Y, w: ARSENAL.PEEL_W, ticks: ARSENAL.PEEL_TICKS - 1, age: 1 });
    expect(h.x).toBeGreaterThan(280);
    expect(events.filter((e) => e.type === "ITEM_BREAK")).toHaveLength(1);
    expect(s.fighters[0]!.item).toBeNull();
    const far = structuredClone(s); far.fighters[0]!.x = 100; far.fighters[1]!.x = 900;
    expect(run(far, ARSENAL.PEEL_TICKS - 2).s.hazards).toHaveLength(1);
    expect(run(far, ARSENAL.PEEL_TICKS - 1).s.hazards).toHaveLength(0); // age 1 after landing, gone at age 900
  });
  it("rule 5: the banana uses the same charge (a full hold lands 640 ± 15, a tap ≈ 484)", () => {
    const full = landingDistance(50, "banana");
    expect(Math.abs(full - THROW.MAX_RANGE)).toBeLessThanOrEqual(15);
    const tap = landingDistance(1, "banana");
    expect(Math.abs(tap - MEDIUM_RANGE)).toBeLessThanOrEqual(15);
  });
  it("standing on it is safe; walking onto it slips (hitstun 36, damage 0, peel removed)", () => {
    const { s: s0, h } = landed("banana");
    const s = structuredClone(s0);
    s.fighters[0]!.x = 100; s.fighters[1]!.x = h.x;
    const still = run(s, 40);
    expect(hits(still.events)).toHaveLength(0);
    expect(still.s.hazards).toHaveLength(1);
    const walk = runUntil(still.s, 10, [EMPTY_FRAME, { ...EMPTY_FRAME, left: true }], (e) => e.type === "HAZARD_HIT");
    expect(walk.tick).toBe(1);
    expect(walk.events.find((e) => e.type === "HAZARD_HIT")).toEqual({ type: "HAZARD_HIT", id: h.id, kind: "peel", target: 1, damage: 0 });
    expect(walk.s.fighters[1]!.hitstun).toBe(ARSENAL.SLIP_STUN);
    expect(walk.s.fighters[1]!.vx).toBe(0);
    expect(walk.s.fighters[1]!.knockbackVx).toBe(0);
    expect(walk.s.fighters[1]!.hp).toBe(BALANCE.MAX_HP);
    expect(walk.s.hazards).toHaveLength(0);
    // no knockback during the slip
    const x = walk.s.fighters[1]!.x;
    const after = run(walk.s, ARSENAL.SLIP_STUN, [EMPTY_FRAME, { ...EMPTY_FRAME, left: true }]);
    expect(after.s.fighters[1]!.hitstun).toBe(0);
    expect(after.s.fighters[1]!.x).toBe(x);
  });
  it("the owner walking through it within 30 ticks of the spawn is safe, afterwards slips", () => {
    const { s: s0, h } = landed("banana");
    const s = structuredClone(s0);
    s.fighters[0]!.x = h.x; s.fighters[0]!.action = null; s.fighters[1]!.x = 900;
    // ages 2..30: owner walks on the spot (tiny oscillation keeps him over the peel)
    let cur = s; const early: SimEvent[] = [];
    for (let t = 0; t < ARSENAL.PEEL_OWNER_IMMUNE - 1; t++) {
      const r = step(cur, [{ ...EMPTY_FRAME, left: t % 2 === 0, right: t % 2 === 1 }, EMPTY_FRAME]);
      cur = r.state; early.push(...r.events);
    }
    expect(cur.hazards[0]!.age).toBe(ARSENAL.PEEL_OWNER_IMMUNE);
    expect(hits(early)).toHaveLength(0);
    const late = runUntil(cur, 3, [{ ...EMPTY_FRAME, right: true }, EMPTY_FRAME], (e) => e.type === "HAZARD_HIT");
    expect(late.tick).toBe(1);
    expect(late.s.fighters[0]!.hitstun).toBe(ARSENAL.SLIP_STUN);
    expect(late.s.hazards).toHaveLength(0);
  });
  it("a fighter in hitstun does not slip", () => {
    const { s: s0, h } = landed("banana");
    const s = structuredClone(s0);
    s.fighters[0]!.x = 100; s.fighters[1]!.x = h.x - 30;
    s.fighters[1]!.hitstun = 10; s.fighters[1]!.knockbackVx = 3;
    const r = run(s, 5);
    expect(hits(r.events)).toHaveLength(0);
    expect(r.s.hazards).toHaveLength(1);
  });
});

describe("6. off-world and pits", () => {
  it("a projectile leaving the world spawns no hazard", () => {
    const s = fighting("molotov", 940, 100);
    s.fighters[0]!.facing = 1;
    s.projectiles.push({ id: s.nextId++, kind: "molotov", owner: 0, x: 958, y: 330, vx: 6, vy: -7 });
    const r = run(s, 5);
    expect(r.s.projectiles).toHaveLength(0);
    expect(r.s.hazards).toHaveLength(0);
    expect(r.events.some((e) => e.type === "HAZARD_SPAWN")).toBe(false);
  });
  it("a hazard landing near the edge is clamped inside the world", () => {
    const s = fighting("molotov", 100, 900);
    s.projectiles.push({ id: s.nextId++, kind: "molotov", owner: 0, x: 930, y: WORLD.ROOF_Y - 1, vx: 3, vy: 5 });
    const ev: SimEvent[] = [];
    advanceProjectiles(s, ev);
    expect(s.hazards[0]!.x).toBe(WORLD.WIDTH - ARSENAL.FIRE_W / 2);
    const left = fighting("molotov", 100, 900);
    left.projectiles.push({ id: left.nextId++, kind: "banana", owner: 0, x: 5, y: WORLD.ROOF_Y - 1, vx: -3, vy: 5 });
    advanceProjectiles(left, ev);
    expect(left.hazards[0]!.x).toBe(ARSENAL.PEEL_W / 2);
  });
  it("a projectile never rises above the ceiling (y clamped at 0)", () => {
    const s = fighting("molotov", 100, 900);
    s.projectiles.push({ id: s.nextId++, kind: "molotov", owner: 0, x: 300, y: 4, vx: 1, vy: -9 });
    const ev: SimEvent[] = [];
    advanceProjectiles(s, ev);
    expect(s.projectiles[0]!.y).toBe(0);
    expect(s.projectiles[0]!.x).toBe(301);
  });
  it("with map gaps, a landing x inside a gap spawns no hazard", () => {
    // gaps map: ground breaks at 300–380 and 580–660. A projectile dropped straight into the first gap falls
    // past the roof line, reaches PIT.Y and vanishes; one dropped beside it on ground still lands.
    const inGap = fighting("molotov", 100, 900);
    inGap.config.map = "gaps";
    inGap.projectiles.push({ id: inGap.nextId++, kind: "molotov", owner: 0, x: 340, y: WORLD.ROOF_Y - 1, vx: 0, vy: 5 });
    const r = run(inGap, 60);
    expect(r.s.projectiles).toHaveLength(0);
    expect(r.s.hazards).toHaveLength(0);
    expect(r.events.some((e) => e.type === "HAZARD_SPAWN")).toBe(false);
    const onGround = fighting("molotov", 100, 900);
    onGround.config.map = "gaps";
    onGround.projectiles.push({ id: onGround.nextId++, kind: "molotov", owner: 0, x: 450, y: WORLD.ROOF_Y - 1, vx: 0, vy: 5 });
    const g = run(onGround, 2);
    expect(g.s.hazards).toHaveLength(1);
    expect(g.s.hazards[0]!.x).toBe(450);
  });
});

describe("7. throw locks", () => {
  it("rule 4: no walk, jump or block while charging; nor through the release and recovery; then free", () => {
    // The edge tick must not hold block: a block held on the punch edge suppresses the punch entirely (the
    // fighter just blocks), which would make every lock assertion below pass without any throw existing.
    const start = run(fighting(), 1, [P_L, EMPTY_FRAME]);
    expect(start.s.fighters[0]!.action).toMatchObject({ kind: "throw", phase: "charge", charge: 1 });
    // 10 ticks of charge with walk, jump, block and the other punch all held: nothing moves
    const held: [InputFrame, InputFrame] = [{ ...EMPTY_FRAME, punchL: true, punchR: true, right: true, jump: true, block: true }, EMPTY_FRAME];
    const c = run(start.s, 10, held);
    expect(c.events.some((e) => e.type === "PUNCH" || e.type === "JUMP")).toBe(false);
    expect(c.s.fighters[0]!.x).toBe(280);
    expect(c.s.fighters[0]!.grounded).toBe(true);
    expect(c.s.fighters[0]!.blocking).toBe(false);
    expect(c.s.fighters[0]!.action).toMatchObject({ kind: "throw", phase: "charge", charge: 11, elapsed: 0 });
    // key up: release; the same locks hold through release and recovery
    const rel: [InputFrame, InputFrame] = [{ ...EMPTY_FRAME, punchR: true, right: true, jump: true, block: true }, EMPTY_FRAME];
    const r = run(c.s, THROW_TOTAL, rel);
    expect(r.events.some((e) => e.type === "PUNCH" || e.type === "JUMP")).toBe(false);
    expect(r.events.some((e) => e.type === "PROJECTILE_SPAWN")).toBe(true);
    expect(r.s.fighters[0]!.x).toBe(280);
    expect(r.s.fighters[0]!.blocking).toBe(false);
    expect(r.s.fighters[0]!.action).toMatchObject({ kind: "throw", phase: "release", elapsed: THROW_TOTAL - 1, released: true });
    // the action clears before input is read, so the fighter walks that same tick
    const free = run(r.s, 5, [{ ...EMPTY_FRAME, right: true }, EMPTY_FRAME]);
    expect(free.s.fighters[0]!.action).toBeNull();
    expect(free.s.fighters[0]!.x).toBe(280 + 5 * BALANCE.WALK_SPEED);
  });
  it("a punch during the throw is not blocked even with block held", () => {
    const s = fighting("molotov", 460, 400);
    s.fighters[0]!.action = { kind: "throw", item: "molotov", arm: "L", phase: "charge", charge: 2, elapsed: 0, released: false };
    const r = run(s, BALANCE.PUNCH_STARTUP + 1, [{ ...EMPTY_FRAME, block: true }, P_L]);
    expect(r.events.find((e) => e.type === "HIT")).toMatchObject({ attacker: 1, target: 0, blocked: false });
  });
});

describe("8. hit during the charge or release", () => {
  it("rule 4: a hit mid-charge cancels the throw, the use is not spent, the item stays", () => {
    const s = fighting("molotov", 460, 400);
    s.fighters[1]!.action = { kind: "punch", arm: "L", elapsed: 0, landed: false, sword: false };
    const r = run(s, 30, [P_L, EMPTY_FRAME]);
    expect(r.events.find((e) => e.type === "HIT")).toMatchObject({ attacker: 1, target: 0, blocked: false });
    expect(r.events.some((e) => e.type === "PROJECTILE_SPAWN")).toBe(false);
    expect(r.events.some((e) => e.type === "ITEM_USE")).toBe(false);
    expect(r.s.projectiles).toHaveLength(0);
    expect(r.s.fighters[0]!.item).toEqual({ kind: "molotov", uses: ITEMS.molotov.uses });
    expect(r.s.fighters[0]!.action).toBeNull();
    // a fresh edge after the hitstun charges again
    const again = run(run(r.s, 1).s, 3, [P_L, EMPTY_FRAME]);
    expect(again.s.fighters[0]!.action).toMatchObject({ kind: "throw", phase: "charge" });
  });
  it("a hit in the release startup loses the throw and does not spend the use", () => {
    const s = fighting("molotov", 460, 400);
    s.fighters[1]!.action = { kind: "punch", arm: "L", elapsed: 2, landed: false, sword: false };
    s.fighters[0]!.action = { kind: "throw", item: "molotov", arm: "L", phase: "release", charge: 10, elapsed: 0, released: false };
    const r = run(s, 30);
    expect(r.events.find((e) => e.type === "HIT")).toMatchObject({ attacker: 1, target: 0, blocked: false });
    expect(r.events.some((e) => e.type === "PROJECTILE_SPAWN")).toBe(false);
    expect(r.events.some((e) => e.type === "ITEM_USE")).toBe(false);
    expect(r.s.projectiles).toHaveLength(0);
    expect(r.s.fighters[0]!.item).toEqual({ kind: "molotov", uses: ITEMS.molotov.uses });
    expect(r.s.fighters[0]!.action).toBeNull();
  });
});

describe("invariants", () => {
  it("ids only grow and never collide", () => {
    let s = fighting();
    const a = holdThen(s, 1, (e) => e.type === "HAZARD_SPAWN");
    s = run(a.s, THROW_TOTAL).s;
    s.fighters[0]!.x = 100; s.fighters[1]!.x = 900;
    const b = holdThen(s, 1, (e) => e.type === "HAZARD_SPAWN");
    const ids = b.events.flatMap((e) => (e.type === "PROJECTILE_SPAWN" || e.type === "HAZARD_SPAWN" ? [e.id] : []));
    const all = [...a.events.flatMap((e) => (e.type === "PROJECTILE_SPAWN" || e.type === "HAZARD_SPAWN" ? [e.id] : [])), ...ids];
    expect(all).toHaveLength(4);
    expect(new Set(all).size).toBe(4);
    for (let i = 1; i < all.length; i++) expect(all[i]!).toBeGreaterThan(all[i - 1]!);
    expect(b.s.nextId).toBeGreaterThan(Math.max(...all));
    expect(b.s.hazards.map((h) => h.id)).toEqual(all.filter((_, i) => i % 2 === 1));
  });
  it("resetForRound clears projectiles and hazards", () => {
    const s = fighting();
    s.projectiles.push({ id: s.nextId++, kind: "molotov", owner: 0, x: 300, y: 330, vx: 6, vy: -7 });
    spawnHazard(s, "peel", 1, 500, WORLD.ROOF_Y, []);
    resetForRound(s, 2);
    expect(s.projectiles).toEqual([]);
    expect(s.hazards).toEqual([]);
  });
  it("hazardRect is 20 px tall on the surface, centred on x", () => {
    const s = fighting();
    spawnHazard(s, "fire", 0, 500, WORLD.ROOF_Y, []);
    expect(hazardRect(s.hazards[0]!)).toEqual({ x: 500 - ARSENAL.FIRE_W / 2, y: WORLD.ROOF_Y - 20, w: ARSENAL.FIRE_W, h: 20 });
  });
  it("advanceHazards ages and expires", () => {
    const s = fighting(); const ev: SimEvent[] = [];
    spawnHazard(s, "peel", 0, 500, WORLD.ROOF_Y, ev);
    expect(ev).toEqual([{ type: "HAZARD_SPAWN", id: s.hazards[0]!.id, kind: "peel", x: 500 }]);
    s.hazards[0]!.ticks = 2;
    advanceHazards(s, ev); expect(s.hazards[0]).toMatchObject({ age: 1, ticks: 1 });
    advanceHazards(s, ev); expect(s.hazards).toHaveLength(0);
  });
});
