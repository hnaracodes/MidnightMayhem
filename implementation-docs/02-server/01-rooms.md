# 2.01 — Rooms and registry

## Purpose
Hold up to two players per room with their latest input frame, ready flag and send function; create and look up rooms by a 5-character code.

## Files
Create: `packages/server/src/rooms.ts`, `packages/server/test/rooms.test.ts`.

## Depends on
1.01, 1.02, 1.05.

## Exposes
- `type Send = (m: ServerMessage) => void`
- `interface PlayerSlot { name; ready; connected; seq: number; latest: InputFrame; send: Send }`
- `class Room { readonly id; slots: [PlayerSlot|null, PlayerSlot|null]; match: MatchState | null; join(name, send): PlayerIndex | null; leave(i): void; setReady(i, ready): void; setInput(i, seq, frame): boolean; inputs(): [InputFrame, InputFrame]; lobbyMessage(): ServerMessage; broadcast(m): void; startMatch(): void; get full; get empty; get allReady }`
- `class RoomRegistry { static generateId(): string; get(id): Room | undefined; getOrCreate(id?): Room; remove(id): void }`

## Behaviour
1. `join` seats slot 0 if free, else slot 1, else returns null. New slot: not ready, `seq 0`, `latest = EMPTY_FRAME`.
2. `setInput` accepts only `seq > slot.seq`; stores a copy of the frame; returns false otherwise.
3. `inputs()` returns `EMPTY_FRAME` for an empty slot.
4. `leave(i)` empties the slot, sets `match = null`, un-readies the other player and resets their `latest` to empty.
5. `startMatch` sets `match = createMatch()` and clears both ready flags (so rematch needs both to ready again).
6. `generateId` uses the alphabet `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (no 0/O/1/I), length 5.
7. `getOrCreate(undefined)` makes a new room with a fresh id; `getOrCreate(id)` returns the existing room or creates one with that id.

## Invariants
- A room never has more than two slots.
- `match` is non-null only after `startMatch` and until a `leave`.

## Tests
- seats two, refuses third, `full`
- ready gating and clearing on start
- monotonic seq, stale rejected, `inputs()` reflects latest
- leave clears match and opponent ready
- id format; getOrCreate reuse

## Done when
- [ ] tests pass
