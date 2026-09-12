/**
 * Pose functions: FighterState plus a render clock -> joint positions in world space.
 * Pure. No Phaser, no DOM, no Date. Spec: implementation-docs/04-design-ux/01-rig-pose.md and
 * HackCMU 2026/design/02-rig-and-animation.md.
 *
 * Local space: origin at the feet, +x toward facing, +y down. Angles in degrees, 0 = straight down,
 * 90 = forward (toward facing), 180 = up. Authored facing right; facing left flips every x offset.
 */
import { ARSENAL, BALANCE, THROW, WORLD, type FighterState } from "@midnight/shared";
import { CHARACTER_RIG, RIG, type CharacterRig } from "./characters";

export interface Pt { x: number; y: number }
export interface Arm { shoulder: Pt; elbow: Pt; wrist: Pt; fist: Pt }
export interface Leg { hip: Pt; knee: Pt; foot: Pt }

export type RigState = "idle" | "walk" | "jump" | "punch" | "chop" | "sweep" | "laser" | "throw" | "block" | "hit" | "slip" | "ko" | "offbounds" | "win";

export interface Clock {
  /** Render time in ms; drives the idle bob, block shudder and win bob. */
  renderMs: number;
  /** Render frames since the KO started; the collapse plays over the first 30. */
  koFrames: number;
  /** Render frames since landing; consumed by the draw-time squash, passed through untouched here. */
  landFrames: number;
  win?: boolean;
  /** 12.04 rule 6: a render-side pose beat with no sim action (the flash's overhead arm), frames left. */
  beat?: { kind: "flash"; frames: number } | undefined;
}

export interface Joints {
  state: RigState;
  alpha: number;
  hip: Pt;
  neck: Pt;
  head: Pt;
  /** Torso lean in degrees, positive toward facing. */
  lean: number;
  arms: { F: Arm; B: Arm };
  legs: { F: Leg; B: Leg };
  punchingArm: "F" | "B" | null;
  /** World points for the jump i-frame ghosts, nearest first. Empty outside the window. */
  ghosts: Pt[];
}

/** The ankle joint sits this far above the sole so the foot capsule (width 8 plus outline) rests on the ground. */
const ANKLE_LIFT = RIG.footW / 2 + 3;
/** The fist disc centre sits this far beyond the wrist along the forearm. */
const FIST_OFF = 4;
const ARM_REACH = RIG.upper + RIG.fore + FIST_OFF;
/** 4.01 rule 2: the rest hip sits here above the sole for both characters; the leg IK absorbs the stance. */
const HIP_HEIGHT = 66;
/** Walk stride (4.01 rule 5): a ±28° swing of the 66 px leg moves the foot about ±31 px. */
const WALK_STRIDE = 31;
/** Opposite-arm counter-swing of ±12° on the 62 px arm, as a fist offset. */
const WALK_ARM_SWING = 13;
/** Block (design/02): fist offsets from the hip line, forearms vertical below them. */
const BLOCK_FIST = { B: { x: 14, dy: -4 }, F: { x: 26, dy: 4 } } as const;
/** Active punch fist target in local space. Must sit inside the sim punch hitbox with the fist radius to spare. */
const PUNCH_FIST: Pt = { x: 63, y: -104 };
/** 9.10: chop — the front arm winds straight overhead, drops through the strike, recovers to guard. */
const CHOP_OVERHEAD: Pt = { x: 6, y: -175 };
const CHOP_STRIKE: Pt = { x: 66, y: -70 };
/** 9.10: sweep — the front arm crosses to the back side at shoulder height, then whips across the front. */
const SWEEP_BACK: Pt = { x: -40, y: -105 };
const SWEEP_FRONT: Pt = { x: 74, y: -100 };
/** 12.04 rule 1: the kamehameha — cupped hands at the back hip, then a two-palm thrust inside the beam band. */
const LASER_CUP = { x: -18, y: -60 };
const LASER_THRUST = { x: 58, y: -80 };
const LASER = { leanBack: 18, headDown: 10, hipDrop: 4, backFoot: 6, leanThrust: 22, frontFoot: 8, headUp: 6, release: 3, trembleHz: 14, shudderHz: 12, overshoot: 4 } as const;
/** 12.04 rule 2: the throw — arm back and up while charging, a snap forward on release. */
const THROW_WIND = { x: -22, y: -26, xT: -10, yT: -8 };
const THROW_RELEASE_FIST = { x: 52, y: -110 };
const THROW_SNAP_TICKS = 2;
/** 12.04 rules 3–6: recovery overshoot past guard, takeoff crouch, apex stretch, brace and flash-beat targets. */
const OVERSHOOT_PX = 3;
const TAKEOFF_TICKS = 2;
const TAKEOFF_CROUCH = 3;
const APEX_STRETCH = 0.04;
const BRACE_FIST = { x: 30, dy: -10 };
const FLASH_BEAT_DEG = 175;

const rad = (deg: number): number => (deg * Math.PI) / 180;
const dir = (deg: number): Pt => ({ x: Math.sin(rad(deg)), y: Math.cos(rad(deg)) });
const add = (a: Pt, b: Pt): Pt => ({ x: a.x + b.x, y: a.y + b.y });
const scale = (a: Pt, k: number): Pt => ({ x: a.x * k, y: a.y * k });
const lerpPt = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const ease = (t: number): number => (t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2);
/** Cubic ease-out: fast start, soft settle (12.04 recoveries). */
const easeOut = (t: number): number => 1 - (1 - t) ** 3;

interface Torso { hip: Pt; neck: Pt; head: Pt; shoulder: Pt; lean: number }

/** Builds the spine from a hip, torso lean and extra head tilt (both positive toward facing). */
function torso(hip: Pt, lean: number, headTilt = 0): Torso {
  const up = dir(180 - lean);
  const neck = add(hip, scale(up, RIG.torso));
  const head = add(neck, scale(dir(180 - lean - headTilt), RIG.neck + RIG.head));
  const shoulder = add(neck, scale(up, -4));
  return { hip, neck, head, shoulder, lean };
}

/** Two-bone IK. Picks the elbow candidate that hangs lower on screen (elbows point down or back). Stretches when out of reach. */
function solve2(a: Pt, target: Pt, l1: number, l2: number, preferLowerJoint: boolean): { mid: Pt; end: Pt } {
  const dx = target.x - a.x;
  const dy = target.y - a.y;
  const d = Math.hypot(dx, dy);
  if (d < 1e-6) return { mid: add(a, { x: 0, y: l1 }), end: target };
  const ux = dx / d;
  const uy = dy / d;
  if (d >= l1 + l2) {
    // out of reach: straight, stretched onto the line so the end point stays where it was asked to be
    return { mid: add(a, { x: ux * l1 * (d / (l1 + l2)), y: uy * l1 * (d / (l1 + l2)) }), end: target };
  }
  const dd = Math.max(d, Math.abs(l1 - l2) + 1e-3);
  const cosA = clamp((l1 * l1 + dd * dd - l2 * l2) / (2 * l1 * dd), -1, 1);
  const sinA = Math.sqrt(1 - cosA * cosA);
  const c1: Pt = { x: a.x + l1 * (ux * cosA - uy * sinA), y: a.y + l1 * (uy * cosA + ux * sinA) };
  const c2: Pt = { x: a.x + l1 * (ux * cosA + uy * sinA), y: a.y + l1 * (uy * cosA - ux * sinA) };
  let mid: Pt;
  if (preferLowerJoint) mid = c1.y > c2.y ? c1 : c2;
  else mid = c1.x > c2.x ? c1 : c2;
  return { mid, end: target };
}

/** Arm reaching for a fist target; the elbow hangs low. Straight when the target is at or beyond reach. */
function armTo(shoulder: Pt, target: Pt): Arm {
  const { mid: elbow } = solve2(shoulder, target, RIG.upper, RIG.fore + FIST_OFF, true);
  const ex = target.x - elbow.x;
  const ey = target.y - elbow.y;
  const el = Math.hypot(ex, ey) || 1;
  const u = { x: ex / el, y: ey / el };
  const wrist = add(elbow, scale(u, RIG.fore));
  const fist = add(wrist, scale(u, FIST_OFF));
  return { shoulder, elbow, wrist, fist };
}

/** Arm as an explicit chain of angles. */
function armAngles(shoulder: Pt, upperDeg: number, foreDeg: number): Arm {
  const elbow = add(shoulder, scale(dir(upperDeg), RIG.upper));
  const wrist = add(elbow, scale(dir(foreDeg), RIG.fore));
  const fist = add(wrist, scale(dir(foreDeg), FIST_OFF));
  return { shoulder, elbow, wrist, fist };
}

/** Forearm straight up to `fist` with the elbow directly below it; the upper arm reaches from the shoulder (elbow tucked). */
function armVertical(shoulder: Pt, fist: Pt): Arm {
  const wrist = { x: fist.x, y: fist.y + FIST_OFF };
  const elbow = { x: fist.x, y: wrist.y + RIG.fore };
  return { shoulder, elbow, wrist, fist };
}

/** Fully straight arm whose fist lands exactly on `target`; the shoulder slides along the line (shoulder thrust). */
function armStraightTo(restShoulder: Pt, target: Pt): Arm {
  const dx = target.x - restShoulder.x;
  const dy = target.y - restShoulder.y;
  const d = Math.hypot(dx, dy) || 1;
  const u = { x: dx / d, y: dy / d };
  const shoulder = add(target, scale(u, -ARM_REACH));
  const elbow = add(shoulder, scale(u, RIG.upper));
  const wrist = add(elbow, scale(u, RIG.fore));
  return { shoulder, elbow, wrist, fist: target };
}

/** Leg with the sole planted on `foot` (ly = 0 when grounded); the knee bends forward. */
function legTo(hip: Pt, foot: Pt): Leg {
  const ankle = { x: foot.x, y: foot.y - ANKLE_LIFT };
  const { mid: knee } = solve2(hip, ankle, RIG.thigh, RIG.shin, false);
  return { hip, knee, foot };
}

/** Leg as an explicit chain of angles; `foot` is the sole under the ankle. */
function legAngles(hip: Pt, thighDeg: number, shinDeg: number): Leg {
  const knee = add(hip, scale(dir(thighDeg), RIG.thigh));
  const ankle = add(knee, scale(dir(shinDeg), RIG.shin));
  return { hip, knee, foot: { x: ankle.x, y: ankle.y + ANKLE_LIFT } };
}

function lerpArm(a: Arm, b: Arm, t: number): Arm {
  return { shoulder: lerpPt(a.shoulder, b.shoulder, t), elbow: lerpPt(a.elbow, b.elbow, t), wrist: lerpPt(a.wrist, b.wrist, t), fist: lerpPt(a.fist, b.fist, t) };
}
function lerpLeg(a: Leg, b: Leg, t: number): Leg {
  return { hip: lerpPt(a.hip, b.hip, t), knee: lerpPt(a.knee, b.knee, t), foot: lerpPt(a.foot, b.foot, t) };
}

/** Extra forward head tilt: the Drifter's hunched shoulders drop his head low and forward. */
const hunch = (rig: CharacterRig): number => (rig.signature === "drifter" ? 10 : 0);

/** Half the distance between the soles at rest. */
const halfStance = (rig: CharacterRig): number => rig.stanceSpread + 3;

/** Rest hip: pinned at (0, -66) per 4.01 rule 2; `rig.kneeBend` is the bend the leg IK produces from the stance. */
function hipHeight(_rig: CharacterRig): number {
  return HIP_HEIGHT;
}

/** Guard fist targets from the character's guard chain; the front fist sits 4 px further forward. */
function guardTargets(rig: CharacterRig, shoulder: Pt, raise = 0): { F: Pt; B: Pt } {
  const chain = armAngles(shoulder, rig.guard.upper, rig.guard.fore).fist;
  return { F: { x: chain.x + 2, y: chain.y - raise }, B: { x: chain.x - 2, y: chain.y - raise } };
}

interface LocalPose {
  alpha: number;
  t: Torso;
  arms: { F: Arm; B: Arm };
  legs: { F: Leg; B: Leg };
  punchingArm: "F" | "B" | null;
}

export function rigState(f: FighterState, koActive: boolean): RigState {
  if (koActive) return "ko";
  if (f.slipped > 0) return "slip";
  if (f.hitstun > 0) return "hit";
  if (f.action?.kind === "laser") return "laser";
  if (f.action?.kind === "punch") return "punch";
  if (f.action?.kind === "slash") return f.action.style;
  if (f.action?.kind === "throw") return "throw";
  if (!f.grounded) return "jump";
  if (f.blocking) return "block";
  if (f.x <= 0 || f.x >= WORLD.WIDTH) return "offbounds";
  if (f.vx !== 0) return "walk";
  return "idle";
}

/** Standing pose: planted feet, resting stance, guard arms; the building block for most states. */
function standing(rig: CharacterRig, hipDy = 0, footDx: { F: number; B: number } = { F: 0, B: 0 }, lean = rig.torsoLean, headTilt = 0, guardRaise = 0): LocalPose {
  const half = halfStance(rig);
  const hip = { x: 0, y: -hipHeight(rig) + hipDy };
  const t = torso(hip, lean, headTilt + hunch(rig));
  const g = guardTargets(rig, t.shoulder, guardRaise);
  return {
    alpha: 1,
    t,
    arms: { F: armTo(t.shoulder, g.F), B: armTo(t.shoulder, g.B) },
    legs: { F: legTo(hip, { x: half + footDx.F, y: 0 }), B: legTo(hip, { x: -half + footDx.B, y: 0 }) },
    punchingArm: null,
  };
}

function idlePose(rig: CharacterRig, ms: number): LocalPose {
  const bob = Math.sin((ms * 2 * Math.PI) / 1400) * 3;
  return standing(rig, bob);
}

function walkPose(rig: CharacterRig, f: FighterState): LocalPose {
  const phase = (f.x / 40) * Math.PI;
  const s = Math.sin(phase);
  const backward = f.vx * f.facing < 0;
  const half = halfStance(rig);
  // Feet swing ±WALK_STRIDE about the hip (±28° of leg); the rest stance fades out toward the extremes so the
  // legs cross mid-stride and never reach past their length. Hip bob 2 px at double frequency, lowest at the
  // extremes (double support), highest as the legs pass.
  const stride = { F: WALK_STRIDE * s - half * s * s, B: -WALK_STRIDE * s + half * s * s };
  const p = standing(rig, 2 * s * s - 1, stride, rig.torsoLean + 3, 0, backward ? 10 : 0);
  // opposite arm swings with the leg: front leg forward -> back arm forward
  const g = guardTargets(rig, p.t.shoulder, backward ? 10 : 0);
  p.arms.F = armTo(p.t.shoulder, add(g.F, { x: -WALK_ARM_SWING * s, y: 2 * Math.abs(s) }));
  p.arms.B = armTo(p.t.shoulder, add(g.B, { x: WALK_ARM_SWING * s, y: 2 * Math.abs(s) }));
  return p;
}

/** Scales the neck, shoulder and head away from the hip (12.04 rule 4). */
function stretchTorso(t: Torso, k: number): Torso {
  const from = (p: Pt): Pt => add(t.hip, scale(add(p, scale(t.hip, -1)), k));
  return { ...t, neck: from(t.neck), head: from(t.head), shoulder: from(t.shoulder) };
}

interface AirSub { thighF: number; shinF: number; thighB: number; shinB: number; armF: number; armB: number; reach: number; lean: number }
// design/02 jump row. Arm angles use this file's convention (90 = forward, 180 = up): "arms up 30°" is 30° above
// forward = 120; "arms out 20°" is 20° below forward = 70. Rising: knees tucked to 70°.
const RISING: AirSub = { thighF: 70, shinF: -30, thighB: 64, shinB: -20, armF: 120, armB: 132, reach: 0.72, lean: 8 };
const APEX: AirSub = { thighF: 48, shinF: -8, thighB: 34, shinB: 0, armF: 105, armB: 118, reach: 0.78, lean: 4 };
const FALLING: AirSub = { thighF: 18, shinF: 6, thighB: 6, shinB: -4, armF: 70, armB: 84, reach: 0.85, lean: 0 };
/** Sub-pose thresholds: apex while |vy| ≤ 2, fully rising / falling once |vy| passes the threshold by the blend width. */
const AIR_THRESHOLD = 2;
const AIR_BLEND = 1.5;
function lerpSub(a: AirSub, b: AirSub, t: number): AirSub {
  const out = {} as AirSub;
  for (const k of Object.keys(a) as (keyof AirSub)[]) out[k] = lerp(a[k], b[k], t);
  return out;
}

function jumpPose(rig: CharacterRig, f: FighterState): LocalPose {
  const k = clamp((Math.abs(f.vy) - AIR_THRESHOLD) / AIR_BLEND, 0, 1);
  const sub = f.vy < 0 ? lerpSub(APEX, RISING, k) : lerpSub(APEX, FALLING, k);
  // 12.04 rule 4: a crouch on the first airborne ticks, a stretch of the torso at the apex
  const takeoff = f.vy < 0 && f.jumpTicks < TAKEOFF_TICKS;
  const hip = { x: 0, y: -hipHeight(rig) + (takeoff ? TAKEOFF_CROUCH : 0) };
  const t = stretchTorso(torso(hip, rig.torsoLean + sub.lean), 1 + APEX_STRETCH * (1 - k));
  return {
    alpha: 1,
    t,
    arms: {
      F: armTo(t.shoulder, add(t.shoulder, scale(dir(sub.armF), ARM_REACH * sub.reach))),
      B: armTo(t.shoulder, add(t.shoulder, scale(dir(sub.armB), ARM_REACH * sub.reach))),
    },
    legs: { F: legAngles(hip, sub.thighF, sub.shinF), B: legAngles(hip, sub.thighB, sub.shinB) },
    punchingArm: null,
  };
}

function punchPose(rig: CharacterRig, f: FighterState): LocalPose {
  const action = f.action;
  if (!action || action.kind !== "punch") return standing(rig);
  const { PUNCH_STARTUP: s, PUNCH_ACTIVE: a, PUNCH_RECOVERY: r } = BALANCE;
  const e = action.elapsed;
  // 9.10: a punch with a sword is a plain punch; the slashes have their own poses
  const target = PUNCH_FIST;
  // the player's left arm is the back arm when facing right and the front arm when facing left
  const arm: "F" | "B" = (action.arm === "L") === (f.facing === 1) ? "B" : "F";
  const other: "F" | "B" = arm === "F" ? "B" : "F";
  let lean: number;
  let footDx = { F: 0, B: 0 };
  // 12.04 rule 3: a harder coil in startup, an overshoot past guard in recovery
  if (e < s) lean = rig.torsoLean - 5 * (e / s);
  else if (e < s + a) { lean = rig.torsoLean + 8; footDx = { F: 6, B: 0 }; }
  else { const t = ease(clamp((e - s - a) / r, 0, 1)); lean = rig.torsoLean + 8 * (1 - t); footDx = { F: 6 * (1 - t), B: 0 }; }
  const p = standing(rig, 0, footDx, lean);
  const g = guardTargets(rig, p.t.shoulder);
  if (e < s) {
    const t = e / s;
    const wind = { x: -14 * t, y: -4 * t };
    p.arms[arm] = armTo(p.t.shoulder, add(g[arm], wind));
  } else if (e < s + a) {
    p.arms[arm] = armStraightTo(p.t.shoulder, target);
    p.arms[other] = armTo(p.t.shoulder, add(g[other], { x: -6, y: 0 }));
  } else {
    const t = ease(clamp((e - s - a) / r, 0, 1));
    const active = armTo(p.t.shoulder, target); // clamped to reach from the resting shoulder
    const overshoot = { x: -OVERSHOOT_PX * Math.sin(Math.PI * t), y: 0 };
    p.arms[arm] = lerpArm(active, armTo(p.t.shoulder, add(g[arm], overshoot)), t);
    p.arms[other] = armTo(p.t.shoulder, add(g[other], { x: -6 * (1 - t), y: 0 }));
  }
  p.punchingArm = arm;
  return p;
}

/** 9.10: which phase a slash is in from `elapsed` against its ARSENAL timings. Pure. */
export function slashStage(style: "chop" | "sweep", elapsed: number): { stage: "startup" | "active" | "recover"; t: number } {
  const s = style === "chop" ? ARSENAL.CHOP_STARTUP : ARSENAL.SWEEP_STARTUP;
  const a = style === "chop" ? ARSENAL.CHOP_ACTIVE : ARSENAL.SWEEP_ACTIVE;
  const r = style === "chop" ? ARSENAL.CHOP_RECOVERY : ARSENAL.SWEEP_RECOVERY;
  if (elapsed < s) return { stage: "startup", t: clamp(elapsed / s, 0, 1) };
  if (elapsed < s + a) return { stage: "active", t: clamp((elapsed - s) / a, 0, 1) };
  return { stage: "recover", t: clamp((elapsed - s - a) / r, 0, 1) };
}

/** 9.10: chop — arm overhead in startup, driven down through the active frames, settling back to guard. */
function chopPose(rig: CharacterRig, f: FighterState): LocalPose {
  const action = f.action;
  if (!action || action.kind !== "slash") return standing(rig);
  const { stage, t } = slashStage("chop", action.elapsed);
  const lean = stage === "startup" ? rig.torsoLean - 8 * t : stage === "active" ? rig.torsoLean + 12 : rig.torsoLean + 12 * (1 - ease(t));
  const footDx = stage === "startup" ? { F: 0, B: 0 } : { F: 8 * (stage === "active" ? 1 : 1 - ease(t)), B: 0 };
  const p = standing(rig, stage === "active" ? 4 : 0, footDx, lean, stage === "startup" ? -6 * t : 4);
  const g = guardTargets(rig, p.t.shoulder);
  if (stage === "startup") {
    p.arms.F = armTo(p.t.shoulder, lerpPt(g.F, CHOP_OVERHEAD, ease(t)));
  } else if (stage === "active") {
    p.arms.F = armStraightTo(p.t.shoulder, lerpPt(CHOP_OVERHEAD, CHOP_STRIKE, t));
    p.arms.B = armTo(p.t.shoulder, add(g.B, { x: -6, y: 0 }));
  } else {
    p.arms.F = lerpArm(armTo(p.t.shoulder, CHOP_STRIKE), armTo(p.t.shoulder, g.F), ease(t));
    p.arms.B = armTo(p.t.shoulder, add(g.B, { x: -6 * (1 - t), y: 0 }));
  }
  p.punchingArm = "F";
  return p;
}

/** 9.10: sweep — the arm drawn across the body, then whipped across the front at shoulder height. */
function sweepPose(rig: CharacterRig, f: FighterState): LocalPose {
  const action = f.action;
  if (!action || action.kind !== "slash") return standing(rig);
  const { stage, t } = slashStage("sweep", action.elapsed);
  const lean = stage === "startup" ? rig.torsoLean - 4 * t : stage === "active" ? rig.torsoLean + 6 : rig.torsoLean + 6 * (1 - ease(t));
  const footDx = stage === "active" ? { F: 10, B: 4 } : stage === "recover" ? { F: 10 * (1 - ease(t)), B: 4 * (1 - ease(t)) } : { F: 0, B: 0 };
  const p = standing(rig, 0, footDx, lean);
  const g = guardTargets(rig, p.t.shoulder);
  if (stage === "startup") {
    p.arms.F = armTo(p.t.shoulder, lerpPt(g.F, SWEEP_BACK, ease(t)));
  } else if (stage === "active") {
    p.arms.F = armStraightTo(p.t.shoulder, lerpPt(SWEEP_BACK, SWEEP_FRONT, ease(t)));
    p.arms.B = armTo(p.t.shoulder, add(g.B, { x: -8, y: 4 }));
  } else {
    p.arms.F = lerpArm(armTo(p.t.shoulder, SWEEP_FRONT), armTo(p.t.shoulder, g.F), ease(t));
    p.arms.B = armTo(p.t.shoulder, add(g.B, { x: -8 * (1 - t), y: 4 * (1 - t) }));
  }
  p.punchingArm = "F";
  return p;
}

/** 12.04 rule 1: where the laser is in its three stages, from `elapsed` against the 9.05 boundaries. Pure. */
export function laserStage(elapsed: number): { stage: "charge" | "release" | "hold" | "recover"; t: number } {
  const { LASER_CHARGE: c, LASER_ACTIVE: a, LASER_RECOVERY: r } = ARSENAL;
  if (elapsed < c) return { stage: "charge", t: clamp(elapsed / c, 0, 1) };
  if (elapsed < c + LASER.release) return { stage: "release", t: (elapsed - c) / LASER.release };
  if (elapsed < c + a) return { stage: "hold", t: (elapsed - c - LASER.release) / Math.max(1, a - LASER.release) };
  return { stage: "recover", t: clamp((elapsed - c - a) / r, 0, 1) };
}

/** The kamehameha (12.04 rule 1). Hands stay open; `laserHands` is the cupped point the ring and beam anchor to. */
function laserPose(rig: CharacterRig, f: FighterState, ms: number): LocalPose {
  const elapsed = f.action?.kind === "laser" ? f.action.elapsed : 0;
  const { stage, t } = laserStage(elapsed);
  if (stage === "charge") {
    const p = standing(rig, LASER.hipDrop * t, { F: 0, B: -LASER.backFoot * t }, rig.torsoLean - LASER.leanBack * t, LASER.headDown * t);
    const tremble = Math.sin((ms * 2 * Math.PI * LASER.trembleHz) / 1000) * t * t;
    const g = guardTargets(rig, p.t.shoulder);
    const cupF = { x: LASER_CUP.x + 2 + tremble, y: LASER_CUP.y - 2 - tremble };
    const cupB = { x: LASER_CUP.x - 2 - tremble, y: LASER_CUP.y + 2 + tremble };
    p.arms.F = armTo(p.t.shoulder, lerpPt(g.F, cupF, ease(t)));
    p.arms.B = armTo(p.t.shoulder, lerpPt(g.B, cupB, ease(t)));
    return p;
  }
  const thrust = (shudder: number): LocalPose => {
    const p = standing(rig, 0, { F: LASER.frontFoot, B: 0 }, rig.torsoLean + LASER.leanThrust, -LASER.headUp);
    p.arms.F = armStraightTo(p.t.shoulder, { x: LASER_THRUST.x, y: LASER_THRUST.y + shudder });
    p.arms.B = armStraightTo(p.t.shoulder, { x: LASER_THRUST.x - 2, y: LASER_THRUST.y + 3 + shudder });
    return p;
  };
  if (stage === "release") return thrust(0);
  if (stage === "hold") return thrust(Math.sin((ms * 2 * Math.PI * LASER.shudderHz) / 1000) >= 0 ? 0.5 : -0.5);
  // recover: a fast ease-out back to guard, the lean passing the rest lean by up to −4 around t ≈ 0.6
  const e = easeOut(t);
  const lean = lerp(rig.torsoLean + LASER.leanThrust, rig.torsoLean, e) - LASER.overshoot * Math.sin(Math.PI * t);
  const p = standing(rig, 0, { F: LASER.frontFoot * (1 - e), B: 0 }, lean, -LASER.headUp * (1 - e));
  const from = thrust(0);
  const g = guardTargets(rig, p.t.shoulder);
  p.arms.F = lerpArm(from.arms.F, armTo(p.t.shoulder, g.F), e);
  p.arms.B = lerpArm(from.arms.B, armTo(p.t.shoulder, g.B), e);
  return p;
}

/** 12.04 rule 2: where a throw is, from the 9.08 action (charge phase, then release ticks and recovery). Pure. */
export function throwStage(action: { phase: "charge" | "release"; charge: number; elapsed: number }): { stage: "windup" | "release" | "recover"; t: number } {
  if (action.phase === "charge") return { stage: "windup", t: clamp(action.charge / THROW.CHARGE_MAX, 0, 1) };
  if (action.elapsed < THROW.RELEASE_TICKS) return { stage: "release", t: clamp(action.elapsed / THROW_SNAP_TICKS, 0, 1) };
  return { stage: "recover", t: clamp((action.elapsed - THROW.RELEASE_TICKS) / THROW.RECOVERY, 0, 1) };
}

function throwPose(rig: CharacterRig, f: FighterState): LocalPose {
  const action = f.action;
  if (!action || action.kind !== "throw") return standing(rig);
  const { stage, t } = throwStage(action);
  const arm: "F" | "B" = (action.arm === "L") === (f.facing === 1) ? "B" : "F";
  const other: "F" | "B" = arm === "F" ? "B" : "F";
  if (stage === "windup") {
    const p = standing(rig, 0, { F: 0, B: -4 * t }, rig.torsoLean - 6 * t);
    const g = guardTargets(rig, p.t.shoulder);
    const back = add(p.t.shoulder, { x: THROW_WIND.x + THROW_WIND.xT * t, y: THROW_WIND.y + THROW_WIND.yT * t });
    p.arms[arm] = armTo(p.t.shoulder, lerpPt(g[arm], back, ease(Math.min(1, t * 3))));
    p.arms[other] = armTo(p.t.shoulder, g[other]);
    return p;
  }
  const snapped = (): LocalPose => {
    const p = standing(rig, 0, { F: 6, B: 0 }, rig.torsoLean + 14);
    const g = guardTargets(rig, p.t.shoulder);
    p.arms[arm] = armStraightTo(p.t.shoulder, THROW_RELEASE_FIST);
    p.arms[other] = armTo(p.t.shoulder, add(g[other], { x: -6, y: 0 }));
    return p;
  };
  if (stage === "release") {
    const from = standing(rig, 0, { F: 0, B: -4 }, rig.torsoLean - 6);
    const gf = guardTargets(rig, from.t.shoulder);
    from.arms[arm] = armTo(from.t.shoulder, add(from.t.shoulder, { x: THROW_WIND.x + THROW_WIND.xT, y: THROW_WIND.y + THROW_WIND.yT }));
    from.arms[other] = armTo(from.t.shoulder, gf[other]);
    const to = snapped();
    const k = ease(t);
    return {
      alpha: 1,
      t: lerpTorso(from.t, to.t, k),
      arms: { F: lerpArm(from.arms.F, to.arms.F, k), B: lerpArm(from.arms.B, to.arms.B, k) },
      legs: { F: lerpLeg(from.legs.F, to.legs.F, k), B: lerpLeg(from.legs.B, to.legs.B, k) },
      punchingArm: null,
    };
  }
  const e = ease(t);
  const p = standing(rig, 0, { F: 6 * (1 - e), B: 0 }, rig.torsoLean + 14 * (1 - e));
  const g = guardTargets(rig, p.t.shoulder);
  const from = snapped();
  const overshoot = { x: -OVERSHOOT_PX * Math.sin(Math.PI * t), y: 0 };
  p.arms[arm] = lerpArm(from.arms[arm], armTo(p.t.shoulder, add(g[arm], overshoot)), e);
  p.arms[other] = armTo(p.t.shoulder, add(g[other], { x: -6 * (1 - e), y: 0 }));
  return p;
}

function lerpTorso(a: Torso, b: Torso, t: number): Torso {
  return { hip: lerpPt(a.hip, b.hip, t), neck: lerpPt(a.neck, b.neck, t), head: lerpPt(a.head, b.head, t), shoulder: lerpPt(a.shoulder, b.shoulder, t), lean: lerp(a.lean, b.lean, t) };
}

function blockPose(rig: CharacterRig, ms: number, shield = false): LocalPose {
  const shudder = Math.sin((ms * 2 * Math.PI * 12) / 1000) >= 0 ? 0.5 : -0.5;
  const p = standing(rig, 0, { F: 0, B: 0 }, rig.torsoLean - 4);
  const sh = add(p.t.shoulder, { x: shudder, y: 0 });
  // both forearms vertical in front of the face, fists at eye height, offset so both gloves read
  const eye = p.t.head.y - 2;
  p.arms.B = armVertical(sh, { x: BLOCK_FIST.B.x + shudder, y: eye + BLOCK_FIST.B.dy });
  // 12.04 rule 5: with a shield the front forearm is raised higher and further forward (the barrier is held)
  const front = shield ? BRACE_FIST : BLOCK_FIST.F;
  p.arms.F = armVertical(sh, { x: front.x + shudder, y: eye + front.dy });
  return p;
}

/** 12.04 rule 6: the flash beat — the front arm overhead for a few render frames on a grounded, un-acted pose. */
function applyBeat(p: LocalPose, beat: Clock["beat"]): LocalPose {
  if (!beat || beat.frames <= 0) return p;
  const t = torso(p.t.hip, p.t.lean - 4);
  p.t = t;
  p.arms.F = armTo(t.shoulder, add(t.shoulder, scale(dir(FLASH_BEAT_DEG), ARM_REACH * 0.95)));
  return p;
}

/** The cupped point of the laser (12.04 rule 1): midway between the fists, where the charge ring orbits and the beam caps. */
export function laserHands(j: Joints): Pt {
  return lerpPt(j.arms.F.fist, j.arms.B.fist, 0.5);
}

function hitPose(rig: CharacterRig, hitstun: number): LocalPose {
  const k = clamp(hitstun / BALANCE.HITSTUN_TICKS, 0, 1);
  const p = standing(rig, 0, { F: 6 * k, B: 0 }, rig.torsoLean - 20 * k, -8 * k);
  const g = guardTargets(rig, p.t.shoulder);
  p.arms.F = armTo(p.t.shoulder, lerpPt(g.F, add(p.t.shoulder, { x: -22, y: 30 }), k));
  p.arms.B = armTo(p.t.shoulder, lerpPt(g.B, add(p.t.shoulder, { x: -30, y: 22 }), k));
  return p;
}

function koPose(rig: CharacterRig, frames: number): LocalPose {
  const t = ease(clamp(frames / 30, 0, 1));
  const from = hitPose(rig, BALANCE.HITSTUN_TICKS);
  const hip = { x: -6, y: -20 };
  const tor = torso(hip, -80, -12);
  const to: LocalPose = {
    alpha: 1,
    t: tor,
    arms: {
      F: armTo(tor.shoulder, { x: 10, y: -ANKLE_LIFT - 2 }),
      B: armTo(tor.shoulder, { x: -96, y: -ANKLE_LIFT }),
    },
    legs: { F: legAngles(hip, 120, 30), B: legAngles(hip, 110, 40) },
    punchingArm: null,
  };
  // soles never sink below the ground while sprawled
  for (const leg of [to.legs.F, to.legs.B]) leg.foot.y = Math.min(leg.foot.y, 0);
  const T = (a: Torso, b: Torso): Torso => ({
    hip: lerpPt(a.hip, b.hip, t), neck: lerpPt(a.neck, b.neck, t), head: lerpPt(a.head, b.head, t),
    shoulder: lerpPt(a.shoulder, b.shoulder, t), lean: lerp(a.lean, b.lean, t),
  });
  return {
    alpha: 1,
    t: T(from.t, to.t),
    arms: { F: lerpArm(from.arms.F, to.arms.F, t), B: lerpArm(from.arms.B, to.arms.B, t) },
    legs: { F: lerpLeg(from.legs.F, to.legs.F, t), B: lerpLeg(from.legs.B, to.legs.B, t) },
    punchingArm: null,
  };
}

/** How far into the floor pose a slip is: falls over SLIP_FALL frames, lies, gets up over the last SLIP_RISE. */
export function slipStage(slipped: number): { stage: "fall" | "down" | "rise"; t: number } {
  const elapsed = ARSENAL.SLIP_STUN - slipped;
  if (elapsed < SLIP_FALL) return { stage: "fall", t: elapsed / SLIP_FALL };
  if (slipped > SLIP_RISE) return { stage: "down", t: 1 };
  return { stage: "rise", t: 1 - slipped / SLIP_RISE };
}
const SLIP_FALL = 12;
const SLIP_RISE = 15;

function lerpPose(a: LocalPose, b: LocalPose, t: number): LocalPose {
  return {
    alpha: lerp(a.alpha, b.alpha, t),
    t: {
      hip: lerpPt(a.t.hip, b.t.hip, t), neck: lerpPt(a.t.neck, b.t.neck, t), head: lerpPt(a.t.head, b.t.head, t),
      shoulder: lerpPt(a.t.shoulder, b.t.shoulder, t), lean: lerp(a.t.lean, b.t.lean, t),
    },
    arms: { F: lerpArm(a.arms.F, b.arms.F, t), B: lerpArm(a.arms.B, b.arms.B, t) },
    legs: { F: lerpLeg(a.legs.F, b.legs.F, t), B: lerpLeg(a.legs.B, b.legs.B, t) },
    punchingArm: null,
  };
}

/** Owner 2026-09-12: a banana slip puts the fighter flat on the floor (the KO sprawl) for SLIP_STUN, then up again. */
function slipPose(rig: CharacterRig, f: FighterState): LocalPose {
  const { stage, t } = slipStage(f.slipped);
  const down = koPose(rig, 30);
  if (stage === "fall") return koPose(rig, 30 * t);
  if (stage === "down") return down;
  return lerpPose(down, standing(rig), ease(t));
}

function offboundsPose(rig: CharacterRig): LocalPose {
  const p = standing(rig, 0, { F: 8, B: -4 }, rig.torsoLean + 25, 6);
  const g = guardTargets(rig, p.t.shoulder);
  p.arms.F = armTo(p.t.shoulder, add(p.t.shoulder, scale(dir(152), ARM_REACH * 0.92)));
  p.arms.B = armTo(p.t.shoulder, add(g.B, { x: 6, y: -10 }));
  p.alpha = 0.6;
  return p;
}

function winPose(rig: CharacterRig, ms: number): LocalPose {
  const bob = Math.sin((ms * 2 * Math.PI) / 1400) * 2;
  const p = standing(rig, bob, { F: 0, B: 0 }, rig.torsoLean - 4);
  p.arms.F = armTo(p.t.shoulder, add(p.t.shoulder, scale(dir(158), ARM_REACH * 0.94)));
  p.arms.B = armTo(p.t.shoulder, add(p.t.shoulder, scale(dir(172), ARM_REACH * 0.9)));
  return p;
}

export function computePose(f: FighterState, clock: Clock): Joints {
  const rig = CHARACTER_RIG[f.character];
  const state: RigState = clock.win ? "win" : rigState(f, f.hp <= 0);
  let p: LocalPose;
  switch (state) {
    case "ko": p = koPose(rig, clock.koFrames); break;
    case "hit": p = hitPose(rig, f.hitstun); break;
    case "slip": p = slipPose(rig, f); break;
    case "punch": p = punchPose(rig, f); break;
    case "chop": p = chopPose(rig, f); break;
    case "sweep": p = sweepPose(rig, f); break;
    case "laser": p = laserPose(rig, f, clock.renderMs); break;
    case "throw": p = throwPose(rig, f); break;
    case "jump": p = jumpPose(rig, f); break;
    case "block": p = blockPose(rig, clock.renderMs, f.item?.kind === "shield"); break;
    case "offbounds": p = offboundsPose(rig); break;
    case "walk": p = applyBeat(walkPose(rig, f), clock.beat); break;
    case "win": p = winPose(rig, clock.renderMs); break;
    default: p = applyBeat(idlePose(rig, clock.renderMs), clock.beat);
  }
  const W = (l: Pt): Pt => ({ x: f.x + f.facing * l.x, y: f.y + l.y });
  const WA = (a: Arm): Arm => ({ shoulder: W(a.shoulder), elbow: W(a.elbow), wrist: W(a.wrist), fist: W(a.fist) });
  const WL = (l: Leg): Leg => ({ hip: W(l.hip), knee: W(l.knee), foot: W(l.foot) });
  const hip = W(p.t.hip);

  const ghosts: Pt[] = [];
  if (!f.grounded && f.jumpTicks >= BALANCE.JUMP_IFRAME_START && f.jumpTicks <= BALANCE.JUMP_IFRAME_END) {
    const len = Math.hypot(f.vx, f.vy);
    const back = len > 1e-6 ? { x: -f.vx / len, y: -f.vy / len } : { x: 0, y: 1 };
    ghosts.push(add(hip, scale(back, 6)), add(hip, scale(back, 12)));
  }

  return {
    state,
    alpha: p.alpha,
    hip,
    neck: W(p.t.neck),
    head: W(p.t.head),
    lean: p.t.lean,
    arms: { F: WA(p.arms.F), B: WA(p.arms.B) },
    legs: { F: WL(p.legs.F), B: WL(p.legs.B) },
    punchingArm: p.punchingArm,
    ghosts,
  };
}
