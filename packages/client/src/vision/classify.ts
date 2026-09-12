import { framesEqual, type InputFrame, type ItemId } from "@midnight/shared";

export interface GestureFlags {
  left: boolean;
  right: boolean;
  jump: boolean;
  punchL: boolean;
  punchR: boolean;
  block: boolean;
  /** The laser beam pose (9.04). */
  special: boolean;
  /** The debounced held item (9.04), or null. */
  item: ItemId | null;
}

let last: Readonly<InputFrame> | null = null;

/**
 * Priority: jump cancels everything but walk; block cancels special and punches; special cancels punches;
 * walk and item pass through. Returns a frozen frame that is reused (same object) until a field changes.
 */
export function classify(g: GestureFlags): Readonly<InputFrame> {
  const jump = g.jump;
  const block = !jump && g.block;
  const special = !jump && !block && g.special;
  const punch = !jump && !block && !special;
  const next: InputFrame = {
    left: g.left,
    right: g.right,
    jump,
    punchL: punch && g.punchL,
    punchR: punch && g.punchR,
    block,
    special,
    item: g.item,
  };
  if (last && framesEqual(last, next)) return last;
  last = Object.freeze(next);
  return last;
}
