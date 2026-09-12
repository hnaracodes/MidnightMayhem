import { BALANCE, MATCH, MODES, WORLD } from "../constants";
import { applyDamage } from "./combat";
import { playerIndices, resetForRound } from "./create";
import { hasTimer } from "./modes";
import type { MatchState, SimEvent, Winner } from "./types";

export function applyOutOfBounds(s: MatchState, events: SimEvent[]): void {
  for (const i of playerIndices(s)) {
    const f = s.fighters[i]!;
    if (f.hp <= 0) continue;
    if (f.x <= 0 || f.x >= WORLD.WIDTH) {
      f.oobTicks++;
      if (f.oobTicks % BALANCE.OOB_EVERY_TICKS === 0) {
        applyDamage(s, i, BALANCE.OOB_DAMAGE, "oob", null, events);
        events.push({ type: "OOB_DAMAGE", player: i, damage: BALANCE.OOB_DAMAGE });
      }
    } else {
      f.oobTicks = 0;
    }
  }
}

/** Teams with at least one living fighter, ascending. */
export function livingTeams(s: MatchState): number[] {
  const teams = new Set<number>();
  for (const f of s.fighters) if (f.hp > 0) teams.add(f.team);
  return [...teams].sort((a, b) => a - b);
}

export function teamHp(s: MatchState, team: number): number {
  let hp = 0;
  for (const f of s.fighters) if (f.team === team) hp += f.hp;
  return hp;
}

/** Every team index of the match (the indices of `roundsWon`). */
function teams(s: MatchState): number[] {
  return s.roundsWon.map((_, t) => t);
}

/** The team(s) with the highest value; "draw" on a tie, the team otherwise. */
function best(candidates: number[], value: (team: number) => number): Winner {
  let top = -Infinity;
  let winners: number[] = [];
  for (const t of candidates) {
    const v = value(t);
    if (v > top) { top = v; winners = [t]; } else if (v === top) winners.push(t);
  }
  return winners.length === 1 ? winners[0]! : "draw";
}

/**
 * Exactly one living team → it; none → "draw"; otherwise, in a timed mode with the clock at zero, the team with
 * the highest total hp (ties "draw"); otherwise null (the round goes on — a deathmatch only ends on KO).
 */
export function roundWinner(s: MatchState): Winner | null {
  const living = livingTeams(s);
  if (living.length === 0) return "draw";
  if (living.length === 1) return living[0]!;
  if (!hasTimer(s.config) || s.roundTicks > 0) return null;
  return best(teams(s), (t) => teamHp(s, t));
}

/**
 * First team with `roundsWon ≥ roundsToWin`; two reaching it on the same round → "draw"; after `maxRounds` rounds →
 * most rounds won, ties "draw". Never null once the round limit is reached, so a match never ends with winner null.
 */
export function matchWinner(s: MatchState): Winner | null {
  const { roundsToWin, maxRounds } = MODES[s.config.mode];
  const reached = teams(s).filter((t) => (s.roundsWon[t] ?? 0) >= roundsToWin);
  if (reached.length > 1) return "draw";
  if (reached.length === 1) return reached[0]!;
  if (s.round >= maxRounds) return best(teams(s), (t) => s.roundsWon[t] ?? 0);
  return null;
}

/**
 * A fighter at 0 hp stays down: whatever it was doing when the KO landed (a punch in startup, a block, knockback)
 * is dropped so nothing of his resolves on a later tick. Runs every fighting tick after damage has been applied.
 */
function settleKnockouts(s: MatchState): void {
  for (const f of s.fighters) {
    if (f.hp > 0) continue;
    f.action = null;
    f.blocking = false;
    f.blockTicks = 0;
    f.vx = 0;
    f.hitstun = 0;
    f.knockbackVx = 0;
  }
}

/**
 * Settle KOs, decrement the timer (only when the mode has one), then end the round if health or time says so.
 * Last step of a fighting tick.
 */
export function tickRound(s: MatchState, events: SimEvent[]): void {
  settleKnockouts(s);
  if (hasTimer(s.config)) s.roundTicks = Math.max(0, s.roundTicks - 1);
  const w = roundWinner(s);
  if (w !== null) endRound(s, w, events);
}

/** Scores the round (every team on a draw — owner rule B), freezes every fighter and clears the field. */
export function endRound(s: MatchState, winner: Winner, events: SimEvent[]): void {
  if (winner === "draw") for (const t of teams(s)) s.roundsWon[t]!++;
  else s.roundsWon[winner] = (s.roundsWon[winner] ?? 0) + 1;
  s.phase = "ROUND_END";
  s.phaseTicks = MATCH.ROUND_END_TICKS;
  for (const f of s.fighters) { f.vx = 0; f.action = null; f.blocking = false; f.blockTicks = 0; }
  s.projectiles = [];
  s.hazards = [];
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
