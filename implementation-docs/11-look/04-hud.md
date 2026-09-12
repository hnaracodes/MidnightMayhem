# 11.04 — HUD for up to four fighters, items, laser, modes

## Purpose
The top band now has to say who is who among four fighters, which team they are on, what each is holding and how
many uses are left, when the laser is back, and how the round ends in this mode.

## Files
Modify: `packages/client/src/game/hud.ts`, `packages/client/dev/hud.html`, `src/dev/hudPreview.ts`.
Create: `test/hud.test.ts` (pure layout helpers).
Owns `hud.ts`, `dev/hud.html`, `src/dev/hudPreview.ts`.

## Depends on
8.01 (`MatchState.fighters[]`, `config`, `HeldItem`, `laserCooldown`, `MODES`), 10.02 `timerSeconds` (import from
`@midnight/shared`; if not merged yet, compute `ceil(roundTicks / 60)` locally behind the same name and note it).

## Exposes
- `class Hud { constructor(scene); setNames(names: string[]): void; update(state: MatchState, dtSec: number): void }` (same shape).
- Pure, exported for tests: `barLayout(players: number, i: PlayerIndex): { x: number; y: number; w: number; align: "left" | "right" }`,
  `teamColor(state, i): number`, `timerText(state): string`, `itemGlyph(item: HeldItem | null): string`,
  `cooldownFraction(f): number`.

## Behaviour
1. Layout: 2 players → as today (380 px bars). 3 → P0 left, P1 right, P2 centred below the timer (w 300). 4 → two
   stacked per side (w 320, 14 px tall, 8 px apart); names under each bar. `barLayout` is the single source.
2. Team colour: FFA → the character key colour; 2v2 → team A `amber-1`, team B `moon`, as a 4 px bar outline and a
   small "A"/"B" tag.
3. Item slot: right of each bar (mirrored on the right side) a 22 px box with `itemGlyph` (▲ molotov, / sword,
   ▣ shield, ◗ banana, ✦ flash, blank when none) and `uses` pips under it; the two loadout items appear as dim outlines
   before they are equipped and a struck-through outline once used this round.
4. Laser: a 16 px ring next to the item slot filling clockwise from `1 − laserCooldown / LASER_COOLDOWN`; full ring
   pulses `amber-1` twice when it becomes ready (edge detected in `update`).
5. Timer: `timerText` → `"∞"` in deathmatch, `MM:SS` when ≥ 60 s, seconds otherwise; under 10 s it turns `danger`
   as today.
6. Round pips: one row per team when 2v2 (two rows), per fighter otherwise; `MODES[mode].roundsToWin` pips each.
7. KO'd fighter (hp 0, round still running — FFA/2v2): bar turns `steel-0` with a "OUT" tag.
8. Dazzled fighter: a small ✦ blinking beside the name for the duration.
9. Banners as today; `ROUND_END` text names the team ("TEAM A TAKES THE ROUND") in 2v2 and the character otherwise;
   `MATCH_END` likewise. Countdown and FIGHT unchanged.

## Invariants
- Presentation only; nothing here is a sim number except through `@midnight/shared` constants.
- The HUD band stays within `y < 90` for 2–3 players and `y < 110` for 4 so no rig head is covered (rig heads ≈ 250).

## Tests
`hud.test.ts`: `barLayout` for 2/3/4 never overlaps and stays inside the width; `timerText` for the three modes;
`itemGlyph`; `cooldownFraction` bounds; `teamColor` in ffa vs 2v2.

## Done when
- [ ] tests pass, `pnpm test` and `pnpm typecheck` green
- [ ] `dev/hud.html` shows 2, 3 and 4-player layouts with items, cooldowns, a KO'd fighter and a dazzled one
  (`?players=4&teams=2v2`); screenshots `.shots/hud-{2,3,4}.png` reviewed by the agent
- [ ] committed on `feat/hud` with prefix `design:`
