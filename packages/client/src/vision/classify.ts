import { framesEqual, type InputFrame, type ItemId } from "@midnight/shared";
import { isThrowable } from "./gestures/windup";

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
  /** 9.10 molotov wind-up per arm (only ever true while a throwable is held). */
  windupL: boolean;
  windupR: boolean;
  /** 9.10 sword slash pulses (either arm). */
  chop: boolean;
  sweep: boolean;
  /** 9.10: that arm's punch is suppressed for SLASH_EXCLUSIVE_MS after a slash. */
  slashL: boolean;
  slashR: boolean;
  /** What the local fighter holds per the last snapshot (VisionInputSource.setHeldItem); sim truth. */
  held: ItemId | null;
}

let last: Readonly<InputFrame> | null = null;

/**
 * The exclusivity table (5.03, 9.04, 9.10). Jump cancels everything but walk; block cancels everything else.
 * Per arm while a throwable is held: windup > punch > laser — an active wind-up holds that arm's punch true
 * and silences the beam, and a punch with a throwable in hand also silences the beam (it would throw).
 * Otherwise the beam (special) cancels punches. A slash suppresses that arm's punch; chop / sweep are pulses.
 * Walk and item pass through. Returns a frozen frame reused (same object) until a field changes.
 */
export function classify(g: GestureFlags): Readonly<InputFrame> {
  const jump = g.jump;
  const block = !jump && g.block;
  const free = !jump && !block;
  const throwable = isThrowable(g.held);
  const windupL = free && throwable && g.windupL;
  const windupR = free && throwable && g.windupR;
  const rawPunchL = free && !g.slashL && (windupL || g.punchL);
  const rawPunchR = free && !g.slashR && (windupR || g.punchR);
  const special = free && g.special && !windupL && !windupR && !(throwable && (rawPunchL || rawPunchR));
  const next: InputFrame = {
    left: g.left,
    right: g.right,
    jump,
    punchL: rawPunchL && !special,
    punchR: rawPunchR && !special,
    block,
    special,
    item: g.item,
    chop: free && g.chop,
    sweep: free && g.sweep,
  };
  if (last && framesEqual(last, next)) return last;
  last = Object.freeze(next);
  return last;
}
