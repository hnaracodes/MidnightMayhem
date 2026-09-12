# 3.04 — Snapshot buffer and session

## Purpose
Keep recent snapshots and produce a render state 50 ms behind wall time with interpolated positions, plus the single shared `session` object the DOM app and Phaser scene both read.

## Files
Create: `packages/client/src/net/snapshotBuffer.ts`, `packages/client/src/game/session.ts`, `test/snapshotBuffer.test.ts`.

## Depends on
1.02.

## Exposes
- `class SnapshotBuffer { constructor(delayMs = 50); push(state, at): void; latest(): MatchState | null; sample(now): MatchState | null }`
- `session = { buffer: SnapshotBuffer; events: SimEvent[]; localIndex: PlayerIndex; localSource: InputSource | null; debug: boolean; visionAvailable: boolean }`

## Behaviour
1. `push` ignores a state whose tick is not greater than the newest; keeps the last 6.
2. `sample(now)`: render time `rt = now - delay`. Find the pair `(a, b)` bracketing `rt`; if `rt` is past the newest, return the newest unchanged. Otherwise clone `b` and linearly interpolate `x` and `y` of both fighters between `a` and `b`. Every other field comes from `b`.
3. Events are pushed to `session.events` by the app on every `SNAPSHOT`; the scene drains them with `splice(0)` once per frame.
4. `session.debug` is `?debug=1`.

## Invariants
- `sample` never returns a state older than the previous call's (monotonic).
- Discrete fields are never interpolated.

## Tests
- interpolation midpoint gives midpoint x
- single snapshot returns it
- older tick ignored

## Done when
- [ ] tests pass
