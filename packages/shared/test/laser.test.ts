import { describe, expect, it } from "vitest";
import { ARSENAL, BALANCE, EMPTY_FRAME, MATCH, WORLD, type InputFrame, type MatchState, type SimEvent } from "../src";
import { createMatch } from "../src/sim/create";
import { laserHitbox, laserPhase, resolveLaser, startLaser } from "../src/sim/laser";
import { step } from "../src/sim/step";
import { P_L, fighting, run } from "./helpers";

const Q: InputFrame = { ...EMPTY_FRAME, special: true };
const BLOCK: InputFrame = { ...EMPTY_FRAME, block: true };
const JUMP: InputFrame = { ...EMPTY_FRAME, jump: true };
const { LASER_CHARGE, LASER_ACTIVE, LASER_RECOVERY, LASER_COOLDOWN, LASER_DAMAGE, LASER_CHIP } = ARSENAL;
const TOTAL = LASER_CHARGE + LASER_ACTIVE + LASER_RECOVERY;

function laserHits(events: SimEvent[]) {
  return events.filter((e) => e.type === "LASER_HIT");
}

describe("laser phases and hitbox", () => {
  it("laserPhase follows elapsed through charge, beam, recover", () => {
    const f = createMatch().fighters[0]!;
    expect(laserPhase(f)).toBeNull();
    f.action = { kind: "laser", elapsed: 0, hit: [] };
    expect(laserPhase(f)).toBe("charge");
    f.action.elapsed = LASER_CHARGE - 1; expect(laserPhase(f)).toBe("charge");
    f.action.elapsed = LASER_CHARGE; expect(laserPhase(f)).toBe("beam");
    f.action.elapsed = LASER_CHARGE + LASER_ACTIVE - 1; expect(laserPhase(f)).toBe("beam");
    f.action.elapsed = LASER_CHARGE + LASER_ACTIVE; expect(laserPhase(f)).toBe("recover");
    f.action.elapsed = TOTAL - 1; expect(laserPhase(f)).toBe("recover");
    f.action = { kind: "punch", arm: "L", elapsed: 0, landed: false, sword: false };
    expect(laserPhase(f)).toBeNull();
  });
  it("laserHitbox spans from the fighter to the world edge in facing direction, only during the beam", () => {
    const f = createMatch().fighters[0]!;
    f.x = 280; f.facing = 1;
    expect(laserHitbox(f)).toBeNull();
    f.action = { kind: "laser", elapsed: LASER_CHARGE, hit: [] };
    expect(laserHitbox(f)).toEqual({ x: 280, y: WORLD.ROOF_Y - 130, w: WORLD.WIDTH - 280, h: 60 });
    f.facing = -1;
    expect(laserHitbox(f)).toEqual({ x: 0, y: WORLD.ROOF_Y - 130, w: 280, h: 60 });
    f.action.elapsed = LASER_CHARGE - 1;
    expect(laserHitbox(f)).toBeNull();
  });
});

describe("rule 1: edge starts a charge, fires 30 ticks later, sets the cooldown", () => {
  it("LASER_CHARGE that tick, LASER_FIRE 30 ticks later, cooldown 720", () => {
    let s = fighting(300);
    const first = step(s, [Q, EMPTY_FRAME]);
    s = first.state;
    expect(first.events).toContainEqual({ type: "LASER_CHARGE", player: 0 });
    expect(s.fighters[0]!.laserCooldown).toBe(LASER_COOLDOWN);
    expect(s.fighters[0]!.action).toEqual({ kind: "laser", elapsed: 0, hit: [] });
    let fireTick = -1;
    for (let i = 1; i <= TOTAL; i++) {
      const r = step(s, [Q, EMPTY_FRAME]); s = r.state;
      if (r.events.some((e) => e.type === "LASER_FIRE")) { expect(fireTick).toBe(-1); fireTick = i; }
    }
    expect(fireTick).toBe(LASER_CHARGE);
    expect(s.fighters[0]!.action).toBeNull();
  });
  it("startLaser refuses when airborne, blocking, acting, in hitstun, on cooldown, ko, in a pit or outside FIGHTING", () => {
    const ready = () => { const s = fighting(300); return s; };
    const ev: SimEvent[] = [];
    expect(startLaser(ready(), 0, ev)).toBe(true);
    let s = ready(); s.fighters[0]!.grounded = false; expect(startLaser(s, 0, ev)).toBe(false);
    s = ready(); s.fighters[0]!.blocking = true; expect(startLaser(s, 0, ev)).toBe(false);
    s = ready(); s.fighters[0]!.action = { kind: "punch", arm: "L", elapsed: 0, landed: false, sword: false }; expect(startLaser(s, 0, ev)).toBe(false);
    s = ready(); s.fighters[0]!.hitstun = 3; expect(startLaser(s, 0, ev)).toBe(false);
    s = ready(); s.fighters[0]!.laserCooldown = 1; expect(startLaser(s, 0, ev)).toBe(false);
    s = ready(); s.fighters[0]!.hp = 0; expect(startLaser(s, 0, ev)).toBe(false);
    s = ready(); s.fighters[0]!.pitTicks = 5; expect(startLaser(s, 0, ev)).toBe(false);
    s = ready(); s.phase = "COUNTDOWN"; expect(startLaser(s, 0, ev)).toBe(false);
    expect(ev.filter((e) => e.type === "LASER_CHARGE")).toHaveLength(1);
  });
});

describe("rule 2: a grounded opponent in front takes 10 once", () => {
  it("one LASER_HIT for a 12-tick beam, far across the roof", () => {
    const s = fighting(); s.fighters[0]!.x = 100; s.fighters[1]!.x = 850;
    const { s: out, events } = run(s, TOTAL + 1, [Q, EMPTY_FRAME]);
    const hits = laserHits(events);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toEqual({ type: "LASER_HIT", attacker: 0, target: 1, damage: LASER_DAMAGE, blocked: false });
    expect(out.fighters[1]!.hp).toBe(BALANCE.MAX_HP - LASER_DAMAGE);
  });
  it("the hit lands on the first beam tick with hitstun and knockback away from the attacker", () => {
    let s = fighting(300);
    s = run(s, LASER_CHARGE, [Q, EMPTY_FRAME]).s;
    expect(s.fighters[1]!.hitstun).toBe(0);
    const r = step(s, [Q, EMPTY_FRAME]);
    expect(laserHits(r.events)).toHaveLength(1);
    expect(r.state.fighters[1]!.hitstun).toBe(BALANCE.HITSTUN_TICKS);
    expect(r.state.fighters[1]!.knockbackVx).toBeGreaterThan(0);
    expect(r.state.fighters[0]!.action).toMatchObject({ kind: "laser", hit: [1] });
  });
});

describe("rule 3: an opponent behind the attacker takes nothing", () => {
  it("no LASER_HIT, hp untouched", () => {
    const s = fighting(); s.fighters[0]!.x = 600; s.fighters[0]!.facing = 1; s.fighters[1]!.x = 100;
    const { s: out, events } = run(s, TOTAL + 1, [Q, EMPTY_FRAME]);
    expect(laserHits(events)).toHaveLength(0);
    expect(out.fighters[1]!.hp).toBe(BALANCE.MAX_HP);
  });
});

describe("rule 4: block and shield", () => {
  it("blocking opponent: chip 4, no hitstun, blocked flag", () => {
    const { s, events } = run(fighting(300), TOTAL + 1, [Q, BLOCK]);
    const hits = laserHits(events);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ damage: LASER_CHIP, blocked: true });
    expect(s.fighters[1]!.hp).toBe(BALANCE.MAX_HP - LASER_CHIP);
    expect(s.fighters[1]!.hitstun).toBe(0);
    expect(s.fighters[1]!.blocking).toBe(true);
  });
  it("shield holder: absorbed, 0 hp lost, no hitstun, SHIELD_ABSORB", () => {
    const start = fighting(300); start.fighters[1]!.item = { kind: "shield", uses: 3 };
    const { s, events } = run(start, TOTAL + 1, [Q, EMPTY_FRAME]);
    expect(events.filter((e) => e.type === "SHIELD_ABSORB")).toEqual([{ type: "SHIELD_ABSORB", player: 1, left: 2 }]);
    expect(laserHits(events)).toHaveLength(1);
    expect(laserHits(events)[0]).toMatchObject({ damage: 0, blocked: false });
    expect(s.fighters[1]!.hp).toBe(BALANCE.MAX_HP);
    expect(s.fighters[1]!.hitstun).toBe(0);
    expect(s.fighters[1]!.item).toEqual({ kind: "shield", uses: 2 });
  });
});

describe("rule 5: jumping over the beam", () => {
  it("an opponent at jump apex is above the band and takes nothing", () => {
    // Opponent jumps one tick after the laser edge: its apex (jumpTicks 30, feet at ROOF_Y - 120) is the first beam tick.
    let s = fighting(300);
    s = run(s, 1, [Q, EMPTY_FRAME]).s;
    const { s: out, events } = run(s, LASER_CHARGE - 1, [Q, JUMP]);
    expect(laserHits(events)).toHaveLength(0);
    expect(out.fighters[1]!.grounded).toBe(false);
    const r = step(out, [Q, JUMP]);
    expect(r.state.fighters[1]!.jumpTicks).toBe(LASER_CHARGE);
    expect(Math.abs(r.state.fighters[1]!.y - (WORLD.ROOF_Y - 120))).toBeLessThanOrEqual(5); // discrete apex is 116 px
    expect(laserHits(r.events)).toHaveLength(0);
    expect(laserHitbox(r.state.fighters[0]!)).not.toBeNull();
    const rest = run(r.state, TOTAL - LASER_CHARGE, [Q, JUMP]);
    expect(laserHits(rest.events)).toHaveLength(0);
    expect(rest.s.fighters[1]!.hp).toBe(BALANCE.MAX_HP);
  });
  it("an opponent low in the air during jump i-frames takes nothing; after them, in the band, it hits", () => {
    const s = fighting(300);
    s.fighters[0]!.action = { kind: "laser", elapsed: LASER_CHARGE, hit: [] };
    const o = s.fighters[1]!;
    o.grounded = false; o.y = WORLD.ROOF_Y - 20;
    for (const jt of [BALANCE.JUMP_IFRAME_START, 7, BALANCE.JUMP_IFRAME_END]) {
      const ev: SimEvent[] = [];
      o.jumpTicks = jt;
      resolveLaser(s, ev);
      expect(laserHits(ev)).toHaveLength(0);
      expect(o.hp).toBe(BALANCE.MAX_HP);
    }
    const ev: SimEvent[] = [];
    o.jumpTicks = BALANCE.JUMP_IFRAME_END + 1;
    resolveLaser(s, ev);
    expect(laserHits(ev)).toHaveLength(1);
    expect(o.hp).toBe(BALANCE.MAX_HP - LASER_DAMAGE);
  });
});

describe("rule 6: charging locks the attacker; a hit cancels the laser without refunding the cooldown", () => {
  it("no walking or jumping during charge", () => {
    let s = fighting(300);
    s = run(s, 1, [Q, EMPTY_FRAME]).s;
    const x0 = s.fighters[0]!.x;
    const walk: InputFrame = { ...EMPTY_FRAME, special: true, right: true, jump: true };
    const { s: out, events } = run(s, LASER_CHARGE - 1, [walk, EMPTY_FRAME]);
    expect(out.fighters[0]!.x).toBe(x0);
    expect(out.fighters[0]!.grounded).toBe(true);
    expect(events.filter((e) => e.type === "JUMP")).toHaveLength(0);
  });
  it("a punch landing during charge cancels the laser, no LASER_FIRE, cooldown not refunded", () => {
    let s = fighting(60);
    s = run(s, 1, [Q, EMPTY_FRAME]).s;
    expect(s.fighters[0]!.action?.kind).toBe("laser");
    const punchTicks = BALANCE.PUNCH_STARTUP + 1;
    const r = run(s, punchTicks, [Q, P_L]);
    expect(r.events.filter((e) => e.type === "HIT")).toHaveLength(1);
    expect(r.s.fighters[0]!.action).toBeNull();
    expect(r.s.fighters[0]!.hitstun).toBe(BALANCE.HITSTUN_TICKS);
    const rest = run(r.s, TOTAL, [Q, EMPTY_FRAME]);
    expect(rest.events.filter((e) => e.type === "LASER_FIRE")).toHaveLength(0);
    expect(rest.events.filter((e) => e.type === "LASER_CHARGE")).toHaveLength(0);
    expect(laserHits(rest.events)).toHaveLength(0);
    // The edge tick set the cooldown after tickCooldowns ran, so only the ticks after it count down.
    expect(rest.s.fighters[0]!.laserCooldown).toBe(LASER_COOLDOWN - punchTicks - TOTAL);
  });
});

describe("rule 7: cooldown", () => {
  it("a second edge while laserCooldown > 0 does nothing; after 720 ticks it works again", () => {
    let s = fighting(300);
    s = run(s, 1, [Q, EMPTY_FRAME]).s;
    s = run(s, TOTAL, [EMPTY_FRAME, EMPTY_FRAME]).s;
    expect(s.fighters[0]!.action).toBeNull();
    const again = step(s, [Q, EMPTY_FRAME]);
    expect(again.events.filter((e) => e.type === "LASER_CHARGE")).toHaveLength(0);
    expect(again.state.fighters[0]!.action).toBeNull();
    s = again.state;
    // Tick 1 set the cooldown after tickCooldowns ran; TOTAL + 1 ticks have counted down since.
    const elapsed = TOTAL + 1;
    s = run(s, LASER_COOLDOWN - elapsed - 2, [EMPTY_FRAME, EMPTY_FRAME]).s;
    expect(s.fighters[0]!.laserCooldown).toBe(2);
    const blocked = step(s, [Q, EMPTY_FRAME]);
    expect(blocked.events.filter((e) => e.type === "LASER_CHARGE")).toHaveLength(0);
    expect(blocked.state.fighters[0]!.laserCooldown).toBe(1);
    // Tick 721 after the first edge: the cooldown counts down to 0 before input is read, so this edge fires.
    const released = step(blocked.state, [EMPTY_FRAME, EMPTY_FRAME]);
    const fired = step(released.state, [Q, EMPTY_FRAME]);
    expect(fired.events).toContainEqual({ type: "LASER_CHARGE", player: 0 });
    expect(fired.state.fighters[0]!.laserCooldown).toBe(LASER_COOLDOWN);
  });
  it("laserCooldown never exceeds LASER_COOLDOWN and never goes negative", () => {
    let s = fighting(300);
    let max = -Infinity; let min = Infinity;
    for (let i = 0; i < LASER_COOLDOWN + TOTAL + 10; i++) {
      const r = step(s, [i % 2 === 0 ? Q : EMPTY_FRAME, EMPTY_FRAME]); s = r.state;
      const c = s.fighters[0]!.laserCooldown;
      max = Math.max(max, c); min = Math.min(min, c);
    }
    expect(max).toBeLessThanOrEqual(LASER_COOLDOWN);
    expect(min).toBeGreaterThanOrEqual(0);
  });
});

describe("rule 8: many players", () => {
  it("3-player FFA: one beam hits both opponents, never the attacker", () => {
    const s = createMatch({ players: 3, teams: "ffa", mode: "rounds", map: "roof", items: true });
    s.phase = "FIGHTING"; s.roundTicks = MATCH.ROUND_TICKS;
    let hitSeen: number[] = [];
    let cur = s; const events: SimEvent[] = [];
    for (let i = 0; i < TOTAL + 1; i++) {
      const r = step(cur, [Q, EMPTY_FRAME, EMPTY_FRAME]); cur = r.state; events.push(...r.events);
      const a = cur.fighters[0]!.action;
      if (a?.kind === "laser") hitSeen = [...a.hit];
    }
    const out = cur;
    const hits = laserHits(events);
    expect(hits).toHaveLength(2);
    expect(hits.map((h) => h.type === "LASER_HIT" && h.target).sort()).toEqual([1, 2]);
    expect(hitSeen.sort()).toEqual([1, 2]);
    expect(out.fighters[0]!.hp).toBe(BALANCE.MAX_HP);
    expect(out.fighters[1]!.hp).toBe(BALANCE.MAX_HP - LASER_DAMAGE);
    expect(out.fighters[2]!.hp).toBe(BALANCE.MAX_HP - LASER_DAMAGE);
  });
  it("2v2: the teammate in the beam is never hit", () => {
    const s = createMatch({ players: 4, teams: "2v2", mode: "rounds", map: "roof", items: true });
    s.phase = "FIGHTING"; s.roundTicks = MATCH.ROUND_TICKS;
    expect(s.fighters[1]!.team).toBe(s.fighters[0]!.team);
    let hitList: number[] = [];
    let cur = s;
    const events: SimEvent[] = [];
    for (let i = 0; i < TOTAL + 1; i++) {
      const r = step(cur, [Q, EMPTY_FRAME, EMPTY_FRAME, EMPTY_FRAME]); cur = r.state; events.push(...r.events);
      const a = cur.fighters[0]!.action;
      if (a?.kind === "laser") hitList = [...a.hit];
    }
    const hits = laserHits(events);
    expect(hits.map((h) => h.type === "LASER_HIT" && h.target).sort()).toEqual([2, 3]);
    expect(hitList.sort()).toEqual([2, 3]);
    expect(cur.fighters[1]!.hp).toBe(BALANCE.MAX_HP);
    expect(cur.fighters[0]!.hp).toBe(BALANCE.MAX_HP);
  });
});

describe("same-tick trade", () => {
  it("two opposing lasers fired on the same tick both land; the lower index gets no priority", () => {
    let s = fighting(300);
    s = run(s, LASER_CHARGE, [Q, Q]).s;
    expect(s.fighters[0]!.action?.kind).toBe("laser");
    expect(s.fighters[1]!.action?.kind).toBe("laser");
    const r = step(s, [Q, Q]);
    expect(r.events.filter((e) => e.type === "LASER_FIRE").map((e) => e.type === "LASER_FIRE" && e.player).sort()).toEqual([0, 1]);
    const hits = laserHits(r.events);
    expect(hits.map((h) => h.type === "LASER_HIT" && h.target).sort()).toEqual([0, 1]);
    expect(r.state.fighters[0]!.hp).toBe(BALANCE.MAX_HP - LASER_DAMAGE);
    expect(r.state.fighters[1]!.hp).toBe(BALANCE.MAX_HP - LASER_DAMAGE);
    expect(r.state.fighters[0]!.action).toBeNull();
    expect(r.state.fighters[1]!.action).toBeNull();
  });
});

describe("rule 9: edge only", () => {
  it("special held continuously starts exactly one laser", () => {
    const { events } = run(fighting(300), TOTAL * 2, [Q, EMPTY_FRAME]);
    expect(events.filter((e) => e.type === "LASER_CHARGE")).toHaveLength(1);
    expect(events.filter((e) => e.type === "LASER_FIRE")).toHaveLength(1);
  });
});
