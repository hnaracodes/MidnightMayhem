# 4.04 — Stage: parallax and train states

## Purpose
The moving train roof at night: six generated parallax layers, the tunnel and final-car overlays, and the per-fighter ground shadow. All sense of speed comes from here.

## Files
Create: `packages/client/src/game/backgrounds.ts`.

## Depends on
4.01 (palette).

## Exposes
- `PARALLAX` table (key, speed, y, tile) exactly as `design/03`
- `generateTextures(scene): void` — creates every texture once from a seeded generator
- `interface Layers { tiles; tunnel; track; dark; tint; moon; glow; railing; lamp; roofSpeed }`
- `createBackgrounds(scene): Layers`
- `scrollBackgrounds(layers, dtSec): void`
- `applyTrainCar(scene, layers, car): void`
- `Layers.tiles` is the ordered array of the six parallax `TileSprite`s (sky, stars, clouds far, clouds near, roof, body) so the arena assembler can set depths; `tunnel`, `track`, `dark`, `tint`, `moon`, `glow`, `railing`, `lamp`, `roofSpeed` are the rest of the contract (integrator amendment)
- `applyTrainCar` is idempotent and safe to call before an earlier transition finished: it kills running tweens on the same targets first (integrator amendment)

## Behaviour
1. Textures and their generators follow the table in `design/03` row by row: sky bands, seeded stars with eight haloed ones, moon with glow and two craters, far and near cloud blobs, roof with seams every 240 px and rivet pairs every 60 px and one ridge, body with amber windows every 120 px and a 30 px upward glow strip, tunnel brick wall with lamps every 320 px, track trail with sleepers.
2. Seeded PRNG (LCG) so the sky is identical on both laptops.
3. Layer speeds 0 / 4 / 0 / 14 / 38 / 240 / 240; tunnel wall 420; track 300; all scroll screen-left. Roof and body speed drop to 180 in the final car.
4. `applyTrainCar` tweens over 400 ms: TUNNEL → dark overlay to 78 %, sky layers and moon to 0, tunnel wall to 1, window glow ×1.4. FINAL_CAR → track trail to 1, `danger` tint 12 %, railing and pulsing red lamp visible, white flash 120 ms. STANDARD → everything back.
5. Twinkle: six star sprites alpha-cycle in code.

## Invariants
- No image files; everything from `generateTexture`.
- Tile widths equal the texture widths so wrapping is seamless.

## Tests
- Visual on the preview page and in the arena: the roof visibly streams, clouds barely move, the tunnel darkens with lamps strobing past, the final car shows railing, lamp and track.

## Done when
- [ ] all three cars render and transition without errors
