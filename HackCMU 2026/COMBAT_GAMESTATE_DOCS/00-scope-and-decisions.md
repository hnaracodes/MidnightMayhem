> **SUPERSEDED 2026-09-12.** This document is historical. The build follows `DECISIONS_CHANGED.md` (root) and `docs/superpowers/plans/2026-09-12-midnight-express-mvp.md`. Where this file disagrees with them, they win. Kept for reference only.

# Scope and Non-Negotiable Decisions

## Protected vertical slice

Before any optional feature or incoming partner phase is integrated, demonstrate this exact path on two browsers: `join room → choose pre-seeded kit → countdown → keyboard/button combat → server-confirmed damage → shared RESULT`. This is the release floor. CV, object scanning, train modifiers, and presentation are additions, not prerequisites.

**Integration owner:** project lead. They own shared types, protocol choices, merge order, and demo readiness. Contributors do not modify a cross-boundary interface without their approval.

## Exact delivery order and cut policy

1. Implement shared constants/types and pure server simulation with Vitest.
2. Implement raw-WebSocket room join, snapshots, and keyboard client.
3. Demonstrate the protected vertical slice on two browser profiles.
4. Add MediaPipe gesture adapter; retain keyboard controls permanently.
5. Add YOLO scan adapter and one scan token flow.
6. Add Tunnel/Final-Car display and audio only if steps 1–5 pass.

If time is short, ship at the latest completed step. Never replace seeded kits or keyboard controls with unbenchmarked CV.

## Immutable configuration

```ts
export const GAME = {
  TICK_HZ: 30, SNAPSHOT_HZ: 15, MATCH_TICKS: 1350,
  COUNTDOWN_TICKS: 90, MAX_PLAYERS: 2, MAX_INPUTS_PER_SECOND: 20,
  RECONNECT_TICKS: 450, ROOM_IDLE_TICKS: 9000,
  WORLD_WIDTH: 1000, WORLD_HEIGHT: 480, PLAYER_HP: 100,
  SCAN_DURATION_TICKS: 45, SCAN_COOLDOWN_TICKS: 180,
  YOLO_FPS: 6, YOLO_MIN_CONFIDENCE: 0.55, YOLO_STABLE_FRAMES: 3,
} as const;
```

Every timer is stored and compared in server ticks, never wall-clock milliseconds.

## MVP

- Two players in one room.
- One 45-second match.
- Three lanes.
- Five supported object classes: bottle, book, backpack, cup, cell phone.
- Three body inputs: block, dodge, power use.
- Three ability slots per player.
- One mid-battle Baggage Scan per six seconds.
- Two train-state moments: Tunnel and Final Car.
- Server-authoritative combat over native WebSocket.

## Full match state machine

```text
LOBBY
  → LOADOUT_SCAN
  → COUNTDOWN
  → PLAYING
  → RESULT
  → LOBBY (rematch) or room cleanup
```

- `LOBBY`: up to two players join; both must be connected.
- `LOADOUT_SCAN`: each player receives one initial object kit through scan or explicit fallback choice.
- `COUNTDOWN`: fixed three-second countdown; no combat inputs accepted.
- `PLAYING`: combat, pose controls, Baggage Scan, train events, and timer are active.
- `RESULT`: inputs are rejected; winner/draw displays; either player can request rematch.

Mid-battle Baggage Scan is **not** a room phase. It is a `PlayerState.status = SCANNING` while the room remains in `PLAYING`.

## Explicit non-goals

- No arbitrary-object capability generation.
- No free-moving physics, knockback, jumping, or ragdolls.
- No streamed webcam video between players.
- No player accounts, matchmaking, persistence, replay system, or ranking.
- No true 3D object orientation, body hitboxes, or pose-to-damage calculation.
- No WebRTC unless a stable game exists and video is a separately proven enhancement.

## Fixed technical choices

| Concern | Decision | Reason |
|---|---|---|
| Server | Node + `ws` | native WebSocket rooms and reliable ordered delivery |
| Client | React/TypeScript + a canvas/DOM renderer | rapid UI plus controlled render loop |
| Pose | MediaPipe Pose Landmarker, local only | body landmarks for a small gesture set |
| Object scan | YOLO nano **or** MediaPipe Object Detector, local only | choose after a benchmark on demo hardware |
| Simulation | 30 Hz server tick | deterministic enough for discrete combat |
| Snapshots | 15 Hz, full small state | simple recovery from packet jitter |
| Rendering | 60 FPS client side | smooth perceived motion |
| Deployment | one HTTPS origin serving client + native WebSocket | camera permissions and no cross-origin setup |

## Decision gate for object detector

Benchmark the five physical demo objects on both demo laptops. Select the detector only if it passes all three:

1. Recognizes at least 4/5 objects in normal venue lighting.
2. Returns a stable result in under 1 second.
3. Returning to pose mode does not visibly stutter the game.

If neither detector passes, retain the scan animation and require the player to confirm a visible object-class card. The fight must never block on computer vision.
