> **SUPERSEDED 2026-09-12.** This document is historical. The build follows `DECISIONS_CHANGED.md` (root) and `docs/superpowers/plans/2026-09-12-midnight-express-mvp.md`. Where this file disagrees with them, they win. Kept for reference only.

# Edge Cases and Bottlenecks

## Integration-owner cut rule

At every 60–90 minute checkpoint, the integration owner runs the protected two-browser vertical slice. If a new feature, CV change, or partner merge breaks it, revert that feature from the demo branch or gate it behind a flag. A reliable keyboard match is always more valuable than an unverified enhancement.

## Mandatory failure behavior

| Condition | Exact behavior |
|---|---|
| Browser lacks camera / permission denied | Set `visionAvailable=false`; leave keyboard controls enabled; never block ready state. |
| YOLO model load or inference fails | Log one client error, stop scan, display fallback cards only when demo flag is on; otherwise cancel scan with no slot change. |
| WebSocket closes in `PLAYING` | Freeze local input, retain last snapshot, display reconnecting; do not locally decide winner. |
| Snapshot version skips forward | Replace visible public state immediately; never apply an older version. |
| Server receives action at exact cooldown end tick | Accept when `currentTick >= cooldownEndsAtTick`. |
| Invalid or late scan token | Send `ERROR(SCAN_TOKEN_INVALID)`; client removes scanning UI and does not retry. |
| Server tick falls behind | Run at most 5 catch-up ticks in one event-loop pass; reschedule the remainder. |

## Gameplay edge cases

| Risk | Failure mode | Required mitigation |
|---|---|---|
| Duplicate CV gesture | one pose creates several powers | monotonic sequence numbers, local state machine, server cooldowns |
| Player holds a block pose | permanent damage immunity | fixed 600 ms block duration and server cooldown |
| Dodge at lane edge | invalid lane -1 or 3 | reject invalid adjacent lane before state mutation |
| Projectile tunnels | fast object crosses hurtbox between ticks | swept segment-vs-expanded-AABB collision |
| One attack hits repeatedly | projectile overlaps across several ticks | `hitPlayerIds` per attack instance |
| Scan while being hit | scan gives immunity or corrupts status | scanning remains damageable; server may cancel scan on stun |
| Scan result arrives late | item appears after scan window | token expiry checked by server tick |
| Slot overflow | player has four or more kits | deterministic replacement of oldest slot |
| Both players die same tick | ambiguous winner | declare draw; render a “mutual derailment” state |
| Match timer ends during active attack | late hit changes winner unexpectedly | process active attacks for the final tick, then resolve winner |
| Both attacks activate in one tick | one player gets an invisible network advantage | create every same-tick attack before collision; allow a draw |
| Source collides with own projectile | self-damage through shared collision code | exclude `sourcePlayerId` from every attack target list |

## Networking edge cases

| Risk | Required mitigation |
|---|---|
| Out-of-order packets | sequence numbers; ignore stale inputs and snapshots |
| Repeated packets | process each sequence once only |
| Jitter | clients interpolate snapshots; combat truth remains server-side |
| Server pause | tick accumulator with capped catch-up; never simulate unlimited backlog |
| Player disconnect | 15-second reconnect window plus visible pause/forfeit state |
| Connection opens late | do not allow ready state until `socket.connected` and a snapshot arrives |
| Large messages block controls | never transmit video, frames, or raw landmarks |

## CV bottlenecks

| Risk | Required mitigation |
|---|---|
| Detector and pose model compete for GPU/CPU | run one active model at a time |
| Dark venue lighting hurts object recognition | use five controlled demo objects with high-contrast backgrounds; confirmation UI |
| Camera is too far away | calibration screen: shoulders and hands must fit in guide frame |
| Pose misfires on unrelated movement | require dwell time and edge-trigger state machine |
| Browser blocks camera | deploy HTTPS; request permission during explicit “Enable Camera” click |
| Model cold start | preload models at the lobby and wait for ready state before allowing match start |
| Scan object hides hands/upper body | disable pose intent processing during `SCANNING`; resume after scan result or expiry |

## Product bottlenecks

| Risk | Cut or mitigation |
|---|---|
| CV is impressive but combat is not fun | finish button-controlled combat before CV integration |
| Object recognition is unreliable | narrow to controlled categories and Mystery Parcel fallback |
| Players cannot understand power kits | show one-line card and three-second tutorial before round start |
| Too much visual information | keep HUD to HP, three slots, timer, train car, and one status label |
| Demo Wi-Fi fails | pre-open two deployed clients; keep one keyboard-controlled local fallback match ready |

## Non-negotiable performance budget

```text
Pose inference: 15–20 FPS
Object scan: 4–8 FPS, for at most 1.5 seconds
Render: 60 FPS
Server tick: 30 Hz
Snapshots: 15 Hz
Input payload: under 200 bytes
No video transport
```
