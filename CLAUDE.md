# Midnight Express — project constitution

A two-laptop, webcam-controlled, side-view 2D fighter for HackCMU 2026. Read this file first.

## Source of truth, in order

1. `DECISIONS_CHANGED.md` — every decision, with the owner's approval column.
2. `implementation-docs/STATUS.md` — where `main` is right now and what to pick up next.
3. `implementation-docs/` — one folder per phase, one file per feature; the exact spec an agent builds from.
4. `docs/superpowers/plans/2026-09-12-midnight-express-mvp.md` — the high-level architecture and schedule behind 2.
5. `HackCMU 2026/design/` — how it looks: palette, rig, backgrounds, HUD, feel. Code-drawn, no assets.
6. `HackCMU 2026/docs/2026-09-12-doc-audit-and-stack.md` — the audit and reasoning behind 1 and 2.
7. `HackCMU 2026/controls/phases/CLAUDE.md` — gesture rules and thresholds (port to TypeScript, pose only).

Everything else under `HackCMU 2026/` is **historical** and carries a SUPERSEDED header. Do not build from it.

## Rules for agents

- Work one feature file at a time from `implementation-docs/`. Use its `Exposes` names verbatim. Do not start a feature until everything in its `Depends on` is committed, and do not start a phase until the previous gate passed.
- `packages/shared` is the only cross-package surface. Server and client import it; it imports nothing from them. The simulation never touches DOM, Phaser, `Date`, `Math.random` or the socket.
- Balance and geometry numbers live only in `packages/shared/src/constants.ts`.
- Keyboard control must never stop working. Camera is additive.
- No image or sprite assets. Every visual is Phaser Graphics or a generated texture per `design/`.
- No React, no database, no rollback, no object detection, no Ludo.
- Ask the owner before changing anything in `DECISIONS_CHANGED.md`. Everything else is yours.
- Keep `pnpm test` and `pnpm typecheck` green. Commit small. Do not push.

## Stack

Node 22, pnpm 10, TypeScript strict, Vitest, `ws` + `zod`, Vite + basic-ssl, Phaser 3, `@mediapipe/tasks-vision`.
