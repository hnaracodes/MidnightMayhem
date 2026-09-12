# 00 — Art Direction & Stage Geometry

## The pitch in one line

Two men fight on the roof of a night train. One has nothing left to lose; the other is defending a
timetable. Everything is lit by moonlight and the orange spill of carriage windows below.

## Style

**Procedural vector 2D.** Flat fills, thick dark outlines, hard readable silhouettes, two-tone lighting.
Think a stylised stickman brawler with weight: limbs are thick capsules, torsos are rounded quads, heads are
circles with one signature shape (cap, beard). Not pixel art, not painted texture, not debug rectangles.

Non-negotiable style rules, every drawn element must satisfy these:

1. **Silhouette first.** A fighter must be identifiable as a single dark shape at 150 px. Drifter = ragged,
   wide, low. Conductor = sharp, narrow, vertical, capped.
2. **Cool ambient, warm rim.** Base fills use the character key colour darkened toward `night-1`. The edge of
   every limb on the side away from the moon (screen-left of the moon at x = 740, so the **right** edge of
   each shape) gets a 3 px `amber-1` stroke segment. This is what separates fighters from the dark background.
3. **Side view, orthographic.** The rig is authored facing screen-right; facing left multiplies every x offset
   by -1. Never author a second orientation.
4. **Feet on a flat ground plane.** Feet sit exactly on `ROOF_Y`. No perspective floor.
5. **Ground shadow drawn by code.** Ellipse under each fighter, see `04-vfx-and-feel.md`.
6. **No text or UI inside the arena** except the HUD band at the top.

## Palette

Defined once here; every other doc references these names. Put them in `packages/client/src/game/palette.ts`.

| Token | Hex | Use |
|---|---|---|
| `night-0` | `#070B18` | Deepest sky, tunnel fill |
| `night-1` | `#101A33` | Sky mid |
| `night-2` | `#1E2B4D` | Sky near horizon, distant hills |
| `steel-0` | `#232733` | Train roof shadow side |
| `steel-1` | `#3A404F` | Train roof base |
| `steel-2` | `#5B6375` | Roof highlight, rivets |
| `moon` | `#E8F0FF` | Moon disc, star cores, cold rim light |
| `amber-1` | `#F2A03D` | Window spill, warm rim light |
| `amber-2` | `#C2601B` | Warm shadow, rust |
| `danger` | `#E8434F` | Out-of-bounds vignette, damage flash |
| `drifter-key` | `#8A6B4A` | Drifter's dominant cloth tone |
| `drifter-skin` | `#C9A27E` | Drifter face, hands |
| `conductor-key` | `#1B2A5C` | Conductor's dominant coat tone |
| `conductor-glove` | `#E6E6EA` | Conductor gloves, cap badge highlight |
| `outline` | `#05070F` | Every shape outline, 3 px |

Drifter and Conductor key colours are deliberately warm-vs-cool so they read apart even when overlapping.

## Screen and stage geometry

All values are in **logical units = render pixels at ×1**. The canvas is 960 × 540 and integer-scales to the window.
These are the same constants as `WORLD` in `packages/shared/src/constants.ts`; the renderer imports them, never
redeclares them.

```
WORLD_WIDTH    = 960
WORLD_HEIGHT   = 540
ROOF_Y         = 430     // ground plane; fighters' feet sit exactly here
PLAYER_START_X = [280, 680]
CHAR_HEIGHT    = 150     // standing, crown of head to sole
HURTBOX        = { w: 72, h: 140 }   // anchored bottom-centre at the fighter's feet
```

Vertical budget above the roof: 430 px. A fighter at 150 px plus a jump apex of 120 px tops out around
`y = 160`, leaving the upper 160 px permanently clear for moon, stars and HUD.

## Out-of-bounds zone

```
SOFT_EDGE_L    = 72
SOFT_EDGE_R    = 888
HARD_EDGE_L    = 0
HARD_EDGE_R    = 960
```

- Fighter inside the 72 px margin → a `danger` vignette fades in on that edge, alpha proportional to depth.
- Fighter at the hard edge (sim clamps x to 0 or 960) → rig drawn at 60 % alpha in the `offbounds` lean pose,
  damage over time applies (sim rule, 3 HP per 30 ticks).
- Recovery is always possible by walking back in. There is no instant ring-out.

## Camera

Fixed. No pan, no zoom. Shake only on heavy hits (see `04-vfx-and-feel.md`). The parallax background supplies all
sense of motion.

## Readability checklist (apply to every rig pose and every generated texture)

- [ ] Silhouette reads at 150 px against `night-1`
- [ ] Warm rim stroke present on the edge away from the moon
- [ ] Feet land on `ROOF_Y`, not a curve
- [ ] Authored facing screen-right; left is a sign flip
- [ ] No shape thinner than 6 px; limbs are 14 to 18 px capsules
