import { framesEqual, type InputFrame } from "@midnight/shared";

export interface GestureFlags {
  left: boolean;
  right: boolean;
  jump: boolean;
  punchL: boolean;
  punchR: boolean;
  block: boolean;
}

let last: Readonly<InputFrame> | null = null;

/**
 * Priority: jump cancels block and punches; block cancels punches; walk is independent.
 * Returns a frozen frame that is reused (same object) until a field changes.
 */
export function classify(g: GestureFlags): Readonly<InputFrame> {
  const jump = g.jump;
  const block = !jump && g.block;
  const punch = !jump && !block;
  const next: InputFrame = {
    left: g.left,
    right: g.right,
    jump,
    punchL: punch && g.punchL,
    punchR: punch && g.punchR,
    block,
    special: false, // laser gesture lands in 09.04
    item: null,     // object detection lands in 09.04
  };
  if (last && framesEqual(last, next)) return last;
  last = Object.freeze(next);
  return last;
}
