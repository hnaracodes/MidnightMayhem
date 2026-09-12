# Four-Person Split with Claude Code

Four people, four laptops, each running Claude Code in its own git worktree on its own branch. One shared
remote. The project lead is the **integrator** and owns `packages/shared` after Phase 0.

## Roles

| Person | Branch | Owns | Reads but never edits |
|---|---|---|---|
| **A — Integrator / Sim** | `main` then `feat/sim` | Phase 0, Phase 1 (`packages/shared`), merges, gates, Phase 6, Phase 7 | everything |
| **B — Server** | `feat/server` | Phase 2 (`packages/server`) | `packages/shared` |
| **C — Client / Design** | `feat/client` | Phase 3 (`packages/client` except `vision/`), Phase 4 | `packages/shared` |
| **D — Vision** | `feat/vision` | Phase 5 (`packages/client/src/vision`, `src/harness`, `harness.html`), later the hands stretch | `packages/shared/src/input.ts` |

Rule: a person edits only their owned paths. Anything needed in `packages/shared` is requested from A in one
message with the exact export name and signature; A adds it and pushes within minutes. `input.ts` is frozen.

## Timeline (wall-clock hours from kickoff)

| Hour | A | B | C | D |
|---|---|---|---|---|
| 0.0–0.5 | **Phase 0** scaffold, push `main` | wait; read 02-server | wait; read 03 and 04 | wait; read 05; run `vision:setup` |
| 0.5–2.0 | 1.01–1.05 sim + protocol | 2.01–2.03 against 1.01/1.02/1.05 types (stub `step` until A pushes) | 3.01–3.05 shell | 5.01 camera + worker, 5.02 filters + calibration |
| 2.0–2.5 | merge sim; **gate 1** | 2.04 bootstrap | 3.06 placeholder arena | 5.03 metrics + gestures |
| 2.5–3.0 | merge server; **gate 2** | rebase, fix | rebase on merged sim+server; **gate 3** with A (two profiles) | 5.04 VisionInputSource |
| 3.0–3.75 | review C's gate; start 4.01 rig pose **with C** (pair: A writes tests, C writes pose) | idle → help D with harness UI (5.05) | 4.02 rig draw | 5.05 harness |
| 3.75–4.5 | — | 5.05 harness with D | **4.03 rig preview → owner gate** | owner runs harness gate; D tunes thresholds |
| 4.5–6.5 | 4.06 effects | 4.04 stage, 4.05 HUD | 4.07 arena scene, 4.08 styling | threshold tuning, punch at 1 / 1.5 / 2.5 m |
| 6.5–7.5 | merge all; **Phase 6 integration** | test two-laptop over LAN with A | screenshot gate fixes | integration support: calibration overlay hooks |
| 7.5–9.0 | **Phase 7** rehearsal ×3 | rehearsal partner laptop | fixes | fixes |
| 9.0–15 | freeze at 9.0; reserve for bugs | reserve | reserve | hands stretch only if everything is green |

## What can and cannot run in parallel

- **Fully parallel:** Phase 1 ∥ Phase 2 ∥ Phase 3 ∥ Phase 5. They share only `packages/shared` types, which Phase 0 commits first. Server and client both compile against the shared types before the sim is finished.
- **Sequential gates:** gate 1 (sim tests) before merging server; gate 2 (server tests) before C's two-profile gate 3; **rig preview (4.03) before 4.04–4.08**; harness gate (5.05) before Phase 6; Phase 6 before Phase 7.
- **Parallel inside Phase 4** after the rig is approved: stage (4.04), HUD (4.05), effects (4.06) are independent files; arena assembly (4.07) is last.
- **Never parallel:** two people in `packages/shared`; two people in `ArenaScene.ts`.

## Per-person kickoff prompt for Claude Code

Paste this, filling in the role:

> Read `CLAUDE.md`, `DECISIONS_CHANGED.md`, `implementation-docs/README.md`, then `implementation-docs/<phase>/README.md`. You are person <X>; you own only the paths listed for <X> in `implementation-docs/TEAM-SPLIT.md`. Implement feature <id> exactly as its file specifies: use the `Exposes` names verbatim, write the listed tests first, keep `pnpm test` and `pnpm typecheck` green, commit with the phase prefix, do not push. If you need a change in `packages/shared`, stop and write me the exact export you need.

## Merge protocol (A)

1. Merge in gate order: sim → server → client shell → vision → design → integration.
2. Before each merge: `pnpm install && pnpm test && pnpm typecheck` on the merged tree.
3. After each merge, the owner of the next branch rebases immediately.
4. Tag `gate-1` … `gate-6` at each passed gate so any laptop can check out a known-good state.

## Hardware assignments for the demo

- Laptop A: runs the server (`pnpm --filter @midnight/server cert && start`), player 1 browser.
- Laptop D: player 2 browser (best camera; D has tuned on it).
- Laptops B and C: spare clients pre-opened on the room screen in case one dies.

## Risks that need a human, not an agent

| Risk | Who | When |
|---|---|---|
| Punch gesture unreliable on venue lighting | D + owner | harness gate at hour 3.75, again at rehearsal |
| Rig looks wrong | owner | 4.03 gate at hour 4.5, before any stage or HUD work |
| Venue Wi-Fi blocks peer traffic | A | hour 7.5 rehearsal; fallback is a phone hotspot or both browsers on laptop A |
| Certificate warning confuses a judge | A | pre-accept on all laptops before the demo |
