# Current Status and Next Assignments

Updated: 2026-09-12 (session 2, expansion integrated). This file is the handoff for any new agent. Read `CLAUDE.md`
first, then this, then your feature file.

## Where main is

| Tag | Contains | Verified by |
|---|---|---|
| `gate-1` | Phase 1 simulation | tests |
| `gate-2` | Phase 2 server | tests plus a live socket smoke test |
| `gate-3` | Phase 3 client shell | owner played a full keyboard match |
| `gate-5-code` | Phase 5 vision code, MediaPipe wired, harness page | client tests; camera checklist not run |
| (untagged) | Phase 4 design (rig, stage, HUD, effects, arena), Phase 6 integration, polish | 219 client + 125 shared/server tests, owner keyboard match |
| (untagged) | 8.01 contracts, every phase 9–11 lane (9.01–9.06, 10.01–10.03, 11.01–11.05) merged and wired | 165 shared + 38 server + 721 client tests, typecheck, `pnpm build`, headless 2p / 3p / 4p play-throughs |
| (untagged) | Phase 12 ambience (12.01–12.06) via PR #1, 9.07 YOLO as the default detector, 9.10 mobile actions, health 50 | 187 shared + 40 server + 837 client tests, typecheck |

`main` builds, `pnpm test` (1064 tests) and `pnpm typecheck` are green. **The expansion is playable end to end on the
keyboard**: pixel sprites for four characters, the moving train with gaps and cargo racks, landing page with the
attract-mode roof, lobby with route board and seat customisation, two-to-four-player HUD, laser, five items, item FX,
synthesised sound, timed and deathmatch modes, 2v2 teams, result screen naming the team.

### What 11.05 landed (commits `integ:`)

- `ArenaScene` draws one `SpriteFighter` per fighter in the state (vector rig with `?rig=vector`), ordered
  back-to-front by distance from the camera centre (depth `2 + rank·0.4`, under the item FX at 4). Hands feed
  `ItemFx`; the item sprite hides while materialising; pit falls hide the fighter, respawn i-frames draw at 50 %.
- Attract mode: with `session.attract` set and no snapshot, the scene runs `createMatch` + `step` locally at 60 Hz
  (deathmatch, roof, items off; `attractInputs` walks the last fighter on a 6 s loop). Only place the client steps
  the sim. The lobby (no attract, no snapshot) shows the bare stage.
- Per frame: events → `Effects.consume`, `ItemFx.consume`, `session.sfx?.consume`; fire loop start/stop from the
  hazard list; HUD reads state; dazzle overlay (white, depth 12) at `ItemFx.dazzleAlpha`; map layer follows
  `state.config.map`; debug boxes for beam, hazards, projectiles, platforms.
- `effects.ts`: KO collapse and slowdown read per fighter from the displayed hp (mid-round KOs in 3–4p collapse
  at once and stay down), `LASER_HIT` / `HAZARD_HIT` flashes.
- Sound: `main.ts` creates the `Sfx` (and its `AudioContext`) on the first pointer/key gesture; `M` toggles
  `session.muted`, persisted under `midnight-mayhem:muted`.
- Pure helpers in `src/game/arenaGlue.ts` (`drawOrder`, `fireLoopTransition`, `attractInputs`, `attractSetup`,
  `posedFighter`, `fighterAlpha`) with `test/arenaGlue.test.ts`. `posedFighter` poses a throw as the same arm's
  punch and a laser as the block stance because `rig/pose.ts` has no pose for either.
- Headless plans in `tools/e2e/`: `landing.json` (attract, lobby, mute), `match.json` (2p: punch, sword parry,
  shield bubble/cracks/break, flash whiteout), `match-4p.json` (2v2 on chaos, deathmatch: equip, throw, fire,
  charge, beam, pit, respawn, peel, KO, result), `modes.json` (timed `1:28`, deathmatch `∞`, 3p FFA on platforms
  with a rack landing), `arena-states.json` (vector rig, tunnel, final car). Screenshots in `.shots/integration-*.png`.
  `update()` measured 0.6–1.5 ms with four fighters, fire and a beam (budget 4 ms).

Integration notes carried over from the 13-lane merge:
- Molotov `MOLOTOV_VX 2 / VY -3` lands 70–130 px out (9.02 rule 2): thrown at a team-mate's feet it burns them.
- `LOBBY.host` is sent as `host ?? 0` for an empty room (shared protocol keeps `host: PlayerIndex`).
- The RoomLoop keeps sending `MATCH_END` snapshots until the room empties; `SnapshotBuffer.push` resets on a
  lower tick after `MATCH_END`, so a rematch with a different player count starts clean.
- Headless driver: a Playwright `press` is shorter than the 60 Hz input poll and can be missed; the plans use
  `hold [key, 60]`. Real key presses are never that short.
- `efficientdet_lite0.tflite` is gitignored; run `pnpm --filter @midnight/client vision:setup` on a fresh checkout.

### What 9.07 landed (commits `vision:`, branch `feat/yolo`)

- Second detector track behind one interface: `src/vision/backends/ObjectBackend.ts`, `mediapipe.ts` (wraps
  9.04's detector), `yolo.ts` (yolov10n on `onnxruntime-web`, lazy `import()`, webgpu → wasm fallback), `nms.ts`
  (pure IoU / NMS / letterbox), `loader.ts` (rule 1 `loadBackend` and the `GuardedBackend` throw guard, both
  unit-tested). The worker loads the backend named in `init { detector }`; a YOLO load failure falls back to
  MediaPipe with one warning (`fallback: true` only for a YOLO request); a backend that throws on three
  consecutive frames is disposed and the client marks objects off; `ready` and every result carry `backend`.
- `?detector=yolo|mediapipe` → `session.detector` → the worker; the lobby camera button reads "Camera on · yolo";
  the harness objects line reads "yolo · 30.0 ms" / "mediapipe (yolo failed) · 12.3 ms" / "off".
- `bench.html` runs both backends on CPU and GPU over the same frames (fake camera, 40 procedural fixtures, any
  photos in `public/bench/`) and reports load, median / p90, effective fps, detections per frame, hit rate per
  label and per set. Numbers and verdict: `docs/superpowers/specs/2026-09-12-detector-benchmark.md`.
- **Verdict: MediaPipe stays the default.** On wasm/CPU YOLO meets the latency bar (42 ms median) and the
  no-page-errors bar, but misses the fixture hit-rate bar (0/40 vs 8/40 on the cartoon set). On the 20 real
  photos YOLO leads 9/20 vs 7/20; on WebGPU it runs at ~10 ms. The owner's real-object check below decides.
- `vision:setup` also downloads `public/models/yolo.onnx` (gitignored, 9.4 MB; provenance in the benchmark doc).
  `YOLO_INPUT` is 640 because that export has a fixed input.

## What is next

1. **Review** — parallel reviewers per area against the feature files (`09-arsenal`, `10-arenas`, `11-look`,
   `12-ambience`), fixes, final verification. Candidates seen during integration: `KeyboardInputSource` could latch
   edges until sampled. (12.04 gave `rig/pose.ts` the real throw and laser poses, so `posedFighter` is the identity.)
2. **9.09** laser gesture hardening is specified and unbuilt: `09-arsenal/09-laser-gesture-hardening.md`. Worth
   doing before the camera gates, since the current laser gate still overlaps block and punch.
3. The human gates below.

### What 9.10 landed (commits `sim:` / `client:`)

Only a punch or a block pins a grounded fighter. The laser and the charged throw are charged, fired and recovered
while walking or jumping, the laser starts in mid-air, and `updateFacing` tracks through a charge and commits at
the beam or the release (`aimLocked`). `actionLocksMovement` in `sim/fighter.ts` is the single gate, so any action
added later is mobile unless it opts in. On the client, `withLocomotion` in `rig/pose.ts` gives the laser and throw
stances the walk cycle's or the air pose's legs while keeping the action's arms and torso. Spec:
`09-arsenal/10-mobile-actions.md`; decision row 49. Verified in the real app by `tools/e2e/mobile-actions.json`:
the fighter charges from x 280 to 450 on the ground, jumps to y 322 still charging, the beam lands for 20, then a
molotov is charged and thrown while walking the other way. Zero page errors. Health is 50 (`BALANCE.MAX_HP`, owner retune), which is a
fraction change everywhere on the client — the HUD bars already scaled off `MAX_HP`.

## Running the game today

```bash
pnpm dev:server            # terminal 1, http://localhost:8080
pnpm dev:client            # terminal 2, https://localhost:5173 (accept the certificate warning)
```
Or the demo build: `pnpm build` then `pnpm --filter @midnight/server start` serves `packages/client/dist` on one port.
Keys: A/D walk, W jump, S block, F/G punch, Q laser (all of these work *while* a laser or throw charges),
1–5 hold an item (molotov, sword, shield, banana, flash),
V camera preview, M mute. `?debug=1` shows boxes, tick, RTT, map/mode; `?rig=vector` draws the old rig;
`?input=keyboard|vision` as before.

Headless (from the repo root, with `MM_HTTP=1 MM_SERVER_PORT=8081 pnpm --filter @midnight/client dev --port 5181`
and `MM_HTTP=1 PORT=8081 pnpm --filter @midnight/server dev` — `MM_HTTP=1` on the server skips `certs/` so the vite
`ws://` proxy can reach it): `node tools/shot.mjs tools/e2e/match-4p.json`. `tools/e2e/match-yolo.json` is the 2p match
with `?detector=yolo` on every page. Every report must show zero page errors.

## Human gates that remain

- Real objects on camera: bottle, tennis racket, backpack, banana, phone held up at 1–2.5 m — does `item` light up in the
  preview within a second and clear within a second of putting it down? Tune `HOLD_*` and `OBJECT_SCORE`.
- Detector choice (9.07): hold the same five objects up under `harness.html?detector=mediapipe` and
  `harness.html?detector=yolo` and compare which lights `item` more reliably and how the `objects` ms line reads on
  the demo laptops. If YOLO wins, flip `DETECTOR_DEFAULT` in `thresholds.ts` and record it under decision 34.
  Benchmark numbers so far: `docs/superpowers/specs/2026-09-12-detector-benchmark.md`.
- Laser gesture on a real body; tune `LASER_EXT`, `LASER_GAP`.
- Four laptops over LAN HTTPS, 2v2 on `chaos`, `timed`.
- Rig look approval of the pixel sprites on `sprites.html`, and of the arena screenshots in `.shots/integration-*.png`.

## In flight: Phase 12 ambience (`feat/graphics-enhancement`)

The look-and-feel overhaul (`docs/superpowers/specs/2026-09-12-ambience-overhaul.md`, specs in
`implementation-docs/12-ambience/`) lives on `feat/graphics-enhancement`, branched after 9.08 merged. All six lanes
are implemented and green there: pixel grid, light rig, atmosphere + quality tiers, action animation (the laser
pose), HUD restyle, menus and wipes. Presentation only — no change under `packages/shared` or `packages/server`.
Merge into `main` after the owner reviews `.shots/before/*` against `.shots/after/*` and approves the proposed
`DECISIONS_CHANGED.md` row in the branch's final summary. New dev pages: `dev/ambience.html`; new switches:
`?quality=high|low`.

## In flight: Phase 13 art (`feat/artstyle-rework`)

The art overhaul (`docs/superpowers/specs/2026-09-12-art-overhaul.md`, specs in `implementation-docs/13-art/`)
lives on `feat/artstyle-rework`, which carries Phase 12 and `main` up to a715f6b (9.10 chop/sweep, use-only
throwables, retro chrome). Owner decisions taken during the lane: fighters at **70 %** (105 px) as a true shrink
through sim and pose (13.00: hurtbox 50 × 98, punch 7/49/84/42, chop 7/63/119/98, sweep 7/105/77/49, laser band
74/25, throw release 70 px); **`SPRITE_SCALE = 1`** with `PIXEL = 2` decoupled for effects and backgrounds (13.01);
the **car stands still** and only the world scrolls (13.07). Landed: shading engine (13.02), Drifter and Conductor
art (13.03), roof and body pixel rasters (13.04), rack and gap pixel art (13.05), ambient props (13.06). Deferred by
owner scope: Stoker / Claude / item art, secondary motion, Claude's screen light, the remaining sky/track layers,
reactive props (see `13-art/07`). A rack perch is now out of a grounded punch's reach (10.01 rule 6 annotated).
Merge into `main` after the owner reviews `sprites.html` and `.shots/art/*` and approves the proposed
`DECISIONS_CHANGED.md` rows in the branch summary. Headless loop: Vite on 5181 and the server on 8081 with
`MM_HTTP=1` (restart the server after merging protocol changes).
