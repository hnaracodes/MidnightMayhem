# Implementation Docs

One folder per phase, one file per feature. An agent assigned a feature reads, in order: root `CLAUDE.md`,
`DECISIONS_CHANGED.md`, this file, the phase README, then its feature file. It builds exactly what the feature
file says and nothing else.

## Phase order and parallelism

| Phase | Folder | Runs in parallel with | Gate owner |
|---|---|---|---|
| 0 | `00-scaffold.md` | — | agent (commands green) |
| 1 | `01-simulation/` | Phase 2 | agent (tests) |
| 2 | `02-server/` | Phase 1 | agent (tests) |
| 3 | `03-client-shell/` | Phase 5 | owner (two browser profiles) |
| 4 | `04-design-ux/` | Phase 5 | owner (rig preview, then screenshots) |
| 5 | `05-vision/` | Phases 3 and 4 | owner (harness) |
| 6 | `06-integration.md` | — | owner (two laptops) |
| 7 | `07-demo-hardening.md` | — | owner (three rehearsals) |

Within a phase, features are numbered in dependency order. A feature may start when every feature it lists
under "Depends on" is committed.

## Feature file format (every file uses exactly these headings)

1. **Purpose** — one paragraph.
2. **Files** — create / modify, exact paths.
3. **Depends on** — feature ids whose exports it consumes.
4. **Exposes** — every exported name with its signature. These names are contracts; later features use them verbatim.
5. **Behaviour** — numbered rules. Each rule is testable.
6. **Invariants** — things that must never be true.
7. **Tests** — named cases the agent writes (Vitest) or the owner runs (manual).
8. **Done when** — the checklist for the commit.

## Status and next assignments

Where `main` is and what each new agent should pick up: `STATUS.md`. Read it before any feature file.

## Team split

Four-person parallel plan, ownership and kickoff prompts: `TEAM-SPLIT.md`.

## Conventions

- Package names: `@midnight/shared`, `@midnight/server`, `@midnight/client`. Import shared as `@midnight/shared`.
- Paths in feature files are relative to the repo root.
- Numbers come from `packages/shared/src/constants.ts`; feature files quote them for clarity but the code imports them.
- Ticks are integers at 60 Hz. Positions are numbers in world units (960 × 540). Angles in degrees.
- Commit message prefix per phase: `sim:`, `server:`, `client:`, `design:`, `vision:`, `integ:`, `demo:`.
