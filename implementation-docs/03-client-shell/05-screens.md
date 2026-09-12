# 3.05 — Lobby, result, banner screens

## Purpose
The DOM screens outside the arena. Functional in this phase; Phase 4.07 restyles them.

## Files
Create: `packages/client/src/app/lobby.ts`, `result.ts`, `banner.ts`.

## Depends on
1.05.

## Exposes
- `class Lobby { constructor(handlers: { onJoin(name, roomId?), onReady(ready), onEnableCamera() }); renderJoin(); renderRoom(roomId, players, visionAvailable); hide() }`
- `class ResultOverlay { constructor(onRematch); show(winner, localIndex); hide() }`
- `showBanner(text: string | null): void`

## Behaviour
1. Join screen: title, name input (remembered in `localStorage`), room code input (uppercased, blank = new room), Join button, key legend `A/D walk · W jump · S block · F/G punch`.
2. Room screen: big room code, two rows `THE DRIFTER` / `THE CONDUCTOR` with name and ready state or "waiting", Enable camera button (disabled state text "Camera on" when `visionAvailable`), Ready toggle.
3. Result: `YOU WIN` / `YOU LOSE` / `MUTUAL DERAILMENT` plus the winning character's name, Rematch button which calls `onRematch` and hides.
4. Banner: red strip at the top; `null` hides it. Used for connection loss and server errors.

## Invariants
- Screens never read `MatchState` directly; the app passes what they need.

## Tests
- Manual in 3.06.

## Done when
- [ ] all three render and hide correctly
