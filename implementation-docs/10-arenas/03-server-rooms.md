# 10.03 — Server: four slots, host config, customisation

## Purpose
Rooms hold up to four players, the host picks the match configuration, every player picks a character and loadout,
and the match starts when the configured number of players is in and ready.

## Files
Modify: `packages/server/src/rooms.ts`, `src/handlers.ts`, `src/loop.ts` (only if needed), `packages/server/test/rooms.test.ts`,
`test/handlers.test.ts`.
Owns the whole `packages/server`.

## Depends on
8.01 (protocol v2, `MatchConfig`, `RosterEntry`, `createMatch(config, roster)`).

## Exposes
`rooms.ts`:
- `PlayerSlot` gains `character: CharacterId`, `loadout: Loadout`.
- `Room.config: MatchConfig` (default `DEFAULT_CONFIG`), `Room.host: PlayerIndex | null` (lowest occupied slot).
- `Room.join(name, send): PlayerIndex | null` — lowest free slot `< config.players`; the first joiner gets
  `character = CHARACTERS[index]` (so P0 is Drifter, P1 Conductor by default) and `DEFAULT_LOADOUT`.
- `Room.setConfig(i, config): "ok" | "not-host" | "in-match" | "too-many-players"` — host only, not during a running
  match (`match === null || match.phase === "MATCH_END"`), and `config.players ≥ occupied count`; stores
  `normalizeConfig(config)`; un-readies everyone (a config change must be re-confirmed).
- `Room.setCustomize(i, character, loadout): boolean` — any time in the lobby (not mid-match); un-readies that player.
- `Room.roster(): RosterEntry[]` — for slots `0..config.players − 1`.
- `Room.inputs(): InputFrame[]` — length `config.players`.
- `Room.allReady` — every slot `< config.players` occupied, connected and ready.
- `Room.startMatch()` → `createMatch(this.config, this.roster())`.
- `Room.lobbyMessage()` → `{ type: "LOBBY", roomId, players: 4 slots, config, host }`.
- `Room.leave(i)`: as today (ends the match, un-readies the others) and recomputes `host`.

`handlers.ts`:
- `CONFIG` → `setConfig`; `not-host` → `ERROR NOT_HOST`; `in-match` / `too-many-players` → `ERROR BAD_CONFIG` with a
  plain message; `ok` → broadcast lobby.
- `CUSTOMIZE` → `setCustomize`; broadcast lobby.
- `READY` unchanged; `maybeStart` unchanged (uses `allReady`).
- `HELLO` into a room whose `config.players` slots are all taken → `ROOM_FULL` even if slot 3 is free.

## Behaviour
1. Two joins into a fresh room → slots 0 and 1, host 0, `LOBBY.players.length === 4` with slots 2, 3 null.
2. Host sets `{ players: 4, teams: "2v2" }` → all four may join; with three joined and ready the match does not start;
   the fourth joins and readies → `createMatch` called with `config.players 4` and a four-entry roster.
3. Non-host `CONFIG` → `ERROR NOT_HOST`, config unchanged.
4. `CONFIG` with `players: 2` while three are in the room → `BAD_CONFIG`, unchanged.
5. `CONFIG` during FIGHTING → `BAD_CONFIG`; after `MATCH_END` → ok.
6. `CUSTOMIZE` stores character and loadout, un-readies the sender, and the next `LOBBY` shows them; `startMatch`
   passes them to `createMatch` (assert `match.fighters[i].character` and `loadout`).
7. Host leaves → the lowest remaining slot becomes host and the next `LOBBY` says so.
8. A match in progress with three players: one disconnect ends it (`OPPONENT_LEFT` to the other two) and returns to
   the lobby with the two remaining un-readied.
9. `inputs()` returns exactly `config.players` frames; an `INPUT` from slot 3 in a 2-player config is ignored.
10. Loop: `SNAPSHOT` goes to every occupied slot; `ackSeq` is that slot's own seq.

## Invariants
- `host` is always the lowest occupied slot or null.
- `config.players ≥` number of occupied slots at all times.
- No message from a client can create a match with a roster shorter than `config.players`.

## Tests
`rooms.test.ts`, `handlers.test.ts`: rules 1–10 with the existing fake `Conn` pattern.

## Done when
- [ ] tests pass, `pnpm test` and `pnpm typecheck` green
- [ ] live smoke: `pnpm dev:server`, four `wscat`/node sockets HELLO into one room with `players: 4`, all READY,
  snapshots arrive with four fighters (script it in `packages/server/test/smoke.mjs`, not a vitest)
- [ ] committed on `feat/server` with prefix `server:`
