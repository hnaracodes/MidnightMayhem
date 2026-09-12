// 10-arenas/02 (sim-modes): team layout and timer helpers. Pure reads of config/constants; no state mutation.
import { MODES, TEAM_OF, TICK, type MatchConfig } from "../constants";
import type { MatchState, PlayerIndex } from "./types";

/** Number of teams (the length of `roundsWon`): 2v2 → 2, ffa → `players`. */
export function teamCount(config: MatchConfig): number {
  return config.teams === "2v2" ? 2 : config.players;
}

/** Player indices per team, indexed by team. Every player appears exactly once. */
export function teamsOf(config: MatchConfig): number[][] {
  const teams: number[][] = Array.from({ length: teamCount(config) }, () => []);
  for (let i = 0; i < config.players; i++) {
    const t = TEAM_OF[config.teams](i as PlayerIndex, config.players);
    teams[t]!.push(i);
  }
  return teams;
}

/** True when the mode counts a round timer down (`MODES[mode].roundTicks !== null`). */
export function hasTimer(config: MatchConfig): boolean {
  return MODES[config.mode].roundTicks !== null;
}

/** Whole seconds left on the round clock (`ceil(roundTicks / 60)`), or null when the mode has no timer. */
export function timerSeconds(s: MatchState): number | null {
  if (!hasTimer(s.config)) return null;
  return Math.ceil(s.roundTicks / TICK.HZ);
}
