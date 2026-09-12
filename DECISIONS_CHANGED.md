# Decisions Changed From the Original Docs — Review Sheet

Date: 2026-09-12. Every row is a place where the build plan differs from at least one original document.
"Original" is what the docs said; "Now" is what the plan builds. Owner initials the last column to approve,
or writes the correction.

Source of truth after review: `docs/superpowers/plans/2026-09-12-midnight-express-mvp.md` and
`HackCMU 2026/design/`. Full reasoning: `HackCMU 2026/docs/2026-09-12-doc-audit-and-stack.md`.

## Combat mechanics

| # | Topic | Original (which doc) | Now | Why | OK? |
|---|---|---|---|---|---|
| 1 | Player movement | 3 lanes, fixed x=130/870, dodge = lane change (Combat 01) | Free horizontal walk at 180 px/s, jump 120 px apex, no lanes, fighters always face each other | Owner D1; design merge | |
| 2 | Dodging | DODGE_LEFT/RIGHT with i-frames ticks 3–7 (Combat 01) | Jump is the only evade. **Jump grants i-frames on ticks 3–10 after takeoff** (tunable `JUMP_IFRAME_START/END`); hits during that window are ignored and the rig draws a ghost trail | Owner, round 4: "we do want i frames" | |
| 3 | Attacks | 5 object abilities, no punches (Combat 01) / punches only (VisFighter) | Punches only: punchL and punchR, identical frame data. 3 weapon slots reserved as `null` | Owner D3 | |
| 4 | Punch frame data | 4/3/8 ticks at 60 Hz (VisFighter), 8 damage, chip 2 | 4/3/8 ticks, **12 damage, chip 3** | HP dropped to 40, so 12 = about 4 clean hits per round | |
| 5 | Health | 100 HP (all docs) | **40 HP** | Owner, round 2 | |
| 6 | Hit detection | Projectile swept segment vs lane (Combat 01) | Axis-aligned overlap of the punch hitbox (70 × 60 in front of the fist, active ticks only) with the opponent hurtbox (72 × 140). One hit per punch. Same-tick trades both land | Owner D6 "hitbox around sprites, overlap deals damage" | |
| 7 | Block | BLOCK_START = fixed 600 ms status with cooldown, 70% reduction (Combat 01) | Held while gesture or key is held, grounded only, no cooldown. Blocked punch deals flat chip 3, no hitstun | Owner D5; chip is simpler than a percentage at 40 HP | |
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
| A | Punch hitbox reach 70 px and punch damage 12 at 40 HP: keep, or tune after the first keyboard match? | Keep, tune in reserve |
| B | Timer draw round scores for both players (so 1–1 after a draw). Alternative: replay the round. | Score both |
| C | Winner keys or rematch flow: rematch returns both to lobby ready state. | Lobby |
