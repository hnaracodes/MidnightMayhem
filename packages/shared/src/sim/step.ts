import type { InputFrame } from "../input";
import { advancePunches, resolvePunches } from "./combat";
import { applyPhysics, controlFighter, updateFacing } from "./fighter";
import { advancePhase, applyOutOfBounds, tickRound } from "./rounds";
import type { MatchState, SimEvent, StepResult } from "./types";

/** Pure: never mutates prev. Same (prev, inputs) always gives the same result. */
export function step(prev: MatchState, inputs: [InputFrame, InputFrame]): StepResult {
  const s: MatchState = structuredClone(prev);
  const events: SimEvent[] = [];
  s.tick++;

  if (s.phase === "FIGHTING") {
    fightTick(s, inputs, events);
    applyOutOfBounds(s, events);
    tickRound(s, events);
  } else if (s.phase === "COUNTDOWN" || s.phase === "ROUND_END") {
    advancePhase(s, events);
  }

  s.fighters[0].prev = { ...inputs[0] };
  s.fighters[1].prev = { ...inputs[1] };
  return { state: s, events };
}

export function fightTick(s: MatchState, inputs: [InputFrame, InputFrame], events: SimEvent[]): void {
  // Advance existing punches first so a punch started this tick sits at elapsed 0 (startup)
  // and its first active tick is the 5th tick after the key edge (4 startup ticks, no hitbox).
  advancePunches(s);
  controlFighter(s.fighters[0], 0, inputs[0], events);
  controlFighter(s.fighters[1], 1, inputs[1], events);
  applyPhysics(s.fighters[0]);
  applyPhysics(s.fighters[1]);
  updateFacing(s.fighters[0], s.fighters[1]);
  resolvePunches(s, events);
}
