> **SUPERSEDED 2026-09-12.** This document is historical. The build follows `DECISIONS_CHANGED.md` (root) and `docs/superpowers/plans/2026-09-12-midnight-express-mvp.md`. Where this file disagrees with them, they win. Kept for reference only.

Webcam Controlled 2D Fighter Engineering Scaffold

This specification defines a build ready architecture for a two player browser based 2D fighting game inspired by traditional one versus one fighters. Each player grants webcam access. Computer vision runs locally, converts configurable physical movements into semantic game actions, and drives a deterministic combat simulation. The exact movement vocabulary, thresholds, characters, art direction, and supported physical objects remain intentionally undecided and are isolated behind configuration and interfaces.

The primary engineering goal is perceived immediacy. The player must see their own character respond without waiting for a network round trip. The system therefore separates local perception, action recognition, presentation, authoritative combat results, and network reconciliation. Webcam video never leaves the player device. Only compact, timestamped semantic inputs and game state corrections cross the network.

# Document status and operating assumptions

| **Item**     | **Decision for scaffold**                                                                     | **Change point**                                                                           |
| ------------ | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Platform     | Desktop web application, Chrome class browser first.                                          | Browser compatibility matrix may expand after the vertical slice.                          |
| Match format | Two remote players; same network demo supported.                                              | Local shared camera mode is out of scope because occlusion changes the perception problem. |
| Game style   | Side view 2D fighter with rounds, health, movement, attacks, blocking, hitstun and knockdown. | Final move set and frame data supplied later.                                              |
| Vision       | One pose model per client; rules over temporal landmarks first.                               | Learned temporal classifier may be added for ambiguous gestures.                           |
| Objects      | Architecture reserves detection and equip interfaces; no object list or mapping yet.          | Selected objects and weapons supplied later.                                               |
| Networking   | WebSocket baseline with immediate local prediction; transport abstraction from day one.       | WebRTC data channel or WebTransport can replace hot path after measurement.                |
| Authority    | Server decides hits, damage, round results and legal action transitions.                      | Peer rollback is an optional later topology.                                               |
| Persistence  | Accounts, cosmetics and match history are outside the hot match loop.                         | Backend product requirements supplied later.                                               |

# Product overview

## Core experience

- Player opens a room, grants camera access, and completes a short calibration.
- A debug silhouette confirms framing, visibility, orientation, and neutral stance.
- Each client recognizes physical movement locally and emits semantic actions such as MOVE_LEFT, PUNCH or BLOCK.
- The local avatar starts permitted presentation immediately.
- The server validates the action, advances deterministic combat state, resolves contact, and broadcasts corrections.
- Both clients reconcile authoritative state without visible teleportation whenever possible.
- A post match performance view reports connection and recognition quality without storing video.

## Experience principles

| **Principle**                  | **Requirement**                                                                                            |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| Intent over imitation          | Physical movement selects a clean authored game action; the avatar does not continuously copy every joint. |
| Immediate self feedback        | The local player sees anticipation, locomotion and effects before server acknowledgement.                  |
| Server controlled consequences | Damage, hit confirmation, knockback and victory remain authoritative.                                      |
| Readable recognition           | The player can see detected stance, confidence and cooldown state during calibration or debug mode.        |
| Small reliable vocabulary      | Ship a compact set of highly separable actions before expanding the move list.                             |
| Privacy by construction        | Raw frames and landmark histories remain local unless an explicit future opt in changes this.              |
| Measured performance           | All latency claims come from instrumented stage timestamps and percentile reports.                         |

# Non goals for the first build

- Full body motion capture or continuous skeletal retargeting.
- Open vocabulary detection of any household object.
- Automatic generation of arbitrary weapon mechanics.
- A large roster, story mode, tournaments or live service economy.
- Perfect anti cheat based on video evidence.
- Photorealistic graphics or complex ragdoll physics.
- Training a foundation vision model.
- Using an LLM in the input or combat hot path.

# System architecture

```
PLAYER A BROWSER                              MATCH SERVICE                              PLAYER B BROWSER
Camera -> Pose -> Gesture -> Input -----> Gateway -> Match Worker <----- Input <- Gesture <- Pose <- Camera
                         |                         |                         |
                    Local prediction       Deterministic state        Local prediction
                         |                         |                         |
                    Render at 60 Hz <----- snapshots/corrections ----> Render at 60 Hz
```

| **Component**       | **Responsibility**                                                                  | **Hot path**          | **Must remain replaceable**                     |
| ------------------- | ----------------------------------------------------------------------------------- | --------------------- | ----------------------------------------------- |
| Camera adapter      | Acquire frames and timestamps; enforce resolution and frame rate constraints.       | Yes                   | Camera source and browser capture API.          |
| Pose adapter        | Return versioned landmarks, confidence and inference timing.                        | Yes                   | MediaPipe or alternative pose runtime.          |
| Calibration service | Estimate neutral pose, scale, handedness, play zone and player specific thresholds. | Setup plus occasional | Calibration algorithm and stored profile.       |
| Gesture engine      | Consume temporal landmarks and emit semantic actions exactly once.                  | Yes                   | Rule detectors and learned classifiers.         |
| Input router        | Apply local prediction, assign frame and sequence numbers, and transmit inputs.     | Yes                   | WebSocket, RTCDataChannel or WebTransport.      |
| Game simulation     | Advance deterministic movement, state machines, hitboxes and damage.                | Yes                   | Rendering engine must not own simulation truth. |
| Renderer            | Animate characters, camera, UI, particles and corrections.                          | Yes                   | Phaser, PixiJS or custom Canvas/WebGL.          |
| Match worker        | Validate inputs and own authoritative state for one or more matches.                | Yes                   | Runtime and deployment environment.             |
| Room service        | Create rooms, issue tokens and select regions.                                      | No                    | Authentication and lobby implementation.        |
| Persistence         | Store users, match summaries and configuration versions.                            | No                    | Database and analytics provider.                |

# Recommended repository scaffold

```
apps/
  web/                      browser shell, lobby, calibration, HUD
  match-server/             gateway, authoritative match workers
packages/
  protocol/                 schemas, binary codecs, version negotiation
  simulation/               deterministic world, fighters, collision, frame data
  perception/               camera, pose adapter, normalization, filters
  gestures/                 detector interface, registry, state machines, fixtures
  renderer/                 sprites, animation graph, effects, interpolation
  telemetry/                stage timestamps, histograms, debug overlay
  shared-config/            versioned characters, moves, gestures, feature flags
  test-harness/             recorded landmark replays, network simulation, bots
docs/
  adr/                      architecture decision records
  protocols/                wire messages and compatibility
  performance/              budgets, benchmarks, regression reports
  runbooks/                 local setup, deployment, incident and demo recovery
```

Use a TypeScript monorepo so the protocol, simulation types, and configuration can be shared without duplication. The pose runtime may use WebAssembly internally, but no separate Python service should exist in the real time path. Python remains appropriate for offline analysis or classifier training.

# Client perception pipeline

## Camera acquisition

- Request only video permission and explain that processing remains on device.
- Start with 640 by 480 or a similarly modest input, then benchmark lower and higher resolutions.
- Request 30 frames per second; render independently at 60 frames per second.
- Associate every camera frame with a monotonic client timestamp.
- Drop frames when inference is busy. Never queue stale camera work.
- Pause inference when the tab is hidden, the match is paused, or camera permission is revoked.

## Pose adapter contract

```
interface PoseFrame {
  captureTimeMs: number;
  inferenceStartMs: number;
  inferenceEndMs: number;
  landmarks: ReadonlyArray<Landmark>;
  overallConfidence: number;
  modelVersion: string;
}
interface PoseEstimator { start(source: CameraSource): Promise<void>; stop(): void; onPose(cb: (p: PoseFrame) => void): void; }
```

The pose adapter must expose capture and inference timestamps so agents can distinguish camera delay from model delay. Model output must not leak directly into combat code.

## Normalization

- Mirror coordinates consistently so screen direction matches the player experience.
- Translate coordinates relative to a stable hip or torso center.
- Scale by shoulder width or torso length to reduce distance dependence.
- Store visibility and confidence for every landmark.
- Derive joint angles, pairwise distances and velocities from normalized coordinates.
- Use a monotonic clock and actual frame deltas rather than assuming a constant pose frame rate.

## Filtering

Apply light adaptive smoothing only to continuous locomotion features. Attack detection should use minimally filtered or separately filtered velocity so fast motion is not averaged away. Use hysteresis for held states: the threshold to enter MOVE_RIGHT or BLOCK should be higher than the threshold to remain in it. Reset temporal detectors after tracking loss.

# Calibration subsystem

| **Calibration step** | **Collected values**                                                         | **Failure rule**                                                |
| -------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Framing              | Bounding box, full body visibility, camera orientation.                      | Block start if required landmarks are repeatedly outside frame. |
| Neutral stance       | Torso center, shoulder width, hip height, resting wrist and ankle positions. | Repeat if variance is too high.                                 |
| Comfortable movement | Left and right range, crouch depth, optional jump displacement.              | Use conservative percentiles, not one extreme sample.           |
| Action rehearsal     | Later supplied gesture examples and confidence.                              | Flag detector overlap or unreliable recognition.                |
| Latency check        | Camera plus pose plus detector timing.                                       | Warn or reduce model quality when p95 exceeds budget.           |
| Environment check    | Lighting proxy, landmark confidence, background and camera stability.        | Show actionable remediation and allow retry.                    |

Calibration output is a versioned local profile. Store thresholds and scale factors, not raw video. Match configuration records which calibration and gesture schema versions were used.

# Gesture engine scaffold

The gesture engine is intentionally data driven because the final motion cases will be supplied later. Each detector consumes normalized temporal features and emits a semantic action only after transition rules, confidence gates and cooldown checks pass.

```
interface GestureDetector {
  id: string;
  reset(reason: ResetReason): void;
  update(frame: FeatureFrame, context: GestureContext): GestureEvent[];
}
interface GestureEvent {
  action: ActionId; phase: "start" | "hold" | "release"; confidence: number;
  detectedAtMs: number; sourceFrames: [number, number]; intensity?: number;
}
```

| **Detector family** | **Use case**                    | **Required behavior**                                                             |
| ------------------- | ------------------------------- | --------------------------------------------------------------------------------- |
| Continuous axis     | Walk direction or optional aim. | Dead zone, hysteresis, bounded output and immediate reversal.                     |
| Held pose           | Block, crouch or stance.        | Minimum dwell, explicit release threshold and tracking loss release.              |
| Impulse             | Punch, kick, jump or dodge.     | Velocity plus geometry, single fire latch, recovery and cooldown.                 |
| Sequence            | Future special actions.         | Finite state machine with timeout and cancel transitions.                         |
| Object proximity    | Future pickup and equip.        | Approved object label, wrist proximity, stable frames and explicit pickup intent. |

## Detector registry and configuration

```
{
  "gestureSchema": "v1",
  "action": "PUNCH_LIGHT",
  "detector": "wrist_impulse",
  "parameters": { "minVelocity": 0.0, "minExtension": 0.0, "cooldownMs": 0 },
  "enabled": false
}
```

Zero placeholder values and disabled state are deliberate. Later agents must not invent final thresholds or enable actions until movement requirements are provided and tested. Configuration validation must reject missing bounds, duplicated bindings, or detectors that can fire while their required landmarks are invisible.

# Object and weapon extension point

Object detection is deferred, but the scaffold must avoid architectural rework. The future subsystem should use a strict allowlist of chosen objects, not open vocabulary generation. Object detection runs only during an explicit pickup window or at a low duty cycle, while pose tracking remains the high frequency controller.

```
interface ObjectObservation { label: ApprovedObjectId; confidence: number; box: Rect; observedAtMs: number; }
interface PickupResolver { update(objects: ObjectObservation[], wrists: WristState): PickupIntent | null; }
interface WeaponMapper { map(object: ApprovedObjectId, ruleset: RulesetVersion): WeaponClassId; }
```

- The server receives an approved object identifier and requested weapon class, never arbitrary client authored stats.
- The server validates the mapping against the active ruleset.
- After equipping, wrist or body motion triggers authored weapon actions; continuous object tracking is optional.
- Object inference must be schedulable separately so it cannot starve pose inference or rendering.
- Object images are not transmitted or persisted by default.

# Deterministic combat simulation

Run the simulation at a fixed 60 simulation ticks per second. Rendering may interpolate between simulation states. The simulation package must run identically in browser and server tests and must not depend on DOM APIs, wall clock time, uncontrolled randomness, rendering state, or floating point behavior that cannot be reproduced reliably.

| **System**            | **Required state**                                                                             |
| --------------------- | ---------------------------------------------------------------------------------------------- |
| Fighter state machine | Idle, walk, startup, active, recovery, block, hitstun, knockdown, round end and future states. |
| Movement              | Position, velocity, facing, grounded state, acceleration and stage bounds.                     |
| Move data             | Startup, active, recovery, cancel rules, damage, hitstun, blockstun and hitbox schedule.       |
| Collision             | Deterministic hurtbox and hitbox overlap with stable resolution ordering.                      |
| Round system          | Timer, health, rounds won, spawn positions and terminal result.                                |
| Randomness            | Seeded generator only; seed included in match start message and replay.                        |
| Serialization         | Compact snapshot and canonical state hash for desync detection.                                |

## Frame data placeholder

```
interface MoveDefinition {
  id: ActionId; startupFrames: number; activeFrames: number; recoveryFrames: number;
  hitboxes: HitboxFrame[]; damage: number; hitstunFrames: number; blockstunFrames: number;
  allowedFrom: FighterStateId[]; cooldownFrames?: number;
}
```

All balance values remain configuration. Recognition time must not secretly change authored frame data. A physical punch chooses PUNCH_LIGHT; the simulation then executes the same move definition every time unless a future design explicitly uses bounded intensity.

# Networking research decision

## What actually removes perceived delay

Rollback networking does not make the network faster. It predicts inputs, advances immediately, then restores and resimulates if late authoritative inputs differ. GGPO describes this as input prediction and speculative execution that creates the appearance of zero latency.\[1\] This is more important to perceived responsiveness than replacing WebSockets alone.

| **Technique**                         | **Effect**                                                        | **Priority**        | **Constraint**                                                                                      |
| ------------------------------------- | ----------------------------------------------------------------- | ------------------- | --------------------------------------------------------------------------------------------------- |
| Local perception                      | Removes video upload and remote inference from the critical path. | Mandatory           | Model must run acceptably on target laptops.                                                        |
| Immediate local prediction            | Own movement and attack anticipation render without round trip.   | Mandatory           | Consequences still await authoritative resolution.                                                  |
| Input timestamps and sequence numbers | Lets server place and reject inputs consistently.                 | Mandatory           | Requires clock offset estimation and frame mapping.                                                 |
| Opponent interpolation                | Smooths irregular remote snapshots.                               | Mandatory           | Adds a small intentional render delay for remote entities.                                          |
| Rollback and resimulation             | Hides network delay for deterministic combat.                     | Performance upgrade | Requires snapshots, deterministic simulation and bounded rollback window.                           |
| Unordered partial reliability         | Prevents stale movement packets from blocking newer ones.         | Transport upgrade   | WebRTC data channels support unordered delivery and limited retransmission configuration.\[2\]\[3\] |
| QUIC datagrams                        | Provides unreliable datagrams in a server centric web transport.  | Experimental        | WebTransport and deployment support must be verified on target browsers and host.\[4\]\[5\]         |
| Regional match workers                | Reduces physical network path.                                    | Production upgrade  | Region selection and operations complexity.                                                         |
| Binary protocol                       | Reduces allocations and payload size.                             | Later optimization  | JSON is acceptable until profiling proves it material.                                              |

## Recommended transport evolution

- Phase 1: WebSocket for signaling and match inputs. Implement every message behind Transport.send and Transport.onMessage.
- Phase 2: add rollback on the same transport. Measure misprediction and rollback depth before changing protocols.
- Phase 3: evaluate WebRTC RTCDataChannel with ordered false and tightly bounded retransmission for transient inputs; retain a reliable channel for room and match control.
- Alternative Phase 3: evaluate WebTransport datagrams when a server authoritative deployment and browser support make it practical.
- Never combine a transport rewrite, rollback implementation and gesture system rewrite in the same milestone.

WebSockets use an ordered reliable stream, so an old lost message can delay newer messages at the transport layer. This is undesirable for repeated movement state. It is less damaging for low loss same region demos and can be mitigated by sending compact state changes, sequence numbers, and dropping stale messages on receipt. Do not claim that WebSockets alone guarantee low latency or that switching to UDP automatically solves prediction and simulation problems.

# Latency budget

| **Stage**                             | **Target median**                       | **Target p95**           | **Instrumentation**                                     |
| ------------------------------------- | --------------------------------------- | ------------------------ | ------------------------------------------------------- |
| Camera capture age at inference start | At most 25 ms                           | At most 50 ms            | capture timestamp to inference start.                   |
| Pose inference                        | At most 25 ms                           | At most 45 ms            | inference start to end.                                 |
| Gesture decision for impulse          | At most 35 ms after sufficient evidence | At most 70 ms            | feature threshold crossing to event.                    |
| Local action presentation             | Within one render frame                 | Within two render frames | gesture event to first visible animation frame.         |
| Input encode and enqueue              | Below 1 ms                              | Below 3 ms               | event creation to transport enqueue.                    |
| One way network estimate              | Below 35 ms                             | Below 80 ms              | clock corrected send and receive.                       |
| Server input processing               | Below 4 ms                              | Below 10 ms              | gateway receive to match worker completion.             |
| Own perceived response                | Below 80 ms                             | Below 130 ms             | physical evidence to local visible response.            |
| Remote consequence                    | Below 140 ms                            | Below 240 ms             | physical evidence to remote authoritative presentation. |

These are engineering targets, not guaranteed measurements. The telemetry package must report p50, p90, p95 and p99 by device, model quality, browser, connection and match. Never use an average alone.

# Low latency implementation rules

- Never transmit video or full landmark arrays during normal matches.
- Keep camera acquisition, inference, simulation and rendering on independent schedules.
- Allow at most one pose inference in flight; discard superseded frames.
- Run expensive inference away from the rendering main thread when the selected runtime supports it.
- Render the latest known local intent immediately; do not wait for a WebSocket acknowledgement.
- Send discrete actions immediately and continuous state only on change plus a modest heartbeat.
- Use one resident match worker or loop; never create a process, database query or remote function call per input.
- Keep database, logging exports and LLM calls out of the match worker hot path.
- Preload models, character assets and move configuration before match start.
- Warm up the pose model and JIT paths during calibration.
- Preallocate or reuse high frequency arrays and message objects where profiling identifies allocation pressure.
- Use bounded queues with drop policies; no component may accumulate stale frame or network work.
- Select the nearest available match region for remote players in production.
- Measure end to end latency with trace IDs spanning camera, gesture, client, network, server and render.

# Wire protocol

```
type ClientInput = {
  protocolVersion: 1; matchId: string; playerId: string; sequence: number;
  clientFrame: number; clientTimeMs: number; action: ActionId; phase: ActionPhase;
  axis?: number; confidenceBand?: 0 | 1 | 2; configHash: string;
};
type ServerSnapshot = {
  serverFrame: number; ackSequenceByPlayer: Record<string, number>;
  state: EncodedGameState; stateHash: string; serverTimeMs: number;
};
```

| **Message**           | **Reliability need**         | **Rules**                                                              |
| --------------------- | ---------------------------- | ---------------------------------------------------------------------- |
| HELLO and MATCH_START | Reliable ordered             | Negotiate protocol, ruleset, seed, player slot and clock samples.      |
| MOVEMENT_AXIS         | Latest value matters         | Sequence numbered; safe to discard stale values.                       |
| ACTION_START          | High importance              | Deduplicate; bounded retry or reliable delivery in baseline.           |
| ACTION_RELEASE        | High importance              | Must eventually clear held actions; server also applies timeout.       |
| SNAPSHOT              | Latest value usually matters | Includes acknowledgement frontier and state hash.                      |
| ROUND_RESULT          | Reliable ordered             | Server authoritative and persisted outside hot path.                   |
| PING or CLOCK_SYNC    | Repeated sample              | Estimate offset and jitter using multiple observations.                |
| CONFIG_MISMATCH       | Reliable ordered             | Refuse match when simulation or gesture configuration is incompatible. |

# Server scaffold

## Process model

- Gateway authenticates connection, applies message size and rate limits, and routes by match ID.
- Match registry assigns each active match to exactly one logical worker at a time.
- Match worker owns the authoritative state and fixed tick loop.
- Worker consumes inputs in deterministic order and records a bounded input history.
- Snapshot broadcaster sends deltas or snapshots at a measured cadence, initially 20 to 30 per second.
- Persistence writer receives round results asynchronously after the match worker commits them.
- Metrics exporter batches histograms outside the tick loop.

## Validation

- Reject malformed or oversized messages before match routing.
- Validate match membership and monotonically increasing sequence numbers.
- Reject actions illegal in the current fighter state.
- Apply server cooldowns and maximum input rates independent of client claims.
- Bound acceptable client frame age and future timestamp skew.
- Never use client confidence to authorize stronger damage.
- On disconnect, stop accepting inputs, apply a defined grace period, and resolve or abandon the match consistently.

# Client prediction reconciliation and rollback

- Maintain an input history indexed by simulation frame.
- Store compact state snapshots for a bounded rollback window, initially 8 to 12 frames for experimentation.
- Predict missing remote input as the most recent held directional state with no new discrete attack.
- When authoritative acknowledgement differs, restore the last matching snapshot and replay stored inputs.
- Never replay sound, particles or analytics naively during resimulation; presentation events require deduplication IDs.
- Smooth small positional corrections visually; snap only when integrity requires it.
- Track rollback count, maximum depth and frames resimulated per second.

If full rollback cannot be completed, keep immediate local animation and server authoritative hit resolution. This hybrid will occasionally produce corrected contact outcomes but remains much better than delaying every local response.

# Rendering and game feel

- Render at requestAnimationFrame cadence independently of the 60 Hz simulation.
- Use authored anticipation, active and recovery animations linked to move frame data.
- Start safe local anticipation immediately; confirm hit sparks, damage and knockback only after authoritative resolution.
- Use hit stop, sound and particles to make confirmed impacts feel decisive.
- Interpolate remote movement between buffered snapshots.
- Keep debug overlays off by default but toggleable with pose landmarks, detector state, frame number, RTT, jitter and rollback depth.
- Treat recognition failure as a visible input system state during calibration, not unexplained silence during a match.

# State and data model

| **Entity**            | **Minimum fields**                                                                     |
| --------------------- | -------------------------------------------------------------------------------------- |
| User                  | id, display name, created time; optional later.                                        |
| CalibrationProfile    | schema version, device key, scale, neutral pose features, thresholds, quality summary. |
| Room                  | id, host, join token, selected region, status, ruleset version.                        |
| Match                 | id, player IDs, seed, simulation hash, config hash, start and end time, result.        |
| FighterDefinition     | id, movement constants, hurtboxes, available moves, animation references.              |
| MoveDefinition        | frame data, damage data, hitboxes, legality and cancel rules.                          |
| GestureBinding        | action ID, detector ID, parameters, enabled flag, schema version.                      |
| ApprovedObjectMapping | future object ID, confidence threshold, weapon class, ruleset version.                 |
| PerformanceSummary    | device class, pose p95, local response p95, RTT, jitter, rollback metrics and errors.  |

# Configuration governance

- Hash the complete simulation ruleset and require client server equality before match start.
- Version gesture schemas separately because recognition can change without changing combat balance.
- Put experimental detectors and transports behind feature flags.
- Record architecture decisions for transport, pose model, simulation timing and authority changes.
- Never let an agent silently choose final gestures, object mappings or balance values left TBD in this specification.

# Testing strategy

## Perception tests

- Recorded landmark fixtures for neutral movement, each future gesture, near misses and tracking loss.
- Detector precision, recall and confusion matrix per player and environment.
- Property tests for normalization invariance across translation and scale.
- Tests for variable frame spacing, dropped frames and visibility changes.
- Performance benchmark for model warm up, median inference and p95 inference.

## Simulation tests

- Golden deterministic replays produce identical state hashes in browser and server environments.
- Frame exact tests for startup, active, recovery, hitstun and blockstun.
- Collision ordering and simultaneous hit tests.
- Seeded randomized input fuzzing with invariant checks.
- Serialization round trips and version mismatch rejection.

## Network tests

- Synthetic latency, jitter, reordering, duplication, loss and temporary disconnect.
- Stale continuous inputs never override newer inputs.
- Discrete actions are deduplicated exactly once.
- Prediction and reconciliation converge to authoritative state.
- Rollback never duplicates damage, sound or analytics.
- Two tabs, two physical laptops on one network, and two remote networks as separate gates.

## End to end tests

- Permission denied, camera removed, pose lost and tab backgrounded.
- Room creation, join, calibration, match, rematch and disconnect.
- Both players act during the same frame window.
- Low performance device enters degraded mode without accumulating frame queues.
- No raw video or landmarks appear in network inspection during normal play.

# Performance and observability

```
trace = { capture, inferenceStart, inferenceEnd, gestureEmit, localRender, networkSend, serverReceive, serverTick, snapshotSend, clientReceive, authoritativeRender }
```

| **Metric**               | **Alert or regression gate**                                               |
| ------------------------ | -------------------------------------------------------------------------- |
| Pose inference p95       | Fails performance gate when above configured device tier budget.           |
| Camera frame age         | Detects hidden queuing even when inference itself is fast.                 |
| Gesture decision latency | Measured from sufficient evidence, not motion start guessed by the system. |
| Main thread long tasks   | Correlate rendering stalls with inference and serialization.               |
| RTT and jitter           | Drive transport and region decisions.                                      |
| Server tick duration     | p99 must remain comfortably below 16.67 ms for 60 Hz.                      |
| Input queue depth        | Must remain bounded and near zero under normal load.                       |
| Rollback depth           | Reveal network instability or incorrect prediction policy.                 |
| State hash mismatch      | Immediate diagnostic event; never silently ignore persistent desync.       |

# Security privacy and abuse boundaries

- Process video locally and disclose webcam use clearly.
- Do not record or upload frames by default.
- Use short lived room tokens and authenticated match membership.
- Rate limit room creation, signaling and input messages.
- Validate all client inputs and configuration identifiers on the server.
- Treat object classification as untrusted client evidence; server maps only approved IDs to approved weapon classes.
- Do not infer sensitive traits, identity or emotion from the webcam.
- Provide an immediate camera off and leave match control.
- Define retention for match summaries and telemetry before deployment.

# Agent work packages

| **Agent**                    | **Scope**                                                                   | **Deliverables**                                            | **Blocked until**                                  |
| ---------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------- | -------------------------------------------------- |
| A Platform and protocol      | Monorepo, TypeScript config, schemas, transport interface, CI.              | Buildable skeleton, protocol tests, ADRs.                   | Nothing.                                           |
| B Deterministic simulation   | Fixed tick world, fighter state machine, collisions, replay hash.           | Headless simulation package and golden tests.               | Placeholder frame data is acceptable.              |
| C Camera and pose            | Capture, pose adapter, timestamps, normalization, debug skeleton.           | Local demo and inference benchmark.                         | Pose library selection ADR.                        |
| D Gesture framework          | Feature frames, detector interface, registry, replay harness.               | Disabled placeholder bindings and synthetic detector tests. | Final gestures not required for framework.         |
| E Renderer and game feel     | Sprite pipeline, animation graph, HUD, interpolation.                       | Keyboard driven vertical slice first.                       | Simulation interfaces stable.                      |
| F Match server               | Gateway, match worker, validation, snapshots and clock sync.                | Two keyboard clients complete a match.                      | Protocol and simulation packages.                  |
| G Prediction and latency     | Local prediction, reconciliation, telemetry, network simulator.             | Latency dashboard and degraded network tests.               | Client and server vertical slice.                  |
| H Final movement integration | Implement and tune supplied gestures.                                       | Confusion matrix, thresholds, calibration flow.             | User supplies cases and triggers.                  |
| I Object extension           | Approved detector, pickup resolver, server mapping and weapon presentation. | Selected objects work end to end.                           | User supplies object allowlist and weapon mapping. |

# Implementation sequence and gates

| **Milestone**              | **Outcome**                                                                          | **Exit criteria**                                                               |
| -------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| M0 Decisions and harness   | Repo, protocol, simulation loop, performance tracing and network impairment harness. | CI green; browser and server share protocol and deterministic state.            |
| M1 Keyboard vertical slice | Two keyboard players complete a server authoritative match.                          | Stable 60 Hz simulation; rooms, attacks, damage and result work.                |
| M2 Local pose control      | One player controls placeholder actions through configurable detectors.              | No network video; local response instrumented; detector replay tests exist.     |
| M3 Two pose players        | Two laptops play a complete match over WebSockets.                                   | No stale queues; legal actions validated; correction behavior acceptable.       |
| M4 Smoothness pass         | Prediction, interpolation, frame dropping, warm up and p95 dashboards.               | Own response and server tick budgets meet defined targets on demo hardware.     |
| M5 Rollback experiment     | Bounded snapshots and resimulation under impairment.                                 | State converges; presentation effects deduplicate; rollback metrics visible.    |
| M6 Final gestures          | User supplied move triggers implemented and calibrated.                              | Per player evaluation meets agreed precision and recall.                        |
| M7 Object weapons          | Chosen objects map to approved weapons.                                              | Pickup is deliberate; object inference does not regress pose or rendering p95.  |
| M8 Demo hardening          | Fallback config, reconnect behavior, rehearsed deployment and runbook.               | Three consecutive clean demo matches on actual venue network or local fallback. |

# Definition of done for the core scaffold

- Two remote browser clients can join the same room and complete a round.
- Keyboard input and pose input use the same semantic action interface.
- Exact gestures remain configurable and can be replaced without editing simulation or networking code.
- Local camera frames never leave the client.
- The local avatar begins feedback without waiting for the server.
- The server alone decides hits, damage and round outcome.
- Simulation results are deterministic under recorded inputs.
- Every hot path stage emits monotonic timestamps and percentile metrics.
- Synthetic latency and packet impairment tests run automatically.
- Pose inference cannot create an unbounded queue.
- Transport can be replaced without changing the gesture or simulation packages.
- Object detection can be added through reserved interfaces without entering the pose hot loop.
- All TBD decisions are visible in one register rather than silently assumed.

# Open decision register

| **ID** | **Decision needed**                                       | **Owner input required** | **Default until decided**                                           |
| ------ | --------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------- |
| D1     | Exact physical movement vocabulary and trigger semantics. | User and game design.    | Bindings disabled except development gestures.                      |
| D2     | Character roster and complete move frame data.            | Game design.             | One mirrored placeholder fighter.                                   |
| D3     | Movement mapping: lean, step, stance or hybrid.           | User testing.            | Configurable continuous axis.                                       |
| D4     | Whether jump and kick require full body visibility.       | User testing and safety. | Do not enable when landmarks are unreliable.                        |
| D5     | Approved physical objects.                                | User.                    | Object subsystem disabled.                                          |
| D6     | Object to weapon class mapping.                           | User and game balance.   | No arbitrary generation.                                            |
| D7     | Primary game renderer.                                    | Engineering.             | Phaser is a reasonable initial candidate, decision recorded in ADR. |
| D8     | Deployment provider and regions.                          | Engineering and budget.  | Single nearby region for demo.                                      |
| D9     | Transport upgrade after WebSocket.                        | Measured performance.    | Do not upgrade before profiling.                                    |
| D10    | Minimum supported hardware and browsers.                  | Product.                 | Recent desktop Chromium on demo laptops.                            |

# Instructions for coding agents

- Read this specification and all current ADRs before editing code.
- Do not implement a final gesture, threshold, object allowlist or weapon mapping unless the open decision register has been resolved.
- Keep perception, gestures, simulation, renderer and transport separated by typed interfaces.
- Make the keyboard vertical slice work before integrating pose input.
- Add tests and trace timestamps with every hot path feature.
- Never solve a latency issue by hiding measurements or removing authoritative validation.
- Profile before changing transport, model quality, tick rate or serialization.
- Preserve deterministic simulation and update golden replay hashes intentionally.
- When a requirement is ambiguous, add a documented TODO tied to a decision ID rather than choosing silently.

# Research sources

1\. GGPO. "Rollback Networking SDK and design overview." <https://github.com/pond3r/ggpo>

2\. Mozilla Developer Network. "RTCDataChannel ordered property." <https://developer.mozilla.org/en-US/docs/Web/API/RTCDataChannel/ordered>

3\. Mozilla Developer Network. "RTCDataChannel maxRetransmits property." <https://developer.mozilla.org/en-US/docs/Web/API/RTCDataChannel/maxRetransmits>

4\. World Wide Web Consortium. "WebTransport specification." <https://www.w3.org/TR/webtransport/>

5\. Internet Engineering Task Force. "RFC 9221 Unreliable Datagram Extension to QUIC." <https://www.rfc-editor.org/rfc/rfc9221.html>

6\. Google AI Edge. "MediaPipe Pose landmark detection guide." <https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker>

7\. Google Research. "On device real time body pose tracking with BlazePose." <https://research.google/blog/on-device-real-time-body-pose-tracking-with-mediapipe-blazepose/>

8\. Mozilla Developer Network. "WebAssembly overview." <https://developer.mozilla.org/en-US/docs/WebAssembly>

9\. Internet Engineering Task Force. "RFC 9297 HTTP Datagrams and Capsule Protocol." <https://www.rfc-editor.org/info/rfc9297/>

10\. W3C WebRTC Working Group. "WebRTC Real Time Communication in Browsers." <https://w3c.github.io/webrtc-pc/>