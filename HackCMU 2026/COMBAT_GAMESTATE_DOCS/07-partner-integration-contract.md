> **SUPERSEDED 2026-09-12.** This document is historical. The build follows `DECISIONS_CHANGED.md` (root) and `docs/superpowers/plans/2026-09-12-midnight-express-mvp.md`. Where this file disagrees with them, they win. Kept for reference only.

# Partner Integration Contract — Combat Phase

## Purpose

This contract lets three partner-owned phases connect to the real-time combat core without reading or changing its internals. Treat this folder as a sealed subsystem: partners use the public boundary below; the combat team owns everything behind it.

## While partner specifications are pending

Do not guess the three modules’ data models or merge speculative code. The integration owner receives each partner document, requires an adapter mapping, and approves it against this contract before code begins. The protected two-browser keyboard vertical slice remains deployable throughout.

## Phase boundary

```text
partner phase(s)                         combat phase (this folder)                    partner phase(s)
setup / story / world / UI  ── launch ──> room + loadout + live 1v1 ── result/event ──> aftermath / score / next scene
                                      ↑                    ↓
                               public commands       public state + events
```

The combat phase owns the interval from `LOBBY` through `RESULT`. A partner may present the lobby or result screen visually, but server transition rules remain those in `00-scope-and-decisions.md`.

## Public interface

Partners interact through a single `CombatSessionAdapter`. It is a thin wrapper over the socket protocol in `02-network-state-protocol.md`; it must not expose a mutable `RoomState` object.

```ts
type CombatSessionAdapter = {
  createOrJoin(input: {
    roomId?: string;
    playerName: string;
    playerToken?: string;
  }): Promise<{ roomId: string; playerId: string }>;

  confirmLoadout(objectClass: ObjectClass): void;
  setReady(ready: boolean): void;
  sendAction(input: PlayerInput): void;
  beginScan(): void;

  onSnapshot(listener: (state: PublicRoomState) => void): Unsubscribe;
  onEvent(listener: (event: PublicGameEvent) => void): Unsubscribe;
  onResult(listener: (result: MatchResult) => void): Unsubscribe;
  leave(): void;
};
```

The concrete socket event names and validation rules stay exactly as defined in `02-network-state-protocol.md`. The adapter is the only partner-facing import.

## What partners can send

| Need | Allowed call | Combat-core behavior |
|---|---|---|
| Put a player in the live game | `createOrJoin` | validates room capacity and returns room/player identifiers |
| Submit a chosen starting item | `confirmLoadout` | accepts only allowlisted object classes during `LOADOUT_SCAN` |
| Begin a match | `setReady(true)` | starts countdown only when both players satisfy core rules |
| Trigger a live action | `sendAction` | queues a validated discrete intent; it does not accept damage values |
| Open Baggage Scan | `beginScan` | requests a server-issued scan token; vision handles classification afterward |
| Exit safely | `leave` | runs disconnect/room cleanup behavior |

No partner sends camera frames, landmarks, bounding boxes, health values, positions, cooldowns, ability parameters, or a declared winner.

## What partners receive

| Output | Safe uses | Must not do |
|---|---|---|
| `PublicRoomState` snapshot | render HUD, timer, train car, visible abilities, player health, connection state | mutate it or derive authoritative damage |
| `PublicGameEvent` | play animations/audio, show hit/block/scan/train feedback, update an external presentation | create a second combat simulation |
| `MatchResult` | show winner, award purely cosmetic progress, navigate to a post-match phase | override the winner or reopen a finished match by local state alone |
| `error`/connection status | show recoverable UI and fallbacks | silently retry a rejected action in a loop |

`MatchResult` is emitted only from the server after `RESULT` begins. It is the source of truth for any partner phase that needs the match winner.

## Hard ownership lines

| This combat phase owns | Partner modules own |
|---|---|
| room lifecycle and authoritative tick | how a player discovers, enters, or leaves the broader game experience |
| health, damage, hitboxes, status effects, cooldowns, and winner | story, progression, scene design, copy, visual skin, and non-combat UX |
| supported object classes and their fixed ability kits | presentation assets for the classes, provided their identifiers do not change |
| CV gesture thresholds, scan mode, and fallback controls | any separate feature that does not need raw combat state mutation |
| Socket event schemas and compatibility | adapters that consume those schemas |

If a partner feature needs a new visible field or event, the protocol owner adds a **read-only** public field/event. No partner reaches into `server/` or `shared/` to add game logic directly.

## Integration sequence for four specifications

1. Each partner writes a one-page mapping from its own phase to this contract: which allowed calls it makes and which outputs it renders.
2. The combat owner supplies a mock `CombatSessionAdapter` that can emit deterministic snapshots/events for partner UI work before the live server is ready.
3. Each partner integrates only against the adapter, never a direct WebSocket instance.
4. The integration owner swaps the mock for the live adapter and runs the Gate 2 acceptance test in `05-build-order-and-integration.md`.
5. Any request that requires a new command, state field, or event is proposed in one message, approved by the protocol owner, then added atomically to `shared/game-types.ts`, `02-network-state-protocol.md`, and tests.

## Required incoming-spec mapping

Each partner sends the integration owner a short mapping with: (1) which `CombatSessionAdapter` calls it will make, (2) which snapshots/events/results it will consume, (3) any new **read-only** field or event it proposes, and (4) how it behaves when CV is unavailable. This makes the three modules composable without granting them combat authority.

## Concrete handoff package

Each partner PR must contain `docs/integration/<partner-name>.md` with four tables: **commands sent**, **state/events read**, **new fields requested**, and **failure UI**. It must include a mocked `CombatSessionAdapter` test that sends a `SNAPSHOT` with `version=1`, then `version=2`, then a `MATCH_ENDED` event. The partner UI must render the version-2 state and result without importing `RoomState`, `PlayerState`, `ws`, or any file under `packages/server`.

## Compatibility checklist

Before merging another phase, confirm:

- [ ] It imports only `CombatSessionAdapter` and shared public types.
- [ ] It does not write to `RoomState`, `PlayerState`, `AttackInstance`, or server combat files.
- [ ] It never transmits raw CV data or a client-calculated combat result.
- [ ] It renders server snapshots/events by `version` and tolerates reconnection.
- [ ] It has a no-camera/keyboard fallback path when it launches combat.
- [ ] Its changes pass a two-browser match through `RESULT` without breaking the live core.
