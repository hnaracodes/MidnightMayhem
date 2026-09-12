> **SUPERSEDED 2026-09-12.** This document is historical. The build follows `DECISIONS_CHANGED.md` (root) and `docs/superpowers/plans/2026-09-12-midnight-express-mvp.md`. Where this file disagrees with them, they win. Kept for reference only.

# Last Car Clash — Phase 2: Real-Time Combat Core

> **This folder is one phase of the game, not its complete product specification.** It owns the live 1v1 match once two players are placed in a room: authoritative game state, combat rules and hit resolution, local CV-to-action interpretation, and sending/receiving game messages. It intentionally does **not** prescribe the surrounding experience (for example, onboarding, narrative, visual world-building, or any partner-owned feature phase).

Read [Partner integration contract](07-partner-integration-contract.md) before modifying this phase or combining it with the three partner specifications.

## Current operating mode: integration-first

Until the three partner specifications arrive, the **integration owner** protects one runnable vertical slice: two browsers join the same room, choose pre-seeded kits, use keyboard/buttons, receive server-confirmed damage, and reach the same result screen. CV, Baggage Scan, train modifiers, visual polish, and every partner module attach only after that slice works.

The integration owner is the sole editor for `shared/game-types.ts`, `shared/abilities.ts`, protocol decisions, and final branch merges. Every 60–90 minutes, they run the two-browser checkpoint in `05-build-order-and-integration.md`.

## What this phase owns

**Last Car Clash** is a real-time 1v1 game aboard the Midnight Express: players scan everyday objects into ability kits, then use body gestures to block, dodge, and activate powers while the train changes the rules.

This phase starts when a caller has enough information to create/join a two-player room. It ends when it emits an authoritative match result and rematch-ready room state. Partner modules may launch, decorate, explain, or follow up on the match, but they do not calculate combat.

## Read these in order

1. [Scope and decisions](00-scope-and-decisions.md) — the non-negotiable MVP.
2. [Gameplay rules](01-gameplay-rules.md) — combat, abilities, hitboxes, and train events.
3. [Network and state contract](02-network-state-protocol.md) — the source of truth for client/server integration.
4. [CV input and scanning](03-cv-input-and-scanning.md) — pose and object-detection boundaries.
5. [Edge cases and bottlenecks](04-edge-cases-bottlenecks.md) — risks, mitigations, and scope cuts.
6. [Build and integration order](05-build-order-and-integration.md) — owner handoffs and acceptance gates.
7. [Test and demo checklist](06-test-and-demo-checklist.md) — how to decide whether the build is demo-safe.
8. [Partner integration contract](07-partner-integration-contract.md) — the only allowed boundary between this phase and the three partner modules.
9. [Agent implementation specification](08-agent-implementation-spec.md) — exact packages, exports, message envelopes, loops, and commands.

## Locked runtime

Use Node 20.11+, pnpm 9, TypeScript 5.5+, React 18, Vite 5, `ws` 8, and `zod` 3. The client is Canvas 2D; do not add a game engine. The server serves the built client and upgrades `/ws` to a **native WebSocket** connection. Use JSON UTF-8 text frames only; no Socket.IO package, polling fallback, database, camera streaming, or external API is allowed.

Use MediaPipe Pose Landmarker for gestures and YOLOv8n exported to ONNX for object scanning. Both execute only in the browser. The initial demonstrable build uses seeded kits and keyboard input; pose, YOLO, train modifiers, and animation polish are layered in that order.

## Architecture in one picture

```text
camera → local CV → discrete player intent → native WebSocket → authoritative game server
   ↑                                      ↓                         ↓
local camera/UI                     predicted local effects     snapshots + combat events
```

Camera frames and raw landmarks never leave a browser. The server never trusts the client for damage, health, lane, cooldowns, or object powers.

## Required repository shape

```text
client/
  src/
    app/                 # combat-phase routes, room entry, lobby, countdown, result
    game/                # renderer, HUD, local prediction, event application
    network/             # one socket client and protocol adapters
    vision/              # pose adapter, scanner adapter, calibration
    assets/              # ability art, train backgrounds, sound
server/
  src/
    index.ts             # HTTPS/HTTP host and native WebSocket bootstrap
    rooms.ts             # room lifecycle, join/reconnect/cleanup
    simulation.ts        # fixed tick loop and stepRoom
    combat.ts             # collision, status, damage, attacks
    handlers.ts           # validates socket events and queues inputs
shared/
  game-types.ts          # the only source for event and state types
  abilities.ts           # immutable object kits and constants
tests/
  combat.test.ts
  rooms.test.ts
  protocol.test.ts
```

`shared/game-types.ts` and `shared/abilities.ts` are integration choke points. One named owner edits them; all other owners consume them.

## Team ownership inside this phase

| Owner | Boundary | Must not edit without coordination |
|---|---|---|
| Game/server | `server/`, `shared/game-types.ts`, combat definitions | client CV internals |
| Client/game UI | `client/src/game/`, rendering, HUD, effects | server rule calculations |
| Vision | `client/src/vision/`, camera, pose, detector adapters | network protocol names |
| Product/design | assets, copy, ability cards, sound, demo setup | shared type semantics |

One person owns the shared protocol. Changes to it require an explicit message to every owner.

The project lead acts as the integration owner; individual contributors remain inside their assigned boundary.

## Non-negotiable integration rule

Other game phases communicate with this folder through the adapter described in `07-partner-integration-contract.md`. They may request a room, subscribe to public match state/events, and receive a final result. They must not directly mutate `RoomState`, call combat functions, or reinterpret CV frames/landmarks. The combat server remains the only authority for health, damage, cooldowns, lanes, train modifiers, and match outcome.
