# Midnight Express MVP — Architecture and Phase Plan

**Goal:** Two laptops on one network play a best-of-3, webcam-controlled, side-view 2D fighter (Drifter vs Conductor) with a laptop-hosted authoritative server, keyboard fallback, and everything drawn in code.

**Decisions:** `HackCMU 2026/docs/2026-09-12-doc-audit-and-stack.md` Parts 6 to 10. **Art and UX spec:** `HackCMU 2026/design/`. **Vision rules:** `HackCMU 2026/controls/phases/CLAUDE.md`, ported to TypeScript, pose only.

**Budget:** 15 hours. Each phase has a test gate the owner runs before the next phase starts. Phases marked ∥ can run in parallel in separate worktrees.

## Stack

Node 22, pnpm 10, TypeScript strict, pnpm workspace `packages/{shared,server,client}`, Vitest, `ws` + `zod`, Vite + `@vitejs/plugin-basic-ssl`, Phaser 3 (Graphics only, no assets), `@mediapipe/tasks-vision` Pose Landmarker in a Web Worker. No React, no database, no rollback, no image files.

## Architecture

```
keyboard ─┐                                   ┌─ shared/sim  step(state, [inA, inB])  60 Hz
webcam ───┼─ InputSource.sample() ─ InputFrame ─┤     pure, deterministic, no DOM
(merged)  ┘        60 Hz, send on change        └─ server: latest frame per player, snapshots 30 Hz
                                                              │
                          client: SnapshotBuffer (50 ms behind) ─ rig pose = f(FighterState) ─ Phaser draw
```

- **`shared`** owns the frozen `InputFrame` contract, all constants and balance, the pure simulation, and the zod wire schemas. Server and client both import it.
- **`server`** owns rooms, the 60 Hz loop per room, validation, and HTTPS static hosting of the built client with `/ws` on the same origin.
- **`client`** owns the DOM screens (lobby, calibration, result), the socket client and input sender, the Phaser arena, the procedural rig, and the vision worker.
- **Rule:** the client never computes damage, and the sim never imports anything from client or server.

## Data contracts (the only cross-package surfaces)

| Contract | Shape | Owner |
|---|---|---|
| `InputFrame` | `{ left, right, jump, punchL, punchR, block }` booleans, held, sim does edges | frozen |
| `MatchState` | tick, phase, round, roundsWon, roundTicks, trainCar, fighters[2], winner | shared/sim |
| `FighterState` | character, x, y, vx, vy, facing, grounded, hp, action (punch elapsed), hitstun, blocking, weaponSlots (reserved) | shared/sim |
| `SimEvent` | ROUND_START, ROUND_END, MATCH_END, JUMP, PUNCH, HIT (blocked?), OOB_DAMAGE | shared/sim |
| Client → server | HELLO(name, roomId?), INPUT(seq, frame), READY(bool), PING | shared/protocol |
| Server → client | WELCOME, LOBBY, SNAPSHOT(state, events, ackSeq), PONG, OPPONENT_LEFT, ERROR | shared/protocol |

## Game rules (locked)

Best of 3, 30 s rounds, 40 HP, first to 2. Punch 4/3/8 ticks, 12 damage, chip 3 on block, hitstun 12, knockback 144 px. Free walk 180 px/s, jump apex ~151 px (the drawn character height), block only while grounded and held, punch allowed mid-air. Jump gives invulnerability on ticks 3–10 after takeoff (the evade). Overlap of the active punch hitbox with the opponent hurtbox (72 × 140) deals damage; same-tick trades both land. Off-screen edge: 3 HP per 30 ticks. Round 1 standard car, round 2 tunnel, round 3 final car (visual only). All numbers in one constants file.

## Phases

### Phase 0 — Scaffold (30 min)
Workspace, tsconfig, three empty packages, Vitest, `InputFrame` and constants in `shared`, `git init`.
**Gate:** `pnpm install && pnpm test && pnpm typecheck` green.

### Phase 1 — Simulation ∥ (1.5 h)
Pure `step()` with movement, jump, facing, bounds, punch hitbox and damage, block chip, hitstun and knockback, rounds and timer, best of 3, out-of-bounds damage, train car per round. Unit tests for each rule above.
**Gate:** tests cover every locked rule; a headless script runs a full scripted match to `MATCH_END`.

### Phase 2 — Server ∥ (1.5 h)
Rooms with 5-char codes, HELLO/READY/INPUT handlers with zod validation, per-room 60 Hz accumulator with capped catch-up, snapshots every 2 ticks bundling events, opponent-left handling, HTTPS bootstrap with a self-signed cert script and COOP/COEP headers, static serving of the client build.
**Gate:** handler and loop tests pass; server prints its LAN URL.

### Phase 3 — Client shell ∥ (1.5 h)
Vite with basic-ssl and `/ws` proxy, socket client, keyboard `InputSource`, merged source, input sender (send on change plus heartbeat), snapshot buffer with interpolation, DOM lobby (name, room code, ready, camera button placeholder), result overlay with rematch. A placeholder arena that draws two rectangles from snapshots.
**Gate:** two browser profiles on one machine complete a full match with keyboard through the real server.

### Phase 4 — Design and UX pass (3 h) ∥ with Phase 5
Implements `design/00` to `04`. Theme: **Midnight Mayhem**, a brawl on the roof of a night train.

**4a. Rig preview page (first 45 min, owner gate before anything else).** A standalone `/rig.html` that draws Drifter and Conductor side by side at 2× in every pose (idle, walk, jump with ghost trail, punch startup / active / recovery, block, hit, KO, off-bounds), on the real generated background, with a slider to scrub punch ticks and a facing toggle. This is where the look is approved or corrected. Nothing else in Phase 4 starts until the owner says the silhouettes read.

**4b. Stage.** Six parallax layers at the locked speeds, roof rivets and seams streaming past, amber window glow bleeding up onto the roof, moon and stars, tunnel with strobing lamps in round 2, final observation car with railing, red marker lamp and receding track in round 3. Ground shadow ellipse per fighter.

**4c. Characters in motion.** Pose functions per state with the priority order; hair, beard and coat tails always trailing screen-left (train moves right); Conductor's cap never leaves the head; punching arm always drawn in front; jump ghost trail during i-frames; landing squash.

**4d. HUD and screens.** Health bars with ghost drain, round pips, timer, names, car label; countdown and round banners; lobby, calibration, result and error screens in the palette. Readable at 1080p from 2 m.

**4e. Feel.** Hit-stop, damage and chip flash, screen shake on clean hits, KO slowdown, impact spark, block ring, dust.

**Gate:** owner reviews `/rig.html` (4a) and later one screenshot per state and per train car against the checklist in `design/00`; a keyboard match feels responsive.

### Phase 5 — Vision layer ∥ with Phase 4 (3 h)
Port of the Controls doc, pose only: camera at 640×480, Web Worker inference with one frame in flight, EMA, explicit calibration (stand still 1.5 s, medians for shoulder width, lean zero, rest heights, arm length), metrics, gestures: walk by lean, jump by physical hop, block by crossed arms, punch by thrust plus world-z depth using the no-hand rule. `VisionInputSource implements InputSource`. Harness page with skeleton overlay, live metrics, six indicators, checklist. `hands.ts` stub reserved.
**Gate:** the Controls doc test gates for phases 1 to 3 plus the punch test at 1.5 m; keyboard still works alongside.

### Phase 6 — Integration (1 h)
Camera button in the lobby starts calibration; merged keyboard plus vision source; calibration overlay bound to the vision state; local cosmetic punch hint on rising edge; `?input=` override.
**Gate:** one player on webcam, one on keyboard, full match over LAN HTTPS on two laptops.

### Phase 7 — Demo hardening (1.5 h)
Two-laptop rehearsal in venue-like light and Wi-Fi three times without code changes. Runbook: cert generation, build, start, room code, fallback script if the camera fails. Freeze.
**Gate:** three clean matches; runbook exists.

### Reserve (2 h)
Tuning thresholds, bugs found at gates, and if everything is green: Hand Landmarker plan (`2026-09-12-hands-stretch.md`).

## Parallel schedule

| Hours | Worktree A | Worktree B |
|---|---|---|
| 0.0–0.5 | Phase 0 | — |
| 0.5–2.0 | Phase 1 sim | Phase 2 server |
| 2.0–3.5 | Phase 3 client shell | Phase 5 vision (starts on the harness, no server needed) |
| 3.5–4.25 | Phase 4a rig preview (owner gate) | Phase 5 vision continued |
| 4.25–6.5 | Phase 4b–e stage, HUD, feel | Phase 5 vision continued |
| 6.0–7.0 | Phase 6 integration | |
| 7.0–8.5 | Phase 7 hardening | |
| 8.5–15 | Reserve, tuning, hands stretch | |

## Out of scope until the reserve

Weapons and object scan, hand landmarks and fist detection, sound, reconnect tokens, spectators, rollback, telemetry dashboards.
