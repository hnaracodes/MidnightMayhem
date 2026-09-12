# Phase 4 — Design and UX (`packages/client/src/game`)

Everything the player sees, drawn in code. Spec: `HackCMU 2026/design/00` to `04`. Theme: Midnight Mayhem, a brawl on the roof of a night train. Feature 01 is an owner gate; nothing after it starts until the owner approves the rig preview.

| # | Feature | File | Gate |
|---|---|---|---|
| 01 | Palette, rig data, pose functions | `01-rig-pose.md` | tests |
| 02 | Rig drawing | `02-rig-draw.md` | — |
| 03 | Rig preview page | `03-rig-preview.md` | **owner** |
| 04 | Stage: parallax and train states | `04-stage.md` | — |
| 05 | HUD and banners | `05-hud.md` | — |
| 06 | Effects and feel | `06-effects.md` | — |
| 07 | Arena scene assembly | `07-arena-scene.md` | owner screenshots |
| 08 | Screen styling | `08-screen-styling.md` | owner |

Module layout:
```
packages/client/src/game/
  palette.ts            01
  rig/characters.ts     01
  rig/pose.ts           01
  rig/draw.ts           02
  backgrounds.ts        04
  hud.ts                05
  effects.ts            06
  ArenaScene.ts         07 (replaces the 3.06 placeholder)
packages/client/rig.html, src/rigPreview.ts   03
```

Drawing model: one `Phaser.GameObjects.Graphics` per fighter, cleared and redrawn every frame from `computePose`. Backgrounds are textures generated once with `generateTexture` and scrolled as `TileSprite`s. HUD is one Graphics plus Text objects. Effects are short-lived Graphics or tweens.
