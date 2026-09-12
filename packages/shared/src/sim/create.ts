import { BALANCE, CHARACTERS, MATCH, WORLD } from "../constants";
import { EMPTY_FRAME } from "../input";
import type { FighterState, MatchState, PlayerIndex, TrainCar } from "./types";

export function createFighter(i: PlayerIndex): FighterState {
  return {
    character: CHARACTERS[i],
    x: WORLD.PLAYER_START_X[i], y: WORLD.ROOF_Y, vx: 0, vy: 0,
    facing: i === 0 ? 1 : -1,
    grounded: true,
    jumpTicks: 0,
    hp: BALANCE.MAX_HP,
    action: null, hitstun: 0, knockbackVx: 0, blocking: false,
    prev: { ...EMPTY_FRAME },
    oobTicks: 0,
    weaponSlots: [null, null, null],
  };
}

export function trainCarForRound(round: number): TrainCar {
  return round === 1 ? "STANDARD" : round === 2 ? "TUNNEL" : "FINAL_CAR";
}

export function createMatch(): MatchState {
  return {
    tick: 0, phase: "COUNTDOWN", phaseTicks: MATCH.COUNTDOWN_TICKS,
    round: 1, roundsWon: [0, 0], roundTicks: MATCH.ROUND_TICKS,
    trainCar: trainCarForRound(1),
    fighters: [createFighter(0), createFighter(1)],
    winner: null,
  };
}

/** Reset fighters for a new round. Keeps each fighter's prev input so held keys do not re-edge. */
export function resetForRound(s: MatchState, round: number): void {
  s.round = round;
  s.trainCar = trainCarForRound(round);
  s.roundTicks = MATCH.ROUND_TICKS;
  s.phase = "COUNTDOWN";
  s.phaseTicks = MATCH.COUNTDOWN_TICKS;
  for (const i of [0, 1] as const) {
    const prev = s.fighters[i].prev;
    s.fighters[i] = { ...createFighter(i), prev };
  }
}
