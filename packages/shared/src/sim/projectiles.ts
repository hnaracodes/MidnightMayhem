// STUB — filled by 09-arsenal/02 (sim-throwables): molotov and banana throws and their flight.
import type { Arm, MatchState, PlayerIndex, SimEvent } from "./types";

/** Starts a throw action for the held throwable; true when the punch edge was consumed. No-op until 09.02. */
export function startThrow(_s: MatchState, _i: PlayerIndex, _arm: Arm, _events: SimEvent[]): boolean {
  return false;
}

/** Moves every projectile and turns landed ones into hazards. No-op until 09.02. */
export function advanceProjectiles(_s: MatchState, _events: SimEvent[]): void {}
