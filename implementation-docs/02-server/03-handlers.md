# 2.03 — Message handlers and validation

## Purpose
Turn validated client messages into room mutations; enforce join, ready, input and malformed-frame rules; start the loop when both are ready; clean up on close.

## Files
Create: `packages/server/src/handlers.ts`, `packages/server/test/handlers.test.ts`.

## Depends on
2.01, 2.02, 1.05.

## Exposes
- `interface Conn { room: Room | null; index: PlayerIndex | null; badFrames: number; send(m): void; close(code, reason): void }`
- `interface ServerContext { registry: RoomRegistry; loops: Map<string, RoomLoop>; now(): number }`
- `handleMessage(ctx, conn, raw: string): void`
- `handleClose(ctx, conn): void`
- `maybeStart(ctx, room): void`

## Behaviour
1. Parse with `parseClientMessage`. On failure: `badFrames++`, send `ERROR{BAD_MESSAGE}`, and on the third failure `close(1008)`.
2. `PING` → `PONG{t, serverTime: now()}` at any time.
3. `HELLO` when already in a room → `ERROR{ALREADY_JOINED}`. Otherwise `registry.getOrCreate(roomId)`, `room.join`; null → `ERROR{ROOM_FULL}`. Success → set `conn.room/index`, send `WELCOME`, broadcast `LOBBY`.
4. Any other message before HELLO → `ERROR{NOT_IN_ROOM}`.
5. `READY` → `room.setReady`, broadcast `LOBBY`, then `maybeStart`.
6. `INPUT` → `room.setInput(index, seq, frame)`; no reply either way (the snapshot's `ackSeq` is the ack).
7. `maybeStart`: if `allReady` and (`match` is null or `MATCH_END`): `startMatch`; create and start a `RoomLoop` for the room if none exists.
8. `handleClose`: if in a room, `room.leave(index)`, clear `conn`, broadcast `OPPONENT_LEFT` then `LOBBY`; if the room is now empty, stop and delete its loop and remove it from the registry.
9. Binary frames count as malformed.

## Invariants
- Handlers never call `step` or mutate `MatchState`.
- One loop per room id, stopped before removal.

## Tests
- HELLO creates room, WELCOME index 0, LOBBY broadcast
- second HELLO seats 1; third gets ROOM_FULL
- both READY starts match and loop (stop it in the test)
- INPUT before HELLO → NOT_IN_ROOM; after, frame stored
- three bad frames → close 1008
- PING → PONG
- close notifies opponent; empty room removed

## Done when
- [ ] tests pass using a fake `Conn` and injected clock
