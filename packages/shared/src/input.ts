/**
 * THE CONTRACT between keyboard, network and webcam sources and the simulation.
 * Frozen after Phase 0; extended by 08-contracts/01 (spec §3.1): `special` (laser) and `item` (what the hand holds).
 */
import type { ItemId } from "./constants";

export interface InputFrame {
  left: boolean;   // move toward screen-left
  right: boolean;  // move toward screen-right
  jump: boolean;
  punchL: boolean; // player's left arm
  punchR: boolean; // player's right arm
  block: boolean;
  special: boolean;      // laser: both arms thrust forward together / key Q
  item: ItemId | null;   // what the camera sees in the hand / keys 1–5 while held
  chop: boolean;         // sword overhead chop: wrist over the head then dropped / key E (9.10)
  sweep: boolean;        // sword horizontal sweep: wrist across the body / key R (9.10)
}

/** Two distinct items chosen pre-fight. */
export type Loadout = [ItemId, ItemId];

export const EMPTY_FRAME: Readonly<InputFrame> = Object.freeze({
  left: false, right: false, jump: false, punchL: false, punchR: false, block: false, special: false, item: null, chop: false, sweep: false,
});

/** The boolean inputs. `item` is compared separately by `framesEqual` and never edge-detected. */
export const INPUT_KEYS = ["left", "right", "jump", "punchL", "punchR", "block", "special", "chop", "sweep"] as const;
export type InputKey = (typeof INPUT_KEYS)[number];

/** Anything that can produce InputFrames. sample() must be non-blocking. */
export interface InputSource {
  start(): Promise<void>;
  stop(): void;
  sample(): Readonly<InputFrame>;
}

/** True only where prev is false and next is true. `item` is always null here: equip is an edge on `item` itself. */
export function risingEdges(prev: Readonly<InputFrame>, next: Readonly<InputFrame>): InputFrame {
  return {
    left: !prev.left && next.left,
    right: !prev.right && next.right,
    jump: !prev.jump && next.jump,
    punchL: !prev.punchL && next.punchL,
    punchR: !prev.punchR && next.punchR,
    block: !prev.block && next.block,
    special: !prev.special && next.special,
    item: null,
    chop: !prev.chop && next.chop,
    sweep: !prev.sweep && next.sweep,
  };
}

export function framesEqual(a: Readonly<InputFrame>, b: Readonly<InputFrame>): boolean {
  return a.item === b.item && INPUT_KEYS.every((k) => a[k] === b[k]);
}
