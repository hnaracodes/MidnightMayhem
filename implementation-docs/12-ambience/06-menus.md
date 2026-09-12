# 12.06 — Menus and transitions: re-lit landing and lobby, iris wipes, lit portraits

## Purpose
The landing and lobby have an approved design (`docs/superpowers/specs/2026-09-12-ui-design-notes.md`: the railway
ticket, the seat manifest, one amber accent) and keep all of it. This lane re-lights them so they belong to the new
arena behind them — a fog scrim that warms toward the lamps, amber that glows, panels that recess — and joins the
screens with a slow iris wipe. Character portraits get the arena's rim treatment so what you pick is what you see.

## Files
Modify: `packages/client/index.html` (CSS only), `src/main.ts` (wipe calls at the four transitions),
`src/app/sprites/portrait.ts` (rim colour/side, ground), `test/portrait.test.ts`.
Create: `src/app/wipe.ts`, `test/wipe.test.ts`.
Owns `wipe.ts`, the CSS of `index.html`, `portrait.ts`.

## Depends on
12.02 (`P.glow1`, `P.lamp`, `P.bone`, `P.void0`, `P.haze`, `PixelCanvas.rim(color, side, outline)`), 11.03 (landing,
lobby, result overlays and their focus management), 11.05 (`session.reducedMotion`).

## Exposes
`app/wipe.ts`:
```ts
export const WIPE_MS = 350;
export function wipeDurationMs(reducedMotion: boolean): number;   // 0 under reduced motion, else WIPE_MS
export function irisWipe(reducedMotion: boolean, swap: () => void): Promise<void>;
```
`irisWipe` closes a `void0` iris over the page (a fixed overlay whose `clip-path: circle()` shrinks from the
corners to nothing at the centre over `WIPE_MS / 2`), runs `swap()` (the screen change) at the closed point, then
opens the iris over the other half and removes the overlay. Under reduced motion it runs `swap()` at once and
resolves. It never blocks input longer than `WIPE_MS`; a second wipe while one runs queues its `swap` after the
first without adding an overlay.
`index.html` gains CSS custom properties `--void-0`, `--haze`, `--bone`, `--glow-1`, `--lamp` next to the existing
palette variables.

## Behaviour
1. Scrims: the landing keeps its top-heavy night gradient but the flat night-0 stops become a fog — `haze` at low
   alpha in the middle band and a `lamp` warmth at the roof line (`radial-gradient` at the lamp's side, alpha ≤ 0.12)
   layered over it — so the live stage and its pools show through; the lobby scrim (88 %) becomes 82 % night-0 with
   the same haze band so the roof lamps read behind the manifest.
2. Amber accents (room code, ticket edge, selected segments, ready mark, primary button) gain a soft outer glow
   (`box-shadow: 0 0 12px rgba(242, 160, 61, 0.35)`); the primary button's glow doubles on hover/focus. Nothing
   else glows.
3. Panels (ticket, seats, board rows, result card) get a 1 px inner top highlight (`inset 0 1px 0 rgba(233, 226, 207,
   0.08)`) and a deeper recess (`inset 0 -2px 0 rgba(3, 5, 12, 0.6)` plus a `void0` 60 % outer shadow). Radii,
   borders, copy and layout do not change.
4. Wipes: `main.ts` calls `irisWipe` at landing → lobby (`landing.hide()` + `renderRoom()` in the swap), lobby → arena
   (`lobby.hide()`), arena → result (`showResult()`), result → lobby (the rematch's `renderRoom()`); skipped under
   `session.reducedMotion`. Focus management inside each screen is untouched: the swap runs the same code as before.
5. Portraits: `portraitPixels` rims the head and shoulders with `lamp` on the right (the lamp side of the seat
   manifest) and dithers the left edge toward `night1` like the arena sprite; the ground behind the portrait is
   `void0`. Every character still fills the cell with an outlined head over shoulders (`portrait.test.ts`).
6. `prefers-reduced-motion` still keeps the train still (11.03) and now also removes the wipe.

## Invariants
- Layout, copy, focus order and keyboard handling of every screen are unchanged; `landing.test.ts`,
  `lobby.test.ts`, `result.test.ts`, `setup.test.ts` stay green without edits.
- No network fonts, no images; the wipe is one DOM element with a CSS transition.
- The wipe overlay is `pointer-events: none` and `aria-hidden`; it never traps focus.

## Tests
`wipe.test.ts` (happy-dom): `wipeDurationMs`; `irisWipe` runs `swap` synchronously under reduced motion and adds no
element; otherwise adds one overlay, runs `swap` after the close half, removes the overlay at the end, and a second
wipe during the first runs both swaps in order with a single overlay. `portrait.test.ts`: the rim pixels are `lamp`
and sit on the right edge only.

## Done when
- [ ] tests pass, `pnpm test` and `pnpm typecheck` green
- [ ] `.shots/integration-landing.png`, `integration-lobby.png` and `integration-4p-result.png` reviewed by the agent
- [ ] committed on `feat/graphics-enhancement` with prefix `ambience:`
