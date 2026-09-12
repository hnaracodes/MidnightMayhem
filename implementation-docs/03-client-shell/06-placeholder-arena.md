# 3.06 — Placeholder arena and app wiring

## Purpose
Prove the full loop: lobby → HELLO → READY → snapshots → a Phaser scene that draws two rectangles, health numbers and the timer from the buffer → result → rematch. Phase 4 replaces only the drawing.

## Files
Create: `packages/client/src/main.ts`, `src/game/config.ts`, `src/game/ArenaScene.ts` (placeholder).

## Depends on
3.02–3.05.

## Exposes
- `startGame(): void` — creates the Phaser game once (`Phaser.AUTO`, 960 × 540, `Scale.FIT`, `CENTER_BOTH`, parent `#game`)
- `class ArenaScene extends Phaser.Scene` with `create()` and `update(time, delta)`

## Behaviour
1. `main.ts` builds `WsClient`, `KeyboardInputSource` inside a `MergedInputSource`, stores it in `session.localSource`, and the `Lobby`/`ResultOverlay`.
2. Join → `connect()` then `HELLO`. Failure → banner "Cannot reach the server".
3. `WELCOME` sets `session.localIndex`; `LOBBY` renders the room screen while no match is running or after `MATCH_END`; `ERROR` and `OPPONENT_LEFT` show banners; socket `closed` shows "Connection lost. Reload to rejoin."
4. First `SNAPSHOT`: hide the lobby, `startGame()`, start the `InputSender`. Every snapshot: `buffer.push(state, performance.now())`, append events. `MATCH_END` event → result overlay; a snapshot in `COUNTDOWN` hides it.
5. Rematch → `READY{true}`.
6. Placeholder scene: each frame `sample(performance.now())`; draw fighter 0 as a 72 × 140 rectangle in `drifter-key`, fighter 1 in `conductor-key`, anchored bottom-centre at `(x, y)`; a thin line at `ROOF_Y`; text for each hp, round pips, `ceil(roundTicks/60)`, phase name. Flash the rectangle white for 4 frames on a `HIT` event.

## Invariants
- The scene reads only `session`; it never talks to the socket.
- The app never computes damage or winner; it renders what the snapshot says.

## Tests
- Manual gate: two browser profiles on one machine, server running, complete a best of 3 with keyboard, see the same winner on both, rematch works, kill one tab and see `OPPONENT_LEFT` on the other.

## Done when
- [ ] manual gate passed by the owner
