/**
 * THE CONTRACT between keyboard, network and webcam sources and the simulation.
 * Frozen after Phase 0. Do not edit without owner approval. See implementation-docs/01-simulation/01.
 */
export interface InputFrame {
  left: boolean;   // move toward screen-left
  right: boolean;  // move toward screen-right
  jump: boolean;
  punchL: boolean; // player's left arm
  punchR: boolean; // player's right arm
  block: boolean;
}

export const EMPTY_FRAME: Readonly<InputFrame> = Object.freeze({
  left: false, right: false, jump: false, punchL: false, punchR: false, block: false,
});

export const INPUT_KEYS = ["left", "right", "jump", "punchL", "punchR", "block"] as const;
export type InputKey = (typeof INPUT_KEYS)[number];

/** Anything that can produce InputFrames. sample() must be non-blocking. */
export interface InputSource {
  start(): Promise<void>;
  stop(): void;
  sample(): Readonly<InputFrame>;
}

/** True only where prev is false and next is true. */
export function risingEdges(prev: Readonly<InputFrame>, next: Readonly<InputFrame>): InputFrame {
  return {
    left: !prev.left && next.left,
    right: !prev.right && next.right,
    jump: !prev.jump && next.jump,
    punchL: !prev.punchL && next.punchL,
    punchR: !prev.punchR && next.punchR,
    block: !prev.block && next.block,
  };
}

export function framesEqual(a: Readonly<InputFrame>, b: Readonly<InputFrame>): boolean {
  return INPUT_KEYS.every((k) => a[k] === b[k]);
}
