# 1.04 — Rounds, timer, best of 3, out-of-bounds, train car

## Purpose
Phase machine COUNTDOWN → FIGHTING → ROUND_END → (COUNTDOWN | MATCH_END), the 30 s timer, scoring, edge damage, and the per-round train car.

## Files
Create: `packages/shared/src/sim/rounds.ts`, `packages/shared/test/rounds.test.ts`. Modify: `sim/step.ts` (final tick order per phase README).

## Depends on
1.03.

## Exposes
- `applyOutOfBounds(state, events): void`
- `tickRound(state, events): void` — timer and round-end check
- `endRound(state, winner, events): void`
- `advancePhase(state, events): void` — COUNTDOWN and ROUND_END countdowns
- `roundWinner(state): Winner | null`, `matchWinner(state): Winner | null`

## Behaviour
1. COUNTDOWN: `phaseTicks` counts down from 180; at 0 → `FIGHTING`, emit `ROUND_START{round}`. No inputs act during countdown (movement rule 1.02.3) but `prev` is still recorded.
2. FIGHTING: after combat each tick, `roundTicks--` (floor 0).
3. Round ends immediately when either hp is 0 after resolution, or when `roundTicks` hits 0. Both hp 0 → draw. Timer: higher hp wins, equal → draw.
4. `endRound`: draw scores one round for **both** players; otherwise the winner scores one. Set `ROUND_END`, `phaseTicks = 120`, zero both `vx`, clear actions and blocking. Emit `ROUND_END`.
5. ROUND_END at `phaseTicks` 0: if a player has 2 rounds (both → match draw), or `round === 3`, set `MATCH_END`, set `winner`, emit `MATCH_END`. Else `resetForRound(round + 1)`.
6. `matchWinner` at round 3 with no one at 2: higher `roundsWon` wins, equal → draw.
7. Train car is `trainCarForRound(round)`: 1 STANDARD, 2 TUNNEL, 3 FINAL_CAR. No rule effect.
8. Out-of-bounds: while `x <= 0 || x >= 960`, `oobTicks++`; every 30th tick deduct 3 hp and emit `OOB_DAMAGE`. Leaving the edge resets `oobTicks`. Runs before the round-end check so edge damage can end a round.
9. MATCH_END: `step` only records `prev`. Rematch is a server concern (new `createMatch`).

## Invariants
- `roundsWon[i] <= 2`; `round <= 3`.
- Exactly one `ROUND_END` per round and one `MATCH_END` per match.
- `phase` never goes FIGHTING → COUNTDOWN directly.

## Tests
- countdown → FIGHTING with ROUND_START at tick 180
- timer expiry, higher hp wins; equal hp draw scores both
- hp 0 ends round same tick
- round 2 starts in TUNNEL with reset positions and hp
- first to 2 → MATCH_END with winner; 2–2 after round 3 → draw; 1–0 after round 3 → player 0
- OOB: 3 hp per 30 ticks, event count
- inputs ignored in MATCH_END

## Done when
- [ ] tests pass; a scripted headless match (script under `packages/shared/test/fullmatch.test.ts`) runs to MATCH_END
