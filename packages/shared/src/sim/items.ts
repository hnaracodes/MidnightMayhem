// STUB — filled by 09-arsenal/01 (sim-items): equip, sword, shield, flash and the per-tick counters.
import type { InputFrame } from "../input";
import type { Arm, MatchState, PlayerIndex, SimEvent } from "./types";

/** Counts down laserCooldown, dazzle and invuln for every fighter (blockTicks is driven by controlFighter). */
export function tickCooldowns(s: MatchState): void {
  for (const f of s.fighters) {
    if (f.laserCooldown > 0) f.laserCooldown--;
    if (f.dazzle > 0) f.dazzle--;
    if (f.invuln > 0) f.invuln--;
  }
}

/** Equip on the `item` edge (spec §4.2). No-op until 09.01. */
export function applyEquip(_s: MatchState, _i: PlayerIndex, _input: InputFrame, _events: SimEvent[]): void {}

/** True when the held item consumed the punch edge; false falls through to a normal punch. No-op until 09.01. */
export function usePunchWithItem(_s: MatchState, _i: PlayerIndex, _arm: Arm, _events: SimEvent[]): boolean {
  return false;
}
