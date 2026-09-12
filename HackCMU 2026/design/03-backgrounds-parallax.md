# 03 — Background, Parallax & Train States

The camera is fixed. **All sense of speed comes from this file.** Every layer is a texture generated once at boot
with Phaser Graphics (`generateTexture`) and scrolled as a `TileSprite`.

## Layers

Six layers, back to front. Each is a seamless horizontal tile scrolled on the X axis and wrapped.

| # | Key | Size | Scroll px/s | How it is generated |
|---:|---|---|---:|---|
| 0 | `bg_sky` | 960 × 540 | 0 | Vertical gradient `night-0` (top) → `night-2` (y = 430). 8 horizontal bands, no dithering |
| 1 | `bg_stars` | 1920 × 440 | **4** | 90 stars from a fixed seed: 1 to 2 px `moon` dots, 8 of them 3 px with a `moon` 40 % halo. Twinkle: alpha-cycle 6 sprites in code |
| 2 | `bg_moon` | 220 × 220 | 0 | `moon` disc r = 70 at `(740, 110)`, two `night-2` crater dots at 30 % alpha, outer glow ring r = 90 at 12 % |
| 3 | `bg_clouds_far` | 1920 × 300 | **14** | 7 cloud blobs, each 3 to 5 overlapping ellipses, `night-2` at 70 %, y in 40 to 200 |
| 4 | `bg_clouds_near` | 1920 × 260 | **38** | 5 larger blobs, `steel-0` at 85 %, bottom edge around y = 330 |
| 5 | `bg_train_roof` | 1920 × 130 | **240** | `steel-1` fill, panel seams every 240 px (`steel-0`, 3 px), rivet pairs every 60 px (`steel-2`, 3 px), one raised ridge 8 px tall at y = 12 (`steel-2` top edge). Top edge = `ROOF_Y` |
| 6 | `bg_train_body` | 1920 × 110 | **240** | `steel-0` fill, windows 60 × 40 every 120 px starting x = 30: `amber-1` fill with a `moon`-tinted 30 % upper glow rect that extends 30 px above the window onto the roof layer (drawn as a separate 30 % `amber-1` gradient strip at y = 430 to 460) |

Scroll direction is **screen-left** for every layer (the train moves right). Layers 5 and 6 share the same speed
and tile width so seams line up. Generate every tile at exactly the width in the table so wrapping is seamless by
construction.

> **13.07 (owner, 2026-09-12):** the car the fighters stand on — layers 5 and 6, the window glow strip and the
> roof lamp fixtures — no longer scrolls; it only bobs. The 240 / 180 "roof speed" is still the train's speed for
> the poles, tunnel wall, foreground silhouettes, rail ballast, gap track slices, final-car track trail, wind,
> sparks and particles. Implementation: `scrollBackgrounds` in `packages/client/src/game/backgrounds.ts`.

```ts
export const PARALLAX = [
  { key: "bg_sky",         speed: 0,   y: 0,   tile: false },
  { key: "bg_stars",       speed: 4,   y: 0,   tile: true  },
  { key: "bg_moon",        speed: 0,   x: 740, y: 110, tile: false },
  { key: "bg_clouds_far",  speed: 14,  y: 60,  tile: true  },
  { key: "bg_clouds_near", speed: 38,  y: 150, tile: true  },
  { key: "bg_train_roof",  speed: 240, y: 430, tile: true  },
  { key: "bg_train_body",  speed: 240, y: 430, tile: true  },
] as const;
```

Advance `tilePositionX += speed * dt` each render frame. Do not move Image objects and wrap them manually.

## The speed ratio is the whole trick

`240 : 38 : 14 : 4` is roughly `1 : 0.16 : 0.06 : 0.017`. The near-ground layer must be *dramatically* faster than
everything else; that contrast is what reads as "fast train". Resist the urge to speed up the clouds.

## Train states

Train car is **sim state** (`MatchState.trainCar`, set per round). The renderer animates it but never decides it.

### Round 1 — `STANDARD`

Layers as above.

### Round 2 — `TUNNEL`

| Change | Value | Transition |
|---|---|---|
| Darkness overlay | `night-0` at 78 % alpha over layers 0 to 4 | fade in 400 ms at round start |
| Stars, moon, clouds | alpha → 0 | fade 400 ms |
| New layer `bg_tunnel_wall` (1920 × 440, speed **420**) | `night-0` fill with `steel-0` brick rows (rows 24 px, bricks 60 px, 1 px mortar) and a wall lamp every 320 px: 12 px `amber-1` disc with a 40 px 25 % glow | fade in 400 ms |
| Window glow strip | brightness × 1.4 (alpha 30 % → 45 %) | fade 400 ms |
| Character rim stroke | `amber-1` only, both edges | instant |

### Round 3 — `FINAL_CAR`

| Change | Value |
|---|---|
| `bg_train_roof` / `bg_train_body` | scroll speed drops to **180** (the last car sways more, reads slower) |
| Railing | a `steel-2` rail drawn from x = 900 to 960 at y = 380 to 430: two horizontal bars, posts every 20 px |
| Marker lamp | `danger` disc r = 6 at (950, 372) with a 30 px 20 % glow, pulsing 1 Hz |
| Track trail | `bg_track_trail` (1920 × 60, speed **300**) below the body: two `steel-2` rails converging slightly, sleepers every 40 px, drawn at y = 480 to 540 |
| Tint | all layers get `danger` at 12 % alpha |
| One-shot | white flash at 30 % alpha, 120 ms, at round start |

## Ground shadow

Each fighter gets an ellipse drawn on the roof, not a texture:

```
ellipse at (fighter.x, ROOF_Y + 2), width 64, height 12, fill outline at alpha 0.35
while airborne: width and alpha scale with height, min 0.35 width factor at apex
```

This is what sells the jump.
