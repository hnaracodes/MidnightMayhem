import { describe, expect, it } from "vitest";
import {
  BALANCE, EMPTY_FRAME, MAPS, MAP_IDS, MATCH, PIT, WORLD,
  type InputFrame, type MapId, type MatchState, type SimEvent,
} from "../src";
import { createMatch } from "../src/sim/create";
import { groundYAt, nearestGroundEdgeX, onGround, platformAt, surfaceBelow } from "../src/sim/maps";
import { step } from "../src/sim/step";

const RIGHT: InputFrame = { ...EMPTY_FRAME, right: true };
const JUMP: InputFrame = { ...EMPTY_FRAME, jump: true };
const JUMP_RIGHT: InputFrame = { ...EMPTY_FRAME, jump: true, right: true };
const PUNCH: InputFrame = { ...EMPTY_FRAME, punchL: true };

function fightingOn(map: MapId, players: 2 | 3 | 4 = 2): MatchState {
  const s = createMatch({ players, teams: "ffa", mode: "rounds", map, items: true });
  s.phase = "FIGHTING"; s.roundTicks = MATCH.ROUND_TICKS;
  return s;
}

function run(s: MatchState, n: number, p0: InputFrame = EMPTY_FRAME, p1: InputFrame = EMPTY_FRAME) {
  const events: SimEvent[] = [];
  for (let i = 0; i < n; i++) { const r = step(s, [p0, p1]); s = r.state; events.push(...r.events); }
  return { s, events };
}

/** Steps with `p0` until `stop(state)` holds or `max` ticks pass. */
function runUntil(s: MatchState, stop: (s: MatchState) => boolean, p0: InputFrame = EMPTY_FRAME, max = 600) {
  const events: SimEvent[] = [];
  let ticks = 0;
  while (!stop(s) && ticks < max) { const r = step(s, [p0, EMPTY_FRAME]); s = r.state; events.push(...r.events); ticks++; }
  return { s, events, ticks };
}

const f0 = (s: MatchState) => s.fighters[0]!;
const ofType = (events: SimEvent[], type: SimEvent["type"]) => events.filter((e) => e.type === type);

describe("maps geometry helpers", () => {
  it("onGround is inclusive of segment ends", () => {
    expect(onGround("gaps", 300)).toBe(true);
    expect(onGround("gaps", 301)).toBe(false);
    expect(onGround("gaps", 379)).toBe(false);
    expect(onGround("gaps", 380)).toBe(true);
    expect(onGround("roof", 0)).toBe(true);
    expect(onGround("roof", 960)).toBe(true);
  });
  it("platformAt matches span and feet y within ±0.5", () => {
    expect(platformAt("platforms", 240, 330)).toBe(0);
    expect(platformAt("platforms", 240, 330.4)).toBe(0);
    expect(platformAt("platforms", 240, 331)).toBeNull();
    expect(platformAt("platforms", 700, 330)).toBe(1);
    expect(platformAt("platforms", 500, 330)).toBeNull();
    expect(platformAt("roof", 240, 330)).toBeNull();
  });
  it("groundYAt picks the highest surface at or below the feet, else the pit", () => {
    expect(groundYAt("roof", 500, 100)).toBe(WORLD.ROOF_Y);
    expect(groundYAt("platforms", 240, 100)).toBe(330);
    expect(groundYAt("platforms", 240, 330)).toBe(330);
    expect(groundYAt("platforms", 240, 331)).toBe(WORLD.ROOF_Y);
    expect(groundYAt("platforms", 500, 100)).toBe(WORLD.ROOF_Y);
    expect(groundYAt("gaps", 340, 100)).toBe(PIT.Y);
    expect(groundYAt("chaos", 340, 100)).toBe(PIT.Y);
    expect(groundYAt("chaos", 240, 100)).toBe(330);
    expect(groundYAt("chaos", 240, 400)).toBe(WORLD.ROOF_Y);
  });
  it("surfaceBelow includes a platform level with the feet and excludes one above", () => {
    expect(surfaceBelow("platforms", 240, 330)).toBe(330);
    expect(surfaceBelow("platforms", 240, 329)).toBe(330);
    expect(surfaceBelow("platforms", 240, 331)).toBe(WORLD.ROOF_Y);
    expect(surfaceBelow("gaps", 340, 431)).toBe(PIT.Y);
  });
  it("nearestGroundEdgeX moves the respawn inward from the nearest edge", () => {
    expect(nearestGroundEdgeX("gaps", 303)).toBe(300 - PIT.RESPAWN_INSET);
    expect(nearestGroundEdgeX("gaps", 375)).toBe(380 + PIT.RESPAWN_INSET);
    expect(nearestGroundEdgeX("gaps", 600)).toBe(580 - PIT.RESPAWN_INSET);
    expect(nearestGroundEdgeX("gaps", 650)).toBe(660 + PIT.RESPAWN_INSET);
  });
});

describe("rule 1: roof is unchanged", () => {
  it("groundYAt is always ROOF_Y on roof", () => {
    for (let x = 0; x <= WORLD.WIDTH; x += 20) for (let y = 0; y <= WORLD.ROOF_Y; y += 50) expect(groundYAt("roof", x, y)).toBe(WORLD.ROOF_Y);
  });
  it("a scripted match on roof never pits, lands once per jump and keeps feet on the roof", () => {
    let s = createMatch();
    const events: SimEvent[] = [];
    // Round 1 fights from tick 181 to 1980; 1500 scripted ticks then 80 idle so every jump has landed.
    for (let t = 0; t < 1580; t++) {
      const scripted = t < 1500;
      const r = step(s, [
        { ...EMPTY_FRAME, right: scripted && t % 7 < 4, jump: scripted && t % 50 === 0 },
        { ...EMPTY_FRAME, left: scripted && t % 5 < 2, block: scripted && t % 11 < 5, jump: scripted && t % 70 === 0 },
      ]);
      s = r.state; events.push(...r.events);
      for (const f of s.fighters) {
        if (f.grounded) expect(f.y).toBe(WORLD.ROOF_Y);
        expect(f.y).toBeGreaterThanOrEqual(0);
        expect(f.onPlatform).toBeNull();
      }
    }
    expect(ofType(events, "PIT_FALL")).toHaveLength(0);
    expect(ofType(events, "PIT_RESPAWN")).toHaveLength(0);
    expect(ofType(events, "LAND").length).toBe(ofType(events, "JUMP").length);
  });
});

/** Walk right from 280 on a gap map until the edge gives way, then let go. */
function fallIntoGap(map: MapId) {
  const start = fightingOn(map);
  expect(f0(start).x).toBe(280);
  const walk = runUntil(start, (s) => !f0(s).grounded, RIGHT);
  expect(f0(walk.s).x).toBe(301);
  expect(f0(walk.s).vy).toBe(BALANCE.GRAVITY); // gravity applies on the tick the edge gives way
  expect(f0(walk.s).jumpTicks).toBe(1);
  const fall = runUntil(walk.s, (s) => f0(s).pitTicks > 0);
  return { walk, fall };
}

for (const map of ["gaps", "chaos"] as const) {
  describe(`rule 2 (${map}): walking off an edge falls into the pit and respawns`, () => {
    it("falls at x > 300, hits PIT.Y, takes 8, then respawns 40 ticks later at 260 with invuln 30", () => {
      const { fall } = fallIntoGap(map);
      expect(fall.ticks).toBeLessThan(100);
      const f = f0(fall.s);
      expect(f.y).toBe(PIT.Y);
      expect(f.hp).toBe(BALANCE.MAX_HP - PIT.DAMAGE);
      expect(f.pitTicks).toBe(PIT.TICKS);
      expect(f.action).toBeNull();
      expect(f.blocking).toBe(false);
      expect(f.vx).toBe(0);
      expect(ofType(fall.events, "PIT_FALL")).toEqual([{ type: "PIT_FALL", player: 0 }]);
      expect(ofType(fall.events, "LAND")).toHaveLength(0);

      const before = run(fall.s, PIT.TICKS - 1);
      expect(f0(before.s).pitTicks).toBe(1);
      expect(ofType(before.events, "PIT_RESPAWN")).toHaveLength(0);
      const after = run(before.s, 1);
      expect(ofType(after.events, "PIT_RESPAWN")).toEqual([{ type: "PIT_RESPAWN", player: 0 }]);
      const r = f0(after.s);
      expect(r.pitTicks).toBe(0);
      expect(r.x).toBe(300 - PIT.RESPAWN_INSET);
      expect(r.y).toBe(WORLD.ROOF_Y);
      expect(r.vy).toBe(0);
      expect(r.grounded).toBe(true);
      expect(r.onPlatform).toBeNull();
      expect(r.invuln).toBe(PIT.INVULN);
      expect(r.hp).toBe(BALANCE.MAX_HP - PIT.DAMAGE);
    });
    it("cannot be punched for the 30 invuln ticks, then can", () => {
      const { fall } = fallIntoGap(map);
      const respawned = run(fall.s, PIT.TICKS).s;
      // P1 stands just left of the respawn point (on ground), facing right, and punches on a cadence.
      respawned.fighters[1]!.x = 260 - 60;
      let s = respawned;
      const events: SimEvent[] = [];
      for (let t = 0; t < PIT.INVULN - 1; t++) {
        const r = step(s, [EMPTY_FRAME, t % 20 === 0 ? PUNCH : EMPTY_FRAME]);
        s = r.state; events.push(...r.events);
      }
      expect(ofType(events, "HIT")).toHaveLength(0);
      expect(f0(s).invuln).toBe(1);
      const settled = run(s, 10).s; // P1's last punch recovers, invuln reaches 0
      expect(f0(settled).invuln).toBe(0);
      const later = run(settled, 20, EMPTY_FRAME, PUNCH);
      expect(ofType(later.events, "HIT")).toHaveLength(1);
    });
  });
}

describe("rule 3 (gaps): a running jump clears the 80 px gap", () => {
  it("jumping from 290 with right held lands on ground at x ≥ 380 without a pit fall", () => {
    const s0 = fightingOn("gaps");
    s0.fighters[0]!.x = 290;
    const up = run(s0, 34, JUMP_RIGHT);
    expect(f0(up.s).grounded).toBe(false);
    expect(WORLD.ROOF_Y - f0(up.s).y).toBeGreaterThan(145);
    expect(WORLD.ROOF_Y - f0(up.s).y).toBeLessThan(155);
    const land = runUntil(up.s, (s) => f0(s).grounded, JUMP_RIGHT);
    expect(34 + land.ticks).toBeGreaterThanOrEqual(60);
    const f = f0(land.s);
    expect(f.x).toBeGreaterThanOrEqual(380);
    expect(f.x).toBeLessThanOrEqual(580);
    expect(f.y).toBe(WORLD.ROOF_Y);
    expect(f.onPlatform).toBeNull();
    expect(ofType([...up.events, ...land.events], "PIT_FALL")).toHaveLength(0);
    expect(ofType(land.events, "LAND")).toEqual([{ type: "LAND", player: 0 }]);
  });
});

// On chaos the right edge of platform 0 (330) overhangs the gap, so the walk-off there goes left onto ground [0, 300].
const WALK_OFF: Record<"platforms" | "chaos", { input: InputFrame; past: (x: number) => boolean }> = {
  platforms: { input: RIGHT, past: (x) => x > 330 },
  chaos: { input: { ...EMPTY_FRAME, left: true }, past: (x) => x < 150 },
};

for (const map of ["platforms", "chaos"] as const) {
  describe(`rule 4 (${map}): platforms catch a jump and drop you off their edge`, () => {
    it("jumping from 240 lands on platform 0 at y 330 with LAND; walking off falls back to the roof", () => {
      const s0 = fightingOn(map);
      s0.fighters[0]!.x = 240;
      const land = runUntil(run(s0, 1, JUMP).s, (s) => f0(s).grounded);
      let f = f0(land.s);
      expect(f.y).toBe(330);
      expect(f.onPlatform).toBe(0);
      expect(f.vy).toBe(0);
      expect(f.jumpTicks).toBe(0);
      expect(ofType(land.events, "LAND")).toEqual([{ type: "LAND", player: 0 }]);

      // Stays put while standing on the platform.
      const idle = run(land.s, 10);
      expect(f0(idle.s).y).toBe(330);
      expect(f0(idle.s).grounded).toBe(true);

      const off = runUntil(idle.s, (s) => !f0(s).grounded, WALK_OFF[map].input);
      f = f0(off.s);
      expect(WALK_OFF[map].past(f.x)).toBe(true);
      expect(f.onPlatform).toBeNull();
      expect(f.vy).toBe(BALANCE.GRAVITY);
      const down = runUntil(off.s, (s) => f0(s).grounded);
      f = f0(down.s);
      expect(f.y).toBe(WORLD.ROOF_Y);
      expect(f.onPlatform).toBeNull();
      expect(ofType(down.events, "LAND")).toEqual([{ type: "LAND", player: 0 }]);
      expect(ofType([...off.events, ...down.events], "PIT_FALL")).toHaveLength(0);
    });
  });
}

describe("rule 5 (platforms): one-way from below", () => {
  it("jumping from directly under a platform passes through it going up and lands on top coming down", () => {
    const s0 = fightingOn("platforms");
    s0.fighters[0]!.x = 240;
    s0.fighters[0]!.y = WORLD.ROOF_Y;
    let s = run(s0, 1, JUMP).s;
    let crossedUp = false;
    for (let t = 0; t < 35; t++) {
      s = step(s, [EMPTY_FRAME, EMPTY_FRAME]).state;
      const f = f0(s);
      if (f.y < 330 && f.vy < 0) crossedUp = true;
      expect(f.grounded).toBe(false);
    }
    expect(crossedUp).toBe(true);
    const land = runUntil(s, (x) => f0(x).grounded);
    expect(f0(land.s).y).toBe(330);
    expect(f0(land.s).onPlatform).toBe(0);
    expect(ofType(land.events, "LAND")).toHaveLength(1);
  });
});

describe("rule 6 (platforms): a perch is not safe", () => {
  it("a grounded opponent's punch clips the shins of a fighter standing on the platform", () => {
    const s0 = fightingOn("platforms");
    const p0 = s0.fighters[0]!;
    p0.x = 280; p0.y = 330; p0.grounded = true; p0.onPlatform = 0;
    s0.fighters[1]!.x = 220;
    const settled = run(s0, 2).s;
    expect(f0(settled).y).toBe(330);
    expect(settled.fighters[1]!.facing).toBe(1);
    const { events } = run(settled, 10, EMPTY_FRAME, PUNCH);
    const hits = ofType(events, "HIT");
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ attacker: 1, target: 0, blocked: false });
  });
});

describe("rule 8: a fighter in a pit is out of play", () => {
  it("ignores input, cannot be hit, is not counted for OOB and keeps his item", () => {
    const s0 = fightingOn("gaps");
    const p0 = s0.fighters[0]!;
    p0.x = 340; p0.y = PIT.Y; p0.grounded = false; p0.pitTicks = 20;
    p0.item = { kind: "shield", uses: 3 };
    s0.fighters[1]!.x = 280;
    const { s, events } = run(s0, 10, { ...EMPTY_FRAME, right: true, punchL: true, jump: true }, PUNCH);
    const f = f0(s);
    expect(f.x).toBe(340);
    expect(f.y).toBe(PIT.Y);
    expect(f.action).toBeNull();
    expect(f.pitTicks).toBe(10);
    expect(f.oobTicks).toBe(0);
    expect(f.item).toEqual({ kind: "shield", uses: 3 });
    expect(ofType(events, "HIT")).toHaveLength(0);
    expect(ofType(events, "JUMP")).toHaveLength(0);
    expect(ofType(events, "PUNCH").filter((e) => e.type === "PUNCH" && e.player === 0)).toHaveLength(0);
    expect(ofType(events, "OOB_DAMAGE")).toHaveLength(0);
  });
  it("can never sit at an OOB x: every map's ground reaches both world edges, so a pit fighter is always inside", () => {
    // OOB (rounds.ts) only counts x <= 0 or x >= WIDTH; a fighter reaches PIT.Y only over a gap, and no gap touches
    // an edge. This is what makes the `oobTicks` assertion above hold for a real fall, not just for x 340.
    for (const map of MAP_IDS) {
      expect(onGround(map, 0)).toBe(true);
      expect(onGround(map, WORLD.WIDTH)).toBe(true);
    }
    const s0 = fightingOn("gaps");
    const p0 = s0.fighters[0]!;
    p0.x = 0; p0.oobTicks = BALANCE.OOB_EVERY_TICKS - 1; // on ground at the edge: OOB counts, no pit fall
    const { s, events } = run(s0, 1);
    expect(ofType(events, "OOB_DAMAGE")).toHaveLength(1);
    expect(ofType(events, "PIT_FALL")).toHaveLength(0);
    expect(f0(s).grounded).toBe(true);
  });
  it("is not hittable even with the hurtbox in reach", () => {
    const s0 = fightingOn("gaps");
    const p0 = s0.fighters[0]!;
    p0.x = 340; p0.y = WORLD.ROOF_Y; p0.pitTicks = 30; // hurtbox placed where P1's punch would land
    s0.fighters[1]!.x = 280;
    const { events } = run(s0, 10, EMPTY_FRAME, PUNCH);
    expect(ofType(events, "HIT")).toHaveLength(0);
  });
});

describe("rule 9: pit damage bypasses the shield", () => {
  it("a shield keeps its uses and hp still drops by 8", () => {
    const s0 = fightingOn("gaps");
    s0.fighters[0]!.item = { kind: "shield", uses: 3 };
    const walk = runUntil(s0, (s) => !f0(s).grounded, RIGHT);
    const fall = runUntil(walk.s, (s) => f0(s).pitTicks > 0);
    expect(f0(fall.s).hp).toBe(BALANCE.MAX_HP - PIT.DAMAGE);
    expect(f0(fall.s).item).toEqual({ kind: "shield", uses: 3 });
    expect(ofType(fall.events, "SHIELD_ABSORB")).toHaveLength(0);
  });
});

describe("rule 10: spawns are on ground", () => {
  for (const map of MAP_IDS) {
    for (const players of [2, 3, 4] as const) {
      it(`${map} × ${players} players`, () => {
        const s = createMatch({ players, teams: "ffa", mode: "rounds", map, items: true });
        for (const f of s.fighters) {
          expect(onGround(map, f.x)).toBe(true);
          expect(groundYAt(map, f.x, f.y)).toBe(WORLD.ROOF_Y);
        }
        const settled = run(s, 5).s;
        for (const f of settled.fighters) expect(f.grounded).toBe(true);
      });
    }
  }
  it("every map's ground segments are ordered and inside the world", () => {
    for (const map of MAP_IDS) {
      let last = -1;
      for (const g of MAPS[map].ground) { expect(g.x0).toBeGreaterThan(last); expect(g.x1).toBeGreaterThan(g.x0); last = g.x1; }
      expect(last).toBeLessThanOrEqual(WORLD.WIDTH);
    }
  });
});

describe("invariants", () => {
  it("grounded ⇒ feet exactly on a surface; y never below 0", () => {
    for (const map of MAP_IDS) {
      let s = fightingOn(map, 4);
      for (let t = 0; t < 3000; t++) {
        s = step(s, [
          { ...EMPTY_FRAME, right: t % 90 < 60, jump: t % 45 === 0 },
          { ...EMPTY_FRAME, left: t % 70 < 30, right: t % 70 >= 50, jump: t % 33 === 0 },
          { ...EMPTY_FRAME, right: t % 120 < 100, jump: t % 61 === 0 },
          { ...EMPTY_FRAME, left: t % 200 < 150, jump: t % 27 === 0 },
        ]).state;
        if (s.phase !== "FIGHTING") break;
        for (const f of s.fighters) {
          expect(f.y).toBeGreaterThanOrEqual(0);
          if (f.pitTicks > 0) continue;
          if (f.grounded) expect(f.y).toBe(groundYAt(map, f.x, f.y));
        }
      }
    }
  });
});
