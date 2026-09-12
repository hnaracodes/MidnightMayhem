/**
 * Pose (Joints) + FighterState -> one pixel frame of a paper-doll fighter (11.01, 13.01, 13.02).
 * Pure: no Phaser, no DOM. Authored facing right in sprite space, mirrored as a whole for facing left, then
 * outlined and lit in screen space (rim on the lit side, dither on the dark side).
 *
 * Sprite space (13.01): 1 sprite px = 1 world px, so the 105 px body (13.00) is 105 rows of art. The nominal
 * standing frame is FRAME_W × FRAME_H with the feet at ANCHOR; the raster the fighter is drawn into is larger
 * (CANVAS) so punches, the sword and the KO sprawl do not clip, and it addresses pixels in frame coordinates
 * through the PixelCanvas origin offset. Effects and backgrounds keep their own 2 px grid (`pixel.ts`).
 *
 * 13.02: limbs are tapered capsules shaded as cylinders from a light vector (`shade.ts`); every part records an
 * id so overlaps darken the part behind; `composeKey` names everything a frame depends on so the Phaser side can
 * skip re-rasterising a fighter that has not changed.
 */
import type { CharacterId, FighterState, ItemId } from "@midnight/shared";
import { P } from "../palette";
import type { Joints, Pt, RigState } from "../rig/pose";
import { PixelCanvas, darken, scalePart, type Part } from "./grid";
import { CLAUDE_PARTS } from "./parts/claude";
import { CONDUCTOR_PARTS } from "./parts/conductor";
import { DRIFTER_PARTS } from "./parts/drifter";
import { ITEM_PARTS } from "./parts/items";
import { STOKER_PARTS } from "./parts/stoker";
import { jointCrease, rampFrom, taperedLimb, type LightDir, type Ramp } from "./shade";

export const SPRITE_SCALE = 1;
export const FRAME_W = 80;
export const FRAME_H = 112;
/** The feet anchor in frame coordinates: 108 rows above the sole for the 105 px body plus its outline and bob; the guard fists reach 39 px ahead. */
export const ANCHOR = { x: 40, y: 108 } as const;
/**
 * The raster behind a fighter: the frame plus 48 px each side (the KO sprawl reaches −78..+77 from the feet), 40 px
 * above (the flash beat and win pose lift a held molotov to −140) and 4 px below, from the 13.01 extents probe over
 * every character × state × facing × item, with an 8 px free ring for the outline and 13.03's secondary motion.
 */
export const CANVAS = { w: 176, h: 152, ox: 48, oy: 40 } as const;

/**
 * 13.01 placeholders: the 11.01 grids were authored at 3 world px per art px for a 150 px body; at 1 px per art
 * px and a 105 px body every part is 3 × 0.7 = 2.1 old pixels wide. 13.03 authored the Drifter and the Conductor
 * at the art grid; the Stoker, Claude Code and the items are still scaled placeholders (owner scope, 2026-09-12).
 */
const PLACEHOLDER_K = 2.1;
function scaleParts(p: CharacterParts): CharacterParts {
  const out: CharacterParts = {
    ...p,
    head: scalePart(p.head, PLACEHOLDER_K),
    headKo: scalePart(p.headKo, PLACEHOLDER_K),
    torso: scalePart(p.torso, PLACEHOLDER_K),
    handOpen: scalePart(p.handOpen, PLACEHOLDER_K),
    handFist: scalePart(p.handFist, PLACEHOLDER_K),
    foot: scalePart(p.foot, PLACEHOLDER_K),
  };
  if (p.torsoBlock) out.torsoBlock = scalePart(p.torsoBlock, PLACEHOLDER_K);
  if (p.torsoBlink) out.torsoBlink = scalePart(p.torsoBlink, PLACEHOLDER_K);
  return out;
}

export function createFrameCanvas(): PixelCanvas {
  return new PixelCanvas(CANVAS.w, CANVAS.h, CANVAS.ox, CANVAS.oy);
}

export interface CharacterParts {
  head: Part;
  headKo: Part;
  torso: Part;
  torsoBlock?: Part;
  /** Claude Code: the terminal prompt with the underscore off; swapped in every 500 ms. */
  torsoBlink?: Part;
  handOpen: Part;
  handFist: Part;
  foot: Part;
  extras: Record<string, number>;
  limbColor: number;
  limbShade: number;
  legColor: number;
  /** Optional cuff colour: a short band at the wrist end of each forearm (wrist wraps, brass cuffs). */
  cuff?: number;
  /** 13.02 rule 6: authored four-step ramps; when absent they are generated from the colours above. */
  limbRamp?: Ramp;
  limbShadeRamp?: Ramp;
  legRamp?: Ramp;
  legShadeRamp?: Ramp;
}

export const CHARACTER_PARTS: Record<CharacterId, CharacterParts> = {
  drifter: DRIFTER_PARTS,
  conductor: CONDUCTOR_PARTS,
  stoker: scaleParts(STOKER_PARTS),
  claude: scaleParts(CLAUDE_PARTS),
};
/** Characters whose grids are 13.01 placeholders rather than 13.03 art (tests relax the authored-detail rules for them). */
export const PLACEHOLDER_CHARACTERS: ReadonlySet<CharacterId> = new Set(["stoker", "claude"]);

/** The held-item sprites at the art grid (13.01 placeholders from `parts/items.ts`). */
export const ITEM_SPRITES: Record<ItemId, Part> = Object.fromEntries(
  (Object.keys(ITEM_PARTS) as ItemId[]).map((id) => [id, scalePart(ITEM_PARTS[id], PLACEHOLDER_K)]),
) as Record<ItemId, Part>;

export interface ComposeOpts {
  facing: 1 | -1;
  /** 12.02: rim highlight colour, from the strongest light at the fighter (`lamp`, `glow1`, `amber1`). */
  rimColor: number;
  /** 12.02: the lit edge; `"both"` in the tunnel (lamps on both walls) and then no dark-side dither. */
  rimSide: "left" | "right" | "both";
  /** 12.02: 0..0.25 mix of every fill toward night1 (gloom); outline and rim untouched. */
  gloom: number;
  /**
   * 13.02 rule 3: unit vector toward the net light in screen space (y down), from `Lighting.rimFor().dir`.
   * Null or absent falls back to a direction derived from `rimSide`.
   */
  lightDir?: LightDir | null | undefined;
  /** 13.02 rule 7: the `low` tier draws base-only limbs with no dither or crease. */
  flatLimbs?: boolean | undefined;
  flash?: number | undefined;
  flashAlpha?: number | undefined;
  alpha: number;
  itemVisible: boolean;
  /** Render clock for the Claude Code prompt blink; 0 when absent. */
  blinkMs?: number | undefined;
}

/** 13.02 rule 1: limb end widths in sprite px (hip → knee → ankle, shoulder → elbow → wrist). */
export const LIMB_W = { hip: 9, knee: 7, ankle: 5, shoulder: 8, elbow: 6, wrist: 5 } as const;
/** The ankle sits this many sprite px above the sole ((RIG.footW / 2 + 3) · BODY_SCALE ≈ 4.9 world px). */
const ANKLE_LIFT = 4;
/** Length of the cuff band at the wrist end of the forearm, sprite px. */
const CUFF_LEN = 4;
/** Below this |lean| the authored (upright) torso is used as-is. */
const LEAN_AUTHORED = 8;
/** Up to this quantised |angle| the torso rows are sheared; beyond it the part is rotated (KO sprawl). */
const LEAN_SHEAR_MAX = 30;
const LEAN_STEP = 15;
const BLINK_MS = 500;
/** Dark-side dither colour and weight. */
const SHADE = P.night1;
const SHADE_ALPHA = 0.45;
/** 12.02: fighters never drop below 75 % brightness (FIGHTER_MIN_BRIGHTNESS in stage/lighting.ts). */
const MAX_GLOOM = 0.25;
const DEFAULT_FLASH_ALPHA = 0.7;
/** 13.02 rule 5: occlusion weights toward night1 for a higher part in the 8-neighbourhood and in the 5×5 ring. */
const OCCLUDE_NEAR = 0.35;
const OCCLUDE_FAR = 0.18;
/** 13.02 rule 3: the light a rim side stands in for when no vector reaches the composer. */
const SIDE_LIGHT: Record<ComposeOpts["rimSide"], LightDir> = {
  left: { x: -0.8, y: -0.6 },
  right: { x: 0.8, y: -0.6 },
  both: { x: 0, y: -1 },
};

/** 13.02 rule 5: draw order back to front; a higher id is in front and occludes a lower one where they touch. */
export const PART_ID = { pack: 1, legB: 2, armB: 3, torso: 4, head: 5, legF: 6, armF: 7, item: 8 } as const;

/** World joint -> frame px in the authored (facing-right) space, relative to the feet anchor, rounded. */
export function jointToSprite(joint: Pt, f: FighterState): { x: number; y: number } {
  return {
    x: Math.round(ANCHOR.x + (f.facing * (joint.x - f.x)) / SPRITE_SCALE),
    y: Math.round(ANCHOR.y + (joint.y - f.y) / SPRITE_SCALE),
  };
}

/** 12.04: the laser keeps open palms (the cupped hands and the thrust); a throw grips (holding covers it anyway). */
const FIST_STATES: ReadonlySet<RigState> = new Set(["punch", "chop", "sweep", "block", "hit", "throw"]);

/** Which hand part a state uses; holding an item always grips. */
function handPart(parts: CharacterParts, state: RigState, holding: boolean): Part {
  return holding || FIST_STATES.has(state) ? parts.handFist : parts.handOpen;
}

function quantise(deg: number): number {
  return Math.round(deg / LEAN_STEP) * LEAN_STEP;
}

/** Whether the item is drawn in the hand (everything but the backpack, which rides on the back). */
export const HAND_ITEMS: ReadonlySet<ItemId> = new Set(["molotov", "sword", "banana", "flash"]);

export function isBlinkOn(blinkMs: number): boolean {
  return Math.floor(blinkMs / BLINK_MS) % 2 === 1;
}

interface Ramps { limb: Ramp; limbShade: Ramp; leg: Ramp; legShade: Ramp; cuff: Ramp | null }
const rampCache = new WeakMap<CharacterParts, Ramps>();
/** The four limb ramps of a character, authored or generated once (rule 6). */
export function rampsFor(parts: CharacterParts): Ramps {
  let r = rampCache.get(parts);
  if (!r) {
    r = {
      limb: parts.limbRamp ?? rampFrom(parts.limbColor),
      limbShade: parts.limbShadeRamp ?? rampFrom(parts.limbShade),
      leg: parts.legRamp ?? rampFrom(parts.legColor),
      legShade: parts.legShadeRamp ?? rampFrom(darken(parts.legColor, 0.72)),
      cuff: parts.cuff === undefined ? null : rampFrom(parts.cuff),
    };
    rampCache.set(parts, r);
  }
  return r;
}

/** Rule 3: the light in authored space — the scene's vector (flipped for facing left) or the rim side's stand-in. */
export function authoredLight(opts: Pick<ComposeOpts, "lightDir" | "rimSide" | "facing">): LightDir {
  const d = opts.lightDir;
  const screen = d && Math.hypot(d.x, d.y) > 1e-3 ? d : SIDE_LIGHT[opts.rimSide];
  const m = Math.hypot(screen.x, screen.y) || 1;
  return { x: (opts.facing * screen.x) / m, y: screen.y / m };
}

export function composeFrame(canvas: PixelCanvas, joints: Joints, f: FighterState, characterId: CharacterId, opts: ComposeOpts): void {
  const parts = CHARACTER_PARTS[characterId];
  const ramps = rampsFor(parts);
  const J = (p: Pt): { x: number; y: number } => jointToSprite(p, f);
  const state = joints.state;
  const item = opts.itemVisible ? f.item : null;
  const holding = item !== null && HAND_ITEMS.has(item.kind);
  const hand = handPart(parts, state, holding);
  const light = authoredLight(opts);
  const flat = opts.flatLimbs === true;

  canvas.clear();

  const hip = J(joints.hip);
  const neck = J(joints.neck);
  const head = J(joints.head);

  // backpack: on the back, behind everything, hanging off the back shoulder
  if (item && item.kind === "shield") {
    canvas.id = PART_ID.pack;
    const sh = J(joints.arms.B.shoulder);
    canvas.blit(ITEM_SPRITES.shield, sh.x - 4, sh.y + 4, false);
  }

  const drawLeg = (leg: Joints["legs"]["F"], ramp: Ramp, id: number): void => {
    canvas.id = id;
    const h = J(leg.hip);
    const k = J(leg.knee);
    const foot = J(leg.foot);
    const ankle = { x: foot.x, y: foot.y - ANKLE_LIFT };
    taperedLimb(canvas, h, k, LIMB_W.hip, LIMB_W.knee, ramp, light, flat);
    taperedLimb(canvas, k, ankle, LIMB_W.knee, LIMB_W.ankle, ramp, light, flat);
    if (!flat) jointCrease(canvas, k, h, ankle, LIMB_W.knee / 2, ramp);
    canvas.blit(parts.foot, foot.x, foot.y, false);
  };
  const drawArm = (arm: Joints["arms"]["F"], ramp: Ramp, id: number): void => {
    canvas.id = id;
    const s = J(arm.shoulder);
    const e = J(arm.elbow);
    const w = J(arm.wrist);
    const fist = J(arm.fist);
    taperedLimb(canvas, s, e, LIMB_W.shoulder, LIMB_W.elbow, ramp, light, flat);
    taperedLimb(canvas, e, w, LIMB_W.elbow, LIMB_W.wrist, ramp, light, flat);
    if (!flat) jointCrease(canvas, e, s, w, LIMB_W.elbow / 2, ramp);
    if (ramps.cuff) {
      const len = Math.hypot(w.x - e.x, w.y - e.y) || 1;
      const ux = (w.x - e.x) / len;
      const uy = (w.y - e.y) / len;
      const from = { x: w.x - ux * CUFF_LEN, y: w.y - uy * CUFF_LEN };
      taperedLimb(canvas, from, w, LIMB_W.wrist + 1, LIMB_W.wrist, ramps.cuff, light, flat);
    }
    canvas.blit(hand, fist.x, fist.y, false);
  };

  drawLeg(joints.legs.B, ramps.legShade, PART_ID.legB);
  drawArm(joints.arms.B, ramps.limbShade, PART_ID.armB);

  // torso on the hip -> neck segment, upright when the lean is small, sheared or rotated in 15° steps otherwise
  canvas.id = PART_ID.torso;
  let torso = parts.torso;
  if (state === "block" && parts.torsoBlock) torso = parts.torsoBlock;
  else if (parts.torsoBlink && isBlinkOn(opts.blinkMs ?? 0)) torso = parts.torsoBlink;
  const segDeg = (Math.atan2(neck.x - hip.x, hip.y - neck.y) * 180) / Math.PI;
  const lean = Math.abs(joints.lean) < LEAN_AUTHORED ? 0 : quantise(segDeg);
  if (lean === 0) canvas.blit(torso, hip.x, hip.y, false);
  else if (Math.abs(lean) <= LEAN_SHEAR_MAX) canvas.blitSheared(torso, hip.x, hip.y, false, Math.tan((lean * Math.PI) / 180));
  else canvas.blitRotated(torso, hip.x, hip.y, false, lean);

  canvas.id = PART_ID.head;
  canvas.blit(state === "ko" ? parts.headKo : parts.head, head.x, head.y, false);

  drawLeg(joints.legs.F, ramps.leg, PART_ID.legF);
  drawArm(joints.arms.F, ramps.limb, PART_ID.armF);

  if (item && holding) {
    canvas.id = PART_ID.item;
    const fist = J(joints.arms.F.fist);
    canvas.blit(ITEM_SPRITES[item.kind], fist.x, fist.y, false);
  }

  if (opts.facing === -1) canvas.mirror(ANCHOR.x);

  // nothing sinks into the roof: the fill stops one row above the sole so the outline lands on it (KO sprawl)
  canvas.clearBelow(ANCHOR.y - 1);
  // 13.02 rule 5 + 12.02 rule 8: occlusion and gloom mix the fills in one sweep before the outline pass so outline
  // pixels (including in-part detail) and the rim stay crisp
  canvas.occludeAndGloom(OCCLUDE_NEAR, OCCLUDE_FAR, SHADE, Math.min(Math.max(opts.gloom, 0), MAX_GLOOM), SHADE, P.outline);
  canvas.outline(P.outline);
  canvas.rim(opts.rimColor, opts.rimSide, P.outline);
  if (opts.rimSide !== "both") canvas.edgeDither(2, SHADE, SHADE_ALPHA, opts.rimSide === "right" ? "left" : "right", P.outline);

  canvas.finishColor(opts.flash, opts.flashAlpha ?? DEFAULT_FLASH_ALPHA, opts.alpha);
}

/**
 * 13.02 rule 7: everything a frame depends on, quantised to what the raster can show (joints to sprite px, the
 * light to 1/16, gloom to 1/64, alphas to 1/64, the blink to on/off). Two equal keys mean `composeFrame` would
 * produce the same pixels, so the caller can skip it.
 */
export function composeKey(joints: Joints, f: FighterState, characterId: CharacterId, opts: ComposeOpts): string {
  const q = (p: Pt): string => { const s = jointToSprite(p, f); return `${s.x},${s.y}`; };
  const arm = (a: Joints["arms"]["F"]): string => `${q(a.shoulder)};${q(a.elbow)};${q(a.wrist)};${q(a.fist)}`;
  const leg = (l: Joints["legs"]["F"]): string => `${q(l.hip)};${q(l.knee)};${q(l.foot)}`;
  const light = authoredLight(opts);
  const item = opts.itemVisible && f.item ? f.item.kind : "-";
  const blink = CHARACTER_PARTS[characterId].torsoBlink ? (isBlinkOn(opts.blinkMs ?? 0) ? 1 : 0) : 0;
  return [
    characterId, joints.state, opts.facing, Math.round(joints.lean),
    q(joints.hip), q(joints.neck), q(joints.head),
    arm(joints.arms.F), arm(joints.arms.B), leg(joints.legs.F), leg(joints.legs.B),
    item, opts.rimColor, opts.rimSide, Math.round(light.x * 16), Math.round(light.y * 16),
    Math.round(Math.min(Math.max(opts.gloom, 0), MAX_GLOOM) * 64), opts.flatLimbs ? 1 : 0,
    opts.flash ?? "-", Math.round((opts.flashAlpha ?? DEFAULT_FLASH_ALPHA) * 64), Math.round(opts.alpha * 64), blink,
  ].join("|");
}
