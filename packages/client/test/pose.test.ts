import { describe, expect, it } from "vitest";
import { BALANCE, WORLD, createMatch, punchHitbox, type FighterState } from "@midnight/shared";
import { computePose, rigState, type Clock, type Joints } from "../src/game/rig/pose";
import { RIG } from "../src/game/rig/characters";

const clock: Clock = { renderMs: 0, koFrames: 0, landFrames: 0 };

function fighter(over: Partial<FighterState> = {}, index: 0 | 1 = 0): FighterState {
  return { ...createMatch().fighters[index]!, ...over };
}

function feetOf(j: Joints): number[] {
  return [j.legs.F.foot.y, j.legs.B.foot.y];
}

describe("rigState priority ladder", () => {
  const all: Partial<FighterState> = {
    hitstun: 5, action: { kind: "punch", arm: "L", elapsed: 2, landed: false, sword: false },
    grounded: false, jumpTicks: 4, blocking: true, x: 0, vx: 3,
  };
  it("ko beats everything", () => expect(rigState(fighter(all), true)).toBe("ko"));
  it("hit beats punch", () => expect(rigState(fighter(all), false)).toBe("hit"));
  it("punch beats jump", () => expect(rigState(fighter({ ...all, hitstun: 0 }), false)).toBe("punch"));
  it("jump beats block", () => expect(rigState(fighter({ ...all, hitstun: 0, action: null }), false)).toBe("jump"));
  it("block beats offbounds", () =>
    expect(rigState(fighter({ ...all, hitstun: 0, action: null, grounded: true }), false)).toBe("block"));
  it("offbounds beats walk", () =>
    expect(rigState(fighter({ ...all, hitstun: 0, action: null, grounded: true, blocking: false }), false)).toBe("offbounds"));
  it("walk beats idle", () => expect(rigState(fighter({ vx: 3 }), false)).toBe("walk"));
  it("idle is the floor", () => expect(rigState(fighter(), false)).toBe("idle"));
  it("offbounds at the right edge too", () => expect(rigState(fighter({ x: WORLD.WIDTH }), false)).toBe("offbounds"));
  it("win overrides in computePose", () =>
    expect(computePose(fighter(all), { ...clock, win: true }).state).toBe("win"));
});

describe("punch fist inside the sim hitbox", () => {
  const start = BALANCE.PUNCH_STARTUP;
  const end = start + BALANCE.PUNCH_ACTIVE;
  for (const facing of [1, -1] as const) {
    for (const arm of ["L", "R"] as const) {
      for (let elapsed = start; elapsed < end; elapsed++) {
        it(`facing ${facing} arm ${arm} tick ${elapsed}`, () => {
          const f = fighter({ facing, action: { kind: "punch", arm, elapsed, landed: false, sword: false } });
          const box = punchHitbox(f);
          expect(box).not.toBeNull();
          const j = computePose(f, clock);
          expect(j.state).toBe("punch");
          expect(j.punchingArm).not.toBeNull();
          const fist = j.arms[j.punchingArm!].fist;
          const r = RIG.fist;
          // the whole fist disc, not just its centre, sits inside the box
          expect(fist.x - r).toBeGreaterThan(box!.x);
          expect(fist.x + r).toBeLessThan(box!.x + box!.w);
          expect(fist.y - r).toBeGreaterThan(box!.y);
          expect(fist.y + r).toBeLessThan(box!.y + box!.h);
        });
      }
    }
  }
  it("punchL uses the back arm facing right and the front arm facing left", () => {
    const l = { kind: "punch", arm: "L", elapsed: 5, landed: false, sword: false } as const;
    expect(computePose(fighter({ facing: 1, action: l }), clock).punchingArm).toBe("B");
    expect(computePose(fighter({ facing: -1, action: l }), clock).punchingArm).toBe("F");
  });
  it("active arm is straight: elbow lies on the shoulder-fist line", () => {
    const f = fighter({ action: { kind: "punch", arm: "R", elapsed: 5, landed: false, sword: false } });
    const a = computePose(f, clock).arms.F;
    const cross = (a.elbow.x - a.shoulder.x) * (a.fist.y - a.shoulder.y) - (a.elbow.y - a.shoulder.y) * (a.fist.x - a.shoulder.x);
    expect(Math.abs(cross)).toBeLessThan(1e-6);
  });
});

describe("feet planted while grounded", () => {
  const cases: Array<[string, Partial<FighterState>, Clock]> = [
    ["idle", {}, { ...clock, renderMs: 350 }],
    ["walk", { vx: 3, x: 123 }, clock],
    ["block", { blocking: true }, { ...clock, renderMs: 41 }],
    ["punch startup", { action: { kind: "punch", arm: "L", elapsed: 1, landed: false, sword: false } }, clock],
    ["punch active", { action: { kind: "punch", arm: "L", elapsed: 5, landed: false, sword: false } }, clock],
    ["punch recovery", { action: { kind: "punch", arm: "R", elapsed: 10, landed: false, sword: false } }, clock],
    ["hit", { hitstun: 8 }, clock],
    ["offbounds", { x: 0 }, clock],
    ["win", {}, { ...clock, win: true }],
  ];
  for (const [name, over, c] of cases) {
    for (const facing of [1, -1] as const) {
      it(`${name} facing ${facing}`, () => {
        const f = fighter({ ...over, facing });
        const j = computePose(f, c);
        for (const y of feetOf(j)) expect(y).toBeCloseTo(f.y, 6);
      });
    }
  }
  it("conductor too", () => {
    const j = computePose(fighter({}, 1), clock);
    for (const y of feetOf(j)) expect(y).toBeCloseTo(WORLD.ROOF_Y, 6);
  });
});

describe("ghosts", () => {
  const air = (jumpTicks: number, vy = -6) => fighter({ grounded: false, jumpTicks, vy, vx: 3, y: 380 });
  it("empty before the window", () => expect(computePose(air(2), clock).ghosts).toEqual([]));
  it("two points inside the window", () => {
    for (const t of [3, 6, 10]) {
      const j = computePose(air(t), clock);
      expect(j.ghosts).toHaveLength(2);
      // behind the hip along -velocity: velocity is up-right, so ghosts are below-left of the hip
      expect(j.ghosts[0]!.x).toBeLessThan(j.hip.x);
      expect(j.ghosts[0]!.y).toBeGreaterThan(j.hip.y);
      const d0 = Math.hypot(j.ghosts[0]!.x - j.hip.x, j.ghosts[0]!.y - j.hip.y);
      const d1 = Math.hypot(j.ghosts[1]!.x - j.hip.x, j.ghosts[1]!.y - j.hip.y);
      expect(d0).toBeCloseTo(6, 6);
      expect(d1).toBeCloseTo(12, 6);
    }
  });
  it("empty after the window and when grounded", () => {
    expect(computePose(air(11), clock).ghosts).toEqual([]);
    expect(computePose(fighter({ jumpTicks: 5 }), clock).ghosts).toEqual([]);
  });
});

describe("skeleton sanity", () => {
  it("head is above the neck in every non-ko state", () => {
    const states: Partial<FighterState>[] = [
      {}, { vx: 3 }, { grounded: false, vy: -6 }, { grounded: false, vy: 0 }, { grounded: false, vy: 6 },
      { action: { kind: "punch", arm: "L", elapsed: 5, landed: false, sword: false } }, { blocking: true }, { hitstun: 12 }, { x: 960 },
    ];
    for (const over of states) for (const facing of [1, -1] as const) {
      const j = computePose(fighter({ ...over, facing }), clock);
      expect(j.head.y).toBeLessThan(j.neck.y);
    }
  });
  it("ko collapses the hip toward the feet over 30 frames and holds", () => {
    const f = fighter({ hp: 0 });
    const a = computePose(f, { ...clock, koFrames: 1 });
    const b = computePose(f, { ...clock, koFrames: 30 });
    const c = computePose(f, { ...clock, koFrames: 90 });
    expect(a.state).toBe("ko");
    expect(b.hip.y).toBeGreaterThan(a.hip.y);
    expect(b.hip.y).toBeCloseTo(f.y - 20, 6);
    expect(c.hip).toEqual(b.hip);
  });
  it("world x mirrors with facing", () => {
    const r = computePose(fighter({ facing: 1 }), clock);
    const l = computePose(fighter({ facing: -1 }), clock);
    expect(l.legs.F.foot.x - l.hip.x).toBeCloseTo(-(r.legs.F.foot.x - r.hip.x), 6);
  });
  it("offbounds is drawn at 60 % alpha", () => {
    expect(computePose(fighter({ x: 0 }), clock).alpha).toBeCloseTo(0.6, 6);
    expect(computePose(fighter(), clock).alpha).toBe(1);
  });
});

describe("4.01 rule 2: rest hip at (0, -66) for both characters", () => {
  for (const index of [0, 1] as const) {
    it(`character ${index} idle hip sits 66 px above the feet`, () => {
      const f = fighter({}, index);
      const j = computePose(f, clock); // renderMs 0: no bob
      expect(j.hip.x).toBeCloseTo(f.x, 6);
      expect(j.hip.y).toBeCloseTo(f.y - 66, 6);
      // the legs still reach the ground: knees bend rather than the hip dropping
      for (const y of feetOf(j)) expect(y).toBeCloseTo(f.y, 6);
    });
  }
});

describe("4.01 rule 5: walk legs swing ±28° with phase x / 40", () => {
  const swing = (x: number) => {
    const j = computePose(fighter({ vx: 3, x }), clock);
    const leg = j.legs.F;
    const ankle = { x: leg.foot.x, y: leg.foot.y - 7 };
    return (Math.atan2(ankle.x - leg.hip.x, leg.hip.y - ankle.y) * 180) / Math.PI;
  };
  it("front leg reaches about +28° at the forward extreme and -28° at the back", () => {
    expect(swing(20)).toBeGreaterThan(24); // sin(π/2) = 1
    expect(swing(60)).toBeLessThan(-24); // sin(3π/2) = -1
  });
  it("legs never stretch past their length", () => {
    for (let x = 0; x < 80; x += 4) {
      const j = computePose(fighter({ vx: 3, x }), clock);
      for (const leg of [j.legs.F, j.legs.B]) {
        const ankle = { x: leg.foot.x, y: leg.foot.y - 7 };
        expect(Math.hypot(ankle.x - leg.hip.x, ankle.y - leg.hip.y)).toBeLessThanOrEqual(RIG.thigh + RIG.shin + 2.5);
      }
    }
  });
});

describe("4.01 rule 5: jump sub-poses by vy", () => {
  const air = (vy: number) => computePose(fighter({ grounded: false, vy, y: 380 }), clock);
  const thigh = (j: Joints) => (Math.atan2(j.legs.F.knee.x - j.legs.F.hip.x, j.legs.F.knee.y - j.legs.F.hip.y) * 180) / Math.PI;
  it("apex holds one pose across |vy| ≤ 2", () => {
    const a = air(-2);
    const b = air(0);
    const c = air(2);
    expect(thigh(a)).toBeCloseTo(thigh(b), 6);
    expect(thigh(c)).toBeCloseTo(thigh(b), 6);
  });
  it("rising tucks the knees to 70° and raises the arms; falling extends the legs", () => {
    expect(thigh(air(-6))).toBeCloseTo(70, 6);
    expect(thigh(air(6))).toBeLessThan(25);
    expect(air(-6).arms.F.fist.y).toBeLessThan(air(6).arms.F.fist.y);
    // the blend past the threshold is short: fully rising by |vy| = 3.5
    expect(thigh(air(-3.5))).toBeCloseTo(70, 6);
    expect(thigh(air(-2.5))).toBeGreaterThan(thigh(air(-2)));
  });
});

describe("design/02 block: both fists in front of the face", () => {
  for (const index of [0, 1] as const) {
    it(`character ${index}: fists at eye height, forearms vertical, gloves not stacked`, () => {
      const f = fighter({ blocking: true }, index);
      const j = computePose(f, { ...clock, renderMs: 10 });
      expect(j.state).toBe("block");
      for (const arm of [j.arms.F, j.arms.B]) {
        expect(Math.abs(arm.fist.y - j.head.y)).toBeLessThan(10);
        expect(Math.abs(arm.elbow.x - arm.fist.x)).toBeLessThan(0.01);
        expect(arm.elbow.y).toBeGreaterThan(arm.fist.y);
        expect((arm.fist.x - j.hip.x) * f.facing).toBeGreaterThan(8);
      }
      expect(Math.abs(j.arms.F.fist.x - j.arms.B.fist.x)).toBeGreaterThan(10);
    });
  }
});

// ---- 12.04 action animation ----

import { ARSENAL, THROW } from "@midnight/shared";
import { laserHands, laserStage, throwStage } from "../src/game/rig/pose";

describe("12.04 rule 1: the kamehameha", () => {
  const laser = (elapsed: number, ms = 0): Joints =>
    computePose(fighter({ action: { kind: "laser", elapsed, hit: [] } }), { ...clock, renderMs: ms });
  const guard = computePose(fighter(), clock);
  const dist = (a: { x: number; y: number }, b: { x: number; y: number }): number => Math.hypot(a.x - b.x, a.y - b.y);

  it("rigState: laser beats punch and jump, hit beats laser", () => {
    const f = fighter({ action: { kind: "laser", elapsed: 5, hit: [] }, grounded: false });
    expect(rigState(f, false)).toBe("laser");
    expect(rigState({ ...f, hitstun: 3 }, false)).toBe("hit");
    expect(rigState(fighter({ action: { kind: "throw", item: "banana", arm: "L", phase: "charge", charge: 3, elapsed: 0, released: false } }), false)).toBe("throw");
  });

  it("charge: both fists close on a cupped point behind the hip at 50 % and 100 %, torso coiling back", () => {
    const c = ARSENAL.LASER_CHARGE;
    const at0 = laser(0), at50 = laser(Math.floor(c / 2)), at100 = laser(c - 1);
    expect(laserStage(0)).toEqual({ stage: "charge", t: 0 });
    expect(laserStage(c - 1).stage).toBe("charge");
    // converging at 50 %, cupped behind the hip at 100 %
    expect(at50.arms.F.fist.x).toBeLessThan(at0.arms.F.fist.x);
    expect(at50.arms.B.fist.x).toBeLessThan(at0.arms.B.fist.x);
    expect(at50.arms.F.fist.y).toBeGreaterThan(at0.arms.F.fist.y);
    expect(dist(at100.arms.F.fist, at100.arms.B.fist)).toBeLessThan(8);
    expect(at100.arms.F.fist.x).toBeLessThan(at100.hip.x); // behind the hip (facing right)
    expect(at100.arms.F.fist.y).toBeGreaterThan(at100.arms.F.shoulder.y); // below the shoulder
    for (const j of [at50, at100]) {
      const cup = laserHands(j);
      expect(Math.abs(cup.x - (j.arms.F.fist.x + j.arms.B.fist.x) / 2)).toBeLessThan(1e-9);
    }
    expect(at50.lean).toBeLessThan(at0.lean);
    expect(at100.lean).toBeLessThan(at50.lean);
    expect(at100.head.y).toBeGreaterThan(guard.head.y); // head down and the hip dropped
    // the tremble is deterministic from the render clock and grows with the charge
    expect(laser(c - 1, 0).arms.F.fist).toEqual(laser(c - 1, 0).arms.F.fist);
    expect(laser(c - 1, 18).arms.F.fist.x).not.toBe(laser(c - 1, 0).arms.F.fist.x);
  });

  it("release and hold: both palms thrust ahead of the shoulder inside the beam band", () => {
    const c = ARSENAL.LASER_CHARGE;
    for (const elapsed of [c, c + 2, c + ARSENAL.LASER_ACTIVE - 1]) {
      const j = laser(elapsed);
      const bandTop = WORLD.ROOF_Y - ARSENAL.LASER_BAND_TOP;
      const bandBottom = WORLD.ROOF_Y - ARSENAL.LASER_BAND_BOTTOM;
      for (const arm of [j.arms.F, j.arms.B]) {
        expect(arm.fist.x).toBeGreaterThan(arm.shoulder.x + 40);
        expect(arm.fist.y).toBeGreaterThan(bandTop);
        expect(arm.fist.y).toBeLessThan(bandBottom);
      }
      expect(j.lean).toBeGreaterThan(guard.lean + 10);
      expect(j.state).toBe("laser");
    }
    expect(laserStage(c).stage).toBe("release");
    expect(laserStage(c + 3).stage).toBe("hold");
  });

  it("recovery: eases back to guard, passing it on the way", () => {
    const c = ARSENAL.LASER_CHARGE + ARSENAL.LASER_ACTIVE;
    const r = ARSENAL.LASER_RECOVERY;
    expect(laserStage(c).stage).toBe("recover");
    const mid = laser(c + Math.round(r * 0.6));
    expect(mid.lean).toBeLessThan(guard.lean); // the −4 overshoot
    const end = laser(c + r);
    expect(dist(end.arms.F.fist, guard.arms.F.fist)).toBeLessThan(1);
    expect(dist(end.arms.B.fist, guard.arms.B.fist)).toBeLessThan(1);
    expect(Math.abs(end.lean - guard.lean)).toBeLessThan(1e-6);
  });
});

describe("12.04 rule 2: throws", () => {
  const throwing = (over: Partial<{ phase: "charge" | "release"; charge: number; elapsed: number }>): Joints =>
    computePose(fighter({ item: { kind: "molotov", uses: 2 }, action: { kind: "throw", item: "molotov", arm: "R", phase: "charge", charge: 0, elapsed: 0, released: false, ...over } }), clock);
  const guard = computePose(fighter(), clock);

  it("winds the front arm back and up while charging, snaps it ahead on release, settles to guard", () => {
    const full = throwing({ phase: "charge", charge: THROW.CHARGE_MAX });
    expect(throwStage({ phase: "charge", charge: THROW.CHARGE_MAX, elapsed: 0 })).toEqual({ stage: "windup", t: 1 });
    expect(full.arms.F.fist.x).toBeLessThan(full.arms.F.shoulder.x);
    expect(full.arms.F.fist.y).toBeLessThan(full.arms.F.shoulder.y);
    const rel = throwing({ phase: "release", charge: THROW.CHARGE_MAX, elapsed: 2 });
    expect(rel.arms.F.fist.x).toBeGreaterThan(rel.arms.F.shoulder.x + 40);
    expect(throwStage({ phase: "release", charge: 10, elapsed: 2 }).stage).toBe("release");
    expect(throwStage({ phase: "release", charge: 10, elapsed: THROW.RELEASE_TICKS }).stage).toBe("recover");
    const end = throwing({ phase: "release", charge: 10, elapsed: THROW.RELEASE_TICKS + THROW.RECOVERY });
    expect(Math.hypot(end.arms.F.fist.x - guard.arms.F.fist.x, end.arms.F.fist.y - guard.arms.F.fist.y)).toBeLessThan(1);
    expect(end.state).toBe("throw");
  });
});

describe("12.04 rules 3–6: punch overshoot, jump weight, brace, flash beat", () => {
  const guard = computePose(fighter(), clock);
  it("punch recovery passes guard then settles", () => {
    const s = BALANCE.PUNCH_STARTUP + BALANCE.PUNCH_ACTIVE;
    const mid = computePose(fighter({ action: { kind: "punch", arm: "R", elapsed: s + BALANCE.PUNCH_RECOVERY / 2, landed: false, sword: false } }), clock);
    const end = computePose(fighter({ action: { kind: "punch", arm: "R", elapsed: s + BALANCE.PUNCH_RECOVERY, landed: false, sword: false } }), clock);
    const arm = mid.punchingArm!;
    expect(mid.arms[arm].fist.x).toBeGreaterThan(guard.arms[arm].fist.x - 20);
    expect(Math.abs(end.arms[arm].fist.x - guard.arms[arm].fist.x)).toBeLessThan(1);
    const wind = computePose(fighter({ action: { kind: "punch", arm: "R", elapsed: BALANCE.PUNCH_STARTUP - 1, landed: false, sword: false } }), clock);
    expect(wind.arms[wind.punchingArm!].fist.x).toBeLessThan(guard.arms[wind.punchingArm!].fist.x - 6);
    const sword = computePose(fighter({ action: { kind: "punch", arm: "R", elapsed: BALANCE.PUNCH_STARTUP, landed: false, sword: true } }), clock);
    expect(sword.arms[sword.punchingArm!].fist.y).toBeLessThan(WORLD.ROOF_Y - 110);
  });
  it("takeoff crouches the hip and the apex stretches the torso", () => {
    const takeoff = computePose(fighter({ grounded: false, vy: -9, jumpTicks: 0 }), clock);
    const rising = computePose(fighter({ grounded: false, vy: -9, jumpTicks: 10 }), clock);
    expect(takeoff.hip.y).toBeGreaterThan(rising.hip.y);
    const apex = computePose(fighter({ grounded: false, vy: 0, jumpTicks: 34 }), clock);
    const len = (j: Joints): number => Math.hypot(j.head.x - j.hip.x, j.head.y - j.hip.y);
    expect(len(apex)).toBeGreaterThan(len(rising) * 1.02);
  });
  it("the shield brace raises the front fist and the flash beat raises it overhead", () => {
    const plain = computePose(fighter({ blocking: true }), clock);
    const brace = computePose(fighter({ blocking: true, item: { kind: "shield", uses: 3 } }), clock);
    expect(brace.arms.F.fist.y).toBeLessThan(plain.arms.F.fist.y);
    expect(brace.arms.F.fist.x).toBeGreaterThan(plain.arms.F.fist.x);
    const beat = computePose(fighter(), { ...clock, beat: { kind: "flash", frames: 4 } });
    expect(beat.arms.F.fist.y).toBeLessThan(beat.head.y);
    const noBeat = computePose(fighter(), { ...clock, beat: { kind: "flash", frames: 0 } });
    expect(noBeat.arms.F.fist.y).toBe(guard.arms.F.fist.y);
  });
});
