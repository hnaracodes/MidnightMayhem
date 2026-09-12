> **SUPERSEDED 2026-09-12.** This document is historical. The build follows `DECISIONS_CHANGED.md` (root) and `docs/superpowers/plans/2026-09-12-midnight-express-mvp.md`. Where this file disagrees with them, they win. Kept for reference only.

# Agent Implementation Specification

## Required package manifests

Root `package.json` has scripts: `dev`, `build`, `test`, `lint`; workspaces are `packages/*`. Client dependencies: `react`, `react-dom`, `onnxruntime-web`, `@mediapipe/tasks-vision`; dev dependencies: `vite`, `typescript`. Server dependencies: `ws`, `zod`; dev dependencies: `tsx`, `vitest`, `typescript`. Shared dependency: `zod` only. Use exact versions pinned in the lockfile.

## Server loop

`index.ts` creates `http.createServer`, mounts static client output, then `new WebSocketServer({server,path:"/ws"})`. `rooms.ts` owns `Map<string, RoomState>`. `ws.ts` validates messages and appends `QueuedInput={playerId,receivedTick,seq,action,slot?}`; it never calls combat functions. `simulation.ts` owns one 33.333 ms accumulator. For each due tick, call `stepRoom`, broadcast events immediately, and broadcast a sanitized snapshot every second tick. `PublicRoomState` excludes reconnect token, input queue, scan token, and all internal counters.

## Deterministic step algorithm

1. Increment `room.tick`; decrement `remainingTicks` only in `PLAYING`.
2. Expire statuses/tokens/cooldowns whose end tick is `<= room.tick`.
3. Sort queued inputs by `receivedTick`, then player ID, then sequence; remove them from queue.
4. Validate each input against phase, player status, sequence, rate, lane, slot, and cooldown. Emit `ACK` or `ERROR`.
5. Create every valid same-tick attack/status; do not collide yet.
6. Advance attacks, resolve collisions, apply reductions/i-frames, then emit ordered hit events.
7. Remove expired/consumed attacks. If either HP is zero or timer is zero, set `RESULT` and emit one `MATCH_ENDED` event.
8. Increment `version` exactly once when any public field or event changes.

## Event IDs and ordering

Every event has `{id: "<roomId>:<tick>:<ordinal>", tick, type, payload}`. At one tick order: `ACTION_ACCEPTED`, `ABILITY_CAST`, `BLOCKED`/`HIT`, `SCAN_STARTED`/`ITEM_ADDED`, `TRAIN_CHANGED`, `MATCH_ENDED`. Clients deduplicate by `id` and apply a snapshot only if `snapshot.version > lastSnapshotVersion`.

## Keyboard mapping

`A` sends `DODGE_LEFT`; `D` sends `DODGE_RIGHT`; `S` sends `BLOCK_START`; `Space` sends `POWER_USE` slot 0; `1`,`2`,`3` send power slots 0–2; `E` sends `SCAN_START`. Ignore repeat keydown events. Buttons call the identical dispatcher. Disable buttons only from public cooldown/status state, but still let the server reject stale actions.

## Done definition

An agent may claim its task complete only after its changes pass `pnpm test`, `pnpm build`, and the two-browser protected milestone. Any optional feature must preserve keyboard-only operation and must have a one-click or feature-flag disable path.
