import { describe, expect, it } from "vitest";
import { ARSENAL, BALANCE, EMPTY_FRAME, MATCH, WORLD, type InputFrame, type MatchState, type SimEvent } from "../src";
import { createMatch } from "../src/sim/create";
import { laserHitbox, laserPhase, resolveLaser, startLaser } from "../src/sim/laser";
import { step } from "../src/sim/step";
import { P_L, fighting, run } from "./helpers";

const Q: InputFrame = { ...EMPTY_FRAME, special: true };
const BLOCK: InputFrame = { ...EMPTY_FRAME, block: true };
const JUMP: InputFrame = { ...EMPTY_FRAME, jump: true };
const { LASER_CHARGE, LASER_ACTIVE, LASER_RECOVERY, LASER_COOLDOWN, LASER_DAMAGE, LASER_CHIP, LASER_SPEED, LASER_BAND_TOP, LASER_BAND_BOTTOM } = ARSENAL;
const TOTAL = LASER_CHARGE + LASER_ACTIVE + LASER_RECOVERY;
const BAND_H = LASER_BAND_TOP - LASER_BAND_BOTTOM;
/** 0-based beam tick on which the front first reaches the near edge of a hurtbox `gap` px away (fighting(300): tick 4). */
const reachTick = (gap: number) => Math.ceil((gap - WORLD.HURTBOX_W / 2) / LASER_SPEED) - 1;

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
  it("laserHitbox grows LASER_SPEED px per beam tick from the fighter's centre to the world edge, in the mid-body band, only during the beam", () => {
    const f = createMatch().fighters[0]!;
    f.x = 280; f.facing = 1;
    expect(laserHitbox(f)).toBeNull();
    f.action = { kind: "laser", elapsed: LASER_CHARGE, hit: [] };
    expect(BAND_H).toBe(WORLD.HURTBOX_H / 2); // half the sprite height
    expect(Math.abs(LASER_BAND_TOP - BAND_H / 2 - WORLD.HURTBOX_H / 2)).toBeLessThanOrEqual(0.5); // centred on the sprite's middle, whole px
    expect(laserHitbox(f)).toEqual({ x: 280, y: WORLD.ROOF_Y - LASER_BAND_TOP, w: LASER_SPEED, h: BAND_H }); // first beam tick
    f.action.elapsed = LASER_CHARGE + 1;
    expect(laserHitbox(f)).toEqual({ x: 280, y: WORLD.ROOF_Y - LASER_BAND_TOP, w: 2 * LASER_SPEED, h: BAND_H });
    f.action.elapsed = LASER_CHARGE + LASER_ACTIVE - 1;
    expect(laserHitbox(f)).toEqual({ x: 280, y: WORLD.ROOF_Y - LASER_BAND_TOP, w: WORLD.WIDTH - 280, h: BAND_H }); // reached the far edge
    expect(LASER_SPEED * LASER_ACTIVE).toBeGreaterThanOrEqual(WORLD.WIDTH); // from any x the beam crosses the whole world
    f.facing = -1;
    expect(laserHitbox(f)).toEqual({ x: 0, y: WORLD.ROOF_Y - LASER_BAND_TOP, w: 280, h: BAND_H });
    f.action.elapsed = LASER_CHARGE;
    expect(laserHitbox(f)).toEqual({ x: 280 - LASER_SPEED, y: WORLD.ROOF_Y - LASER_BAND_TOP, w: LASER_SPEED, h: BAND_H });
    f.action.elapsed = LASER_CHARGE - 1;
    expect(laserHitbox(f)).toBeNull();
  });
});

describe("rule 1: edge starts a charge, fires LASER_CHARGE (180, 3 s) ticks later, sets the cooldown", () => {
  it("LASER_CHARGE that tick, LASER_FIRE 180 ticks later, cooldown 720", () => {
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
  it("startLaser refuses when blocking, acting, in hitstun, on cooldown, ko, in a pit or outside FIGHTING; airborne is allowed", () => {
    const ready = () => { const s = fighting(300); return s; };
    const ev: SimEvent[] = [];
    expect(startLaser(ready(), 0, ev)).toBe(true);
    // 9.10: being off the ground is not a bar — the laser starts, charges and fires mid-air.
    let s = ready(); s.fighters[0]!.grounded = false; expect(startLaser(s, 0, ev)).toBe(true);
    s = ready(); s.fighters[0]!.blocking = true; expect(startLaser(s, 0, ev)).toBe(false);
    s = ready(); s.fighters[0]!.action = { kind: "punch", arm: "L", elapsed: 0, landed: false, sword: false }; expect(startLaser(s, 0, ev)).toBe(false);
    s = ready(); s.fighters[0]!.hitstun = 3; expect(startLaser(s, 0, ev)).toBe(false);
    s = ready(); s.fighters[0]!.laserCooldown = 1; expect(startLaser(s, 0, ev)).toBe(false);
    s = ready(); s.fighters[0]!.hp = 0; expect(startLaser(s, 0, ev)).toBe(false);
    s = ready(); s.fighters[0]!.pitTicks = 5; expect(startLaser(s, 0, ev)).toBe(false);
    s = ready(); s.phase = "COUNTDOWN"; expect(startLaser(s, 0, ev)).toBe(false);
    expect(ev.filter((e) => e.type === "LASER_CHARGE")).toHaveLength(2); // the grounded and the airborne start
  });
});

describe("rule 2: a grounded opponent in front takes 20 once", () => {
  it("one LASER_HIT for a 16-tick beam, far across the roof", () => {
    const s = fighting(); s.fighters[0]!.x = 100; s.fighters[1]!.x = 850;
    const { s: out, events } = run(s, TOTAL + 1, [Q, EMPTY_FRAME]);
    const hits = laserHits(events);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toEqual({ type: "LASER_HIT", attacker: 0, target: 1, damage: LASER_DAMAGE, blocked: false });
    expect(out.fighters[1]!.hp).toBe(BALANCE.MAX_HP - LASER_DAMAGE);
  });
  it("the hit lands on the beam tick whose front reaches the target, not before, with hitstun and knockback away from the attacker", () => {
    let s = fighting(300);
    const before = run(s, LASER_CHARGE + reachTick(300), [Q, EMPTY_FRAME]);
    s = before.s;
    expect(before.events.filter((e) => e.type === "LASER_FIRE")).toHaveLength(1);
    expect(laserHits(before.events)).toHaveLength(0); // the front has not reached the target yet
    expect(s.fighters[1]!.hitstun).toBe(0);
    const r = step(s, [Q, EMPTY_FRAME]);
    expect(laserHits(r.events)).toHaveLength(1);
    expect(r.state.fighters[1]!.hitstun).toBe(BALANCE.HITSTUN_TICKS);
    expect(r.state.fighters[1]!.knockbackVx).toBeGreaterThan(0);
    expect(r.state.fighters[0]!.action).toMatchObject({ kind: "laser", hit: [1] });
  });
});

describe("rule 3: an opponent behind the attacker takes nothing", () => {
  it("nothing behind the muzzle for the whole sweep", () => {
    // Pinned mid-beam, so this is the geometry alone. Since 9.10 a *charging* fighter re-aims at its nearest
    // opponent, so with a single opponent the beam can no longer be pointed away from it for 180 ticks.
    const s = fighting(); s.fighters[0]!.x = 600; s.fighters[0]!.facing = 1; s.fighters[1]!.x = 100;
    const f = s.fighters[0]!;
    const events: SimEvent[] = [];
    for (let k = 0; k < LASER_ACTIVE; k++) {
      f.action = { kind: "laser", elapsed: LASER_CHARGE + k, hit: [] };
      resolveLaser(s, events);
    }
    expect(laserHits(events)).toHaveLength(0);
    expect(s.fighters[1]!.hp).toBe(BALANCE.MAX_HP);
  });
  it("3-player FFA: the beam takes the opponent in front and never the one behind", () => {
    const s = createMatch({ players: 3, teams: "ffa", mode: "rounds", map: "roof", items: true });
    s.phase = "FIGHTING"; s.roundTicks = MATCH.ROUND_TICKS;
    s.fighters[0]!.x = 500; s.fighters[1]!.x = 560; s.fighters[2]!.x = 100; // nearest is in front, the other behind
    let cur = s; const events: SimEvent[] = [];
    for (let i = 0; i < TOTAL + 1; i++) {
      const r = step(cur, [Q, EMPTY_FRAME, EMPTY_FRAME]); cur = r.state; events.push(...r.events);
    }
    expect(laserHits(events).map((h) => h.type === "LASER_HIT" && h.target)).toEqual([1]);
    expect(cur.fighters[1]!.hp).toBe(BALANCE.MAX_HP - LASER_DAMAGE);
    expect(cur.fighters[2]!.hp).toBe(BALANCE.MAX_HP);
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
  it("an opponent near jump apex is above the band and takes nothing", () => {
    // Opponent takes off 30 ticks before the beam: on the first beam tick (jumpTicks 30) its feet are ~149 px up, near the
    // ~151 px apex, and it is still more than a band height (70 px) up when the front sweeps past over the 16 beam ticks.
    let s = fighting(300);
    s = run(s, 1, [Q, EMPTY_FRAME]).s;
    s = run(s, LASER_CHARGE - 30, [Q, EMPTY_FRAME]).s;
    const { s: out, events } = run(s, 29, [Q, JUMP]);
    expect(laserHits(events)).toHaveLength(0);
    expect(out.fighters[1]!.grounded).toBe(false);
    const r = step(out, [Q, JUMP]);
    expect(r.state.fighters[1]!.jumpTicks).toBe(30);
    expect(WORLD.ROOF_Y - r.state.fighters[1]!.y).toBeGreaterThan(BAND_H);
    expect(Math.abs(r.state.fighters[1]!.y - (WORLD.ROOF_Y - 150))).toBeLessThanOrEqual(5);
    expect(laserHits(r.events)).toHaveLength(0);
    expect(laserHitbox(r.state.fighters[0]!)).not.toBeNull();
    const rest = run(r.state, TOTAL - LASER_CHARGE, [Q, JUMP]);
    expect(rest.s.fighters[1]!.grounded).toBe(false); // still airborne after the beam is gone
    expect(laserHits(rest.events)).toHaveLength(0);
    expect(rest.s.fighters[1]!.hp).toBe(BALANCE.MAX_HP);
  });
  it("an opponent low in the air during jump i-frames takes nothing; after them, in the band, it hits", () => {
    const s = fighting(300);
    s.fighters[0]!.action = { kind: "laser", elapsed: LASER_CHARGE + LASER_ACTIVE - 1, hit: [] }; // full reach
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

describe("rule 6 (9.10): the charge does not lock the attacker; a hit cancels the laser without refunding the cooldown", () => {
  it("walks and jumps through the charge at full speed", () => {
    let s = fighting(300);
    s = run(s, 1, [Q, EMPTY_FRAME]).s;
    const x0 = s.fighters[0]!.x;
    const walk: InputFrame = { ...EMPTY_FRAME, special: true, right: true };
    const r = run(s, 10, [walk, EMPTY_FRAME]);
    expect(r.s.fighters[0]!.x).toBe(x0 + 10 * BALANCE.WALK_SPEED);
    expect(r.s.fighters[0]!.action?.kind).toBe("laser");
    const j = run(r.s, 1, [{ ...walk, jump: true }, EMPTY_FRAME]);
    expect(j.events.filter((e) => e.type === "JUMP")).toHaveLength(1);
    expect(j.s.fighters[0]!.grounded).toBe(false);
    expect(j.s.fighters[0]!.action?.kind).toBe("laser");
  });
  it("the beam sweeps from where the attacker walked to, not from where it started charging", () => {
    let s = fighting(300); // attacker 400, opponent 700
    s = run(s, 1, [Q, EMPTY_FRAME]).s;
    const walk: InputFrame = { ...EMPTY_FRAME, special: true, right: true };
    s = run(s, 40, [walk, EMPTY_FRAME]).s;
    const x = s.fighters[0]!.x;
    expect(x).toBe(400 + 40 * BALANCE.WALK_SPEED);
    const r = run(s, LASER_CHARGE - 40, [Q, EMPTY_FRAME]); // stand still for the rest of the charge
    expect(r.events.filter((e) => e.type === "LASER_FIRE")).toHaveLength(1);
    expect(laserPhase(r.s.fighters[0]!)).toBe("beam");
    expect(laserHitbox(r.s.fighters[0]!)).toEqual({ x, y: WORLD.ROOF_Y - LASER_BAND_TOP, w: LASER_SPEED, h: BAND_H });
  });
  it("a beam fired from the top of a jump passes over a grounded opponent", () => {
    // Take off 30 ticks before the beam: the attacker's feet are ~149 px up when it fires, so its band
    // ([feet − 105, feet − 35)) sits entirely above a grounded opponent's.
    let s = fighting(300);
    s = run(s, 1, [Q, EMPTY_FRAME]).s;
    s = run(s, LASER_CHARGE - 31, [Q, EMPTY_FRAME]).s;
    const QJ: InputFrame = { ...EMPTY_FRAME, special: true, jump: true };
    const up = run(s, 31, [QJ, EMPTY_FRAME]); // the last of these is the fire tick
    expect(up.events.filter((e) => e.type === "LASER_FIRE")).toHaveLength(1);
    expect(up.s.fighters[0]!.grounded).toBe(false);
    expect(WORLD.ROOF_Y - up.s.fighters[0]!.y).toBeGreaterThan(BAND_H);
    const rest = run(up.s, LASER_ACTIVE, [QJ, EMPTY_FRAME]);
    expect(laserHits(up.events)).toHaveLength(0);
    expect(laserHits(rest.events)).toHaveLength(0);
    expect(rest.s.fighters[1]!.hp).toBe(BALANCE.MAX_HP);
  });
  it("a beam fired just after take-off is still low enough to land", () => {
    // 13.00: the band is 49 px, so the front must reach a target before the attacker has risen that far (150 px away: beam tick 2)
    let s = fighting(150);
    s = run(s, 1, [Q, EMPTY_FRAME]).s;
    s = run(s, LASER_CHARGE - 3, [Q, EMPTY_FRAME]).s;
    const QJ: InputFrame = { ...EMPTY_FRAME, special: true, jump: true };
    const r = run(s, 2 + LASER_ACTIVE, [QJ, EMPTY_FRAME]);
    expect(r.s.fighters[0]!.grounded).toBe(false);
    expect(laserHits(r.events)).toHaveLength(1);
  });
  it("a charging fighter re-aims; firing commits the direction", () => {
    let s = fighting(300); // attacker 400 facing right, opponent 700
    s = run(s, 1, [Q, EMPTY_FRAME]).s;
    expect(s.fighters[0]!.facing).toBe(1);
    const walk: InputFrame = { ...EMPTY_FRAME, special: true, right: true };
    s = run(s, 120, [walk, EMPTY_FRAME]).s; // walk past the opponent
    expect(s.fighters[0]!.x).toBe(760);
    expect(s.fighters[0]!.facing).toBe(-1);
    const r = run(s, LASER_CHARGE - 120, [Q, EMPTY_FRAME]);
    expect(r.events.filter((e) => e.type === "LASER_FIRE")).toHaveLength(1);
    expect(laserHitbox(r.s.fighters[0]!)).toMatchObject({ x: 760 - LASER_SPEED, w: LASER_SPEED });
    const cur = r.s;
    cur.fighters[1]!.x = 900; // behind the attacker now: the committed aim does not follow
    const after = step(cur, [Q, EMPTY_FRAME]);
    expect(after.state.fighters[0]!.facing).toBe(-1);
  });
  it("walking into a pit mid-charge cancels the laser and never refunds the cooldown", () => {
    const s = createMatch({ players: 2, teams: "ffa", mode: "rounds", map: "gaps", items: true });
    s.phase = "FIGHTING"; s.roundTicks = MATCH.ROUND_TICKS;
    s.fighters[0]!.x = 290; s.fighters[1]!.x = 900; // ground runs out at 300
    const start = run(s, 1, [Q, EMPTY_FRAME]);
    expect(start.s.fighters[0]!.action?.kind).toBe("laser");
    const off = run(start.s, 5, [{ ...EMPTY_FRAME, special: true, right: true }, EMPTY_FRAME]);
    expect(off.s.fighters[0]!.grounded).toBe(false);
    const r = run(off.s, 40, [Q, EMPTY_FRAME]); // drops into the gap
    expect(r.events.filter((e) => e.type === "PIT_FALL")).toHaveLength(1);
    expect(r.s.fighters[0]!.action).toBeNull();
    const rest = run(r.s, TOTAL, [Q, EMPTY_FRAME]);
    expect(rest.events.filter((e) => e.type === "LASER_FIRE")).toHaveLength(0);
    expect(rest.events.filter((e) => e.type === "LASER_CHARGE")).toHaveLength(0);
    expect(rest.s.fighters[0]!.laserCooldown).toBeGreaterThan(0);
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
    const before = run(s, LASER_CHARGE + reachTick(300), [Q, Q]);
    s = before.s;
    expect(before.events.filter((e) => e.type === "LASER_FIRE").map((e) => e.type === "LASER_FIRE" && e.player).sort()).toEqual([0, 1]);
    expect(laserHits(before.events)).toHaveLength(0);
    expect(s.fighters[0]!.action?.kind).toBe("laser");
    expect(s.fighters[1]!.action?.kind).toBe("laser");
    const r = step(s, [Q, Q]); // both fronts reach the other on the same tick
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
