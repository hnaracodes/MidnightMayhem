// STUB — filled by 09-arsenal/03 (sim-laser): charge, beam and cooldown.
import type { MatchState, PlayerIndex, SimEvent } from "./types";

/** Starts a laser action on the `special` edge; true when it consumed the edge. No-op until 09.03. */
export function startLaser(_s: MatchState, _i: PlayerIndex, _events: SimEvent[]): boolean {
  return false;
}

/** Applies active beams to every living opponent once per beam. No-op until 09.03. */
export function resolveLaser(_s: MatchState, _events: SimEvent[]): void {}
