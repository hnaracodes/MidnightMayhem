# 13.07 — Consistency and sign-off

## Purpose
Close Phase 13: confirm the effects sit on the 2 px grid, record what the owner's scope cuts left out, fix the
stationary-car rule, re-run every headless plan on the merged code, and hand over the perf table and shots.

## Files
Modify: `packages/client/src/game/backgrounds.ts` (`scrollBackgrounds`), `HackCMU 2026/design/03-backgrounds-parallax.md`,
`implementation-docs/12-ambience/{02,03}`, `implementation-docs/STATUS.md`. No FX code change was needed.

## Depends on
13.00–13.06.

## Behaviour
1. **FX grid pass (verified, no change).** `effects.ts` sparks are `PIXEL × PIXEL` rects at `snapPt` positions, the
   shockwave ring radius is rounded to `PIXEL`, dust and impact centres go through `snapPt`; `itemFx.ts` reads the
   beam band from `laserHitbox` and the barrier from the 13.00 constants. With `PIXEL = 2` everything already lands
   on the grid; the 3 px stroke widths (trail, arc) are world-px strokes, not grid art, and stay.
2. **The car stands still (owner, 2026-09-12).** Roof, body, window glow and lamp fixtures no longer scroll; they
   bob. The rest of the world scrolls at its 11.02 speeds. `roofSpeed` keeps its meaning as the train's speed for
   the poles, tunnel, foreground, ballast, track slices, wind, sparks and particles.
3. **Headless sweep on the merged branch** (server restarted on 8081 for protocol v3): `match`, `match-4p`,
   `match-sword`, `modes`, `landing`, `arena-states`, `ambience-dev`, `ambience-actions` — zero page errors each.
4. **Deferred by owner scope** (2026-09-12), for a later lane: Stoker, Claude Code and item grids (still ×2.1
   placeholders, `PLACEHOLDER_CHARACTERS`); secondary motion (hair, hems, straps, chain); Claude's screen light;
   the pixel port of sky, stars, moon, clouds, tunnel wall, track, lamps and railing; reactive props (landing dust,
   lamp swing, KO crate shift, molotov flare, laser wake); the conductor's trouser crease (needs a per-limb detail
   pass); a `dev/stage.html` trigger UI for reactive props.

## Perf (headless Chrome, `high`, EMA of `update()`)
| Measure | Baseline (22c62b9) | 13.01 | 13.02 | 13.06 + merge |
|---|---|---|---|---|
| 4 attract fighters `updateMs` | 1.06–1.36 ms | 2.54–2.64 | 1.72–1.97 | 1.86–1.92 |
| 2P match `updateMs` | 0.82 / 0.54 | 1.43 / 1.29 | — | 1.46 / 0.99 |
| 4P chaos match `updateMs` | — | — | — | 1.14 / 0.78 |
| `SpriteFighter.update` per fighter (sprites.html) | 0.109 ms | 0.304 | 0.132 | — |
| `dev/stage.html` frame (scroll + motion + lighting + props) | 0.60 ms | 1.15 | 0.69 | 0.45 (16 live props) |
| Live props | — | — | — | 14–16 on `high`, 3 on `low` |
| `low` tier drops | bloom, rays, particulate | + | + flat limbs | + props thinned to lamps and flap |

Boot-time texture generation is logged once by `generateTextures` (`[art] stage textures …`) and stored in
`TEXTURE_BOOT_MS`.

## Screenshots (`.shots/art/`)
`01-*` grid change, `02-lit-from-{left,right}` shading under the lamp vs away from it, `03-sprites` the authored
Drifter and Conductor, `04-stage-{standard,tunnel,final}`, `05-map-{gaps,platforms,chaos}-debug` with the sim's
collision lines, `06-props-{a,b,tunnel}` the empty roof, `07-still-{a,b}` the car holding still while the world
moves, `merge-*` after the main merge; `.shots/art-before-*` from the branch point; `.shots/integration-*` from the
plans.

## Done when
- [x] every plan zero page errors; `pnpm test` (shared 194, server 40, client 935) and `pnpm typecheck` green
- [ ] owner review of `sprites.html` and the shots; `DECISIONS_CHANGED.md` rows 50–52 approved (proposed in the summary)
