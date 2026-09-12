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

`main` builds, `pnpm test` (924 tests) and `pnpm typecheck` are green. **The expansion is playable end to end on the
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

## What is next

1. **Review** — parallel reviewers per area against the feature files (`09-arsenal`, `10-arenas`, `11-look`),
   fixes, final verification. Candidates seen during integration: `rig/pose.ts` could grow real throw and laser
   poses (11.05 adapts them through `posedFighter`); `KeyboardInputSource` could latch edges until sampled.
2. **9.07** per the phase plan, then the human gates below.

## Running the game today

```bash
pnpm dev:server            # terminal 1, http://localhost:8080
pnpm dev:client            # terminal 2, https://localhost:5173 (accept the certificate warning)
```
Or the demo build: `pnpm build` then `pnpm --filter @midnight/server start` serves `packages/client/dist` on one port.
Keys: A/D walk, W jump, S block, F/G punch, Q laser, 1–5 hold an item (molotov, sword, shield, banana, flash),
V camera preview, M mute. `?debug=1` shows boxes, tick, RTT, map/mode; `?rig=vector` draws the old rig;
`?input=keyboard|vision` as before.

Headless (from the repo root, with `MM_HTTP=1 MM_SERVER_PORT=8081 pnpm --filter @midnight/client dev --port 5181`
and `PORT=8081 pnpm --filter @midnight/server dev`): `node tools/shot.mjs tools/e2e/match-4p.json`. Every report must
show zero page errors.

## Human gates that remain

- Real objects on camera: bottle, umbrella, backpack, banana, phone held up at 1–2.5 m — does `item` light up in the
  preview within a second and clear within a second of putting it down? Tune `HOLD_*` and `OBJECT_SCORE`.
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
