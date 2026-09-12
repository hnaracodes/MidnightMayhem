# 1.02 — State, movement, jump, facing, bounds

## Purpose
The match and fighter data model, `createMatch`, and the per-tick control and physics for walking, jumping, facing and clamping.

## Files
Create: `packages/shared/src/sim/types.ts`, `sim/create.ts`, `sim/fighter.ts`, `sim/step.ts`, `packages/shared/test/movement.test.ts`.

## Depends on
1.01.

## Exposes
`types.ts`
- `type PlayerIndex = 0 | 1`, `type Facing = 1 | -1`, `type Arm = "L" | "R"`
- `type TrainCar = "STANDARD" | "TUNNEL" | "FINAL_CAR"`, `type Phase = "COUNTDOWN" | "FIGHTING" | "ROUND_END" | "MATCH_END"`, `type Winner = PlayerIndex | "draw"`
- `interface PunchAction { kind: "punch"; arm: Arm; elapsed: number; landed: boolean }`
- `interface FighterState { character: CharacterId; x, y, vx, vy: number; facing: Facing; grounded: boolean; jumpTicks: number; hp: number; action: PunchAction | null; hitstun: number; knockbackVx: number; blocking: boolean; prev: InputFrame; oobTicks: number; weaponSlots: [null, null, null] }`
- `interface MatchState { tick: number; phase: Phase; phaseTicks: number; round: number; roundsWon: [number, number]; roundTicks: number; trainCar: TrainCar; fighters: [FighterState, FighterState]; winner: Winner | null }`
- `type SimEvent = ROUND_START{round} | ROUND_END{round, winner} | MATCH_END{winner} | JUMP{player} | PUNCH{player, arm} | HIT{attacker, target, damage, blocked} | OOB_DAMAGE{player, damage}`
- `interface StepResult { state: MatchState; events: SimEvent[] }`, `interface Rect { x, y, w, h }`
- Reserved, unused: `type ProjectileHeight = "LOW" | "MID" | "HIGH"`

`create.ts`: `createFighter(i): FighterState`, `createMatch(): MatchState`, `resetForRound(state, round): void` (mutates), `trainCarForRound(round): TrainCar`.

`fighter.ts`: `controlFighter(f, i, input, events): void`, `applyPhysics(f): void`, `updateFacing(a, b): void`.

`step.ts`: `step(prev, inputs): StepResult`, `fightTick(state, inputs, events): void` (03 and 04 extend this).

## Behaviour
1. `createMatch`: tick 0, `COUNTDOWN` with `phaseTicks = 180`, round 1, `STANDARD`, fighters at x = 280 / 680, y = 430, facing 1 / -1, hp 40, grounded, `prev = EMPTY_FRAME`.
2. `step` deep-clones `prev` (`structuredClone`), never mutates its argument, and always stores the inputs as each fighter's `prev` at the end, in every phase.
3. Movement only in `FIGHTING`. `vx = (right ? +3 : 0) + (left ? -3 : 0)`; both held cancel.
4. Walking is disabled while grounded and punching or blocking (`vx = 0`). In the air the punch does not stop horizontal motion.
5. Jump: rising edge of `jump` while grounded, not punching, not blocking → `vy = -8.8`, `grounded = false`, `jumpTicks = 0`, emit `JUMP`. Holding jump does not re-jump on landing.
6. Physics per tick: `x += vx`; if airborne `vy += 8/30`, `y += vy`, `jumpTicks++`; landing when `y >= 430` → `y = 430`, `vy = 0`, `grounded = true`, `jumpTicks = 0`. Apex is ~141 px (one fighter height, `HURTBOX_H`) at tick 33; airborne 66 ticks.
7. Clamp `x` to `[0, 960]` after physics.
8. Facing: after physics each tick, a fighter not currently punching faces the opponent (`x` comparison; ties keep current facing).
9. Hitstun: while `hitstun > 0` the fighter ignores all input, `vx = knockbackVx`, and `hitstun--`; when it reaches 0, `knockbackVx = 0`.
10. Blocking: `blocking = input.block && grounded && action === null`. Evaluated every tick, so releasing the key or leaving the ground ends it.
11. `resetForRound` restores both fighters to `createFighter` values but keeps each fighter's `prev` so held keys do not re-edge at round start.

## Invariants
- `sim/*` has no imports outside `packages/shared/src`.
- `step` output for the same `(prev, inputs)` is byte-identical on every call.
- `y <= 430` always; `grounded` implies `y === 430`.

## Tests
- spawn positions, facing, hp
- walks right 10 ticks = +30 px; left+right cancels
- no movement during COUNTDOWN
- jump apex ≈ 140 at tick 33, lands by tick 66, `jumpTicks` resets
- held jump does not re-jump
- facing flips when fighters cross
- clamps at 0 and 960
- block requires grounded and zeroes vx
- `step` does not mutate its input (JSON compare)

## Done when
- [ ] tests pass, `index.ts` re-exports `sim/types`, `sim/create`, `sim/step`
