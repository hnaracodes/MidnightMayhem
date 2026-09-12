# 12.05 — HUD restyle: etched chrome, bone ink, breathing low-HP, ink-bleed banners

## Purpose
The HUD is arcade-readable and stays that way — every rect from `barLayout` / `toastLayout` and every text position
is kept — but its chrome is flat fills with hard strokes over a stage that now has depth and light. This lane
restyles the finish only: recessed channels, a bone highlight, a glow that grows as health drops, carved round pips,
recessed slot bezels, bone type on the same condensed railway stack the landing uses, a breathing vignette and a
heartbeat for the fighter about to fall, and banners that bleed in from dark instead of popping.

## Files
Modify: `packages/client/src/game/hud.ts`, `packages/client/dev/hud.html`, `src/dev/hudPreview.ts` (a low-HP query),
`test/hud.test.ts`, `tools/e2e/ambience-dev.json` (1 HP shots).
Owns `hud.ts`, `dev/hud.html`, `src/dev/hudPreview.ts`.

## Depends on
12.02 (`P.bone`, `P.void0`, `P.lamp`), 11.04 (`barLayout`, `HUD_BAND`), 9.08 (`toastLayout`).

## Exposes
`hud.ts`, pure and exported for tests:
- `barGlowAlpha(hp: number): number` — `0.1 + 0.4 · (1 − hp / MAX_HP)`.
- `lowHpPulse(sec: number): number` — 0..1 heartbeat (two beats per 1.2 s cycle) for the low-HP bar and vignette.
- `bannerFade(sec: number): { alpha: number; tint: number }` — the ink-bleed entrance over 0.28 s: alpha 0 → 1
  eased-out, tint `void0` → white (so `bone` text blooms up from dark), no scale.
- `HUD_FONT` — the condensed local stack: `"Avenir Next Condensed", Bahnschrift, "Arial Narrow", "Helvetica Neue",
  Impact, sans-serif`, weight 800 (the landing's display stack; no network fonts).
- `LOW_HP_FRACTION = 0.25` (the existing danger threshold).

## Behaviour
1. Bars keep their footprint, symmetry, team outline and drain animation. The channel is `void0` with a 1 px `night2`
   line along its bottom edge (a recess), the fill keeps the HP colour ramp (`amber1` above 50 %, `moon`, `danger`
   below 25 % — the arcade signal the owner approved) with a 1 px `bone` highlight along its top and a 2 px `outline`
   inner shadow along its bottom; a soft glow (three expanding rects in the fill colour, alpha `barGlowAlpha(hp)` split
   over them) sits outside the team frame and grows as HP drops. The team colour stays the 4 px frame and the tag.
2. Names, tags, the timer, the car label and the banner use `HUD_FONT` in `bone` with a 2 px `void0` stroke and a
   warm `lamp` shadow-glow (blur 6, alpha 0.35) instead of the 4–6 px hard strokes; sizes unchanged; the timer still
   turns `danger` under 10 s; `setColorIfChanged` still guards every recolour.
3. Round pips are carved marks: a diamond (r 6 / 5) with an `outline` edge, filled `steel1` when unwon and `moon` when
   won, with a 1 px `bone` facet on the upper-left edge of a won pip.
4. Item slots and the two loadout minis get a recessed bezel: `void0` fill, `outline` chamfered edge as today, a 1 px
   `night2` shadow inside the top and left edges and a 1 px `steel2` lip inside the bottom and right edges; the
   cooldown ring's track is `void0` with a `night2` inner edge.
5. Low HP (`hp / MAX_HP ≤ LOW_HP_FRACTION`, fighter alive, round running): a slow breathing vignette on the screen
   edges — 12 `danger` strips per edge like `Effects.drawVignette` but 40 px wide, peak alpha `0.18 · lowHpPulse`,
   at depth 10 (under the OOB vignette's pulse at 2 Hz and above the stage), drawn once for all low fighters — and a
   heartbeat on that fighter's bar only: the glow alpha multiplied by `0.6 + 0.4 · lowHpPulse`.
6. Banners (`3 2 1 FIGHT`, round end, match end) enter with `bannerFade`: alpha and tint bloom up from dark over
   0.28 s with a `void0` halo (an ellipse 1.4 × the text width, alpha 0.35 → 0.2 over the fade, depth 10.9) under the
   text; the 1.4 → 1 scale pop is retired. Text changes restart the fade.
7. `HUD_BAND` clearances hold; the glow and vignette are the only things drawn outside a bar's rect and both stay
   within the band (glow ≤ 8 px outside the frame).
8. `dev/hud.html` honours `?hp=<n>` (every fighter's hp) and `?low=<i>` (one fighter at 1 HP) so the low-HP state can
   be shot.

## Invariants
- Presentation only; no layout value in `barLayout`, `toastLayout`, `HUD_BAND` moves.
- No new fonts; the stack is the one already used by `index.html`.
- Every number stays legible at 50 % browser zoom: minimum text size unchanged (9 px minis), stroke never below 2 px on
  names and numerals.

## Tests
`hud.test.ts`: `barGlowAlpha` at full / half / 1 HP; `lowHpPulse` bounds, period and two beats per cycle;
`bannerFade` at 0, mid and end (alpha 1, tint white); the existing layout and helper tests unchanged.

## Done when
- [ ] tests pass, `pnpm test` and `pnpm typecheck` green
- [ ] `.shots/ambience-hud-{2p,3p,4p}.png` and `ambience-hud-{2p,4p}-low.png` reviewed by the agent; every number
  legible at 50 % zoom
- [ ] committed on `feat/graphics-enhancement` with prefix `ambience:`
