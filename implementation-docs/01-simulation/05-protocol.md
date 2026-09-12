# 1.05 — Wire protocol schemas

## Purpose
The only message shapes that cross the socket, validated with zod on the server, typed on both sides.

## Files
Create: `packages/shared/src/protocol.ts`, `packages/shared/test/protocol.test.ts`.

## Depends on
1.02 (types), 1.01.

## Exposes
- `PROTOCOL_VERSION = 1`, `MAX_MESSAGE_BYTES = 4096`, `ROOM_ID_RE = /^[A-Z0-9]{4,8}$/`
- `InputFrameSchema` (strict object of six booleans)
- `ClientMessage` = `HELLO{name: 1–16 chars trimmed, roomId?: ROOM_ID_RE}` | `INPUT{seq: positive int, frame}` | `READY{ready: boolean}` | `PING{t: number}`; all `.strict()`, discriminated on `type`
- `ServerMessage` = `WELCOME{roomId, playerIndex, protocolVersion}` | `LOBBY{roomId, players: [LobbyPlayer|null, LobbyPlayer|null]}` | `SNAPSHOT{state: MatchState, events: SimEvent[], ackSeq}` | `PONG{t, serverTime}` | `OPPONENT_LEFT` | `ERROR{code: ErrorCode, message}`
- `interface LobbyPlayer { name; ready; connected }`, `type ErrorCode = "BAD_MESSAGE" | "ROOM_FULL" | "NOT_IN_ROOM" | "ALREADY_JOINED"`
- `parseClientMessage(raw: unknown): { ok: true; message } | { ok: false; reason }`

## Behaviour
1. Reject non-string input, UTF-8 length over 4096, invalid JSON, non-object, arrays, unknown `type`, extra keys.
2. `HELLO.roomId` is uppercase only; the client uppercases before sending.
3. Server messages are not validated (trusted origin); they are plain JSON.

## Invariants
- No message carries camera frames, landmarks, damage, or positions from the client.

## Tests
- HELLO with and without room id; lowercase rejected; name > 16 rejected
- INPUT seq 0 rejected; extra key in frame rejected
- garbage, array, unknown type, oversized rejected

## Done when
- [ ] tests pass, `index.ts` re-exports `protocol`
