import { EMPTY_FRAME, type InputFrame } from "../input";
import { advancePunches, resolvePunches } from "./combat";
import { playerIndices } from "./create";
import { applyPhysics, controlFighter, updateFacing } from "./fighter";
import { advanceHazards } from "./hazards";
import { applyEquip, tickCooldowns } from "./items";
import { resolveLaser } from "./laser";
import { applyPits } from "./maps";
import { advanceProjectiles, advanceThrowCharge } from "./projectiles";
import { advancePhase, applyOutOfBounds, tickRound } from "./rounds";
import type { MatchState, SimEvent, StepResult } from "./types";

/** Pure: never mutates prev. Same (prev, inputs) always gives the same result. Missing inputs read as EMPTY_FRAME. */
export function step(prev: MatchState, inputs: readonly InputFrame[]): StepResult {
  const s: MatchState = structuredClone(prev);
  const events: SimEvent[] = [];
  s.tick++;

  if (s.phase === "FIGHTING") {
    fightTick(s, inputs, events);
    applyOutOfBounds(s, events);
    tickRound(s, events);
  } else if (s.phase === "COUNTDOWN") {
    // Spec §4.2: an item may be equipped during the countdown so it is in hand when FIGHT starts.
    for (const i of playerIndices(s)) applyEquip(s, i, inputs[i] ?? EMPTY_FRAME, events);
    advancePhase(s, events);
  } else if (s.phase === "ROUND_END") {
    advancePhase(s, events);
  }

  for (const i of playerIndices(s)) s.fighters[i]!.prev = { ...(inputs[i] ?? EMPTY_FRAME) };
  return { state: s, events };
}

/** One fighting tick, in the order the lanes fill in (08-contracts/01 § step.ts). */
export function fightTick(s: MatchState, inputs: readonly InputFrame[], events: SimEvent[]): void {
  // Advance existing actions first so a punch started this tick sits at elapsed 0 (startup)
  // and its first active tick is the 5th tick after the key edge (4 startup ticks, no hitbox).
  advancePunches(s);
  tickCooldowns(s);
  const players = playerIndices(s);
  for (const i of players) controlFighter(s, i, inputs[i] ?? EMPTY_FRAME, events);
  advanceThrowCharge(s, inputs);
  for (const i of players) applyEquip(s, i, inputs[i] ?? EMPTY_FRAME, events);
  for (const i of players) applyPhysics(s.fighters[i]!, i, s.config.map, events);
  updateFacing(s);
  resolvePunches(s, events);
  resolveLaser(s, events);
  advanceProjectiles(s, events);
  advanceHazards(s, events);
  applyPits(s, events);
}
