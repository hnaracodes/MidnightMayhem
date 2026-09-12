# Design & Art Spec — Midnight Mayhem

Owner: **Hruday (visuals/characters)**. Audience: the coding agents building the client renderer.

This folder is the single source of truth for **what the game looks like**. All art is drawn in code: fighters are
skeleton rigs whose pose is a pure function of simulation state, backgrounds are generated textures, effects are
Phaser Graphics. There are no image files, no sprite sheets, no external animation tools. It does not define combat
rules; those live in `packages/shared/src/constants.ts` and the audit decision register.

## Reading order

| # | File | What it settles |
|---|---|---|
| 0 | [00-art-direction.md](00-art-direction.md) | Style, palette, stage geometry, screen constants, readability rules |
| 1 | [01-characters.md](01-characters.md) | The two fighters — silhouette, palette, rig proportions |
| 2 | [02-rig-and-animation.md](02-rig-and-animation.md) | The skeleton, every pose as a function of sim state, tick mapping |
| 3 | [03-backgrounds-parallax.md](03-backgrounds-parallax.md) | Generated sky/cloud/train layers, scroll speeds, Tunnel and Final Car |
| 4 | [04-vfx-and-feel.md](04-vfx-and-feel.md) | Hit-stop, flashes, shake, sparks, dust, danger vignette, KO slowdown |

## Locked decisions

Settled by the owner on 2026-09-12 (see `../docs/2026-09-12-doc-audit-and-stack.md`, Parts 6 to 10).

| Decision | Value |
|---|---|
| Logical world = render resolution | **960 × 540**, integer-scaled to the window |
| Art style | **Procedural vector 2D**: flat fills, thick strokes, hard silhouettes, two-tone lighting (cool base, warm rim edge) |
| Character height (standing) | **~150 px** |
| Fighter rendering | **Skeleton rig drawn every frame** from `FighterState`; no frames, no atlases |
| Movement model | Free horizontal movement + jump. No lanes for players |
| Dodging | Jump only |
| Out-of-bounds | Past the hard edge: 3 HP per 30 ticks, always recoverable |
| Setting | Roof of the Midnight Express at night — stars, moon, clouds, parallax scroll |
| Roster | **Drifter** (player 0) vs **Conductor** (player 1) |
| Renderer | Phaser 3 Graphics and generated textures |
| Weapons | Deferred. A future weapon is drawn at the rig's wrist joint |

## The scene in one breath

Midnight. A train hammers through open country under a full moon. On its roof, a shaggy bearded drifter in ripped
clothes squares up against the train's conductor, uniform buttoned to the collar. Wind tears at everything. The
carriage windows below throw orange light up onto the roof. Nobody is supposed to be up here.

Every visual choice serves three words: **night, speed, mayhem.** Night = deep blue palette, moon rim light.
Speed = the roof streaming past at 240 px/s and every loose thing trailing backward. Mayhem = hard hit-stop,
flashes, shake, a drifter who fights dirty and a conductor who fights by the book.

## Look at the rig before anything else

Phase 4a of the plan builds `/rig.html`: both fighters, every pose, at 2× on the real background, with a punch
scrubber. The owner approves that page before the arena is built. If the silhouettes do not read there, fix the
rig, not the game.

## Why code-drawn

The sim owns time. When the arm length is computed from `action.elapsed`, the visual contact frame is the mechanical
active window by construction. Nothing can drift, nothing needs re-anchoring, and mirroring is a sign flip.
