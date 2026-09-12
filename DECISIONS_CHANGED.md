# Decisions Changed From the Original Docs — Review Sheet

Date: 2026-09-12. Every row is a place where the build plan differs from at least one original document.
"Original" is what the docs said; "Now" is what the plan builds. Owner initials the last column to approve,
or writes the correction.

Source of truth after review: `docs/superpowers/plans/2026-09-12-midnight-express-mvp.md` and
`HackCMU 2026/design/`. Full reasoning: `HackCMU 2026/docs/2026-09-12-doc-audit-and-stack.md`.

## Combat mechanics

| # | Topic | Original (which doc) | Now | Why | OK? |
|---|---|---|---|---|---|
| 1 | Player movement | 3 lanes, fixed x=130/870, dodge = lane change (Combat 01) | Free horizontal walk at 180 px/s, jump apex the drawn character height (~151 px; was 120 px, raised on the owner's request 2026-09-12), no lanes, fighters always face each other | Owner D1; design merge | |
| 2 | Dodging | DODGE_LEFT/RIGHT with i-frames ticks 3–7 (Combat 01) | Jump is the only evade. **Jump grants i-frames on ticks 3–10 after takeoff** (tunable `JUMP_IFRAME_START/END`); hits during that window are ignored and the rig draws a ghost trail | Owner, round 4: "we do want i frames" | |
| 3 | Attacks | 5 object abilities, no punches (Combat 01) / punches only (VisFighter) | Punches only: punchL and punchR, identical frame data. 3 weapon slots reserved as `null` | Owner D3 | |
| 4 | Punch frame data | 4/3/8 ticks at 60 Hz (VisFighter), 8 damage, chip 2 | 4/3/8 ticks, **12 damage, chip 3** | HP dropped to 40, so 12 = about 4 clean hits per round | |
| 5 | Health | 100 HP (all docs) | **50 HP** (was 40; owner retune 2026-09-12) | Owner, round 2; then "bring health up to 50" after the LAN test | |
| 6 | Hit detection | Projectile swept segment vs lane (Combat 01) | Axis-aligned overlap of the punch hitbox (70 × 60 in front of the fist, active ticks only) with the opponent hurtbox (72 × 140). One hit per punch. Same-tick trades both land | Owner D6 "hitbox around sprites, overlap deals damage" | |
| 7 | Block | BLOCK_START = fixed 600 ms status with cooldown, 70% reduction (Combat 01) | Held while gesture or key is held, grounded only, no cooldown. Blocked punch deals flat chip 3, no hitstun | Owner D5; chip is simpler than a percentage at 50 HP | |
| 8 | Hitstun and knockback | None (Combat, "no knockback") / 12 ticks, ~2 widths (VisFighter) | 12 ticks hitstun, 144 px knockback over the stun. A hit cancels the target's punch and block | VisFighter rule adopted | |
| 9 | Mid-air | n/a | Punch allowed mid-air; block not | VisFighter rule adopted | |
| 10 | Out of bounds | none (Combat) / "damage over time, 3 HP per 30 ticks" (Design, NEEDS SIGN-OFF) | Hard edge clamps at x=0/960; 3 HP per 30 ticks while at the edge; always recoverable | Design proposal accepted by default | |
| 11 | Match format | One 45 s match (Combat) / best of 3 × 60 s (VisFighter) | **Best of 3, 30 s rounds, first to 2.** Timer expiry: higher HP wins; equal HP = draw round scored for both; 2–2 after round 3 = match draw | Owner D6 | |
| 12 | Train events | Tunnel at 20 s left, Final Car at 10 s left, with damage multipliers and cooldown reset (Combat 01) | Round 1 standard, round 2 tunnel, round 3 final car. **Visual only, no rule effect** | 30 s rounds killed the timers; no abilities to multiply. Pushback P6 accepted | |
| 13 | Baggage Scan, object kits, YOLO | Locked in Combat 00/03 | **Removed.** MediaPipe Pose only. `weaponSlots` and a projectile `height` band are reserved in the types | Owner D7, D3, P3 | |
| 14 | Roster | none / 3 identical (VisFighter) | Drifter (P1) vs Conductor (P2), identical stats, different rig | Design | |
| 15 | World | 1000 × 480 (Combat) / 320 × 180 (VisFighter) | 960 × 540, ground at y=430, spawn x=280/680, hurtbox 72 × 140 | Design | |

## Netcode and architecture

| # | Topic | Original | Now | Why | OK? |
|---|---|---|---|---|---|
| 16 | Tick rate | 30 Hz server (Combat) / 60 Hz (VisFighter, Scaffold) | 60 Hz | Frame data is authored at 60; costs nothing on one server | |
| 17 | Where the sim runs | Server only, thin client (Combat) / both peers in lockstep (VisFighter) / both with rollback (Scaffold) | **Server only.** Client renders snapshots 50 ms behind, interpolated, and starts its own punch pose early as a cosmetic hint | Owner accepted P1: LAN RTT is under 10 ms so prediction buys nothing in 15 h | |
| 18 | Snapshots | 15 Hz (Combat) | 30 Hz, full state, events bundled | Smoother interpolation, still tiny | |
| 19 | Wire input | Discrete events BLOCK_START/DODGE/POWER, 20 per s (Combat) / held InputFrame polled (VisFighter) | **Whole 6-boolean `InputFrame` sent on change plus a 100 ms heartbeat, with a sequence number.** Server keeps the latest per player; the sim does edge detection | Owner accepted P2; deletes the unowned adapter | |
| 20 | Authority | Server (Combat) / trusted peers (VisFighter) | Server | Owner D2 | |
| 21 | Reconnect tokens, 15 s grace | Combat 02 | **Dropped.** Opponent disconnect ends the match, room returns to lobby | 15 h budget | |
| 22 | Hosting | HTTPS cloud origin (Combat) / plain-http LAN relay (VisFighter) | Laptop-hosted Node server over HTTPS with a self-signed cert on the LAN. Camera requires a secure context, so plain http was a hidden failure | Owner D8 | |
| 23 | Repo layout | 5 different layouts | pnpm workspace `packages/{shared,server,client}` in this repo | Audit C7 | |
| 24 | Rollback, telemetry, regions, accounts | Scaffold and Handbook | Not built. Those two docs are principles only | Owner D14 | |

## Vision

| # | Topic | Original | Now | Why | OK? |
|---|---|---|---|---|---|
| 25 | Gesture set | wrists-above-shoulders block and power, nose-offset dodge (Combat 03) | Walk = lean, jump = physical hop, block = crossed arms, punch = thrust toward camera per arm (Controls doc) | Combat's block and power were the same pose; Controls is the detailed spec | |
| 26 | Calibration | silent (VisFighter) / explicit prompted (Controls) | Explicit prompted screen | Owner D11 | |
| 27 | Hand Landmarker, fists, guard block | Controls phases 4 | Deferred to `docs/superpowers/plans/2026-09-12-hands-stretch.md`. Punch uses the no-hand depth rule | Owner P4 | |
| 28 | Language | plain JS + JSDoc (Controls) | TypeScript inside `packages/client/src/vision` | Owner D12 | |
| 29 | Keyboard | P1 keys A/D/W/S/F/G, P2 arrows (VisFighter) | A/D/W/S/F/G only; each laptop is one player. Keyboard always works alongside the webcam | Two-laptop only | |

## Art and UI

| # | Topic | Original | Now | Why | OK? |
|---|---|---|---|---|---|
| 30 | Art source | Ludo.ai sprite sheets, atlas pipeline (Design 03/06/07/08) / procedural pixel art (VisFighter) | **Everything drawn in code**: skeleton rig whose pose is a function of sim state, generated parallax textures, Graphics effects. Design 03/06/07/08 deleted, 02/04/05 rewritten | Owner, round 3 | |
| 31 | Art style | Illustrated painted 2D (Design) | Procedural vector: flat fills, thick outlines, cool base with warm rim stroke, same palette | Consequence of 30 | |
| 32 | UI framework | React + Canvas 2D (Combat) / Phaser (VisFighter) | Phaser for the arena and HUD, plain DOM for lobby, calibration and result | Owner D13 delegated | |
| 33 | Sound | none | Stretch only, Web Audio blips, no files | Budget | |

## Still open (need an answer before the relevant phase)

| # | Question | Default if unanswered |
|---|---|---|
| A | Punch hitbox reach 70 px and punch damage 12 at 50 HP: keep, or tune after the first keyboard match? | Keep, tune in reserve |
| B | Timer draw round scores for both players (so 1–1 after a draw). Alternative: replay the round. | Score both |
| C | Winner keys or rematch flow: rematch returns both to lobby ready state. | Lobby |

## Expansion (owner directive, 2026-09-12 session 2: "go, no intervention")

The owner asked for these features in one message and told the planning agent not to wait for approval. Rows
34–48 record the choices the agent made inside that directive. "OK?" is still the owner's column; an unticked row
is a decision taken under the directive, not an unreviewed guess. Spec: `docs/superpowers/specs/2026-09-12-mayhem-expansion-design.md`.

| # | Topic | Was (rows above) | Now | Why | OK? |
|---|---|---|---|---|---|
| 34 | Object detection | Removed (13); "prefer MediaPipe Object Detector over YOLO when re-added" | **Re-added, two tracks.** Track 1 (9.04): MediaPipe `ObjectDetector` (EfficientDet-Lite0) in the pose worker, ships first. Track 2 (9.07): YOLO on `onnxruntime-web` behind the same interface, `?detector=yolo`, plus a benchmark page; **Owner decision 2026-09-12 12:00 after the real-object test: YOLO is the default; `?detector=mediapipe` restores the original.** (Benchmark: YOLOv10n 10 ms WebGPU / 42 ms wasm vs MediaPipe 26 / 42 ms; 9/20 vs 7–8/20 on real photos) | Owner (session 2, follow-up): "try both… I do want to use YOLO if we can because of accuracy". MediaPipe first because it is verifiable unattended; YOLO judged on measured numbers | |
| 35 | InputFrame | Frozen six booleans (19) | Gains `special: boolean` (laser) and `item: ItemId \| null` (held object). Protocol v2 | Owner asked for both; one frame keeps the seq/heartbeat path and the sim's edge detection | |
| 36 | Weapon slots | `weaponSlots` reserved as `[null,null,null]` (3) | Replaced by a pre-fight **loadout of 2** items plus one active `item` slot; laser is always available | Owner: "customize the 2 weapons/shield thing you can use in the fight before the fight" | |
| 37 | Items | none | molotov (bottle, 2 throws), sword (umbrella, 6 swings, parry window 10 ticks), shield (backpack, 3 hits), banana (peel trap, 1), flash (phone, 1, dazzles opponents 2 s). Numbers in `ARSENAL` | Owner named the first three; banana and phone are COCO classes with obvious mechanics | |
| 38 | Laser | none | Both arms thrust forward together / `Q`; charge 180 ticks (3 s), beam 16 ticks whose front travels 60 px/tick from the sprite's middle to the world edge in a 70 px band (half the sprite height) centred on the body, 20 dmg (chip 4), jumpable, 12 s cooldown. Owner retune 2026-09-12; was charge 30, instant full width, 60 px chest band, 10 dmg | Owner: "laser beam mechanic with a cooldown by putting your arms in a beam motion" | |
| 39 | Players | Exactly 2 (29) | 2, 3 (FFA) or 4 (FFA or 2v2). Facing = nearest living opponent; KO'd fighters stay down; rounds/timer decided per team | Owner: "3 or 4 players with free for all, with 3s and 4s teams of 2" | |
| 40 | Match format | Best of 3 × 30 s only (11) | Modes: `rounds` (unchanged default), `timed` (one 90 s round), `deathmatch` (no timer, KO) | Owner: "timed, free fight, etc" | |
| 41 | Stage geometry | Flat roof only (15) | Maps: `roof`, `gaps` (two pits, 8 dmg + respawn), `platforms` (two one-way racks at y 330), `chaos` (both). Geometry in `MAPS` | Owner: "small holes, elevated/floating surfaces like super smash bros" | |
| 42 | Roster | Drifter, Conductor (14) | Adds **The Stoker** and **Claude Code** (sunburst head, terminal torso, arms and legs). Duplicates allowed in a room | Owner asked for more characters and Claude Code specifically | |
| 43 | Art style | Procedural vector rig (30, 31) | **Pixel-art paper-doll**: hand-authored pixel grids (heads, torsos, hands, feet, items) + limbs rasterised from the existing skeleton poses, 3× nearest-neighbour. Still no image files. Vector rig kept behind `?rig=vector` | Owner: "detailed pixel art for the characters". Grids-in-code keeps the no-assets rule and reuses the tested pose system | |
| 44 | Stage motion | Parallax only (12, 30) | Wheels, sparks, smoke, telegraph poles, train bob, lightning, tunnel whoosh; gaps and racks drawn to match `MAPS` | Owner: "the train isn't moving, neither does the background" | |
| 45 | Sound | Stretch, blips only (33) | Full procedural Web Audio set with a signature equip motif per item; `M` mutes; no files | Owner: "special sound effects should sound" on equip | |
| 46 | Lobby / landing | Plain DOM join form (32) | Landing page with the live stage and four idling fighters behind it; lobby with character pick, loadout pick, host controls (players, teams, mode, map, items). `frontend-design` skill required | Owner: "very midnight express themey… very visually engaging… customize characters" | |
| 47 | Server | 2 slots (21) | 4 slots, `config.players` decides how many must be in and ready; host = lowest slot; `CONFIG` host-only; `CUSTOMIZE` per player | Consequence of 39, 46 | |
| 48 | Execution | Four worktrees on one machine (STATUS) | Contracts feature alone, then 13 parallel worktree lanes with disjoint file ownership, then integration, then parallel review and fixes — all agent-run, no owner gates until the end | Owner: "launch a dynamic workflow to implement all of these features in parallel… I don't want to intervene" | |
| 49 | Action mobility | Any action zeroes `vx` and refuses a jump while grounded; the laser needs `grounded` to start (9.03 rule 6, 9.08 rule 4) | **Only a punch (or a block) pins a fighter.** The laser and the charged throw are charged, fired and recovered while walking or jumping at full `WALK_SPEED`, the laser can start in mid-air, and facing tracks through a charge and commits when the beam fires or the throw releases. No future action is gated on movement (`actionLocksMovement` is the single gate). Spec: `implementation-docs/09-arsenal/10-mobile-actions.md` | Owner 2026-09-12: "make it so that players can charge up their special while they are still moving, and use it while they are still [moving]"; follow-up: "yes both, and all future actions shouldn't be gated by movement" | |
