/**
 * Per-character rig data from HackCMU 2026/design/01-characters.md. Pure data: no Phaser, no DOM.
 * Lengths are px at standing height 150; angles in degrees (0 = straight down, 90 = forward, 180 = up).
 */
import type { CharacterId } from "@midnight/shared";
import { P } from "../palette";

/** Shared segment lengths and thicknesses. `*W` fields are capsule widths. */
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
  // 08-contracts: placeholders on the existing vector rigs until 11.01 draws the pixel sprites.
  stoker: {
    key: P.drifterKey,
    skin: P.drifterSkin,
    hand: P.drifterSkin,
    name: "THE STOKER",
    shoulderW: 44,
    hipW: 40,
    stanceSpread: 20,
    kneeBend: 12,
    torsoLean: 6,
    guard: { upper: 12, fore: 62 },
    signature: "drifter",
  },
  claude: {
    key: P.conductorKey,
    skin: 0xE9C9AE,
    hand: P.conductorGlove,
    name: "CLAUDE CODE",
    shoulderW: 36,
    hipW: 32,
    stanceSpread: 12,
    kneeBend: 0,
    torsoLean: 0,
    guard: { upper: 45, fore: 175 },
    signature: "conductor",
  },
};
