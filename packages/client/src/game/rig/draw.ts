/**
 * Renders Joints onto a Phaser Graphics object. Style rules from design/00 (capsule limbs, 3 px outline,
 * warm rim on the screen-right edge), signature shapes from design/01, spec in
 * implementation-docs/04-design-ux/02-rig-draw.md. Everything here is Graphics calls; no assets, no setScale.
 */
import type Phaser from "phaser";
import type { CharacterId } from "@midnight/shared";
import { P } from "../palette";
import { snap } from "../pixel";
import { CHARACTER_RIG, RIG, type CharacterRig } from "./characters";
import type { Arm, Joints, Leg, Pt } from "./pose";

type G = Phaser.GameObjects.Graphics;

export interface DrawOpts {
  facing: 1 | -1;
  /** Rim stroke colour (0xRRGGBB): `lamp`, `glow1` or `amber1` from the light rig (12.02). */
  rim: number;
  /** 12.02: the lit edge of every shape; `"both"` in the tunnel (wall lamps on both sides). Default screen-right. */
  rimSide?: "left" | "right" | "both";
  /** 12.02: 0..0.25 mix of every fill toward night1; outline and rim untouched. */
  gloom?: number;
  /** Flash colour mixed into every fill (damage / chip flash). Outlines and rim stay; the rig stays opaque. */
  fillOverride?: number;
  /** With `fillOverride`: the mix weight toward it (0.7 = mostly flash colour). Without it: multiplies every alpha. */
  fillAlpha?: number;
  /** Vertical scale of the torso, head and arms about the feet (1 = none); width scales by the inverse. Legs stay put. */
  squash?: number;
  /** Roof scroll speed in px/s; loose shapes lean screen-left by 2 + windSpeed / 120 px. */
  windSpeed: number;
}

const OUTLINE_W = 3;
const MAX_GLOOM = 0.25;
/** Which edges carry the rim stroke: +1 screen-right, −1 screen-left. */
const sides = (side: "left" | "right" | "both"): readonly (1 | -1)[] => (side === "both" ? [1, -1] : side === "left" ? [-1] : [1]);
const ANKLE_LIFT = RIG.footW / 2 + 3;
/** Drifter hair wedges, crown to nape: length, angle from straight up toward screen-left, base width. */
const HAIR_LEN = [18, 24, 30, 22] as const;
const HAIR_ANGLE = [10, 34, 58, 80] as const;
const HAIR_BASE = 10;
const HAIR_LONGEST = 2;
const rad = (deg: number): number => (deg * Math.PI) / 180;

interface Style {
  fill: (c: number) => number;
  alpha: number;
  outline: number;
  rim: number | null;
  /** Rim on both edges (tunnel) instead of screen-right only. */
  rimSide: "left" | "right" | "both";
}

/** One capsule pass: a thick line with round caps. Exported for the preview page. */
export function capsule(g: G, a: Pt, b: Pt, width: number, color: number, alpha: number): void {
  const r = width / 2;
  g.fillStyle(color, alpha);
  g.lineStyle(width, color, alpha);
  if (Math.hypot(b.x - a.x, b.y - a.y) > 0.01) g.lineBetween(a.x, a.y, b.x, b.y);
  g.fillCircle(a.x, a.y, r);
  g.fillCircle(b.x, b.y, r);
}

/** 12.02 rule 10: shadow pool geometry at a height above the ground, 0 (planted) to 150 px (jump apex). Pure. */
export function shadowPool(heightAboveGround: number): { w: number; alpha: number } {
  const t = Math.max(0, Math.min(1, heightAboveGround / SHADOW_APEX));
  return { w: SHADOW_W0 + (SHADOW_W1 - SHADOW_W0) * t, alpha: 1 - (1 - SHADOW_ALPHA_APEX) * t };
}
const SHADOW_APEX = 150;
const SHADOW_W0 = 64;
const SHADOW_W1 = 110;
const SHADOW_ALPHA_APEX = 0.3;
/** Three stacked ellipses, the outer ones softer, so the contact reads as a pool that tightens toward the ground. */
const SHADOW_LAYERS = [
  { k: 1, alpha: 0.32 },
  { k: 0.66, alpha: 0.18 },
  { k: 0.36, alpha: 0.14 },
] as const;

export function drawShadow(g: G, x: number, groundY: number, heightAboveGround: number): void {
  const pool = shadowPool(heightAboveGround);
  const cx = snap(x);
  for (const layer of SHADOW_LAYERS) {
    g.fillStyle(P.outline, layer.alpha * pool.alpha);
    g.fillEllipse(cx, groundY + 2, snap(pool.w * layer.k), 12 * (0.6 + 0.4 * layer.k));
  }
}

export function drawFighter(g: G, joints: Joints, characterId: CharacterId, opts: DrawOpts): void {
  const rig = CHARACTER_RIG[characterId];
  const override = opts.fillOverride;
  // A flash substitutes fill colours; it never makes the rig translucent (design/00 rule 1: silhouette first).
  const alpha = joints.alpha * (override === undefined ? (opts.fillAlpha ?? 1) : 1);
  const squash = opts.squash ?? 1;
  const j = squash === 1 ? joints : squashJoints(joints, squash);
  const wind = 2 + opts.windSpeed / 120;
  const now = typeof performance !== "undefined" ? performance.now() : 0;
  const flap = Math.sin(((now / 1000) * 2 * Math.PI * 6) + j.hip.x / 50) * 3;

  for (const [i, ghost] of j.ghosts.entries()) {
    const gj = translateJoints(j, ghost.x - j.hip.x, ghost.y - j.hip.y);
    const ga = (i === 0 ? 0.35 : 0.18) * alpha;
    drawBody(g, gj, rig, opts, { fill: () => P.moon, alpha: ga, outline: P.moon, rim: null, rimSide: "right" }, wind, flap);
  }

  const mixWeight = opts.fillAlpha ?? 1;
  // 12.02: gloom dims the fills toward night1 (never below 75 %); a flash still replaces them afterwards
  const gloom = Math.min(opts.gloom ?? 0, MAX_GLOOM);
  const shaded = gloom > 0 ? (c: number): number => mix(c, P.night1, gloom) : (c: number): number => c;
  const style: Style = {
    fill: override === undefined ? shaded : (c) => mix(shaded(c), override, mixWeight),
    alpha,
    outline: P.outline,
    rim: opts.rim,
    rimSide: opts.rimSide ?? "right",
  };
  drawBody(g, j, rig, opts, style, wind, flap);
}

// ---------------------------------------------------------------------------------------------
// body

function drawBody(g: G, j: Joints, rig: CharacterRig, opts: DrawOpts, st: Style, wind: number, flap: number): void {
  const c = colours(rig);
  const back = { coat: darken(c.coat, 0.25), trouser: darken(c.trouser, 0.25), hand: darken(c.hand, 0.25), skin: darken(c.skin, 0.25) };

  // block: both forearms are up in front of the face, so the back arm goes over the torso and head (design/02)
  const backArmInFront = j.state === "block";
  drawLeg(g, j.legs.B, rig, back.trouser, back.skin, st, opts.facing, rig.signature === "drifter");
  if (!backArmInFront) drawArm(g, j.arms.B, rig, back.coat, back.hand, st);
  drawTorso(g, j, rig, c, st, wind, opts.facing);
  drawHead(g, j, rig, c, st, wind, flap, opts.facing);
  if (backArmInFront) drawArm(g, j.arms.B, rig, back.coat, back.hand, st);
  drawLeg(g, j.legs.F, rig, c.trouser, c.skin, st, opts.facing, false);
  drawArm(g, j.arms.F, rig, c.coat, c.hand, st);
}

interface Colours { coat: number; trouser: number; skin: number; hand: number; hair: number; cap: number }

function colours(rig: CharacterRig): Colours {
  if (rig.signature === "drifter") {
    return { coat: rig.key, trouser: mix(rig.key, P.steel1, 0.55), skin: rig.skin, hand: rig.hand, hair: darken(rig.key, 0.25), cap: darken(rig.key, 0.25) };
  }
  return { coat: rig.key, trouser: darken(rig.key, 0.2), skin: rig.skin, hand: rig.hand, hair: darken(rig.key, 0.3), cap: darken(rig.key, 0.28) };
}

interface Seg { a: Pt; b: Pt; w: number; color: number }

/** Outline pass for the whole group, then fills, then rim: joints inside a limb chain stay clean. */
function limbGroup(g: G, segs: Seg[], st: Style): void {
  for (const s of segs) capsule(g, s.a, s.b, s.w + OUTLINE_W * 2, st.outline, st.alpha);
  for (const s of segs) capsule(g, s.a, s.b, s.w, st.fill(s.color), st.alpha);
  if (st.rim !== null) for (const s of segs) rimCapsule(g, s.a, s.b, s.w, st.rim, st.alpha, st.rimSide);
}

function drawLeg(g: G, leg: Leg, rig: CharacterRig, trouser: number, skin: number, st: Style, facing: 1 | -1, tornCuff: boolean): void {
  const ankle = { x: leg.foot.x, y: leg.foot.y - ANKLE_LIFT };
  const footA = { x: ankle.x - facing * 3, y: ankle.y };
  const footB = { x: ankle.x + facing * (RIG.foot - 4), y: ankle.y };
  const segs: Seg[] = [{ a: leg.hip, b: leg.knee, w: RIG.thighW, color: trouser }];
  if (tornCuff) {
    const u = unit(leg.knee, ankle);
    const cuff = { x: ankle.x - u.x * 4, y: ankle.y - u.y * 4 };
    segs.push({ a: cuff, b: ankle, w: RIG.shinW - 4, color: skin });
    segs.push({ a: leg.knee, b: cuff, w: RIG.shinW, color: trouser });
  } else {
    segs.push({ a: leg.knee, b: ankle, w: RIG.shinW, color: trouser });
  }
  segs.push({ a: footA, b: footB, w: RIG.footW, color: darken(trouser, 0.35) });
  limbGroup(g, segs, st);
  if (tornCuff) {
    // notch in the torn cuff
    const u = unit(leg.knee, ankle);
    const n = { x: -u.y, y: u.x };
    const cx = ankle.x - u.x * 5;
    const cy = ankle.y - u.y * 5;
    g.fillStyle(st.outline, st.alpha);
    g.fillPoints([
      { x: cx + n.x * 7, y: cy + n.y * 7 },
      { x: cx + n.x * 2 - u.x * 3, y: cy + n.y * 2 - u.y * 3 },
      { x: cx + n.x * 7 - u.x * 6, y: cy + n.y * 7 - u.y * 6 },
    ], true);
  }
}

function drawArm(g: G, arm: Arm, rig: CharacterRig, coat: number, hand: number, st: Style): void {
  const segs: Seg[] = [
    { a: arm.shoulder, b: arm.elbow, w: RIG.upperW, color: coat },
    { a: arm.elbow, b: arm.wrist, w: RIG.foreW, color: rig.signature === "drifter" ? rig.skin : coat },
  ];
  limbGroup(g, segs, st);
  if (rig.signature === "drifter") {
    // cloth wraps: 4 px amber-2 bands across the forearm
    const u = unit(arm.elbow, arm.wrist);
    const n = { x: -u.y, y: u.x };
    const half = RIG.foreW / 2 + 1;
    g.lineStyle(4, st.fill(P.amber2), st.alpha);
    for (const t of [0.32, 0.62]) {
      const cx = arm.elbow.x + (arm.wrist.x - arm.elbow.x) * t;
      const cy = arm.elbow.y + (arm.wrist.y - arm.elbow.y) * t;
      g.lineBetween(cx - n.x * half, cy - n.y * half, cx + n.x * half, cy + n.y * half);
    }
  }
  outlinedCircle(g, arm.fist, RIG.fist, hand, st);
}

function drawTorso(g: G, j: Joints, rig: CharacterRig, c: Colours, st: Style, wind: number, facing: 1 | -1): void {
  const u = unit(j.hip, j.neck); // up the spine
  const p = { x: -u.y, y: u.x }; // across the body; p.x > 0 means screen-right
  const sw = rig.shoulderW / 2;
  const hw = rig.hipW / 2;
  const at = (base: Pt, along: number, across: number): Pt => ({ x: base.x + u.x * along + p.x * across, y: base.y + u.y * along + p.y * across });
  const neckL = at(j.neck, -1, -sw);
  const neckR = at(j.neck, -1, sw);
  const hipL = at(j.hip, -3, -hw);
  const hipR = at(j.hip, -3, hw);
  const quad: Pt[] = [neckL, at(j.neck, 1, 0), neckR, at(j.neck, -RIG.torso / 2, sw + 2), hipR, at(j.hip, -6, 0), hipL, at(j.neck, -RIG.torso / 2, -sw - 2)];

  // loose cloth first so its roots hide under the coat
  const leftIsBack = p.x >= 0 ? -1 : 1; // sign of `across` that points screen-left
  if (rig.signature === "drifter") {
    const rag = c.coat;
    const hem = (across: number): Pt => at(j.hip, -4, across);
    const drops = [[-hw + 2, 13], [-hw / 2, 18], [0, 11], [hw / 2, 16], [hw - 2, 12]] as const;
    for (const [x, len] of drops) {
      const a = hem(x - 5);
      const b = hem(x + 5);
      const tip = { x: a.x + 5 * p.x - u.x * len - wind * (len / 12), y: a.y + 5 * p.y - u.y * len };
      outlinedPoly(g, [a, b, tip], rag, st);
    }
    for (const [along, len] of [[-14, 14], [-30, 18]] as const) {
      const a = at(j.hip, RIG.torso + along, leftIsBack * (hw - 1));
      const b = at(j.hip, RIG.torso + along - 9, leftIsBack * (hw - 1));
      const tip = { x: a.x - len - wind, y: a.y + 10 };
      outlinedPoly(g, [a, b, tip], rag, st);
    }
  } else {
    // two coat tails off the hip trailing screen-left
    for (const across of [leftIsBack * (hw - 4), leftIsBack * (hw - 13)]) {
      const a = at(j.hip, -2, across - 4);
      const b = at(j.hip, -2, across + 4);
      const d = { x: -(8 + wind), y: 14 };
      outlinedPoly(g, [a, b, { x: b.x + d.x, y: b.y + d.y }, { x: a.x + d.x, y: a.y + d.y }], c.coat, st);
    }
  }

  outlinedPoly(g, quad, c.coat, st);
  if (st.rim !== null) {
    const rightS = p.x > 0 ? 1 : -1;
    const edges = sides(st.rimSide).map((side) => side * rightS);
    g.lineStyle(3, st.rim, st.alpha);
    for (const s of edges) {
      const top = s === 1 ? neckR : neckL;
      const bottom = s === 1 ? hipR : hipL;
      g.lineBetween(top.x - p.x * s * 1.5, top.y - p.y * s * 1.5, bottom.x - p.x * s * 1.5, bottom.y - p.y * s * 1.5);
    }
  }

  if (rig.signature === "drifter") {
    // rope belt across the hip
    const a = at(j.hip, 5, -hw + 1);
    const b = at(j.hip, 5, hw - 1);
    g.lineStyle(3, st.fill(P.amber2), st.alpha);
    g.lineBetween(a.x, a.y, b.x, b.y);
    const knot = at(j.hip, 5, facing * 6);
    g.fillStyle(st.fill(P.amber2), st.alpha);
    g.fillCircle(knot.x, knot.y, 3);
  } else {
    // two columns of three brass buttons
    g.fillStyle(st.fill(P.amber1), st.alpha);
    for (const across of [-4, 4]) for (const along of [18, 30, 42]) {
      const b = at(j.hip, along, across);
      g.fillCircle(b.x, b.y, 2);
    }
    // watch chain: a sagging arc across the lower torso
    const pts: Pt[] = [];
    for (let i = 0; i <= 6; i++) {
      const t = i / 6;
      const sag = Math.sin(t * Math.PI) * 4;
      pts.push(at(j.hip, 14 - sag, -8 + t * 18));
    }
    g.lineStyle(2, st.fill(P.amber1), st.alpha);
    g.strokePoints(pts, false, false);
  }
}

function drawHead(g: G, j: Joints, rig: CharacterRig, c: Colours, st: Style, wind: number, flap: number, facing: 1 | -1): void {
  const u = unit(j.neck, j.head); // up through the head
  const p = { x: -u.y, y: u.x };
  const at = (along: number, across: number): Pt => ({ x: j.head.x + u.x * along + p.x * across, y: j.head.y + u.y * along + p.y * across });
  const neckTop = at(-RIG.head, 0);
  limbGroup(g, [{ a: j.neck, b: neckTop, w: RIG.neckW, color: c.skin }], { ...st, rim: null });
  if (rig.signature === "conductor") {
    // collar: a moon wedge sitting on the coat, under the chin
    const cl = at(-RIG.head - 8, -13);
    const cr = at(-RIG.head - 8, 13);
    const ct = at(-RIG.head - 18, 0);
    g.fillStyle(st.fill(P.moon), st.alpha);
    g.fillPoints([cl, cr, ct], true);
  }
  outlinedCircle(g, j.head, RIG.head, c.skin, st);

  if (rig.signature === "drifter") {
    // beard: rounded jagged triangle hanging from the chin, tip toward facing, streaming screen-left
    // hangs from the chin (14 px below the head centre) so the face stays clear between hair cap and beard
    const beardPts: [number, number][] = [[-12, 14], [12, 14], [14, 20], [11, 27], [8, 21], [5, 34], [2, 25], [-1, 38], [-5, 28], [-9, 31], [-13, 22]];
    const beard: Pt[] = beardPts.map(([x, y]) => {
        const q = at(-y, x * facing);
        return { x: q.x - (y > 18 ? wind * ((y - 18) / 20) : 0), y: q.y };
      });
    outlinedPoly(g, beard, c.hair, st);
    // hair: four wind-blown wedges (8 px base, 18 to 30 px long) growing out of the screen-left edge of a hair
    // cap that covers the top of the head; wedge roots go first so the cap hides them
    const leftSign = p.x >= 0 ? -1 : 1; // `across` sign that points screen-left
    const r = RIG.head;
    for (let i = 0; i < 4; i++) {
      const theta = rad(HAIR_ANGLE[i]!); // from straight up, toward screen-left
      const len = HAIR_LEN[i]!;
      const along = (r - 2) * Math.cos(theta);
      const across = (r - 2) * Math.sin(theta) * leftSign;
      // base of 8 px along the cap edge (tangent direction), tip trailing screen-left and sagging
      const tx = -Math.sin(theta);
      const ty = Math.cos(theta) * leftSign;
      const a = at(along + tx * HAIR_BASE / 2, across + ty * HAIR_BASE / 2);
      const b = at(along - tx * HAIR_BASE / 2, across - ty * HAIR_BASE / 2);
      const osc = i === HAIR_LONGEST ? flap : 0;
      const root = at(along, across);
      const tip = { x: root.x - len - wind * 1.5, y: root.y + len * 0.35 + osc };
      outlinedPoly(g, [a, b, tip], c.hair, st);
    }
    // hair cap: a half-disc over the top of the head, chord just above the centre line (its 3 px outline is the
    // hairline; lower and the outlines of cap and beard would leave no face)
    const capPts: Pt[] = [];
    const chord = 0.1 * r; // along: positive is up
    const capR = r + 1;
    const phi = Math.acos(chord / capR); // half-angle of the arc above the chord
    const steps = 12;
    for (let i = 0; i <= steps; i++) {
      const ang = -phi + (2 * phi * i) / steps;
      capPts.push(at(capR * Math.cos(ang), capR * Math.sin(ang)));
    }
    outlinedPoly(g, capPts, c.cap, st);
    if (st.rim !== null) {
      // the rim arc continues over the cap on the screen-right edge (both edges in the tunnel)
      g.lineStyle(3, st.rim, st.alpha);
      for (const side of sides(st.rimSide)) {
        g.beginPath();
        g.arc(j.head.x, j.head.y, r - 1.5, side === 1 ? -0.95 : Math.PI + 0.05, side === 1 ? -0.05 : Math.PI + 0.95, false);
        g.strokePath();
      }
    }
  } else {
    // cap: band on the crown, brim toward facing, badge dot; rotates with the head so it never detaches
    const bandPts: [number, number][] = [[-18, 12], [-16, 22], [-8, 25], [8, 25], [16, 22], [18, 12]];
    const band: Pt[] = bandPts.map(([x, y]) => at(y, x * facing));
    outlinedPoly(g, band, c.cap, st);
    const brimPts: [number, number][] = [[16, 11], [30, 11], [30, 15], [16, 15]];
    const brim: Pt[] = brimPts.map(([x, y]) => at(y, x * facing));
    outlinedPoly(g, brim, darken(c.cap, 0.2), st);
    g.fillStyle(st.fill(P.conductorGlove), st.alpha);
    const badge = at(18, 7 * facing);
    g.fillCircle(badge.x, badge.y, 2);
    if (st.rim !== null) {
      g.lineStyle(3, st.rim, st.alpha);
      const rightEdge = facing === 1 ? [band[5]!, band[4]!] : [band[0]!, band[1]!];
      const leftEdge = facing === 1 ? [band[0]!, band[1]!] : [band[5]!, band[4]!];
      if (st.rimSide !== "left") g.lineBetween(rightEdge[0]!.x - 1.5, rightEdge[0]!.y, rightEdge[1]!.x - 1.5, rightEdge[1]!.y);
      if (st.rimSide !== "right") g.lineBetween(leftEdge[0]!.x + 1.5, leftEdge[0]!.y, leftEdge[1]!.x + 1.5, leftEdge[1]!.y);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// primitives

function outlinedCircle(g: G, c: Pt, r: number, color: number, st: Style): void {
  g.fillStyle(st.outline, st.alpha);
  g.fillCircle(c.x, c.y, r + OUTLINE_W);
  g.fillStyle(st.fill(color), st.alpha);
  g.fillCircle(c.x, c.y, r);
  if (st.rim !== null) {
    g.lineStyle(3, st.rim, st.alpha);
    if (st.rimSide !== "left") {
      g.beginPath();
      g.arc(c.x, c.y, r - 1.5, -0.95, 0.95, false);
      g.strokePath();
    }
    if (st.rimSide !== "right") {
      g.beginPath();
      g.arc(c.x, c.y, r - 1.5, Math.PI - 0.95, Math.PI + 0.95, false);
      g.strokePath();
    }
  }
}

function outlinedPoly(g: G, pts: Pt[], color: number, st: Style): void {
  g.fillStyle(st.outline, st.alpha);
  g.fillPoints(offsetPoly(pts, OUTLINE_W), true);
  g.fillStyle(st.fill(color), st.alpha);
  g.fillPoints(pts, true);
}

/**
 * Warm rim along the screen-right edge of a capsule, plus a cap arc on the right-most end of horizontal limbs.
 * With `both` the screen-left edge and left-most end get the same stroke (tunnel: lamps on both walls).
 */
function rimCapsule(g: G, a: Pt, b: Pt, width: number, color: number, alpha: number, rimSide: "left" | "right" | "both" = "right"): void {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  const r = width / 2 - 1.5;
  g.lineStyle(3, color, alpha);
  if (len > 0.01) {
    const ux = dx / len;
    const uy = dy / len;
    let nx = -uy;
    let ny = ux;
    if (nx < 0) { nx = -nx; ny = -ny; }
    for (const side of sides(rimSide)) {
      if (nx > 0.35) g.lineBetween(a.x + side * nx * r, a.y + side * ny * r, b.x + side * nx * r, b.y + side * ny * r);
      if (Math.abs(ux) > 0.5) {
        const e = (b.x > a.x) === (side === 1) ? b : a;
        g.beginPath();
        g.arc(e.x, e.y, r, side === 1 ? -0.9 : Math.PI - 0.9, side === 1 ? 0.9 : Math.PI + 0.9, false);
        g.strokePath();
      }
    }
  }
}

/** Grows a convex polygon outward by `d` px (mitred). */
function offsetPoly(pts: Pt[], d: number): Pt[] {
  const n = pts.length;
  let cx = 0;
  let cy = 0;
  for (const p of pts) { cx += p.x; cy += p.y; }
  cx /= n;
  cy /= n;
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const prev = pts[(i + n - 1) % n]!;
    const cur = pts[i]!;
    const next = pts[(i + 1) % n]!;
    const n1 = edgeNormal(prev, cur, cx, cy);
    const n2 = edgeNormal(cur, next, cx, cy);
    let mx = n1.x + n2.x;
    let my = n1.y + n2.y;
    const ml = Math.hypot(mx, my) || 1;
    mx /= ml;
    my /= ml;
    const cos = Math.max(0.45, mx * n1.x + my * n1.y);
    out.push({ x: cur.x + (mx * d) / cos, y: cur.y + (my * d) / cos });
  }
  return out;
}

function edgeNormal(a: Pt, b: Pt, cx: number, cy: number): Pt {
  let nx = -(b.y - a.y);
  let ny = b.x - a.x;
  const l = Math.hypot(nx, ny) || 1;
  nx /= l;
  ny /= l;
  // point away from the centroid
  const mx = (a.x + b.x) / 2 - cx;
  const my = (a.y + b.y) / 2 - cy;
  if (nx * mx + ny * my < 0) { nx = -nx; ny = -ny; }
  return { x: nx, y: ny };
}

function unit(a: Pt, b: Pt): Pt {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l = Math.hypot(dx, dy) || 1;
  return { x: dx / l, y: dy / l };
}

function darken(color: number, k: number): number {
  const f = 1 - k;
  const r = Math.round(((color >> 16) & 255) * f);
  const g = Math.round(((color >> 8) & 255) * f);
  const b = Math.round((color & 255) * f);
  return (r << 16) | (g << 8) | b;
}

function mix(a: number, b: number, t: number): number {
  const ch = (s: number): number => Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

function mapJoints(j: Joints, f: (p: Pt) => Pt): Joints {
  const arm = (a: Arm): Arm => ({ shoulder: f(a.shoulder), elbow: f(a.elbow), wrist: f(a.wrist), fist: f(a.fist) });
  const leg = (l: Leg): Leg => ({ hip: f(l.hip), knee: f(l.knee), foot: f(l.foot) });
  return {
    ...j,
    hip: f(j.hip), neck: f(j.neck), head: f(j.head),
    arms: { F: arm(j.arms.F), B: arm(j.arms.B) },
    legs: { F: leg(j.legs.F), B: leg(j.legs.B) },
    ghosts: [],
  };
}

function translateJoints(j: Joints, dx: number, dy: number): Joints {
  return mapJoints(j, (p) => ({ x: p.x + dx, y: p.y + dy }));
}

/**
 * Landing squash (4.02 rule 7): the torso, head and arms scale vertically about the feet, width by the inverse.
 * The legs keep their world positions (feet and knees stay put); only the thigh's hip end follows the torso.
 */
function squashJoints(j: Joints, s: number): Joints {
  const gy = Math.max(j.legs.F.foot.y, j.legs.B.foot.y);
  const cx = j.hip.x;
  const f = (p: Pt): Pt => ({ x: cx + (p.x - cx) / s, y: gy + (p.y - gy) * s });
  const arm = (a: Arm): Arm => ({ shoulder: f(a.shoulder), elbow: f(a.elbow), wrist: f(a.wrist), fist: f(a.fist) });
  const leg = (l: Leg): Leg => ({ hip: f(l.hip), knee: l.knee, foot: l.foot });
  return {
    ...j,
    hip: f(j.hip), neck: f(j.neck), head: f(j.head),
    arms: { F: arm(j.arms.F), B: arm(j.arms.B) },
    legs: { F: leg(j.legs.F), B: leg(j.legs.B) },
  };
}
