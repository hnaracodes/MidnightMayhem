# Documentation Audit and Tech Stack Proposal

Date: 2026-09-12
Status: awaiting owner decisions. Nothing below is decided until the owner answers the decision register at the end.

## Sources audited

| Set | Location | Game it describes |
|---|---|---|
| Scaffold | `Webcam_Fighter_Engineering_Scaffold.md` | Generic side-view fighter, 60 Hz deterministic sim, server authority plus client prediction, optional rollback, 8-package monorepo, gestures and objects TBD |
| Handbook | `WEBCAM_FIGHTER_LATENCY_FAILURE_HANDBOOK.md` | Same as Scaffold, focused on latency and failure modes |
| Combat | `COMBAT_GAMESTATE_DOCS/` | "Last Car Clash": 3 lanes, fixed positions, no jump, 30 Hz server-only sim, 15 Hz snapshots, 45 s single match, 5 YOLO object kits, React + Canvas 2D |
| VisFighter | `/Users/hrudaynara/Projects/HackCMU/VisFighter/CLAUDE.md` (sibling repo, scaffold only) | "Body Fighter": side-view pixel art 320x180, 60 Hz pure `step()`, delay-based lockstep over a dumb LAN relay, Phaser 3, best of 3, 6-boolean InputFrame, no weapons |
| Controls | `controls/phases/` | Standalone vision layer, plain JS + JSDoc, Web Worker inference, explicit calibration, emits the same 6-boolean InputFrame |
| Design | `design/` | "Midnight Express": 960x540 illustrated, Drifter vs Conductor, free walk + jump, no lanes, weapons in, Phaser atlas pipeline, Ludo art generation |

The design folder is the newest and already flags several of these conflicts as `NEEDS SIGN-OFF`. It states "current design wins" but does not have authority over rules.

## Part 1: Cross-document conflicts (owner decision required)

### C1. Movement model
- Combat: 3 lanes, players pinned at x=130 and x=870, dodge = lane change with i-frames, no jump, no knockback.
- VisFighter and Design: free horizontal walk, jump, knockback, hit-stun, no lanes, out-of-bounds damage.
- Scaffold: side view with movement, blocking, hitstun, knockdown.

Cascades into: collision code, `PlayerState` shape (lane vs x/y/vx/vy/facing), the vision intent set (DODGE_LEFT/RIGHT vs walk/jump), ability types (lane strike/zone vs arc/ground), hurtbox size, world size, and the netcode (see C3).

### C2. Input model: discrete events vs held booleans
- Combat: discrete intents `BLOCK_START | DODGE_LEFT | DODGE_RIGHT | POWER_USE | SCAN_START`, one INPUT message each, rate limit 20/s, block is an 18-tick timed status.
- VisFighter and Controls: `InputFrame` = 6 held booleans sampled every tick, sim does edge detection, block is held.
- Scaffold and Handbook: semantic events with start/hold/release phases plus a movement axis.

Free movement (C1) needs continuous input. The 20/s discrete-event design assumed no movement. Nobody owns the adapter between held booleans and wire messages (see G6).

### C3. Simulation rate and where simulation runs
- Combat: 30 Hz on the server only. Client renders 15 Hz snapshots and predicts only its own animation and cooldown UI.
- VisFighter: 60 Hz pure `step()` on both clients in lockstep, no server simulation.
- Scaffold and Handbook: 60 Hz deterministic sim on client (prediction, rollback) and server (authority).
- Design: frame data quoted at 60 Hz (punch 15 ticks = 250 ms) and flags that 30 Hz makes it 500 ms.

Three distinct netcode architectures. This is the largest single engineering decision and it fixes the package layout.

### C4. Authority
- Combat and Scaffold: server decides everything, non-negotiable.
- VisFighter: relay does no simulation, both peers trusted.

### C5. Renderer
- Combat: Canvas 2D plus React, "do not add a game engine".
- VisFighter and Design: Phaser 3. The entire design pipeline (atlas JSON, `setOrigin(0.5, 0.9375)`, `TileSprite` parallax, `setFrame` phase animation) assumes Phaser.
- Scaffold: Phaser candidate, record in ADR.

### C6. Language for the vision layer
- Controls: plain JavaScript with JSDoc, `tsc` `checkJs`, "No .ts files".
- Everything else: TypeScript strict.
No controls code exists yet, so choosing TS now costs nothing.

### C7. Repository layout (five different ones)
- Scaffold: `apps/web`, `apps/match-server`, `packages/{protocol,simulation,perception,gestures,renderer,telemetry,shared-config,test-harness}`.
- Combat README: flat `client/`, `server/`, `shared/`, `tests/` with `server/src/handlers.ts`.
- Combat 05/06/08: pnpm workspace `packages/{client,server,shared}` named `@last-car-clash/*` with `ws.ts` and `validate.ts`.
- VisFighter: single Vite app at root, `src/{input,core,game,net,vision}`, `server/relay.ts`.
- Controls: standalone repo `src/{input,vision,harness}`.
- Design: writes to `VisFighter/public/assets/` and `design/tools/build-atlas.mjs`.

### C8. Gesture vocabulary (three sets, plus internal conflicts)
- Combat: block = both wrists above shoulders (5 frames); power = both wrists above shoulders (8 frames); dodge = nose offset 0.18 or 0.25 shoulder widths.
- VisFighter: walk = lean, jump = wrists above head, punch L/R = thrust toward camera plus fist, block = crossed arms. Automatic silent baseline, no calibration screen.
- Controls: walk = lean, jump = physical hop, punch L/R = thrust plus fist, block = crossed arms OR guard (fists up at face). Explicit prompted calibration.
- Scaffold: open decision D1.
VisFighter and Controls disagree on jump and on calibration even though they share a contract.

### C9. Objects and weapons
- Scaffold and Handbook: disabled until allowlist decided (D5, D6).
- Combat: 5 COCO classes locked. README/03/08 lock YOLOv8n ONNX via onnxruntime-web; 00 says "YOLO nano or MediaPipe Object Detector, choose after benchmark".
- Design: weapons in, proposes a 6th class umbrella to sword.
- VisFighter: no weapons.
Undefined: does the merged game have bare-hand punches (VisFighter) AND 3-slot object abilities (Combat)? Design says "the character's punch plus the weapon's fire covers it", which implies both exist, but Combat has no punch at all.

### C10. Match structure
- Combat: one 45 s match, 100 HP, draw on equal HP, Tunnel at 20 s left, Final Car at 10 s left.
- VisFighter: best of 3, 60 s rounds, 100 HP.
Train events are tuned to a 45 s single match.

### C11. Roster
Combat: none. VisFighter: 3 identical. Design: 2 (Drifter, Conductor). Design closes this; rules docs need updating.

### C12. World size and hurtbox
Combat 1000x480, hurtbox 90x120. VisFighter 320x180. Design 960x540, hurtbox 72x140.

### C13. Block mechanics
- Combat: BLOCK_START triggers a fixed 600 ms status with cooldown, reduction `ceil(raw * 0.30)`.
- VisFighter: held while true, grounded only, chip damage 2 of 8.
Timed-vs-held is the real conflict; the percentage is minor.

### C14. Deployment and secure context
- Combat: one deployed HTTPS origin serving client and `/ws`, reconnect tokens, 15 s grace.
- VisFighter: relay on one laptop, plain http over LAN IP.
Hidden error: `getUserMedia` only works on `localhost` or HTTPS. The non-host laptop in the VisFighter plan cannot open its camera. Dev over LAN needs HTTPS (for example `@vitejs/plugin-basic-ssl`) or a tunnel.

## Part 2: Hidden errors inside single document sets

### Combat docs
- E1. Two message-name sets in `02`: envelope uses `JOIN/LOADOUT/READY/INPUT/SCAN_RESULT/PING` and `JOINED/SNAPSHOT/EVENT/ACK/ERROR/PONG`; the tables in the same file use `room:join`, `loadout:confirm`, `match:ready`, `scan:result`, `client:ping`, `snapshot`, `event`, `ack`, `error`. Gate 1 says "names exactly as written in 02".
- E2. Reconnect budget does not close: client waits 12 s of silence, then backs off 250+500+1000+2000+4000 ms = 7.75 s. Worst case 19.75 s, but the server forfeits at 15 s (450 ticks).
- E3. Scan fallback cards appear at tick 45, which is exactly when the scan token expires. Any card submission is rejected with `SCAN_TOKEN_INVALID`. Also `03` says both "show fallback cards" and "if scan expires: submit nothing".
- E4. Scan confidence threshold is 0.55 in `GAME` and the YOLO section, 0.65 in the scan adapter section. Auto-submit on confirmation vs "show the result for explicit confirmation before submitting".
- E5. `ObjectClass` casing: lowercase `bottle` in the label map, uppercase `"BOTTLE" | ... | "UNKNOWN"` in the type.
- E6. Block and Power are the same pose (both wrists above shoulders), distinguished only by dwell (5 vs 8 frames). Block always fires first, so "power ... while not blocking" can never be satisfied. Dwell is also listed in ms (150/120/250) that do not match the frame counts at 15 to 20 FPS. Dodge threshold is 0.18 in prose and 0.25 in the table.
- E7. Loadout: `LOADOUT` carries one `objectClass`, but players initialize with "three seeded slots". What fills the other two slots is undefined.
- E8. Balance values an agent would have to invent: windup/active/recovery/cooldown per ability, projectile speed and half-width, Cargo Slam "long cooldown", Sonic Tunnel stun length, Steam Screen "dodge bonus", zone `affectedLanes`, Tunnel multiplier rounding (10 x 1.25 = 12.5), timer-end winner rule.
- E9. Tick loop order differs between `02` (expire statuses first, version at step 9) and `08` (increment tick first).
- E10. Dev origin: checklist opens `localhost:5173` (Vite) but the server serves the built client and `/ws` on one origin. No Vite proxy for `/ws` is specified.
- E11. `createOrJoin({ roomId? })` is optional in the adapter but `JOIN.roomId` is required. Who generates a room id is unspecified.
- E12. YOLOv8n weights are AGPL-3.0 and need an ONNX export step that no doc provides. `onnxruntime-web` is a second inference runtime alongside MediaPipe. MediaPipe Object Detector (EfficientDet-Lite0, Apache 2.0) ships in `@mediapipe/tasks-vision`, which is already loaded, and covers all five COCO labels plus umbrella.
- E13. "Three partner specifications" are assumed to be owned by other people. The current setup is one owner plus agents.

### Scaffold and Handbook
- E14. Eight packages, telemetry, region selection, accounts, rollback, M0 to M8: weeks of work. Design calls this a "24-hour build". The Scaffold needs to be demoted to principles or it will drive agents to build telemetry packages before a punch lands.
- E15. Handbook `ActionCode` (MOVE_AXIS, PUNCH, KICK, BLOCK_START/END, CROUCH, JUMP) is a fourth input vocabulary.

### VisFighter and Controls
- E16. Jump: hop (Controls) vs wrists above head (VisFighter). Calibration: explicit (Controls) vs silent (VisFighter). Guard block exists only in Controls.
- E17. Controls' README plan sends `sample()` at 60 Hz over WebSocket; Combat rate-limits inputs to 20/s.
- E18. Two frozen contract files, `InputFrame.js` and `InputFrame.ts`, both "never edit".

### Design
- E19. Ludo pipeline points Chrome downloads at `/Users/hrudaynara/Downloads/HackCMU 2026/design/raw`. The repo is at `/Users/hrudaynara/Projects/MidnightMayhem/HackCMU 2026/design/raw`. The Downloads path does not exist.
- E20. `07` rsyncs atlases to `VisFighter/public/assets/`, a different repo in a different folder.
- E21. Out-of-bounds damage "3 HP per 30 ticks" exists in no rules doc.
- E22. Design `README` says `VisFighter/CLAUDE.md` specifies "no weapons" (correct) and pixel art 320x180 (correct), and is the source of 60 Hz frame data. VisFighter is scaffold-only with no implemented code.

## Part 3: Gaps in reasoning

- G1. Free movement with Combat's thin-client model puts your own walking at snapshot latency (15 Hz plus RTT). Choosing free movement forces either lockstep or client-side prediction of the local fighter. Combat explicitly avoids both.
- G2. Lockstep with a 3-tick delay at 60 Hz means 50 ms input delay and stalls whenever RTT exceeds that. Fine on a laptop-to-laptop LAN, uncertain on venue Wi-Fi. No doc measured or budgeted venue Wi-Fi.
- G3. 30 vs 60 Hz is framed as a feel question only. 60 Hz with 20 Hz snapshots costs nothing meaningful on a one-match server. Nothing forces 30.
- G4. Pose plus Hand plus YOLO is three models with two runtimes in one browser tab. `03` already says run only one model per frame; that constraint plus the license issue argues for MediaPipe Object Detector as the default.
- G5. `demoFallbackEnabled` and "production mode": there is no production. Simplify to one demo flag.
- G6. The edge-detection adapter from held `InputFrame` to wire messages is out of scope for Controls and assumed nonexistent by Combat. Nobody owns it.
- G7. No hackathon date or remaining hours appears in any doc. This drives every scope decision.
- G8. React is specified for lobby and HUD, Phaser for the arena. Two UI frameworks for a HUD of HP, 3 slots, timer, and a status label. Plain DOM over the Phaser canvas is enough.
- G9. `pnpm` is not installed on this machine (Node 22.23.2 is). VisFighter pins `pnpm@12.4.1`; Combat says pnpm 9.

## Part 4: Tech stack proposal (not final until confirmed)

| Layer | Proposal | Why | Replaces |
|---|---|---|---|
| Runtime | Node 22 LTS, pnpm 10.x via corepack | Installed Node is 22; pin one pnpm | Node 20.11 / pnpm 9 / pnpm 12 |
| Language | TypeScript strict everywhere, including vision | One type system, shared types, no JSDoc port later | Controls' plain JS rule |
| Layout | pnpm workspace: `packages/shared` (types, zod schemas, constants, pure sim), `packages/server`, `packages/client`, `design/` kept as-is | Matches Combat 05; VisFighter and Controls fold into `client/src/vision` and `shared/sim` | Scaffold's 8 packages, flat layout, separate repos |
| Sim | Pure deterministic `step(state, inputs)` in `shared`, 60 Hz, integer positions | Runs identically on server and client; design frame data is at 60 Hz | 30 Hz server-only |
| Netcode | Server-authoritative; server runs `step` at 60 Hz, sends snapshots at 20 Hz; client runs `step` for its own fighter (prediction) and reconciles from snapshots; opponent interpolated; no rollback | Keeps Combat's authority and scan tokens, gets VisFighter's movement feel, stays well short of Scaffold's rollback | Lockstep relay, thin client |
| Transport | `ws` 8 + `zod` 3, JSON, one HTTPS origin, `/ws` | Unchanged from Combat | none |
| Renderer | Phaser 3.90; HUD and lobby as plain DOM over the canvas; no React | Design pipeline requires Phaser; one UI framework | Canvas 2D + React |
| Vision | `@mediapipe/tasks-vision` Pose + Hand in a Web Worker, per Controls design | Controls doc is the most detailed and correct spec | Combat's simpler gesture rules |
| Object scan | MediaPipe Object Detector (EfficientDet-Lite0) behind the scan adapter; YOLOv8n via onnxruntime-web only if the benchmark gate in Combat 00 fails | Same runtime, Apache 2.0, covers all six classes | Locked YOLO |
| Dev HTTPS | `@vitejs/plugin-basic-ssl` with `--host`; Vite proxy for `/ws` | Camera on the second laptop | Plain http LAN |
| Demo hosting | Decision D8 below | | |
| Tests | Vitest for `shared` sim and server protocol; harness page for vision (manual) | Combat + Controls agree | none |
| Art | Procedural rig and generated textures in code (superseded by Part 10) | No external tool risk | Ludo pipeline |

Alternative for netcode if remaining time is under roughly 24 hours: delay-based lockstep over a relay (VisFighter). Less code, best feel on LAN, but no server authority, no scan tokens, and stalls on bad Wi-Fi.

## Part 5: Decision register (owner answers required)

| ID | Question | Options | My recommendation |
|---|---|---|---|
| D1 | Which game? | (a) Design merge: free walk + jump, no lanes, weapons, 2 characters, Midnight Express (b) Combat as written: 3 lanes (c) VisFighter as written: no weapons | (a) |
| D2 | Netcode architecture | (a) server-authoritative 60 Hz with client prediction, no rollback (b) lockstep relay (c) thin client 30 Hz | (a), or (b) if under 24 h |
| D3 | Do bare-hand punches and object abilities both exist? | (a) both: punch always available, abilities in 3 slots on POWER (b) abilities only (c) punches only | (a) |
| D4 | Input vocabulary on the wire | (a) held InputFrame edges converted to events by a client adapter, plus continuous move axis (b) Combat discrete events only | (a) |
| D5 | Block: held or timed? | (a) held while gesture holds, grounded only (b) 600 ms timed | (a) |
| D6 | Match format | (a) one 45 s match with Tunnel/Final Car (b) best of 3 x 60 s | (a) for demo length |
| D7 | Object detector | (a) MediaPipe Object Detector default, YOLO fallback (b) YOLOv8n ONNX locked | (a) |
| D8 | Demo hosting | (a) one laptop runs server, exposed via HTTPS tunnel (cloudflared or ngrok) (b) cloud container (Fly.io, Railway, Render) (c) LAN only with self-signed dev cert | (b) if internet at venue is reliable, else (a) |
| D9 | Sixth object class umbrella to sword | yes / no | yes, one label-map line |
| D10 | Jump gesture | (a) physical hop (Controls) (b) wrists above head (VisFighter) | (a); user has not tested either |
| D11 | Calibration | (a) explicit prompted (Controls) (b) silent (VisFighter) | (a) |
| D12 | Vision layer language | (a) TypeScript in the monorepo (b) plain JS separate repo as Controls says | (a) |
| D13 | Renderer and UI | (a) Phaser + plain DOM HUD (b) Phaser + React (c) Canvas 2D + React | (a) |
| D14 | Fate of Scaffold and Handbook | (a) demote to "principles" docs, not build plans (b) keep as build plans | (a) |
| D15 | Hackathon deadline and hours left | free text | needed before scoping |
| D16 | Open balance numbers from E8 | supply or let the plan propose starting values marked tunable | plan proposes, marked tunable |

Combat-doc internal errors E1 to E11 are resolved mechanically once D1 to D5 are answered and will be fixed in the docs as part of the plan.

## Part 6: Owner answers, round 1 (2026-09-12)

| ID | Answer |
|---|---|
| D1 | Design merge (free walk + jump, no lanes for players). No weapons initially, leave gaps. Three vertical lanes reserved for projectiles only. Ignore VisFighter branding; use Midnight Express. |
| D2 | (a) server-authoritative 60 Hz, client predicts own fighter, no rollback. **Pushback below.** |
| D3 | Punches only. Reserve 3 weapon slots for later. |
| D4 | (a) adapter converts held booleans to edge events plus move axis. **Pushback below.** |
| D5 | Held block. |
| D6 | Best of 3, 30 s rounds, health bars always visible, hitbox around sprites, overlap during punch active frames deals damage. |
| D7 | MediaPipe for body tracking only. No object detection now; YOLO reserved for the future. |
| D8 | Laptop-hosted game server. |
| D9 | Deferred. |
| D10 | Physical hop. |
| D11 | Explicit prompted calibration. |
| D12 | TypeScript in the monorepo. |
| D13 | Delegated: Phaser 3 for the arena, health bars and timer; plain DOM for lobby, calibration and result overlays; no React. |
| D14 | Scaffold and Handbook demoted to principles. |
| D15 | 15 hours. |
| D16 | Delegated: plan proposes starting values, all marked tunable. |

## Part 7: Pushbacks awaiting owner reply

P1. D2 netcode. Recommend thin client instead of client prediction: server runs the sim at 60 Hz, sends snapshots at 30 Hz, clients render interpolated snapshots and only start the local punch/jump animation early as a cosmetic hint. On a laptop-hosted server the RTT is 2 to 10 ms, so input-to-screen is about 50 ms, which is under the webcam pipeline's own 100 to 200 ms. Prediction plus reconciliation is roughly 3 hours of code and bugs that hide a delay nobody will see. Keep the interface so prediction can be added if measurements demand it.

P2. D4 wire input. Recommend sending the whole 6-boolean `InputFrame` on change plus a 10 Hz heartbeat, with a sequence number. The server keeps the latest frame per player and the sim does edge detection, exactly as the InputFrame contract already says. This deletes the unowned edge-detection adapter (G6) and makes keyboard, vision and network sources identical.

P3. D1 projectile lanes. Recommend reserving a `height: LOW | MID | HIGH` spawn field on the future projectile type, not a lane concept. With real y positions and jump, a projectile is just a moving hitbox; jumping over a LOW one falls out naturally.

P4. Vision scope for 15 hours. Recommend Pose Landmarker only for the MVP: walk by lean, hop, crossed-arms block, punch by thrust plus world-z depth using the no-hand fallback rule already in the Controls doc. Hand Landmarker, fist detection and the guard block become stretch work. Halves inference cost and removes the hardest tuning phase from the critical path.

P5. Art risk. Build the whole game on procedural placeholder sprites first (blocky figures on a canvas texture, same atlas contract). Ludo P0 generation runs in the owner's browser in parallel and drops in via the atlas build with no code change. If Ludo throughput fails, the demo still exists.

P6. Train events. With 30 s rounds the 20 s and 10 s triggers are gone. Recommend mapping them to rounds: round 1 standard, round 2 Tunnel, round 3 Final Car. Zero rule impact until weapons exist, pure backdrop change.

P7. Balance starting values (D16, delegated): 100 HP, punch damage 12 (about 8 landed hits per round), chip 3, startup 4 / active 3 / recovery 8 ticks, hit-stun 12, knockback 2 character widths, walk 180 px/s, jump apex 120 px in 30 ticks, out-of-bounds 3 HP per 30 ticks. All in one tunable file.

## Part 8: Round 2 answers (2026-09-12)

- P1 thin client: accepted. P2 whole-InputFrame on the wire: accepted. P3 projectile `height` field: accepted. P4 pose only, hands in a separate plan: accepted. P6 train car per round: accepted.
- Balance: MAX_HP changed to 40. Everything else as proposed.
- P5 art: owner is unsure Ludo is sufficient or reliable. Alternatives evaluated below.

## Part 9: Sprite animation tool alternatives

| Tool | How it animates | Identity consistency | Cost | Fit for this project |
|---|---|---|---|---|
| Ludo.ai (current) | Video model from one base image; 384 px frames, 1.5x upscale | Drifts between animations; the design docs' whole anchor pipeline exists to cope with it | $20/mo, credits, one job at a time | Already documented. Keep as primary only because the pipeline is written |
| Meta Animated Drawings (open source) | Auto-rigs one PNG, drives it with BVH motion capture, renders transparent frames | Perfect: it deforms the same image every time | Free, runs locally in Python | Best reliability. Mixamo has free BVH for idle, walk, jump, punch, hit, KO. Cut-out puppet look, stiffer than Ludo but never broken |
| PixelLab | Skeleton-controlled animation from a reference sprite, walk/attack presets | Good, skeleton driven; punch contact frame is controllable | Metered, ~$10+/mo | Pixel art only, 512 px cap. Would change the art direction from illustrated to pixel art |
| Scenario / direct image model (Nano Banana, GPT Image) | One generation returns a full 3x3 or 4x4 sprite-sheet grid from a reference image | Moderate, single generation so frames share one context | Per-image pricing, cheap | Fastest to try. Our `build-atlas` slices it. Good fallback per animation when Ludo credits run out |
| AutoSprite | Same approach as Ludo (video sliced to frames) | Drifts, per its own FAQ | Subscription | No advantage over Ludo |
| Mixamo + Blender toon render | 3D character, hundreds of animations, rendered to 2D | Perfect | Free | Most reliable, but a 3D pipeline and Blender scripting do not fit 15 hours |

Recommendation: build on procedural placeholders (no dependency on any tool), run Ludo P0 in parallel as planned, and set up Animated Drawings as the deterministic fallback for any animation Ludo fails twice. Try one single-generation sprite sheet from an image model early as a third option, since it costs minutes.

## Part 10: Round 3 decision, art (2026-09-12)

- Fighters, backgrounds and effects are drawn procedurally in code (Phaser Graphics), as a skeleton rig whose pose is a pure function of `FighterState`. No sprite sheets, no atlas loader, no external animation tool. Ludo is removed from all documentation.
- The design folder is rewritten as the spec for the procedural rig: palette, stage geometry, silhouettes, per-state pose rules, parallax layers, and code-driven feel all still apply. Files 03 (atlas), 06 (Ludo), 07 (post-process) and 08 (manifest) are deleted; 02, 04, 05 are rewritten.
- The `handAnchor` concept survives as the rig's wrist joint, which is where a future weapon is drawn.
