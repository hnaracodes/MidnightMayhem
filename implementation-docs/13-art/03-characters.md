# 13.03 — Character art at the 1 px grid: Drifter and Conductor

## Purpose
The 13.01 placeholders are the 11.01 grids blown up 2.1×: 17 px heads drawn as 36 px blocks. This lane authors
the two original fighters at the new grid with the four-step ramps of 13.02 and sharpens their identity. Scope
set by the owner on 2026-09-12: Drifter and Conductor fully; Stoker, Claude Code and the held items keep the
13.01 placeholders; secondary motion and Claude's screen light are deferred (kept in the 13.07 notes).

## Files
Modify: `packages/client/src/game/sprites/parts/{drifter,conductor}.ts`, `sprites/compose.ts` (placeholder scaling
only for `stoker`, `claude`, items), `test/sprites.test.ts`.
Owns `parts/drifter.ts`, `parts/conductor.ts`.

## Depends on
13.02 (`rampFrom`, `materialPalette`, part ids), 13.01 (frame geometry, standing-bounds contract).

## Exposes
`parts/drifter.ts`, `parts/conductor.ts`: the same `CharacterParts` shape and anchor meaning; grids sized as the
13.01 placeholders so the standing bounds hold — Drifter head 36 × 36 anchor (19, 6), torso 32 × 40 anchor
(15, 38); Conductor head 32 × 29 anchor (15, 6), torso 27 × 40 anchor (13, 38); hands 11 × 11 anchor (4, 4);
feet 15 × 8 anchor (4, 8). Both files declare their limb ramps (`limbRamp`, `limbShadeRamp`, `legRamp`).

## Behaviour
1. **Drafting.** The grids were drafted with a throwaway raster script (ellipsoid shading toward a top light,
   dithered step transitions, each feature placed at explicit coordinates) and hand-tuned; only the grids are
   committed. Four steps per material via `materialPalette`; internal `o` only where parts overlap or a feature
   needs an edge (eyes, mouth, knuckles, boot tops, cap brim).
2. **Drifter** — matted hair in distinct strands trailing behind the crown, a beard in three tones with a
   jagged edge, a ripped coat over a grey shirt with lapels, a fibre-textured rope belt with a knot, a torn hem
   with the lining showing in the tears, bare hands, scuffed boot toes; amber wrist wraps (13.02 cuff ramp) stay
   the one warm accent. Browns and greys only.
3. **Conductor** — peaked cap with a lighter crown, dark band and forward brim, a badge, a moon collar, epaulettes,
   two columns of three brass buttons, a watch chain sagging across the lower coat, white gloves, polished shoes
   with a moon highlight. Navy, brass, white only.
4. **KO heads** — eyes crossed; the Drifter's hair slumps back, the Conductor's cap slides back and down.

## Invariants
- The 13.01 standing-bounds contract holds (±1 px); every earlier `sprites.test.ts` rule still passes.
- Drifter and Conductor idle silhouettes differ by > 12 % of their pixels.
- Stoker, Claude and item grids are unchanged (still scaled ×2.1 in `compose.ts`).

## Tests
`sprites.test.ts`: authored sizes and anchors for the two characters; ≥ 6 colours per authored head; `headKo`
differs; silhouette distinctness; bounds contract.

## Done when
- [ ] tests pass, `pnpm test` and `pnpm typecheck` green
- [ ] `.shots/art/03-sprites.png` reviewed (owner approval on `sprites.html`)
- [ ] committed with prefix `art:`
