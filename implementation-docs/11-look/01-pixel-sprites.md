# 11.01 — Pixel-art paper-doll sprites, four characters

## Purpose
Replace the vector stickmen with detailed pixel-art fighters without adding a single image file: hand-authored
pixel grids for the parts that carry personality (head, torso, hands, feet, item in hand), limbs rasterised from
the existing tested skeleton poses, everything composited at 3× with nearest-neighbour scaling. Four characters:
Drifter, Conductor, Stoker, Claude Code.

## Files
Create: `packages/client/src/game/sprites/grid.ts` (grid parsing, palette, raster helpers), `sprites/parts/drifter.ts`,
`parts/conductor.ts`, `parts/stoker.ts`, `parts/claude.ts`, `parts/items.ts`, `sprites/compose.ts` (pose → pixel frame),
`sprites/SpriteFighter.ts` (Phaser side), `packages/client/sprites.html`, `src/spritePreview.ts`, `test/sprites.test.ts`.
Modify: `packages/client/src/game/rig/characters.ts` (add `stoker`, `claude` rig rows so `computePose` works for them),
`src/game/palette.ts` (add `stokerKey 0x4A4E57`, `stokerSkin 0xB98B6B`, `stokerRed 0xB8323C`, `claudeOrange 0xD97757`,
`claudeInk 0x1A1A1E`, `claudeGlove 0xFFFFFF`, `claudeScreen 0x0E1A14`, `claudeGreen 0x7CF29A`), `vite.config.ts` (add
`sprites.html` to inputs and `optimizeDeps.entries`).
Owns `src/game/sprites/**`, `rig/characters.ts`, `palette.ts`, `sprites.html`, `src/spritePreview.ts`. Does not edit
`rig/pose.ts`, `rig/draw.ts`, `ArenaScene.ts`.

## Depends on
8.01 (`CHARACTERS` with four ids, `FighterState.item`, `Action` kinds).

## Exposes
`grid.ts`:
- `type Grid = string[]` — each string one row; characters index `GRID_PALETTE`: `.` transparent, `o` outline,
  `k` key, `K` key dark, `s` skin, `S` skin shade, `h` highlight (moon), `a` amber-1, `A` amber-2, `w` white, `d` danger,
  `1`–`4` per-character extras (declared in the part file).
- `interface Part { grid: Grid; anchor: { x: number; y: number }; /** pixel that sits on the joint */ }`
- `parseGrid(grid, colors: Record<string, number | null>): Uint32Array` + `w`, `h` (validated: every row equal length,
  every char known — throws otherwise).
- `class PixelCanvas { constructor(w, h); set(x, y, rgba); line(x0, y0, x1, y1, thickness, color); disc(cx, cy, r, color);
  blit(part, x, y, flipX); outline(color) /* 1 px outline around every opaque pixel */; dither(fromX, toX, color, alpha) }`

`compose.ts`:
- `SPRITE_SCALE = 3`, `FRAME_W = 40`, `FRAME_H = 56` (sprite px; feet at row 52, anchor x 20)
- `interface CharacterParts { head: Part; headKo: Part; torso: Part; torsoBlock?: Part; handOpen: Part; handFist: Part;
  foot: Part; extras: Record<string, number>; limbColor: number; limbShade: number; legColor: number }`
- `CHARACTER_PARTS: Record<CharacterId, CharacterParts>`
- `composeFrame(canvas: PixelCanvas, joints: Joints, f: FighterState, characterId, opts: { facing; rimBoth; flash?: number;
  flashAlpha?: number; alpha: number; itemVisible: boolean })` — draws, back to front: back leg (thigh + shin as 4 px lines,
  foot part), back arm (upper 4 px, fore 3 px, hand part), torso part at the hip→neck segment (rotated by the lean in
  15° steps by choosing pre-authored `torso` for |lean| < 8° and skewing rows otherwise), head part at the head centre
  (`headKo` when `joints.state === "ko"`), front leg, front arm, item part at the front hand when `f.item` and
  `itemVisible`; then 1 px outline; then a 1 px moon-side highlight on the right edge (rim) and a 2×2 dither band
  on the left; `flash` mixes every opaque pixel toward the flash colour.
- `jointToSprite(joint: Pt, f: FighterState): { x, y }` — world → sprite px relative to the frame anchor (feet at
  `(20, 52)`), `round`ed.

`parts/*.ts`: the grids. Minimum detail per character (agents: count these — the reviewer will):
- head ≥ 14 × 14 with at least 3 colours plus outline; a `headKo` variant (eyes ×, cap/hair displaced).
- torso ≥ 12 × 18 with the signature (Drifter: rope belt, ragged hem, wrap bands; Conductor: buttons in two columns,
  collar, watch chain; Stoker: sleeveless vest, soot smudges, red neckerchief, goggles on the forehead; Claude Code: a
  dark terminal window with a 1 px `claudeGreen` border, a `>_` prompt whose underscore blinks — two grids, `torso`
  and `torsoBlink`, swapped every 500 ms — and a tiny orange sunburst badge).
- Claude Code head: an eight-armed `claudeOrange` sunburst (the arms are 2 px wide, 3–4 px long, alternating long/short)
  around a 6 px disc with two `claudeInk` dot eyes; `headKo` has the arms drooping (shifted down 1 px) and eyes `x`.
- Stoker head: bald with a 2 px goggles band, thick brows, stubble dots, a coal smudge on one cheek.
- hands: open and fist, 5 × 5; Conductor gloves white, Claude gloves white, Drifter bare, Stoker bare with soot.
- feet 7 × 4; Claude Code feet are rounded `claudeInk` sneakers with a white stripe.
- `parts/items.ts`: `ITEM_PARTS: Record<ItemId, Part>` 10–14 px: bottle with amber liquid and a rag, umbrella (folded,
  hooked handle), backpack (worn on the back: composed at the torso back, not the hand), banana, phone with a lit screen.

`SpriteFighter.ts`:
```ts
class SpriteFighter {
  constructor(scene: Phaser.Scene, index: PlayerIndex, depth: number);
  /** Re-rasterise this frame into the fighter's CanvasTexture and position the Image. */
  update(f: FighterState, joints: Joints, opts: { rimBoth: boolean; flash?: number; flashAlpha?: number; squash: number; itemVisible: boolean; blinkMs: number }): void;
  setVisible(v: boolean): void; destroy(): void;
  /** World position of the front hand this frame (for item FX and materialise). */
  hand(): { x: number; y: number };
}
```
Uses `scene.textures.createCanvas`, one per fighter, `Image` with `setScale(SPRITE_SCALE)`, `texture.setFilter(NEAREST)`,
origin at the feet anchor; `squash` scales y about the feet as the vector rig did.

`spritePreview.ts` / `sprites.html`: a grid of every character × state (`idle, walk, jump, punch, block, hit, ko,
win, throw, laser`) at 3× and one row at 6×, each holding a different item, cycling walk/idle frames on a timer;
`?rig=vector` shows the old rig beside each for comparison; exposes `window.__sprites`.

## Behaviour
1. Every grid parses (equal row lengths, known chars); every `CharacterParts` field is present; parts have the minimum
   sizes above.
2. `composeFrame` for `idle` on each character produces a frame whose opaque pixels span ≥ 44 rows (≈ 132 world px
   of a 150 px fighter) and ≤ 40 columns, with the feet row at 52 and nothing below it.
3. Facing left mirrors the frame exactly (pixel-for-pixel flip of the facing-right frame with the same joints).
4. The outline pass never leaves an opaque pixel without an `o` neighbour on the silhouette edge (sample the frame's
   border pixels).
5. During an active punch the front hand part is centred within 2 sprite px of `jointToSprite(joints.arms[punchingArm].fist)`.
6. Item part is drawn at the front hand for molotov, sword, banana, flash; the backpack is drawn behind the torso at
   the back shoulder; `itemVisible: false` draws no item.
7. `headKo` and the blink torso are selected by state and `blinkMs`.
8. `SpriteFighter.update` runs under 0.5 ms per fighter on the headless driver (measure in the preview, log it).

## Invariants
- No `<img>`, no `load.image`, no data URLs: every texture comes from `PixelCanvas` → `CanvasTexture`.
- `compose.ts` and `parts/*.ts` import nothing from Phaser (pure; testable in vitest).
- The silhouette rule from `design/00` still holds: each character reads as a distinct dark shape at 150 px.

## Tests
`sprites.test.ts`: rules 1–7 (pure), rule 8 as a console log in the preview.

## Done when
- [ ] tests pass, `pnpm test` and `pnpm typecheck` green
- [ ] `sprites.html` screenshot `.shots/sprites.png` taken with `tools/shot.mjs` and reviewed by the agent: every cell
  populated, four visibly different characters, items visible, Claude Code recognisable (sunburst head, terminal torso)
- [ ] committed on `feat/sprites` with prefix `design:`
