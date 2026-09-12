/**
 * Per-character rig data from HackCMU 2026/design/01-characters.md. Pure data: no Phaser, no DOM.
 * Lengths are px at standing height 150; angles in degrees (0 = straight down, 90 = forward, 180 = up).
 */
import type { CharacterId } from "@midnight/shared";
import { P } from "../palette";

/**
 * 13.00: the drawn body is this fraction of the 150 px author rig (105 px). `RIG` and every constant in
 * `rig/pose.ts` stay in author px; `computePose` scales the local offsets when mapping to world, `rig/draw.ts`
 * scales its widths, and `shared/constants.ts` carries the matching hurtbox, reach and band numbers.
 */
export const BODY_SCALE = 0.7;

/** Shared segment lengths and thicknesses in author px (a 150 px body). `*W` fields are capsule widths. */
export const RIG = {
  head: 16,
  neck: 8, neckW: 10,
  torso: 54,
  upper: 30, upperW: 14,
  fore: 28, foreW: 12,
  fist: 9,
  thigh: 34, thighW: 16,
  shin: 32, shinW: 14,
  foot: 22, footW: 8,
} as const;

export interface CharacterRig {
  key: number;
  skin: number;
  hand: number;
  name: string;
  shoulderW: number;
  hipW: number;
  /** Half the distance between the feet, minus the foot pad; feet sit at ±(stanceSpread + 3). */
  stanceSpread: number;
  /** Resting knee bend in degrees (design/01). The hip is pinned at feet.y - 66 (4.01 rule 2); the leg IK produces this bend from the stance. */
  kneeBend: number;
  /** Resting forward torso lean in degrees. */
  torsoLean: number;
  /** Resting guard as a chain of angles (upper arm, then forearm); the front fist sits 4 px further forward. */
  guard: { upper: number; fore: number };
  signature: "drifter" | "conductor";
}

export const CHARACTER_RIG: Record<CharacterId, CharacterRig> = {
  drifter: {
    key: P.drifterKey,
    skin: P.drifterSkin,
    hand: P.drifterSkin,
    name: "THE DRIFTER",
    shoulderW: 44,
    hipW: 40,
    stanceSpread: 20,
    kneeBend: 12,
    torsoLean: 6,
    guard: { upper: 12, fore: 62 },
    signature: "drifter",
  },
  conductor: {
    key: P.conductorKey,
    skin: 0xE9C9AE,
    hand: P.conductorGlove,
    name: "THE CONDUCTOR",
    shoulderW: 36,
    hipW: 32,
    stanceSpread: 12,
    kneeBend: 0,
    torsoLean: 0,
    guard: { upper: 45, fore: 175 },
    signature: "conductor",
  },
  // 11.01: the Stoker is a brawler (wide, forward, low guard); Claude Code is upright with a tidy boxing guard.
  // `signature` picks the vector-rig fallback look (`?rig=vector`); the pixel sprites carry their own parts.
  stoker: {
    key: P.stokerKey,
    skin: P.stokerSkin,
    hand: P.stokerSkin,
    name: "THE STOKER",
    shoulderW: 46,
    hipW: 38,
    stanceSpread: 18,
    kneeBend: 10,
    torsoLean: 8,
    guard: { upper: 14, fore: 66 },
    signature: "drifter",
  },
  claude: {
    key: P.claudeOrange,
    skin: P.claudeOrange,
    hand: P.claudeGlove,
    name: "CLAUDE CODE",
    shoulderW: 36,
    hipW: 32,
    stanceSpread: 14,
    kneeBend: 0,
    torsoLean: 0,
    guard: { upper: 40, fore: 170 },
    signature: "conductor",
  },
};
