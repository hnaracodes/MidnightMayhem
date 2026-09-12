# Phase 2 — Server (`packages/server`)

One Node process. Owns rooms, runs the shared sim at 60 Hz per room, validates every inbound frame, broadcasts snapshots at 30 Hz, and serves the built client over HTTPS on the same origin as `/ws`.

| # | Feature | File |
|---|---|---|
| 01 | Rooms and registry | `01-rooms.md` |
| 02 | Room loop and snapshots | `02-loop-and-snapshots.md` |
| 03 | Message handlers and validation | `03-handlers.md` |
| 04 | HTTPS bootstrap, certs, static hosting | `04-bootstrap.md` |

Module layout:
```
packages/server/src/
  index.ts       04 — process entry, wires ws to handlers
  rooms.ts       01
  loop.ts        02
  handlers.ts    03
  certs.ts       04
packages/server/scripts/make-cert.sh   04
packages/server/test/{rooms,loop,handlers}.test.ts
```

Data flow: socket text frame → `handleMessage` → `Room.setInput` (latest frame wins) → `RoomLoop.tickOnce` reads `room.inputs()` → `step` → every 2nd tick `SNAPSHOT` to both slots.
Handlers never call `step`; the loop never parses messages.
