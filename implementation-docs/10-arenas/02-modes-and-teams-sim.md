# 10.02 — Modes and teams in the simulation

## Purpose
Make the three game modes and the 3/4-player team rules real and fully tested: timers per mode, round and match
winners by team, KO'd fighters staying down, the deathmatch that only ends on KO.

## Files
Modify: `packages/shared/src/sim/modes.ts` (replace stub), `src/sim/rounds.ts`, `src/sim/create.ts`.
Create: `packages/shared/test/modes.test.ts`.
Owns `modes.ts`, `rounds.ts`, `create.ts`. Does not edit `fighter.ts`, `combat.ts`, `maps.ts`.

## Depends on
8.01 (which already generalised `roundWinner` / `matchWinner` to teams; this feature finishes, hardens and tests
them).

## Exposes
`modes.ts`:
- `teamCount(config): number` — 2v2 → 2, ffa → `players`.
- `teamsOf(config): number[][]` — player indices per team.
- `hasTimer(config): boolean` — `MODES[mode].roundTicks !== null`.
- `timerSeconds(s): number | null` — `ceil(roundTicks / 60)` or null.

`rounds.ts` (final rules):
- `livingTeams(s)`, `teamHp(s, team)` (8.01).
- `roundWinner(s)`: exactly one living team → it; zero → `"draw"`; else if `hasTimer && roundTicks === 0` → highest
  `teamHp`, ties `"draw"`; else null.
- `endRound`: `roundsWon[team]++` for the winner, or every team on a draw (existing owner rule B); every fighter's
  action/block cleared, `vx = 0`; projectiles and hazards cleared.
- `matchWinner(s)`: first team with `roundsWon ≥ MODES[mode].roundsToWin`; if two reach it on the same round → `"draw"`;
  after `maxRounds` rounds → most rounds won, ties `"draw"`.
- `tickRound`: decrements only when `hasTimer`.

`create.ts`: `roundsWon = new Array(teamCount(config)).fill(0)`; `resetForRound` clears `projectiles`, `hazards`,
`item`, `itemsUsed`, `dazzle`, `laserCooldown` (a new round starts fresh), keeps `prev`.

## Behaviour
1. `rounds`, 2 players: identical to today's `fullmatch.test.ts` (it must still pass untouched).
2. `timed`: `roundTicks` starts 5400; after 5400 fighting ticks with no hits → `ROUND_END draw` then `MATCH_END draw`
   (one round only). With P0 at 40 and P1 at 28 at expiry → team 0 wins the match.
3. `deathmatch`: 20 000 ticks with no hits never ends the round; a KO ends round and match at once.
4. 3-player FFA `rounds`: P2 KO'd, P0 and P1 alive → no winner; P1 then KO'd → round to team 0; `roundsWon.length === 3`.
5. 4-player 2v2: teams `[0,0,1,1]`; P0 KO'd, P1 alive, P2 and P3 alive → no winner; P2 and P3 KO'd → team 0 wins;
   `roundsWon.length === 2`; `MATCH_END winner 0` after two such rounds.
6. A KO'd fighter (`hp 0`) in a 3-player round: ignores input, is never hit again (`canBeHit` false), is not counted
   for OOB, and his punches never resolve.
7. A 2v2 teammate is never hit by a punch, a laser or a flash; he **is** hurt by fire (fire is indiscriminate).
8. Timer draw in 2v2 with equal team hp → `"draw"`, both `roundsWon` incremented.
9. `resetForRound` clears items, hazards, projectiles, dazzle and cooldowns, keeps characters, loadouts, teams, prev.
10. `timerSeconds` is null in deathmatch and 90 at the start of `timed`.

## Invariants
- `roundsWon.length === teamCount(config)` always.
- A match never ends with `winner === null`.
- Nothing here reads `Math.random` or the clock.

## Tests
`modes.test.ts`: rules 2–10 (rule 1 is the existing suite). Rule 7's laser/flash parts depend on 9.03/9.01 — write
them as `it.todo` if those lanes have not merged; the integrator un-todos them.

## Done when
- [ ] tests pass, `pnpm test` and `pnpm typecheck` green
- [ ] committed on `feat/sim-modes` with prefix `sim:`
