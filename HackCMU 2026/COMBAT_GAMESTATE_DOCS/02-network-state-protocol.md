> **SUPERSEDED 2026-09-12.** This document is historical. The build follows `DECISIONS_CHANGED.md` (root) and `docs/superpowers/plans/2026-09-12-midnight-express-mvp.md`. Where this file disagrees with them, they win. Kept for reference only.

# Network, State, and Combat Protocol

## Ownership and rollout rule

The integration owner owns this protocol and `shared/game-types.ts`. Build and verify the button/keyboard path first; CV and partner modules must call the same validated action boundary afterward. No partner module opens an alternate socket contract or writes directly to room state.

## Transport and envelope — exact

The only endpoint is `wss://<host>/ws`. The browser sends one UTF-8 JSON object per `WebSocket.send`; the server rejects frames over 4096 bytes, non-JSON payloads, arrays, and objects without a valid `type`. Validate every parsed object with Zod before use. Close with code `1008` after three malformed frames from one socket.

```ts
type ClientMessage =
 | { type:"JOIN"; requestId:string; roomId:string; name:string; reconnectToken?:string }
 | { type:"LOADOUT"; requestId:string; objectClass:ObjectClass }
 | { type:"READY"; requestId:string; ready:boolean }
 | { type:"INPUT"; seq:number; action:Action; abilitySlot?:0|1|2 }
 | { type:"SCAN_RESULT"; seq:number; token:string; objectClass:ObjectClass; confidence:number }
 | { type:"PING"; clientTime:number };
type ServerMessage =
 | { type:"JOINED"; requestId:string; roomId:string; playerId:string; reconnectToken:string }
 | { type:"SNAPSHOT"; state:PublicRoomState }
 | { type:"EVENT"; event:PublicGameEvent }
 | { type:"ACK"; seq:number }
 | { type:"ERROR"; requestId?:string; code:ErrorCode; message:string }
 | { type:"PONG"; clientTime:number; serverTime:number };
```

`requestId` is `crypto.randomUUID()`. `seq` begins at 1 for each browser session and increments once per `INPUT` or `SCAN_RESULT`; the client never retries an action with a new sequence number.

## WebSocket lifecycle

On `open`, send `JOIN` within 3 seconds. Start a 5-second ping interval after `JOINED`. The server replies `PONG` immediately. If no server message arrives for 12 seconds, client displays reconnecting and creates one new socket using exponential delays `250, 500, 1000, 2000, 4000` ms (maximum five attempts), then sends `JOIN` with saved room/player token. The server retains that player for 450 ticks. A duplicate reconnect token replaces the old socket; it never creates a third player.

## Room state

Keep active rooms in `Map<roomId, RoomState>`. A single demo server does not need a database.

```ts
type RoomState = {
  id: string;
  phase: "LOBBY" | "LOADOUT_SCAN" | "COUNTDOWN" | "PLAYING" | "RESULT";
  tick: number;
  version: number;
  remainingTicks: number;
  trainCar: "STANDARD" | "TUNNEL" | "FINAL_CAR";
  players: Record<string, PlayerState>;
  attacks: AttackInstance[];
  inputQueue: QueuedInput[];
  eventLog: GameEvent[];
};
```

The server increments `version` for every authoritative state change. Clients ignore snapshots at or below their latest version.

## Tick loop

Run a fixed 30 Hz simulation. Never mutate combat state directly inside a socket callback.

```text
1. Remove expired statuses.
2. Process queued inputs in server arrival order.
3. Finish creating all valid same-tick statuses and attacks.
4. Advance attacks and timers.
5. Resolve collisions after all same-tick attacks exist.
6. Apply damage and status effects.
7. Remove expired attacks.
8. Trigger train events.
9. Increment room version.
10. Emit immediate combat events and 15 Hz snapshots.
```

Use an accumulator based on elapsed time; cap catch-up processing to prevent a paused server from simulating a huge backlog.

## Client-to-server events

| Event | Payload | Validation |
|---|---|---|
| `room:join` | room id, player name | room capacity ≤ 2 |
| `loadout:confirm` | initial object class | only during `LOADOUT_SCAN`; class allowlist |
| `match:ready` | ready boolean | player belongs to room |
| `input` | sequence number, action, optional slot | monotonic sequence, phase, cooldown, status |
| `scan:result` | sequence, scan token, class, confidence | active token, expiry, allowlist, threshold |
| `client:ping` | client timestamp | used only for debug UI |

## Server-to-client events

| Event | Purpose |
|---|---|
| `snapshot` | full compact public room state, 15 Hz |
| `event` | immediate ability, hit, block, dodge, item, train, and match-end events |
| `ack` | last accepted input sequence for the sender |
| `error` | rejected action reason for debug only |

## Input schema

```ts
type PlayerInput = {
  seq: number;
  action: "BLOCK_START" | "DODGE_LEFT" | "DODGE_RIGHT" | "POWER_USE" | "SCAN_START";
  abilitySlot?: 0 | 1 | 2;
};
```

Reject an input when any of these is true:

- sender is not the room player;
- match is not `PLAYING`;
- sequence number is not greater than `lastInputSeq`;
- player status forbids the action;
- ability slot is empty or cooldown is active;
- scan cooldown is active;
- input rate exceeds 20 events/sec.

The server records the rejected/accepted outcome but does not echo raw CV data.

## Client prediction

Clients may predict their own animation, cooldown indicator, and sound only. They do not predict opponent HP.

```text
local gesture → local animation → send input
server accepts → retain animation, receive ack
server rejects → cancel/fade prediction, restore local UI
server hit event → apply target damage and reaction
```

This preserves responsiveness without trusting client combat calculations.

## Reconnect behavior

- Preserve a disconnected player state for 15 seconds.
- Rejoin requires the same short-lived player token.
- Send one full snapshot immediately after rejoin.
- If no rejoin occurs within 15 seconds, declare the connected player winner.

For a live demo, show a clear reconnect overlay; do not silently continue a broken match.

## Room lifecycle

- Create a room only when the first player requests it.
- Start `LOADOUT_SCAN` only after exactly two players are connected.
- Start countdown only after two confirmed loadouts and two ready signals.
- Remove a room five minutes after result, or five minutes after the final player disconnects.
- Do not allow a third spectator socket to mutate the room. Spectator support is out of scope.
