# 2.02 — Room loop and snapshots

## Purpose
Advance one room's match at exactly 60 Hz from wall time with capped catch-up, and send a `SNAPSHOT` with bundled events every second tick.

## Files
Create: `packages/server/src/loop.ts`, `packages/server/test/loop.test.ts`.

## Depends on
2.01, 1.02–1.04.

## Exposes
- `class RoomLoop { constructor(room: Room, now: () => number = performance.now); start(): void; stop(): void; pump(): void; tickOnce(): void }`

## Behaviour
1. `start` records `last = now()` and sets a 4 ms `setInterval` calling `pump`. `stop` clears it.
2. `pump`: `acc += now - last`; while `acc >= 16.667` and fewer than 5 ticks this call: `tickOnce`, `acc -= 16.667`. If `acc` is still `>= 16.667` after the cap, set `acc = 0` (drop the backlog, never simulate a pause).
3. `tickOnce`: if `room.match` is null, return. Otherwise `step(room.match, room.inputs())`, store the new state, append events to a pending list. If `state.tick % 2 === 0`: send `SNAPSHOT{state, events: pending, ackSeq: slot.seq}` to each occupied slot (each slot gets its own `ackSeq`), then clear pending.
4. Events between snapshots are never dropped; they ride the next snapshot.
5. The loop keeps ticking in `MATCH_END` (cheap; keeps clients updated) until the room empties or `startMatch` replaces the state.

## Invariants
- At most 5 ticks per `pump`.
- Every `SimEvent` is delivered exactly once per client.
- The loop never touches the socket directly; it calls `slot.send`.

## Tests
- tickOnce advances tick; snapshot only on even ticks; per-slot ackSeq
- ROUND_START appears in the snapshot bundle at tick 180
- pump with 50 ticks of elapsed time runs 5 and drops the rest; next pump runs 1
- no match: no throw, no send

## Done when
- [ ] tests pass with an injected clock
