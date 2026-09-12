> **SUPERSEDED 2026-09-12.** This document is historical. The build follows `DECISIONS_CHANGED.md` (root) and `docs/superpowers/plans/2026-09-12-midnight-express-mvp.md`. Where this file disagrees with them, they win. Kept for reference only.

# Webcam Fighter Latency and Perception Failure Handbook

**Status:** Architecture specification for implementation agents  
**Project:** Two-player, browser-based, webcam-controlled 2D fighting game  
**Primary transport:** WebSocket for the first implementation  
**Primary pose system:** MediaPipe Pose Landmarker or an equivalent on-device landmark model  
**Simulation target:** Deterministic 60 Hz combat simulation  
**Scope:** Latency, timing, action-recognition errors, synchronization, reconciliation, failure handling, testing, and observability

---

## 1. Executive decision

Yes, the initial implementation uses **WebSockets**. However, WebSockets are only one part of the latency path. The camera, browser frame scheduling, MediaPipe inference, gesture interpretation, game simulation, rendering, the network, server scheduling, and reconciliation can each add delay or produce timing conflicts.

The design must therefore obey these rules:

1. **Webcam inference runs locally.** Raw video and full landmark streams never travel to the server during a normal match.
2. **The local character responds immediately.** A player must not wait for a WebSocket round trip before seeing their own movement or attack begin.
3. **The server remains authoritative for competitive results.** It validates legal action transitions and decides hits, damage, health, round state, and match results.
4. **Only semantic inputs cross the network.** Send `MOVE_AXIS`, `PUNCH_PRESS`, `PUNCH_RELEASE`, `KICK_PRESS`, `BLOCK_START`, and similar events—not images.
5. **Every input is frame-numbered and sequence-numbered.** Wall-clock arrival order is not treated as game order.
6. **The simulation is deterministic and replayable.** The same initial state and ordered input stream must produce the same result.
7. **Clients predict, then reconcile.** Small errors are corrected visually; material combat disagreements trigger rollback and resimulation.
8. **Queues are bounded.** Stale camera frames, landmark results, movement updates, render work, and telemetry must be dropped rather than allowed to accumulate.
9. **WebSocket is hidden behind a transport interface.** WebRTC DataChannel or WebTransport datagrams may later replace the latency-sensitive input path without rewriting perception or combat code.
10. **Latency is measured by stage and percentile.** Report p50, p90, p95, and p99; a single average hides the failures that make a fighter feel bad.

The most important product distinction is:

> Network prediction can hide network delay. It cannot hide a gesture detector that waits too long, fires twice, or chooses the wrong move.

The project must optimize both **responsiveness** and **semantic correctness**.

---

## 2. What “latency” means in this project

There is no single latency number. At least six related measurements matter.

| Measurement | Begins | Ends | Player-visible symptom |
|---|---|---|---|
| Physical-to-capture latency | Body begins moving | Relevant camera frame is captured | Everything feels late even offline |
| Capture-to-landmark latency | Frame capture | Pose result is available | Skeleton/debug overlay trails the player |
| Landmark-to-action latency | Sufficient motion evidence exists | Semantic action is emitted | Punch occurs after the real punch finishes |
| Action-to-local-photon latency | Local action emitted | First changed rendered frame is displayed | Local avatar feels disconnected |
| Action-to-remote-photon latency | Local action emitted | Opponent sees its consequence | Opponent appears delayed or teleports |
| Correction latency | Authoritative disagreement arrives | Correct state is displayed | Snapback, hit reversal, or animation pop |

Also distinguish:

- **Latency:** time between cause and visible result.
- **Jitter:** variation in latency. Stable 80 ms can feel better than 30–140 ms oscillation.
- **Throughput:** frames or packets processed per second. Higher throughput does not guarantee fresher output.
- **Staleness:** age of the data being acted upon. A 60 FPS queue can still be 500 ms behind.
- **Misprediction:** client guessed a future state that the server later rejects.
- **Misclassification:** perception chose the wrong semantic action before networking began.
- **Input ambiguity:** the physical motion genuinely matches multiple action definitions.

### 2.1 End-to-end critical path

```text
physical movement
  -> camera exposure and browser frame delivery
  -> image conversion/copy
  -> MediaPipe pose inference
  -> temporal feature update
  -> gesture state-machine decision
  -> local predicted simulation
  -> local render
  -> semantic input serialization
  -> WebSocket send
  -> server receive and validation
  -> authoritative simulation
  -> server snapshot/acknowledgement
  -> opponent interpolation or local reconciliation
  -> remote render
```

Do not sum nominal component benchmarks and call that the user experience. Instrument the timestamps carried through the actual pipeline.

---

## 3. Latency budget

These are initial engineering targets, not promises. Validate them on the lowest supported laptop and on realistic networks.

| Stage | p50 target | p95 target | Required measurement |
|---|---:|---:|---|
| Camera frame age when inference begins | <= 25 ms | <= 50 ms | `inferenceStart - captureTime` |
| Pose inference | <= 25 ms | <= 45 ms | `poseEnd - poseStart` |
| Temporal feature update | <= 1 ms | <= 3 ms | Feature profiler |
| Impulse gesture decision after sufficient evidence | <= 35 ms | <= 70 ms | Threshold-crossing to action event |
| Local action to visible animation | <= 16.7 ms | <= 33.4 ms | Action event to presented frame |
| Encode and enqueue network input | <= 1 ms | <= 3 ms | Action event to socket enqueue |
| One-way network estimate | <= 35 ms | <= 80 ms | Clock-corrected timestamp or RTT/2 estimate |
| Server receive to simulation completion | <= 4 ms | <= 10 ms | Gateway receive to match-tick end |
| Physical movement to own visible response | <= 80 ms | <= 130 ms | End-to-end local trace |
| Physical movement to remote consequence | <= 140 ms | <= 240 ms | End-to-end distributed trace |
| Rollback resimulation | <= 2 ms typical | <= 8 ms worst supported window | Rollback profiler |

The system should degrade gracefully before missing the render budget. Reduce inference frequency, resolution, effects, or snapshot rate before allowing queues to grow.

---

## 4. WebSocket-specific behavior

### 4.1 Why WebSockets are acceptable initially

- Mature browser support and simple deployment.
- Convenient room establishment and server-authoritative topology.
- Reliable delivery is useful for room lifecycle, configuration, match start, round results, and resynchronization.
- The team can concentrate on deterministic simulation and perception before adding NAT traversal or another transport stack.

### 4.2 WebSocket limitations that matter to a fighter

WebSockets provide an ordered, reliable byte stream. This creates several risks:

1. **Head-of-line delay:** if earlier bytes are lost, later movement updates cannot overtake them at the transport layer.
2. **Stale-state delivery:** a delayed `MOVE_LEFT` update may arrive after the player has returned to neutral.
3. **No built-in application backpressure policy:** the browser API can buffer outgoing messages. If production outruns transmission, old inputs can accumulate.
4. **Variable coalescing:** small messages may be grouped by lower layers or delayed by implementation/network behavior.
5. **Reconnect ambiguity:** a reopened socket is not proof that the client still owns the same active match slot.

### 4.3 Required mitigations while using WebSockets

- Use one long-lived socket per client session, not one request per input.
- Use compact binary messages after the first vertical slice; avoid large JSON and repeated keys in the hot path.
- Attach `matchId`, `playerId`, `connectionEpoch`, `inputSeq`, `clientFrame`, and `actionId` to inputs.
- Ignore any continuous-state message older than the latest accepted sequence.
- Treat impulse actions as idempotent by unique `actionId`.
- Send continuous axes on meaningful change plus a low-frequency heartbeat, not every camera frame.
- Send press/release transitions for held actions.
- Inspect `WebSocket.bufferedAmount`. If it exceeds thresholds, stop sending replaceable state and trigger degraded-network UI.
- Never buffer unbounded inputs in application arrays before calling `send()`.
- Separate gameplay and telemetry logically; telemetry must never delay gameplay processing in the application.
- Do not compress tiny hot-path messages. Compression CPU and buffering may cost more than the bytes saved.
- Use a nearby region and sticky routing so a match stays on one resident simulation worker.
- Keep database calls, authentication lookups, logs, analytics exports, and LLM calls out of the match tick.

### 4.4 Message classes and delivery semantics

| Class | Examples | Desired semantics over current WebSocket | Future datagram semantics |
|---|---|---|---|
| Replaceable state | movement axis, stance direction | Latest sequence wins | Unreliable, unordered |
| Impulse input | punch, kick, dodge | Reliable, deduplicated | Limited retransmission or duplicated send |
| Held-state edge | block start/end | Reliable, idempotent; heartbeat repairs missing edge | Limited retransmission plus periodic state |
| Authoritative snapshot | positions, health, state hash | Newest valid snapshot wins | Unreliable with periodic key snapshot |
| Critical control | match start/end, disconnect, resync | Reliable and ordered | Reliable stream |

Do not use one semantic policy for every packet merely because they share a WebSocket.

### 4.5 When to consider changing transport

Do not migrate based on intuition. Consider a WebRTC DataChannel or WebTransport path when measurements show all of the following:

- Perception and local presentation already meet budget.
- Deterministic prediction and rollback are operational.
- The observed remaining problem is network loss/head-of-line behavior, not client CPU stalls.
- WebSocket queue age or packet timing is materially hurting p95/p99 play.
- The team can maintain connection setup, security, fallback, and monitoring for the new transport.

Possible evolution:

1. Keep WebSocket for signaling, room state, and critical control.
2. Add WebRTC DataChannel configured unordered and with bounded retransmission for hot gameplay inputs.
3. Or add WebTransport datagrams where deployment and browser support meet requirements.
4. Retain WebSocket fallback and keep wire semantics independent of the transport.

Switching to an unreliable transport without sequence numbers, prediction, rollback, and recovery snapshots will not make the game correct.

---

## 5. Camera and browser scheduling failures

### 5.1 Camera starts at a low frame rate

**Cause:** poor lighting, browser constraints, thermal throttling, another application using the camera, or device limitations.  
**Effect:** large gaps between pose observations; fast punches may exist almost entirely between frames.  
**Fixes:**

- Request a supported target rather than assuming 60 FPS.
- Inspect actual track settings after permission is granted.
- Calibrate motion thresholds against observed frame intervals.
- Prefer timestamped velocity using `deltaTime`, never “distance per frame.”
- Warn or disable unreliable gestures below a tested capture rate.
- Provide an upper-body moveset fallback if feet cannot be sampled reliably.

### 5.2 Camera frame queue becomes stale

**Cause:** inference is slower than capture and every frame is queued.  
**Effect:** the debug skeleton looks smooth but follows the player by hundreds of milliseconds.  
**Fix:** allow at most one inference in flight and retain at most the newest pending frame. Drop superseded frames.

MediaPipe live-stream APIs may ignore new frames while the task is busy. Treat this as a useful freshness policy, but count dropped frames and ensure temporal calculations use timestamps rather than assuming uniform samples.

### 5.3 Main-thread blocking

**Cause:** inference, image conversion, game physics, React work, garbage collection, asset decoding, or effects share the main thread.  
**Effect:** simultaneous pose, input, and render spikes; visible hitching mistaken for network lag.  
**Fixes:**

- Run supported vision work in a worker/off-main-thread execution path.
- Keep the render loop independent of inference frequency.
- Avoid per-frame UI framework state updates.
- Reuse typed arrays and message objects in proven allocation hotspots.
- Preload and decode combat assets before the round.
- Pause nonessential animation and analytics during combat.
- Record long tasks and correlate them with input-to-photon spikes.

### 5.4 Browser tab loses visibility or focus

**Cause:** player switches tabs, browser throttles timers, window is minimized, device sleeps.  
**Effect:** giant `deltaTime`, missing pose frames, queued socket messages, or a character stuck blocking/moving.  
**Policy:** immediately mark the player inactive, send a reliable input reset, freeze or safely neutralize the character, and enter a reconnect/pause state. Never simulate accumulated elapsed time as one giant tick.

### 5.5 Camera permission or track ends mid-round

**Cause:** permission revoked, USB camera removed, OS privacy change, camera driver reset.  
**Policy:** emit `INPUT_SOURCE_LOST`, neutralize all held actions, show a grace-period reconnect state, and never infer attacks from the final malformed frames.

### 5.6 Resolution or orientation changes

**Cause:** browser resize, camera renegotiation, device rotation, camera switch.  
**Effect:** normalized positions jump and can appear as impossible velocities.  
**Policy:** version the camera transform. On any transform change, invalidate the temporal gesture buffer, require a short neutral reacquisition period, and recalibrate if scale changed materially.

---

## 6. MediaPipe and landmark timing failures

### 6.1 Landmark result arrives late

Each pose result must retain the **capture timestamp of its source frame**, not merely the callback time. Gesture velocity and action frame assignment must use source time.

If a result is older than the configured freshness threshold:

- It may update a debug overlay.
- It must not trigger a new competitive action.
- It must increment `stale_pose_result_count`.

### 6.2 Results arrive with irregular spacing

Frame dropping and inference variability make intervals uneven. Derivatives must be calculated as:

```text
velocity = (positionNow - positionBefore) / (captureTimeNow - captureTimeBefore)
```

Never compare raw displacement between consecutive inference callbacks without accounting for time.

### 6.3 Low visibility or partial occlusion

**Examples:** punching arm crosses torso, hand leaves frame, player turns sideways, furniture blocks legs.  
**Risk:** landmark teleportation creates false high velocity or the wrong limb is selected.  
**Policy:**

- Every detector declares the landmarks it requires.
- Require minimum presence/visibility for those landmarks.
- A low-confidence sample cannot start an attack.
- Brief low-confidence gaps may preserve an already-confirmed animation but may not generate additional impulses.
- A longer gap cancels pending candidates and moves input state toward neutral.
- Never replace a missing wrist with `(0,0)` or another numeric sentinel that looks like motion.

### 6.4 Left/right landmark swap

**Cause:** mirrored preview confusion, body crossing, model instability, player turns around.  
**Effect:** left jab becomes right jab, direction reverses, or a large apparent cross-body velocity fires an attack.  
**Fixes:**

- Define canonical body-space left/right independently from mirrored display.
- Maintain limb identity temporally rather than trusting one frame alone.
- Reject anatomically implausible swaps or large instantaneous identity jumps.
- Clear attack candidates after a confirmed identity discontinuity.

### 6.5 Landmark teleport or spike

Use plausibility gates based on normalized body scale and elapsed time. A single extreme sample should not create an action. Track spike rejection metrics separately from ordinary smoothing.

Do not solve spikes with a large moving-average window. Heavy smoothing lowers noise but adds input delay. Prefer:

- confidence gates;
- median-of-three or small robust filters;
- adaptive filtering based on velocity/confidence;
- hysteresis in the gesture state machine;
- confirmation based on meaningful phase transitions.

### 6.6 Person detector temporarily loses the player

**Effect:** reacquired skeleton may have a discontinuous origin/scale.  
**Policy:** transition through `TRACKING_LOST -> REACQUIRING -> NEUTRAL_READY`; do not go directly from lost tracking to `PUNCH_CONFIRMED`.

### 6.7 More than one person enters frame

**Risk:** tracker switches identities, causing avatar teleportation or opponent spoofing.  
**Policy:** one calibrated player identity per client. Choose the track nearest the expected calibration signature and prior pose. If identity is ambiguous, neutralize input and show a framing warning rather than silently switching.

### 6.8 Background movement and pets

Body landmarks should be bound to the calibrated subject. Sudden secondary detections must not replace that subject. Log `multi_pose_ambiguity` and require reacquisition when necessary.

### 6.9 Camera mirroring mismatch

The selfie preview may be mirrored while MediaPipe coordinates are not. Establish these transforms explicitly:

```text
camera image coordinates
  -> model coordinates
  -> canonical player body coordinates
  -> game-facing coordinates
  -> mirrored UI preview coordinates
```

Only the final preview should mirror for familiarity. Action semantics must operate in canonical coordinates.

### 6.10 World coordinates are noisy or unavailable

Do not require depth for the base moveset. A forward punch toward the camera is harder to infer from 2D image coordinates, but estimated depth may be unstable. Prefer side-on or lateral gesture definitions for the MVP unless depth performance is validated across hardware.

---

## 7. Gesture-recognition latency versus accuracy

A gesture detector is a temporal state machine, not a single-frame label.

Example conceptual states:

```text
IDLE -> CANDIDATE -> COMMITTED -> COOLDOWN -> IDLE
          |             |
          +-> REJECTED  +-> CANCELLED only if game rules permit
```

### 7.1 Decision too early

**Benefit:** lower latency.  
**Risks:** feints become attacks; reaching, blocking, or returning to neutral is mistaken for a punch.  
**Mitigations:** require direction, velocity, joint extension, and origin conditions; use a short commit threshold; allow cosmetic anticipation before the action becomes combat-authoritative.

### 7.2 Decision too late

**Benefit:** greater classification confidence.  
**Risks:** character attacks after the physical motion, and the network gets blamed for perception delay.  
**Mitigations:** detect the earliest discriminative phase rather than waiting for the entire gesture; trigger on acceleration/extension threshold and use later frames only to refine animation intensity.

### 7.3 Speculative presentation with confirmed combat

For ambiguous motions, separate layers:

- **Presentation hint:** immediate shoulder/arm anticipation, dust, charging, or a pose-follow animation.
- **Semantic commit:** emitted when the detector has sufficient evidence.
- **Combat hitbox:** activated only according to deterministic move frame data after commit.

If the candidate is rejected, blend the presentation back to idle without ever creating damage. This hides some recognition delay without compromising match correctness.

### 7.4 Hysteresis

Use different enter and exit thresholds. Example: start block only above a strong crossed-arm confidence; remain blocking until confidence falls below a lower threshold. This prevents rapid block/unblock chatter.

### 7.5 Debounce and cooldown

- **Debounce:** requires an action condition to remain valid briefly.
- **Cooldown:** prevents the same physical motion/retraction from firing repeatedly.
- **Game lockout:** move frame data forbids an action because the character is already committed.

These are different. Do not use one global 500 ms timer for every move. Cooldowns belong to detector definitions; legal transitions belong to the game simulation.

### 7.6 Press, hold, release, and impulse semantics

| Physical/game action | Network form | Failure danger |
|---|---|---|
| Punch/kick | One idempotent impulse | Duplicate callbacks cause double attacks |
| Block | Start/end edges plus periodic current state | Lost end leaves character blocking forever |
| Horizontal movement | Quantized axis/state with latest sequence | Old movement arrives after neutral |
| Crouch | Held state or transition depending on design | Pose noise creates crouch chatter |
| Jump | One impulse with cooldown | Landing motion retriggers jump |

### 7.7 Simultaneously plausible actions

Examples:

- Leaning while punching could mean `MOVE + PUNCH`.
- Raising arms to block could resemble punch windup.
- A kick changes hip position and could resemble jump.
- Returning from punch could resemble the opposite-arm punch.

Resolve with a documented action arbitration table. Possible policy:

1. Tracking safety gates first.
2. Previously committed action continues unless cancellable by frame data.
3. Defensive held state and locomotion may coexist only if game design permits.
4. One impulse candidate wins by detector priority and confidence margin.
5. If two exclusive candidates are too close, emit neither and record ambiguity.

Do not let JavaScript callback order decide gameplay semantics.

---

## 8. Fighter-specific conflicts and edge cases

### 8.1 Both players hit on the same simulation frame

The server must resolve this deterministically from frame data—not packet arrival order. Possible valid outcomes include trade, priority win, armor, clash, or both blocked. The chosen rule belongs in combat configuration.

### 8.2 Inputs arrive on opposite sides of a frame boundary

Clock jitter can assign nearly simultaneous actions to different ticks. Use server-estimated client frame mapping with a bounded acceptance window. Never rewrite old history beyond the supported rollback window.

### 8.3 Local client shows a hit, server says miss

Cause: opponent’s late input caused rollback or local prediction placed opponent incorrectly.  
Policy:

- Delay irreversible presentation—health decrement, announcer call, round win—until authoritative confirmation.
- Immediate local hit-stop/spark may be speculative only if it can be cancelled gracefully.
- Prefer predicted attack animation but authoritative hit confirmation.

### 8.4 Local client shows a miss, server says hit

Play a late-confirmation hit reaction from the corrected state. If the delay exceeds a usability threshold, display network degradation rather than pretending the experience is healthy.

### 8.5 Block began locally but server received it after impact

The server evaluates the block on its assigned input frame, not receipt time. Within a bounded rollback/late-input window, rewind and resimulate. Beyond that window, reject the late defense consistently and expose the network condition.

### 8.6 Player physically punches during hitstun

The perception layer may correctly recognize the physical punch, but the game layer must reject it as illegal. Send or record it only according to input-buffer rules. Perception correctness does not override character state.

### 8.7 Repeated physical motion during a long attack animation

Do not queue unlimited attacks. Use a small, explicit fighting-game input buffer. Define which action types may be buffered, for how many frames, and whether newer inputs replace older ones.

### 8.8 Holding a pose across rollback

Rollback replays semantic input history, not the webcam. Held input state must be reconstructible from start/end edges and checkpoints. Never ask MediaPipe to recreate past frames.

### 8.9 Opponents face opposite directions

Physical “left” can mean screen left, player-local forward, or character-forward. Choose canonical action semantics. Recommended separation:

- Perception outputs body/world-neutral intent such as `LATERAL_AXIS` and `LEFT_ARM_STRIKE`.
- An input-mapping layer converts that into game-relative forward/back according to character facing.
- Rollback records the mapped semantic input used by simulation.

### 8.10 Side switching

When fighters cross and facing flips, a continuously held movement must not generate a discontinuous input. Decide whether body lean maps to screen direction or character direction. Version this as game configuration and test the exact crossing frame.

### 8.11 Knockdown, wake-up, and crouch confusion

The avatar’s visual posture must not feed back into perception; only the human webcam does. A player crouching while the avatar is knocked down may buffer crouch but cannot alter the knockdown state. Clear or retain buffered input by explicit wake-up rules.

### 8.12 Pause and round transitions

Discard or quarantine physical actions detected during countdown, pause, KO freeze, round transition, camera recalibration, and reconnect. Require a neutral pose before rearming detectors so a held punch pose does not fire on resume.

### 8.13 False double-fire

Typical cause: extension emits punch and retraction crosses a velocity threshold again. Require a complete reset condition—such as wrist returning inside a neutral envelope—before the detector can rearm.

### 8.14 Slow deliberate punch

Velocity-only detection misses it. Decide whether the game intentionally requires sharp motions or supports both velocity and pose-transition paths. Do not silently change behavior by device frame rate.

### 8.15 Very fast punch sampled in only two frames

Position and joint extension may jump. Use timestamped displacement plus anatomical plausibility. If evidence is insufficient, favor a miss over fabricating an attack, then adjust camera/inference requirements based on recorded test data.

### 8.16 Player moves closer to the camera

Raw pixel motion and limb size change. Normalize relative to torso/shoulder scale and hip/shoulder origin. Detect large global scale change separately so it is not interpreted as all limbs accelerating.

### 8.17 Clothing, skin tone, lighting, and background variance

These can reduce landmark confidence and create unequal latency because some users need more frames to cross confidence thresholds. Test diverse users and rooms. Surface confidence/framing feedback during calibration; do not hide systematic performance behind global averages.

### 8.18 Webcam auto-exposure changes

Sudden blur or brightness changes can destabilize landmarks. Treat bursts of low confidence as tracking degradation, not valid rapid motion.

### 8.19 CPU/GPU contention during VFX-heavy moments

Special effects may reduce pose throughput exactly during attacks. Profile worst-case combat scenes. Reserve a frame budget for inference and disable or simplify effects dynamically before perception falls behind.

### 8.20 Network disconnect during an attack

The server continues only for a short configured grace window. Neutralize future input after the last valid frame; never repeat the last punch. Match outcome policy must distinguish voluntary leave, timeout, and recoverable reconnect.

---

## 9. Prediction, rollback, and reconciliation

### 9.1 Local prediction

When a local semantic action is committed:

1. Assign it an input sequence and target simulation frame.
2. Apply it immediately to the local predicted simulation.
3. Store it in the unacknowledged input history.
4. Send it to the server.
5. Continue simulating without waiting for acknowledgement.

### 9.2 Remote input prediction

The simplest prediction for missing remote input is to repeat the most recent continuous state and assume no new impulse. This works because most frames contain no new attack.

Never predict repeated punches from a previous punch impulse.

### 9.3 Authoritative snapshot content

Each snapshot should include at least:

```ts
interface AuthoritativeSnapshot {
  matchId: string;
  serverFrame: number;
  lastAcceptedInputSeq: [number, number];
  stateHash: number;
  fighters: FighterState[];
  round: RoundState;
}
```

Send deltas if useful, but periodic complete/key snapshots are required for recovery.

### 9.4 Reconciliation categories

| Difference | Response |
|---|---|
| Tiny position error, no combat consequence | Smooth visual correction over a short interval |
| Material position/state error within history | Restore authoritative frame and replay stored inputs |
| Hit, block, health, stun, stock, or round disagreement | Roll back/resimulate; authority wins |
| State hash mismatch without understandable delta | Request full resync and record diagnostic bundle |
| Correction older than stored history | Hard resync, network warning, possibly abort competitive match |

### 9.5 Rollback constraints

- Store compact simulation snapshots or efficiently reversible state for a bounded number of frames.
- Store semantic inputs, not raw camera or landmarks.
- Simulation code must not read wall clock, random global state, DOM state, network arrival order, or nondeterministic physics.
- Seed randomness and serialize the seed/state.
- Use fixed-point or strictly controlled numeric behavior if cross-runtime floating-point divergence is observed.
- Rendering and audio are not rewound literally; they consume corrected simulation events with deduplication/cancellation policy.

### 9.6 Avoiding correction artifacts

- Keep authoritative collision capsules separate from smoothed render transforms.
- Never smooth health, KO, or legal combat state internally; smooth only presentation.
- Deduplicate audio and hit sparks by stable event ID.
- Cancel speculative effects when their event disappears after rollback.
- Do not replay camera shake multiple times during resimulation.
- Limit visible remote extrapolation to prevent large snapback.

---

## 10. Input protocol

### 10.1 Suggested message

```ts
type ActionCode =
  | "MOVE_AXIS"
  | "PUNCH"
  | "KICK"
  | "BLOCK_START"
  | "BLOCK_END"
  | "CROUCH_START"
  | "CROUCH_END"
  | "JUMP"
  | "INPUT_RESET";

interface PlayerInputMessage {
  protocolVersion: number;
  matchId: string;
  playerId: string;
  connectionEpoch: number;
  inputSeq: number;
  actionId: string;
  clientCaptureTimeMs: number;
  clientDecisionTimeMs: number;
  clientFrame: number;
  predictedServerFrame: number;
  action: ActionCode;
  value?: number;
  detectorId: string;
  detectorConfigVersion: string;
  confidenceBucket: number;
}
```

The server should not trust client confidence to decide damage. It is diagnostic metadata and may support anti-abuse review or quality adaptation.

### 10.2 Input validation

- Match and connection epoch must be current.
- Sequence must be monotonic within a bounded reordering policy.
- Duplicate `actionId` must be idempotent.
- Target frame must be within configured early/late limits.
- Transition must be legal for authoritative fighter state.
- Rate must be below per-action and global limits.
- Impossible combinations are rejected and counted.
- Rejected inputs receive a reason code suitable for reconciliation and debugging.

### 10.3 Reset semantics

`INPUT_RESET` neutralizes all held controls and clears uncommitted detector candidates. Send it on:

- camera loss;
- tab hide/freeze;
- reconnect;
- recalibration;
- round transition;
- explicit pause;
- unrecoverable landmark loss.

---

## 11. Client scheduling architecture

Use independent schedules:

1. **Camera acquisition:** accepts the newest browser frame and capture timestamp.
2. **Pose inference:** one request in flight; newest-frame replacement buffer.
3. **Gesture evaluation:** runs when a fresh pose result arrives.
4. **Fixed simulation:** advances at 60 Hz with accumulated time clamped.
5. **Rendering:** uses `requestAnimationFrame`, interpolating presentation between simulation frames.
6. **Network receive:** parses and stages messages without doing expensive work in the callback.
7. **Telemetry:** batches off the hot path with a strict memory cap.

### 11.1 Never couple inference FPS to simulation FPS

The game can simulate at 60 Hz even if MediaPipe produces 20–30 fresh poses per second. The most recent held semantic state persists; impulse events occur once. Rendering may run at the display refresh rate.

### 11.2 Fixed-step loop requirements

- Clamp elapsed time after stalls.
- Cap catch-up ticks per render frame.
- If the client cannot maintain the simulation, request resync rather than entering a permanent catch-up spiral.
- Simulation timestamps are integer frames.
- Wall-clock time is used for scheduling and telemetry, never combat outcomes.

### 11.3 Dynamic quality policy

Degrade in this order when client time exceeds budget:

1. Drop stale pending camera frames.
2. Reduce pose inference rate.
3. Reduce input resolution/model complexity if validated.
4. Reduce cosmetic effects, particles, shadows, and postprocessing.
5. Reduce nonessential UI update frequency.
6. Warn that hardware is below competitive quality.

Never degrade by increasing gesture smoothing windows without explicit evaluation; that directly adds control latency.

---

## 12. Server architecture and latency failure modes

### 12.1 Match worker

One resident logical match worker owns:

- authoritative frame counter;
- both input histories;
- deterministic simulation state;
- rollback history;
- connection epochs;
- validation/rate limits;
- snapshot schedule;
- state hashes and performance metrics.

### 12.2 Server failures

| Failure | Symptom | Prevention/response |
|---|---|---|
| Cold start | First seconds lag badly | Keep demo region warm; preload code/assets |
| Shared event-loop overload | All matches spike together | Isolate/budget match work; monitor loop delay |
| Database in tick | Random long stalls | Move persistence outside hot path |
| Synchronous logging | Attacks hitch during log bursts | Buffer bounded structured telemetry off-path |
| Unbounded inbound queue | Server simulates old inputs | Bounded per-match queue; reject/replace stale state |
| Oversized message attack | Parse/GC spike | Binary size limit before parse; schema validation |
| No sticky routing | State transfer or match loss | Route match consistently to owning worker |
| Clock adjustment | Frame mapping jumps | Use monotonic process clocks; never system-wall-clock deltas |
| Long garbage collection | Snapshot gap and burst | Allocation profiling; reuse hot objects; process isolation |
| Region too far | Persistent high RTT | Region selection based on both players, not room creator only |

### 12.3 Region selection

Select a region minimizing a fairness-aware function, for example:

```text
score(region) = max(RTT_A, RTT_B) + lambda * abs(RTT_A - RTT_B)
```

The exact policy is a product decision. A midpoint region may produce a better match than the lowest average if one player would otherwise have a severe disadvantage.

### 12.4 Tick overload policy

Do not silently slow game time. If a worker repeatedly exceeds its frame budget:

- shed noncritical work;
- reduce snapshot frequency within bounds;
- mark the match degraded;
- migrate only between rounds if architecture supports safe state transfer;
- abort/refund competitive results if authoritative timing integrity cannot be maintained.

---

## 13. Object/weapon detection latency extension

Object functionality remains disabled until the approved object list and mappings are provided. When added, it must not enter the pose hot path indiscriminately.

Rules:

- Use a strict allowlist, not open-vocabulary generation.
- Run object detection at a lower independent rate unless pickup interaction requires a short burst.
- Enter a `PICKUP_CANDIDATE` state when hand/object proximity is plausible.
- Confirm object identity across multiple observations or with a dedicated interaction.
- Send only `EQUIP_REQUEST(objectClass, actionId, frame)` to the server.
- The server validates whether pickup/equip is legal; the client does not invent weapon stats.
- Cache a stable tracked object identity rather than redetecting its class every frame.
- If confidence is lost, retain or cancel according to explicit state; do not oscillate weapons.
- Never let object inference block pose inference, the simulation tick, or rendering.

Potential conflict: the hand becomes occluded while holding an object, degrading pose quality. Test weapon gestures with the actual approved objects; do not assume bare-hand thresholds will transfer.

---

## 14. Observability and diagnostic traces

### 14.1 Per-action trace

For sampled actions, retain locally or report privacy-safe timestamps:

```text
captureTime
poseStart
poseEnd
featureEnd
candidateStart
actionCommit
localSimulationApply
localPresented
socketEnqueue
socketBufferedAmount
serverReceive
serverApplyFrame
snapshotSend
snapshotReceive
reconciliationEnd
```

Use one stable trace/action ID across stages.

### 14.2 Required metrics

**Camera and perception**

- actual camera FPS;
- inference FPS;
- inference duration percentiles;
- source-frame age at inference and result;
- dropped/superseded frames;
- stale result count;
- landmark confidence per required joint;
- tracking-lost and reacquisition duration;
- detector candidate-to-commit time;
- detector ambiguity/rejection count;
- action rate and double-fire suppression count.

**Client runtime**

- render FPS and frame-time percentiles;
- simulation tick duration and catch-up ticks;
- main-thread long tasks;
- memory/GC indicators where available;
- WebSocket `bufferedAmount` and queue-age estimates;
- predicted inputs outstanding;
- correction magnitude and count;
- rollback frames and resimulation duration.

**Network/server**

- RTT, jitter, disconnects, and reconnect time;
- input arrival lateness by assigned frame;
- duplicates and stale packets;
- server event-loop/tick delay;
- snapshot spacing;
- validation rejection reasons;
- state hash mismatches;
- match-region RTT fairness.

### 14.3 Debug overlay

Development builds should offer an overlay showing:

- capture FPS and current source-frame age;
- pose inference ms and pose confidence;
- detector state and last emitted semantic action;
- local/server frame numbers;
- RTT/jitter and socket buffer bytes;
- predicted frames ahead;
- rollback count/maximum distance;
- current quality-degradation level.

Do not expose raw webcam frames or identifying telemetry in production diagnostics without explicit consent.

### 14.4 Misclassification recording

Provide a local developer control to mark “missed action,” “false action,” or “wrong action.” Store a short landmark/time-series diagnostic only with explicit development consent. The project should not require uploading raw video to debug routine timing issues.

---

## 15. Test plan

### 15.1 Deterministic simulation tests

- Same initial state and input log produces identical state hashes.
- Both players attack on the same frame.
- Block and hit begin at adjacent frames.
- Side switch occurs while movement is held.
- Input arrives exactly at early/late acceptance boundaries.
- Rollback crosses jump, hitstun, knockdown, and round-end events.
- Duplicate impulse is applied once.
- Missing held-state end is repaired by reset/checkpoint.
- Resimulation does not duplicate sound/effects event IDs.

### 15.2 Perception sequence tests

Build recorded landmark fixtures for:

- idle movement that must emit nothing;
- one punch that must emit exactly once;
- punch plus locomotion;
- block transitioning to punch;
- punch retraction;
- slow and fast variants;
- left/right body turn and crossing arms;
- partial occlusion;
- dropped/irregular frames;
- low confidence and landmark spikes;
- camera scale/orientation change;
- second person entering frame;
- tracking loss and reacquisition;
- action during illegal game state.

Test timing as well as classification: each expected event gets an earliest and latest acceptable commit time.

### 15.3 Synthetic network matrix

Test at minimum:

| RTT | Jitter | Loss | Reordering simulation | Expected result |
|---:|---:|---:|---:|---|
| 0–10 ms | 0 | 0 | none | Baseline |
| 40 ms | 5 ms | 0 | none | Smooth |
| 80 ms | 20 ms | 0 | none | Prediction/rollback functional |
| 120 ms | 30 ms | 1% | app-level delayed batches | Degraded but playable target |
| 180 ms | 50 ms | 3% | bursts | Warning; integrity maintained |
| 250+ ms | 80 ms | 5% | bursts | Graceful unacceptable-state handling |

Because WebSocket runs on an ordered reliable stream, network tooling should model delayed delivery/bursts, not only packet loss exposed directly to the application.

### 15.4 Load tests

- Many matches on one worker/process.
- One malicious client sending maximum legal rate.
- Oversized/invalid messages.
- Telemetry backend unavailable.
- Database slow while matches continue unaffected.
- Snapshot serialization at peak match count.
- GC pressure and event-loop delay.

### 15.5 Device matrix

Test recent Chromium browsers across:

- low-end supported integrated graphics;
- Apple Silicon;
- Windows laptops with integrated and discrete GPUs;
- 30 FPS and 60 FPS webcams;
- poor indoor lighting;
- high-DPI/external displays;
- browser power-saving mode;
- thermal throttling after a sustained match session.

### 15.6 Human fairness tests

Measure false positives, false negatives, and commit latency by person—not only in aggregate. Include different heights, limb lengths, mobility ranges, clothing, skin tones, rooms, camera distances, and left/right-handed motion styles. Calibration should reduce systematic differences without giving gameplay strength advantages.

---

## 16. Failure-response matrix

| Detected condition | Immediate client action | Network/server action | User feedback |
|---|---|---|---|
| Pose inference busy | Replace pending frame with newest | None | None unless persistent |
| Pose result stale | Ignore for new actions | None | Performance indicator if persistent |
| Required joint low-confidence | Prevent candidate commit | Optional quality metric | Framing hint |
| Tracking lost | Neutralize held inputs | Send `INPUT_RESET` | Re-enter frame prompt |
| Tab hidden | Stop competitive input | Pause/grace policy | Paused/inactive notice |
| Socket buffer high | Drop replaceable updates | Mark connection degraded | Network warning |
| Snapshot hash mismatch | Stop speculative certainty | Full resync | Brief reconnecting state |
| Rollback beyond history | Hard resync | Send full state | Severe network warning |
| Server tick overload | Continue bounded local prediction | Shed work/mark match | Server degradation notice |
| Duplicate action | Ignore duplicate | Idempotent acknowledgement | None |
| Ambiguous exclusive gestures | Emit neither | None | Optional calibration hint |
| Camera transform changes | Clear temporal buffers | Reset held state | Short recalibration |

---

## 17. Implementation phases

### Phase A: Offline latency baseline

- Keyboard controls and deterministic 60 Hz simulation.
- Local MediaPipe pipeline with debug skeleton.
- Timestamp every stage.
- No networking until local physical-to-photon latency is measured.
- One or two temporary test gestures only; final mappings remain configurable.

**Gate:** no unbounded camera queue; local p95 target is approached on reference devices.

### Phase B: WebSocket vertical slice

- Room connection and match epochs.
- Semantic input protocol.
- Server-authoritative deterministic simulation.
- Sequence numbers, idempotency, input reset, and periodic snapshots.
- Keyboard input works through the same interface as pose input.

**Gate:** two clients complete a match; no raw pose/video crosses network.

### Phase C: Prediction and reconciliation

- Immediate local prediction.
- Unacknowledged input history.
- Visual correction separation.
- State hashes and full resync.

**Gate:** artificial latency does not delay local action animation.

### Phase D: Rollback

- Bounded history and late-input frame mapping.
- Restore/resimulate.
- Event deduplication.
- Fighter-specific conflict tests.

**Gate:** hit/block disagreements resolve deterministically without duplicated irreversible effects.

### Phase E: Perception hardening

- Detector state machines, confidence gates, hysteresis, cooldowns, arbitration.
- Calibration and neutral rearming.
- Diverse recorded landmark fixtures.
- Dynamic quality policy.

**Gate:** measured false-action and missed-action rates meet defined thresholds for the selected moves.

### Phase F: Transport profiling

- Collect WebSocket queue, RTT, jitter, late-input, and rollback metrics.
- Determine whether WebSocket head-of-line behavior is a material remaining bottleneck.
- Prototype WebRTC/WebTransport only behind the transport interface.

**Gate:** migration requires an A/B measurement showing meaningful p95/p99 improvement without unacceptable reliability or deployment cost.

### Phase G: Approved object extension

- Add only the selected object classes.
- Independent detection schedule and pickup state machine.
- Validate pose occlusion and latency with real props.

**Gate:** object inference cannot regress base pose or render latency beyond budget.

---

## 18. Agent rules

Every coding agent working on this project must follow these constraints:

- Do not send webcam frames or full landmark arrays to the game server.
- Do not wait for the server before showing the local action.
- Do not use arrival order to decide simultaneous combat.
- Do not attach final game semantics directly to raw MediaPipe callbacks.
- Do not add large smoothing windows without measuring added commit latency.
- Do not queue every captured frame.
- Do not allow stale movement state to accumulate in WebSocket/application buffers.
- Do not place persistence, analytics, or external calls in the match tick.
- Do not make rollback replay audiovisual side effects blindly.
- Do not invent gestures, thresholds, approved objects, or weapon mappings.
- Do not change transport-specific code outside the transport adapter.
- Add timestamps, metrics, deterministic fixtures, and impairment tests with every hot-path feature.
- If a requirement is ambiguous, record it as an explicit decision rather than silently selecting behavior.

---

## 19. Acceptance criteria

The latency architecture is complete when:

- [ ] Webcam inference is local and at most one inference is in flight.
- [ ] Superseded frames are dropped, and source-frame age is measured.
- [ ] Gesture decisions are timestamp-aware and state-machine based.
- [ ] Every impulse has a unique action ID and emits at most once.
- [ ] Held inputs have start/end/reset recovery semantics.
- [ ] The local avatar reacts without awaiting a server acknowledgement.
- [ ] The server owns hits, damage, health, and round results.
- [ ] Inputs and snapshots carry sequence/frame identifiers.
- [ ] Simulation replay is deterministic under automated tests.
- [ ] Prediction and reconciliation are implemented.
- [ ] Rollback resolves late material inputs within a bounded window.
- [ ] WebSocket buffers and all internal queues are bounded and observable.
- [ ] p50/p90/p95/p99 stage latency is available by device and match.
- [ ] Network impairment, browser stall, tracking loss, and gesture ambiguity tests pass.
- [ ] Irreversible effects are authoritative or safely deduplicated.
- [ ] The transport adapter can support a later WebRTC/WebTransport experiment.
- [ ] Object detection remains disabled until an allowlist and mappings are approved.

---

## 20. Research basis

The architecture above uses the following primary or authoritative sources:

1. [Google AI Edge: Pose landmark detection guide](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker/) — MediaPipe Pose Landmarker modes, outputs, configuration, and live-stream behavior.
2. [Google AI Edge: Pose Landmarker Python guide](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker/python) — asynchronous live-stream processing and the behavior when a detector is already busy.
3. [MDN: WebSocket API](https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API) — browser WebSocket behavior, including the classic interface’s lack of backpressure.
4. [W3C: WebRTC specification](https://w3c.github.io/webrtc-pc/) — browser real-time communication and RTCDataChannel APIs.
5. [MDN: RTCDataChannel `ordered`](https://developer.mozilla.org/en-US/docs/Web/API/RTCDataChannel/ordered) — unordered delivery configuration.
6. [MDN: RTCDataChannel `maxRetransmits`](https://developer.mozilla.org/en-US/docs/Web/API/RTCDataChannel/maxRetransmits) — bounded retransmission configuration.
7. [W3C: WebTransport](https://www.w3.org/TR/webtransport/) — streams and datagrams over an HTTP/3-based transport API.
8. [IETF RFC 9221: Unreliable Datagram Extension to QUIC](https://www.rfc-editor.org/rfc/rfc9221.html) — unreliable datagram semantics over QUIC.
9. [GGPO](https://github.com/pond3r/ggpo) — rollback networking design based on speculative execution, prediction, rollback, and resimulation.

### Final recommendation

Build the first complete version on **WebSockets**, but design for transport replacement. Hyperoptimization should proceed in this order:

1. keep webcam inference local;
2. eliminate stale frame and work queues;
3. make gesture decisions early but stateful and robust;
4. show local predicted feedback immediately;
5. make combat deterministic;
6. add reconciliation and rollback;
7. profile server scheduling and regional RTT;
8. only then evaluate an unordered/partially reliable WebRTC DataChannel or WebTransport datagram hot path.

This order attacks the largest controllable delays first and prevents a transport rewrite from disguising unresolved perception or simulation defects.
