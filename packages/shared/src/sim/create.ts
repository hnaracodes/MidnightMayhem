import {
  BALANCE, CHARACTERS, DEFAULT_CONFIG, DEFAULT_LOADOUT, MATCH, MODES, SPAWN_X, TEAM_OF, WORLD, normalizeConfig,
  type MatchConfig, type RosterEntry,
} from "../constants";
import { EMPTY_FRAME } from "../input";
import { teamCount } from "./modes";
import type { FighterState, MatchState, PlayerIndex, TrainCar } from "./types";

/** Spawns from `SPAWN_X[config.players]`, team from `TEAM_OF`, facing toward the world centre. */
export function createFighter(i: PlayerIndex, config: MatchConfig, entry: RosterEntry): FighterState {
  const x = SPAWN_X[config.players][i] ?? WORLD.WIDTH / 2;
  return {
    character: entry.character,
    x, y: WORLD.ROOF_Y, vx: 0, vy: 0,
    facing: x < WORLD.WIDTH / 2 ? 1 : -1,
    grounded: true,
    jumpTicks: 0,
    hp: BALANCE.MAX_HP,
    action: null, hitstun: 0, knockbackVx: 0, blocking: false,
    prev: { ...EMPTY_FRAME },
    oobTicks: 0,
    team: TEAM_OF[config.teams](i, config.players),
    loadout: [entry.loadout[0], entry.loadout[1]],
    item: null,
    itemsUsed: [],
    laserCooldown: 0,
    blockTicks: 0,
    dazzle: 0,
    pitTicks: 0,
    onPlatform: null,
    invuln: 0,
  };
}

export function trainCarForRound(round: number): TrainCar {
  return round === 1 ? "STANDARD" : round === 2 ? "TUNNEL" : "FINAL_CAR";
}

/** Every player index of a match, typed for event payloads and per-player tables. */
export function playerIndices(s: MatchState): PlayerIndex[] {
  return s.fighters.map((_, i) => i as PlayerIndex);
}

function rosterEntry(i: PlayerIndex, roster?: RosterEntry[]): RosterEntry {
  const given = roster?.[i];
  return {
    character: given?.character ?? CHARACTERS[i] ?? CHARACTERS[0],
    loadout: given?.loadout ?? DEFAULT_LOADOUT,
  };
}

export function createMatch(config: MatchConfig = DEFAULT_CONFIG, roster?: RosterEntry[]): MatchState {
  const cfg = normalizeConfig(config);
  const fighters: FighterState[] = [];
  for (let i = 0; i < cfg.players; i++) fighters.push(createFighter(i as PlayerIndex, cfg, rosterEntry(i as PlayerIndex, roster)));
  return {
    tick: 0, phase: "COUNTDOWN", phaseTicks: MATCH.COUNTDOWN_TICKS,
    round: 1, roundsWon: new Array<number>(teamCount(cfg)).fill(0), roundTicks: MODES[cfg.mode].roundTicks ?? 0,
    trainCar: trainCarForRound(1),
    fighters,
    winner: null,
    config: cfg,
    projectiles: [],
    hazards: [],
    nextId: 1,
  };
}

/**
 * Reset for a new round: a fresh field (no projectiles, no hazards) and fresh fighters at spawn with full hp, no
 * held item, an empty `itemsUsed`, no dazzle, no laser cooldown. Keeps each fighter's prev input so held keys do
 * not re-edge, plus character, loadout and team. `roundsWon` is untouched (per team, `teamCount(config)` long).
 */
export function resetForRound(s: MatchState, round: number): void {
  s.round = round;
  s.trainCar = trainCarForRound(round);
  s.roundTicks = MODES[s.config.mode].roundTicks ?? 0;
  s.phase = "COUNTDOWN";
  s.phaseTicks = MATCH.COUNTDOWN_TICKS;
  s.projectiles = [];
  s.hazards = [];
  for (const i of playerIndices(s)) {
    const old = s.fighters[i]!;
    s.fighters[i] = { ...createFighter(i, s.config, { character: old.character, loadout: old.loadout }), prev: old.prev };
  }
}
