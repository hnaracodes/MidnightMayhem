# 4.02 — Rig drawing

## Purpose
Render `Joints` onto a Phaser Graphics object with the style rules in `design/00` and the signature shapes in `design/01`.

## Files
Create: `packages/client/src/game/rig/draw.ts`.

## Depends on
4.01.

## Exposes
- `interface DrawOpts { facing: 1 | -1; rim: number; fillOverride?: number; fillAlpha?: number; squash?: number; windSpeed: number }`
- `drawFighter(g, joints, characterId, opts): void`
- `drawShadow(g, x, groundY, heightAboveGround): void`
- `capsule(g, a, b, width, color, alpha): void` (internal helper, exported for the preview page)

## Behaviour
1. Every limb is a capsule: outline pass at `width + 6` in `outline`, then fill pass at `width`; round caps via circles at both ends.
2. Draw order: ghosts (moon, 35 % and 18 %), back leg, back arm, torso, head group, front leg, front arm. Back limbs use the key colour darkened 25 %.
3. Torso is a quad from shoulder width at the neck to hip width at the hip, outlined, with a 3 px `rim` stroke on the edge facing away from the moon (the screen-right edge when facing right, the screen-left edge when facing left, because the moon is at x = 740 and both edges are approximate; simplify: always the trailing edge relative to facing).
4. Wind: hair wedges, coat rags, coat tails and the beard notch offset toward screen-left by `2 + windSpeed / 120` px, with the longest hair wedge oscillating ±3 px at 6 Hz using `joints` plus `performance.now()`.
5. Drifter signature: jagged beard triangle, four hair wedges, five ragged coat triangles off the hip edge and two off the back edge, rope belt line in `amber-2`, cloth wraps as 4 px `amber-2` lines on both forearms, one shin 4 px shorter.
6. Conductor signature: cap (rounded rect on the crown, brim toward facing, badge dot), two columns of three `amber-1` buttons, `moon` collar wedge, two coat tails off the hip trailing screen-left, watch-chain arc in `amber-1`, glove-coloured fists.
7. `fillOverride` replaces all fills (damage flash); `fillAlpha` multiplies alpha; `squash` scales the torso and head vertically about the feet (`1` = none).
8. `drawShadow`: ellipse at `(x, groundY + 2)`, width `64 · k`, height 12, alpha `0.35 · k`, `k = max(0.35, 1 - height / 200)`.

## Invariants
- No shape thinner than 6 px including outline.
- No `setScale` on the Graphics object; all sizing is in the drawing.

## Tests
- Visual, via 4.03.

## Done when
- [ ] both characters render in every state on the preview page without console errors
