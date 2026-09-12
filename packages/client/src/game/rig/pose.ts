/**
 * Pose functions: FighterState plus a render clock -> joint positions in world space.
 * Pure. No Phaser, no DOM, no Date. Spec: implementation-docs/04-design-ux/01-rig-pose.md and
 * HackCMU 2026/design/02-rig-and-animation.md.
 *
 * Local space: origin at the feet, +x toward facing, +y down. Angles in degrees, 0 = straight down,
 * 90 = forward (toward facing), 180 = up. Authored facing right; facing left flips every x offset.
 */
import { BALANCE, WORLD, type FighterState } from "@midnight/shared";
import { CHARACTER_RIG, RIG, type CharacterRig } from "./characters";

export interface Pt { x: number; y: number }
export interface Arm { shoulder: Pt; elbow: Pt; wrist: Pt; fist: Pt }
export interface Leg { hip: Pt; knee: Pt; foot: Pt }

export type RigState = "idle" | "walk" | "jump" | "punch" | "block" | "hit" | "ko" | "offbounds" | "win";

export interface Clock {
  /** Render time in ms; drives the idle bob, block shudder and win bob. */
  renderMs: number;
  /** Render frames since the KO started; the collapse plays over the first 30. */
  koFrames: number;
  /** Render frames since landing; consumed by the draw-time squash, passed through untouched here. */
  landFrames: number;
  win?: boolean;
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

const rad = (deg: number): number => (deg * Math.PI) / 180;
const dir = (deg: number): Pt => ({ x: Math.sin(rad(deg)), y: Math.cos(rad(deg)) });
const add = (a: Pt, b: Pt): Pt => ({ x: a.x + b.x, y: a.y + b.y });
const scale = (a: Pt, k: number): Pt => ({ x: a.x * k, y: a.y * k });
const lerpPt = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const ease = (t: number): number => (t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2);

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
  if (f.hitstun > 0) return "hit";
  if (f.action?.kind === "punch") return "punch";
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
  const hip = { x: 0, y: -hipHeight(rig) };
  const t = torso(hip, rig.torsoLean + sub.lean);
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
  if (!action) return standing(rig);
  const { PUNCH_STARTUP: s, PUNCH_ACTIVE: a, PUNCH_RECOVERY: r } = BALANCE;
  const e = action.elapsed;
  // the player's left arm is the back arm when facing right and the front arm when facing left
  const arm: "F" | "B" = (action.arm === "L") === (f.facing === 1) ? "B" : "F";
  const other: "F" | "B" = arm === "F" ? "B" : "F";
  let lean: number;
  let footDx = { F: 0, B: 0 };
  if (e < s) lean = rig.torsoLean - 3 * (e / s);
  else if (e < s + a) { lean = rig.torsoLean + 8; footDx = { F: 6, B: 0 }; }
  else { const t = ease(clamp((e - s - a) / r, 0, 1)); lean = rig.torsoLean + 8 * (1 - t); footDx = { F: 6 * (1 - t), B: 0 }; }
  const p = standing(rig, 0, footDx, lean);
  const g = guardTargets(rig, p.t.shoulder);
  if (e < s) {
    const t = e / s;
    p.arms[arm] = armTo(p.t.shoulder, add(g[arm], { x: -10 * t, y: -2 * t }));
  } else if (e < s + a) {
    p.arms[arm] = armStraightTo(p.t.shoulder, PUNCH_FIST);
    p.arms[other] = armTo(p.t.shoulder, add(g[other], { x: -6, y: 0 }));
  } else {
    const t = ease(clamp((e - s - a) / r, 0, 1));
    const active = armTo(p.t.shoulder, PUNCH_FIST); // clamped to reach from the resting shoulder
    p.arms[arm] = lerpArm(active, armTo(p.t.shoulder, g[arm]), t);
    p.arms[other] = armTo(p.t.shoulder, add(g[other], { x: -6 * (1 - t), y: 0 }));
  }
  p.punchingArm = arm;
  return p;
}

function blockPose(rig: CharacterRig, ms: number): LocalPose {
  const shudder = Math.sin((ms * 2 * Math.PI * 12) / 1000) >= 0 ? 0.5 : -0.5;
  const p = standing(rig, 0, { F: 0, B: 0 }, rig.torsoLean - 4);
  const sh = add(p.t.shoulder, { x: shudder, y: 0 });
  // both forearms vertical in front of the face, fists at eye height, offset so both gloves read
  const eye = p.t.head.y - 2;
  p.arms.B = armVertical(sh, { x: BLOCK_FIST.B.x + shudder, y: eye + BLOCK_FIST.B.dy });
  p.arms.F = armVertical(sh, { x: BLOCK_FIST.F.x + shudder, y: eye + BLOCK_FIST.F.dy });
  return p;
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
    case "punch": p = punchPose(rig, f); break;
    case "jump": p = jumpPose(rig, f); break;
    case "block": p = blockPose(rig, clock.renderMs); break;
    case "offbounds": p = offboundsPose(rig); break;
    case "walk": p = walkPose(rig, f); break;
    case "win": p = winPose(rig, clock.renderMs); break;
    default: p = idlePose(rig, clock.renderMs);
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
