# Phase 1 — Simulation (`packages/shared`)

Pure, deterministic, 60 Hz. `step(state, [inputA, inputB]) -> { state, events }`. No DOM, Phaser, `Date`, `Math.random`, or sockets anywhere in `packages/shared/src/sim`. The server runs it; the client only reads its output types.

| # | Feature | File |
|---|---|---|
| 01 | Input contract and constants | `01-input-and-constants.md` |
| 02 | State, movement, jump, facing, bounds | `02-state-and-movement.md` |
| 03 | Punch, hitboxes, damage, block, hitstun, i-frames | `03-combat.md` |
| 04 | Rounds, timer, best of 3, out-of-bounds, train car | `04-rounds-and-match.md` |
| 05 | Wire protocol schemas | `05-protocol.md` |

Module layout:
```
packages/shared/src/
  index.ts          re-exports everything below
  input.ts          01
  constants.ts      01
  protocol.ts       05
  sim/types.ts      02
  sim/create.ts     02
  sim/fighter.ts    02 (control + physics)
  sim/combat.ts     03
  sim/rounds.ts     04
  sim/step.ts       02, extended by 03 and 04
packages/shared/test/*.test.ts
```

Tick order inside `step` (final, after 04):
1. clone state, `tick++`
2. if `FIGHTING`: control both fighters → physics both → facing → advance punches → resolve hits → out-of-bounds → round timer and end checks
3. else if `COUNTDOWN` or `ROUND_END`: phase countdown
4. store this tick's inputs as each fighter's `prev`
