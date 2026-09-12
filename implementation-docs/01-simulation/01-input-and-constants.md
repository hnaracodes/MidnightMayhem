# 1.01 — Input contract and constants

## Purpose
The frozen six-boolean input contract shared by keyboard, webcam and network, and the single file holding every gameplay number.

## Files
Create: `packages/shared/src/input.ts`, `packages/shared/src/constants.ts`, `packages/shared/test/input.test.ts`.

## Depends on
Phase 0.

## Exposes
`input.ts`
- `interface InputFrame { left, right, jump, punchL, punchR, block: boolean }`
- `const EMPTY_FRAME: Readonly<InputFrame>` (frozen, all false)
- `const INPUT_KEYS: readonly ["left","right","jump","punchL","punchR","block"]`, `type InputKey`
- `interface InputSource { start(): Promise<void>; stop(): void; sample(): Readonly<InputFrame> }`
- `risingEdges(prev, next): InputFrame` — true only where prev false and next true
- `framesEqual(a, b): boolean`

`constants.ts` (all `as const`)
- `TICK = { HZ: 60, MS: 1000/60, SNAPSHOT_EVERY: 2, MAX_CATCHUP: 5 }`
- `WORLD = { WIDTH: 960, HEIGHT: 540, ROOF_Y: 430, SOFT_EDGE_L: 72, SOFT_EDGE_R: 888, PLAYER_START_X: [280, 680], HURTBOX_W: 72, HURTBOX_H: 140 }`
- `BALANCE = { MAX_HP: 40, PUNCH_DAMAGE: 12, CHIP_DAMAGE: 3, PUNCH_STARTUP: 4, PUNCH_ACTIVE: 3, PUNCH_RECOVERY: 8, PUNCH_GAP: 10, PUNCH_REACH: 70, PUNCH_HITBOX_TOP: 120, PUNCH_HITBOX_H: 60, HITSTUN_TICKS: 12, KNOCKBACK_PX: 144, WALK_SPEED: 3, JUMP_VELOCITY: -8, GRAVITY: 8/30, JUMP_IFRAME_START: 3, JUMP_IFRAME_END: 10, OOB_DAMAGE: 3, OOB_EVERY_TICKS: 30 }`
- `MATCH = { ROUND_SECONDS: 30, ROUND_TICKS: 1800, COUNTDOWN_TICKS: 180, ROUND_END_TICKS: 120, ROUNDS_TO_WIN: 2, MAX_ROUNDS: 3 }`
- `CHARACTERS = ["drifter", "conductor"]`, `type CharacterId`

## Behaviour
1. All six fields are held (level) signals. Edge detection is the sim's job, never the source's.
2. `left`/`right` are screen directions; the sim converts to forward/back using facing.
3. `sample()` never blocks and never allocates on the hot path beyond returning a frozen object.
4. Every tunable number lives in `constants.ts`. No other file in the repo declares a gameplay number.

## Invariants
- `input.ts` is never edited after Phase 0 without owner approval.
- `constants.ts` has no imports.

## Tests
- `EMPTY_FRAME` is frozen and all false.
- `risingEdges` reports only false→true transitions across all six keys.
- `framesEqual` true for equal frames, false when any key differs.

## Done when
- [ ] tests pass, `index.ts` re-exports both files
