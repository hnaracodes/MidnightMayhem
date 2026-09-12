# Current Status and Next Assignments

Updated: 2026-09-12 (session 2, expansion planned). This file is the handoff for any new agent. Read `CLAUDE.md`
first, then this, then your feature file.

## Where main is

| Tag | Contains | Verified by |
|---|---|---|
| `gate-1` | Phase 1 simulation | tests |
| `gate-2` | Phase 2 server | tests plus a live socket smoke test |
| `gate-3` | Phase 3 client shell | owner played a full keyboard match |
| `gate-5-code` | Phase 5 vision code, MediaPipe wired, harness page | client tests; camera checklist not run |
| (untagged) | Phase 4 design (rig, stage, HUD, effects, arena), Phase 6 integration, polish | 219 client + 125 shared/server tests, owner keyboard match |

| (untagged) | 8.01 contracts + every phase 9–11 lane merged (9.01–9.06, 10.01–10.03, 11.01–11.04), integrator shims collapsed | 165 shared + 38 server + 707 client tests, typecheck, client build |

`main` builds, `pnpm test` (910 tests) and `pnpm typecheck` are green. The sim has items, throwables, laser, maps,
modes and N players; the client has the pixel sprites, moving stage, landing/lobby, four-player HUD, item FX and SFX
as separate modules. **The arena does not use them yet: 11.05 (arena integration) is the next assignment, alone on
`main`.** After 11.05: review per area, then 9.07.

Integration notes (merge of 13 lanes, commits `integ:`):
- Molotov retuned to `MOLOTOV_VX 2 / VY -3` so it lands 70–130 px out (9.02 rule 2); banana unchanged (~250 px).
- `step.ts` runs `applyEquip` during COUNTDOWN too (spec §4.2).
- `LOBBY.host` is sent as `host ?? 0` for an empty room because the shared protocol keeps `host: PlayerIndex`.
- The RoomLoop keeps sending `MATCH_END` snapshots until the room empties; 11.05's client should tolerate an old
  2-fighter MATCH_END arriving before a new 4-player match starts.
- `settleKnockouts` (rounds.ts) clears a KO'd fighter's action each fighting tick; could fold into `resolvePunches`.
- `efficientdet_lite0.tflite` is gitignored; run `pnpm --filter @midnight/client vision:setup` on a fresh checkout.

## What is being built now: the expansion

Spec: `docs/superpowers/specs/2026-09-12-mayhem-expansion-design.md`. Decisions: `DECISIONS_CHANGED.md` rows 34–48.
Feature files: `implementation-docs/08-contracts`, `09-arsenal`, `10-arenas`, `11-look`.

### Order

1. **8.01 contracts** — alone, on `main`. Nothing else starts until it is committed and green.
2. **Thirteen lanes in parallel**, each in its own worktree and branch, each owning only the paths in its feature
   file's `Files` / README table:

| Lane | Branch | Feature | Owns |
|---|---|---|---|
| sim-items | `feat/sim-items` | 9.01 | `shared/src/sim/items.ts`, `combat.ts` |
| sim-throwables | `feat/sim-throwables` | 9.02 | `shared/src/sim/projectiles.ts`, `hazards.ts` |
| sim-laser | `feat/sim-laser` | 9.03 | `shared/src/sim/laser.ts` |
| sim-maps | `feat/sim-maps` | 10.01 | `shared/src/sim/maps.ts`, `fighter.ts` |
| sim-modes | `feat/sim-modes` | 10.02 | `shared/src/sim/modes.ts`, `rounds.ts`, `create.ts` |
| server | `feat/server` | 10.03 | `packages/server/**` |
| vision | `feat/vision` | 9.04 | `client/src/vision/**`, `input/KeyboardInputSource.ts`, `app/cameraPreview.ts`, `harness/panel.ts` |
| item-fx | `feat/item-fx` | 9.05 | `client/src/game/itemFx.ts`, `dev/itemfx.html`, `src/dev/itemFxPreview.ts` |
| sfx | `feat/sfx` | 9.06 | `client/src/game/sfx.ts`, `dev/sfx.html`, `src/dev/sfxPreview.ts` |
| sprites | `feat/sprites` | 11.01 | `client/src/game/sprites/**`, `rig/characters.ts`, `palette.ts`, `sprites.html`, `src/spritePreview.ts` |
| stage | `feat/stage` | 11.02 | `client/src/game/backgrounds.ts`, `game/stage/**`, `dev/stage.html`, `src/dev/stagePreview.ts` |
| ui | `feat/ui` | 11.03 | `client/index.html`, `src/app/{landing,setup,lobby,result}.ts`, `src/app/sprites/**`, screens block of `main.ts` |
| hud | `feat/hud` | 11.04 | `client/src/game/hud.ts`, `dev/hud.html`, `src/dev/hudPreview.ts` |

Each lane also creates its own test files (named in the feature file). Shared file `vite.config.ts`: `sprites` adds
`sprites.html`; nobody else touches it. `session.ts`: only `ui` (adds `config`, `roster`) and 11.05.

3. **Integration** — merge every branch into `main` (integrator), then **11.05** alone on `main`.
4. **Review** — parallel reviewers per area against the feature files, fixes, final verification.

### Worktree recipe (per lane)

```bash
git worktree add .worktrees/<lane> -b feat/<lane> main
cd .worktrees/<lane> && pnpm install --offline --silent   # falls back to online if the store misses a package
```
Dev ports if you need a browser: client `MM_HTTP=1 pnpm --filter @midnight/client dev --port 51xx`, server
`PORT=80xx pnpm --filter @midnight/server dev`; screenshots with `node tools/shot.mjs` from the repo root.

## Running the game today

```bash
pnpm dev:server            # terminal 1, http://localhost:8080
pnpm dev:client            # terminal 2, https://localhost:5173 (accept the certificate warning)
```
Keys: A/D walk, W jump, S block, F/G punch. After the expansion: Q laser, 1–5 items, V camera preview, M mute.
`?debug=1` shows boxes, tick and RTT. `?rig=vector` (after 11.05) draws the old rig.

## Human gates that remain (after 11.05)

- Real objects on camera: bottle, umbrella, backpack, banana, phone held up at 1–2.5 m — does `item` light up in the
  preview within a second and clear within a second of putting it down? Tune `HOLD_*` and `OBJECT_SCORE`.
- Laser gesture on a real body; tune `LASER_EXT`, `LASER_GAP`.
- Four laptops over LAN HTTPS, 2v2 on `chaos`, `timed`.
- Rig look approval of the pixel sprites on `sprites.html`.
