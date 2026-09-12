# Phase 0 — Scaffold

## Purpose
Create the workspace so that Phases 1 and 2 can start in parallel worktrees with shared contracts already committed.

## Files
Create:
- `package.json` (root, private, `packageManager: pnpm@10`, scripts `test`, `typecheck`, `build`, `dev:server`, `dev:client`, all via `pnpm -r --if-present`)
- `pnpm-workspace.yaml` (`packages/*`)
- `tsconfig.base.json` (ES2022, bundler resolution, strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noEmit`)
- `.gitignore` (node_modules, dist, `packages/server/certs/`, `packages/client/public/wasm/`, `packages/client/public/models/`)
- `packages/shared/{package.json,tsconfig.json,vitest.config.ts,src/index.ts}`
- `packages/server/{package.json,tsconfig.json,vitest.config.ts,src/index.ts}` (index is an empty main for now)
- `packages/client/{package.json,tsconfig.json,vitest.config.ts,vite.config.ts,index.html,src/main.ts}` (main logs "hello")
- `packages/shared/src/input.ts`, `packages/shared/src/constants.ts` (see 01-simulation/01)

## Depends on
Nothing. Node 22 is installed; run `corepack enable && corepack prepare pnpm@10 --activate`.

## Exposes
- `@midnight/shared` resolves from server and client via `workspace:*`.
- Dependencies pinned: shared `zod@3`; server `ws@8`, `zod@3`, dev `tsx`, `@types/ws`, `@types/node`; client `phaser@3.90`, `@mediapipe/tasks-vision` (latest 1.x), dev `vite@7`, `@vitejs/plugin-basic-ssl`; all packages dev `typescript@5.9`, `vitest@3`.

## Behaviour
1. `pnpm install` succeeds from a clean clone.
2. `pnpm test` runs Vitest in all three packages (zero tests is fine except shared, which has the input contract test from 01-simulation/01).
3. `pnpm typecheck` runs `tsc -p` in all three packages and is clean.
4. `git init`, first commit `chore: scaffold workspace`.

## Invariants
- No package imports another package's `src` by relative path; always the package name.
- Nothing under `packages/*/src` imports from `HackCMU 2026/`.

## Tests
- Command gate only: install, test, typecheck.

## Done when
- [ ] all three commands green
- [ ] `packages/shared/src/input.ts` and `constants.ts` committed exactly per 01-simulation/01
