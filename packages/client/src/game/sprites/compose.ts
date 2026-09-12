/**
 * Pose (Joints) + FighterState -> one pixel frame of a paper-doll fighter (11.01).
 * Pure: no Phaser, no DOM. Authored facing right in sprite space, mirrored as a whole for facing left, then
 * outlined and lit in screen space (rim on the moon side, dither on the dark side).
 *
 * Sprite space (13.01): 1 sprite px = 1 world px, so the 105 px body (13.00) is 105 rows of art. The nominal
 * standing frame is FRAME_W × FRAME_H with the feet at ANCHOR; the raster the fighter is drawn into is larger
 * (CANVAS) so punches, the sword and the KO sprawl do not clip, and it addresses pixels in frame coordinates
 * through the PixelCanvas origin offset. Effects and backgrounds keep their own 2 px grid (`pixel.ts`).
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
 * px and a 105 px body every part is 3 × 0.7 = 2.1 old pixels wide. 13.03 replaces these with hand-authored art.
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
}

export const CHARACTER_PARTS: Record<CharacterId, CharacterParts> = {
  drifter: scaleParts(DRIFTER_PARTS),
  conductor: scaleParts(CONDUCTOR_PARTS),
  stoker: scaleParts(STOKER_PARTS),
  claude: scaleParts(CLAUDE_PARTS),
};

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
  flash?: number | undefined;
  flashAlpha?: number | undefined;
  alpha: number;
  itemVisible: boolean;
  /** Render clock for the Claude Code prompt blink; 0 when absent. */
  blinkMs?: number | undefined;
}

/** Thickness of the rasterised limbs in sprite px (13.01: world px at the 105 px body; 13.02 tapers and shades them). */
const THIGH_W = 8;
const SHIN_W = 6;
const UPPER_W = 8;
const FORE_W = 6;
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

/** World joint -> frame px in the authored (facing-right) space, relative to the feet anchor, rounded. */
export function jointToSprite(joint: Pt, f: FighterState): { x: number; y: number } {
  return {
    x: Math.round(ANCHOR.x + (f.facing * (joint.x - f.x)) / SPRITE_SCALE),
    y: Math.round(ANCHOR.y + (joint.y - f.y) / SPRITE_SCALE),
  };
}

/** 12.04: the laser keeps open palms (the cupped hands and the thrust); a throw grips (holding covers it anyway). */
const FIST_STATES: ReadonlySet<RigState> = new Set(["punch", "block", "hit", "throw"]);

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

export function composeFrame(canvas: PixelCanvas, joints: Joints, f: FighterState, characterId: CharacterId, opts: ComposeOpts): void {
  const parts = CHARACTER_PARTS[characterId];
  const J = (p: Pt): { x: number; y: number } => jointToSprite(p, f);
  const state = joints.state;
  const item = opts.itemVisible ? f.item : null;
  const holding = item !== null && HAND_ITEMS.has(item.kind);
  const hand = handPart(parts, state, holding);
  const legShade = darken(parts.legColor, 0.72);

  canvas.clear();

  const hip = J(joints.hip);
  const neck = J(joints.neck);
  const head = J(joints.head);

  // backpack: on the back, behind everything, hanging off the back shoulder
  if (item && item.kind === "shield") {
    const sh = J(joints.arms.B.shoulder);
    canvas.blit(ITEM_SPRITES.shield, sh.x - 4, sh.y + 4, false);
  }

  const drawLeg = (leg: Joints["legs"]["F"], color: number): void => {
    const h = J(leg.hip);
    const k = J(leg.knee);
    const foot = J(leg.foot);
    const ankle = { x: foot.x, y: foot.y - ANKLE_LIFT };
    canvas.line(h.x, h.y, k.x, k.y, THIGH_W, color);
    canvas.line(k.x, k.y, ankle.x, ankle.y, SHIN_W, color);
    canvas.blit(parts.foot, foot.x, foot.y, false);
  };
  const drawArm = (arm: Joints["arms"]["F"], color: number): void => {
    const s = J(arm.shoulder);
    const e = J(arm.elbow);
    const w = J(arm.wrist);
    const fist = J(arm.fist);
    canvas.line(s.x, s.y, e.x, e.y, UPPER_W, color);
    canvas.line(e.x, e.y, w.x, w.y, FORE_W, color);
    if (parts.cuff !== undefined) {
      const len = Math.hypot(w.x - e.x, w.y - e.y) || 1;
      const ux = (w.x - e.x) / len;
      const uy = (w.y - e.y) / len;
      canvas.line(Math.round(w.x - ux * CUFF_LEN), Math.round(w.y - uy * CUFF_LEN), w.x, w.y, FORE_W, parts.cuff);
    }
    canvas.blit(hand, fist.x, fist.y, false);
  };

  drawLeg(joints.legs.B, legShade);
  drawArm(joints.arms.B, parts.limbShade);

  // torso on the hip -> neck segment, upright when the lean is small, sheared or rotated in 15° steps otherwise
  let torso = parts.torso;
  if (state === "block" && parts.torsoBlock) torso = parts.torsoBlock;
  else if (parts.torsoBlink && isBlinkOn(opts.blinkMs ?? 0)) torso = parts.torsoBlink;
  const segDeg = (Math.atan2(neck.x - hip.x, hip.y - neck.y) * 180) / Math.PI;
  const lean = Math.abs(joints.lean) < LEAN_AUTHORED ? 0 : quantise(segDeg);
  if (lean === 0) canvas.blit(torso, hip.x, hip.y, false);
  else if (Math.abs(lean) <= LEAN_SHEAR_MAX) canvas.blitSheared(torso, hip.x, hip.y, false, Math.tan((lean * Math.PI) / 180));
  else canvas.blitRotated(torso, hip.x, hip.y, false, lean);

  canvas.blit(state === "ko" ? parts.headKo : parts.head, head.x, head.y, false);

  drawLeg(joints.legs.F, parts.legColor);
  drawArm(joints.arms.F, parts.limbColor);

  if (item && holding) {
    const fist = J(joints.arms.F.fist);
    canvas.blit(ITEM_SPRITES[item.kind], fist.x, fist.y, false);
  }

  if (opts.facing === -1) canvas.mirror(ANCHOR.x);

  // nothing sinks into the roof: the fill stops one row above the sole so the outline lands on it (KO sprawl)
  canvas.clearBelow(ANCHOR.y - 1);
  // 12.02: gloom mixes the fills before the outline and rim passes so those stay crisp
  if (opts.gloom > 0) canvas.mixAll(SHADE, Math.min(opts.gloom, MAX_GLOOM), P.outline);
  canvas.outline(P.outline);
  canvas.rim(opts.rimColor, opts.rimSide, P.outline);
  if (opts.rimSide !== "both") canvas.edgeDither(2, SHADE, SHADE_ALPHA, opts.rimSide === "right" ? "left" : "right", P.outline);

  if (opts.flash !== undefined) canvas.mixAll(opts.flash, opts.flashAlpha ?? DEFAULT_FLASH_ALPHA);
  canvas.scaleAlpha(opts.alpha);
}
