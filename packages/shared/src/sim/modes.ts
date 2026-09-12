// STUB — filled by 10-arenas/02 (sim-modes): mode rules beyond the timer and round counts wired in rounds.ts.
import type { MatchConfig } from "../constants";

/** Number of teams (the length of `roundsWon`). */
export function teamCount(config: MatchConfig): number {
  return config.teams === "2v2" ? 2 : config.players;
}
