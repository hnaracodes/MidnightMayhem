# Current Status and Next Assignments

Updated: 2026-09-12 after gate-3. This file is the handoff for any new agent. Read `CLAUDE.md` first, then this,
then your feature file.

## Where main is

| Tag | Contains | Verified by |
|---|---|---|
| `gate-1` | Phase 1 simulation, 39 tests | tests |
| `gate-2` | Phase 2 server | tests plus a live socket smoke test |
| `gate-3` | Phase 3 client shell | owner played a full keyboard match in two browser windows |
| `gate-5-code` | Phase 5 vision code, MediaPipe wired, harness page | 70 client tests; **camera checklist not yet run** |

`main` builds, 125 tests pass, `pnpm typecheck` clean. The game is playable with keyboards as two rectangles.
The old branches `feat/sim`, `feat/server`, `feat/client`, `feat/vision` are fully merged and retired.

## What is left

| Work | Feature files | Est. |
|---|---|---|
| Rig pose, drawing, preview page | `04-design-ux/01`, `02`, `03` | 1.5 h then **owner gate** |
| Stage parallax, tunnel, final car | `04-design-ux/04` | 1 h |
| HUD and banners | `04-design-ux/05` | 45 min |
| Effects and feel | `04-design-ux/06` | 1 h |
| Arena assembly (replaces rectangles) | `04-design-ux/07` | 45 min, after the four above |
| Screen styling | `04-design-ux/08` | 30 min |
| Integration: camera in lobby, overlay, merged input, punch hint | `06-integration.md` | 1 h |
| Camera tuning on the harness | `05-vision/05` gate | human, ongoing |
| Rehearsal and runbook | `07-demo-hardening.md` | 1.5 h |

## Parallel assignment: four worktrees on one machine

```bash
git worktree add ../mm-rig    -b feat/rig    main
git worktree add ../mm-stage  -b feat/stage  main
git worktree add ../mm-hud    -b feat/hud    main
git worktree add ../mm-fx     -b feat/fx     main
for d in rig stage hud fx; do (cd ../mm-$d && pnpm install --silent); done
```

| Worktree | Features in order | Owns (edit nothing else) |
|---|---|---|
| `mm-rig` | 4.01 → 4.02 → 4.03 | `packages/client/src/game/palette.ts`, `src/game/rig/`, `rig.html`, `src/rigPreview.ts`, `test/pose.test.ts` |
| `mm-stage` | 4.04 | `packages/client/src/game/backgrounds.ts` |
| `mm-hud` | 4.05 → 4.08 | `packages/client/src/game/hud.ts`, `index.html` styles, `src/app/*` |
| `mm-fx` | 4.06, then 4.07 and Phase 6 after the others merge | `packages/client/src/game/effects.ts`; later `ArenaScene.ts`, `src/main.ts`, `src/app/calibrationOverlay.ts` |

Shared file rule: `src/game/palette.ts` is created by `mm-rig`. If it does not exist in your worktree yet, create
it yourself exactly from the palette table in `HackCMU 2026/design/00-art-direction.md` (token name → `0xRRGGBB`);
identical content merges cleanly.

## Kickoff prompt for each agent

> Read `CLAUDE.md`, `DECISIONS_CHANGED.md`, `implementation-docs/README.md`, `implementation-docs/STATUS.md`, then
> `implementation-docs/04-design-ux/README.md` and your feature file. You are worktree `<name>`; you own only the
> paths listed for it in STATUS.md. Before writing code, summarise back the `Exposes` list and the numbered
> behaviour rules of your feature in your own words and wait for confirmation. Then write the listed tests first,
> implement, keep `pnpm test` and `pnpm typecheck` green, commit with the `design:` prefix, push your branch.
> Do not add exports, files or features the feature file does not name. If you need anything in
> `packages/shared` or another worktree's files, stop and say exactly what.

## Sequence after the four branches land

1. `mm-rig` pushes 4.03 → owner opens `https://localhost:5173/rig.html`, approves or lists corrections.
2. Integrator merges each finished branch into `main` in any order, running the full suite on the merged tree.
3. `mm-fx` rebases on `main` and does 4.07 (arena assembly). Owner runs the screenshot gate in 4.07.
4. `mm-fx` does Phase 6. Owner runs the two-laptop camera-vs-keyboard gate.
5. Everyone: Phase 7 rehearsal. Tag `demo-freeze`.

## Running the game today

```bash
pnpm dev:server            # terminal 1, http://localhost:8080
pnpm dev:client            # terminal 2, https://localhost:5173 (accept the certificate warning)
```
Game: `/`. Vision harness: `/harness.html` after `pnpm --filter @midnight/client vision:setup` once per laptop.
Keys: A/D walk, W jump, S block, F/G punch. `?debug=1` shows boxes, tick and RTT.

## Open items for the owner

- Camera checklist in `05-vision/05-harness.md` has not been run against a real body. Punch depth threshold is the
  expected tuning point (`packages/client/src/vision/thresholds.ts`).
- Rig look approval (4.03) is the only gate that can send art work back; run it as soon as `mm-rig` pushes.
