import { EMPTY_FRAME, MATCH, type InputFrame, type MatchState, type SimEvent } from "../src";
import { createMatch } from "../src/sim/create";
import { step } from "../src/sim/step";

export const NONE: [InputFrame, InputFrame] = [EMPTY_FRAME, EMPTY_FRAME];
export const P_L: InputFrame = { ...EMPTY_FRAME, punchL: true };

export function fighting(gap?: number): MatchState {
  const s = createMatch();
  s.phase = "FIGHTING"; s.roundTicks = MATCH.ROUND_TICKS;
  if (gap !== undefined) { s.fighters[0]!.x = 400; s.fighters[1]!.x = 400 + gap; }
  return s;
}

export function run(s: MatchState, n: number, inputs: [InputFrame, InputFrame] = NONE) {
  const events: SimEvent[] = [];
  for (let i = 0; i < n; i++) { const r = step(s, inputs); s = r.state; events.push(...r.events); }
  return { s, events };
}
