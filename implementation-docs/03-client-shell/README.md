# Phase 3 — Client shell (`packages/client`)

Everything the client needs except the real art: socket, input sources, snapshot interpolation, DOM screens, and a placeholder arena that proves the loop end to end. Phase 4 replaces the placeholder arena's drawing; nothing else changes.

| # | Feature | File |
|---|---|---|
| 01 | Vite, HTTPS dev, package | `01-build-and-dev.md` |
| 02 | Socket client | `02-ws-client.md` |
| 03 | Input sources and sender | `03-input-sources.md` |
| 04 | Snapshot buffer and session | `04-snapshot-buffer.md` |
| 05 | Lobby, result, banner screens | `05-screens.md` |
| 06 | Placeholder arena and app wiring | `06-placeholder-arena.md` |

Module layout:
```
packages/client/
  index.html  harness.html (empty until Phase 5)  rig.html (Phase 4)
  vite.config.ts
  src/main.ts                    06
  src/app/{lobby,result,banner}.ts   05
  src/net/{wsClient,inputSender,snapshotBuffer}.ts   02, 03, 04
  src/input/{KeyboardInputSource,MergedInputSource,selectSource}.ts   03
  src/game/{session,config,ArenaScene}.ts   04, 06
```
