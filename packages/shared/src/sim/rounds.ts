import { BALANCE, MATCH, WORLD } from "../constants";
import { resetForRound } from "./create";
import type { MatchState, SimEvent, Winner } from "./types";

export function applyOutOfBounds(s: MatchState, events: SimEvent[]): void {
  for (const i of [0, 1] as const) {
    const f = s.fighters[i];
    if (f.x <= 0 || f.x >= WORLD.WIDTH) {
      f.oobTicks++;
      if (f.oobTicks % BALANCE.OOB_EVERY_TICKS === 0) {
        f.hp = Math.max(0, f.hp - BALANCE.OOB_DAMAGE);
        events.push({ type: "OOB_DAMAGE", player: i, damage: BALANCE.OOB_DAMAGE });
      }
    } else {
      f.oobTicks = 0;
    }
  }
}

export function roundWinner(s: MatchState): Winner | null {
  const [a, b] = s.fighters;
  if (a.hp <= 0 && b.hp <= 0) return "draw";
  if (a.hp <= 0) return 1;
  if (b.hp <= 0) return 0;
  if (s.roundTicks > 0) return null;
  if (a.hp > b.hp) return 0;
  if (b.hp > a.hp) return 1;
  return "draw";
}

export function matchWinner(s: MatchState): Winner | null {
  const [a, b] = s.roundsWon;
  const aWins = a >= MATCH.ROUNDS_TO_WIN, bWins = b >= MATCH.ROUNDS_TO_WIN;
  if (aWins && bWins) return "draw";
  if (aWins) return 0;
  if (bWins) return 1;
  if (s.round >= MATCH.MAX_ROUNDS) return a > b ? 0 : b > a ? 1 : "draw";
  return null;
}

/** Decrement the timer, then end the round if health or time says so. Last step of a fighting tick. */
export function tickRound(s: MatchState, events: SimEvent[]): void {
  s.roundTicks = Math.max(0, s.roundTicks - 1);
  const w = roundWinner(s);
  if (w !== null) endRound(s, w, events);
}

export function endRound(s: MatchState, winner: Winner, events: SimEvent[]): void {
  if (winner === "draw") { s.roundsWon[0]++; s.roundsWon[1]++; }
  else s.roundsWon[winner]++;
  s.phase = "ROUND_END";
  s.phaseTicks = MATCH.ROUND_END_TICKS;
  for (const f of s.fighters) { f.vx = 0; f.action = null; f.blocking = false; }
  events.push({ type: "ROUND_END", round: s.round, winner });
}

/** COUNTDOWN and ROUND_END countdowns. */
export function advancePhase(s: MatchState, events: SimEvent[]): void {
  s.phaseTicks--;
  if (s.phaseTicks > 0) return;
  if (s.phase === "COUNTDOWN") {
    s.phase = "FIGHTING";
    events.push({ type: "ROUND_START", round: s.round });
  } else if (s.phase === "ROUND_END") {
    const w = matchWinner(s);
    if (w !== null) { s.phase = "MATCH_END"; s.winner = w; events.push({ type: "MATCH_END", winner: w }); }
    else resetForRound(s, s.round + 1);
  }
}
