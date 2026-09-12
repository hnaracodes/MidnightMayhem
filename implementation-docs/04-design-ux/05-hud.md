# 4.05 — HUD and banners

## Purpose
Health bars with ghost drain, round pips, timer, names, car label, countdown and round banners, per `design/04` § HUD and § Banners.

## Files
Create: `packages/client/src/game/hud.ts`.

## Depends on
4.01.

## Exposes
- `class Hud { constructor(scene); update(state: MatchState, dtSec: number): void }`
- `Hud.setNames(names: [string, string]): void` — player names shown under the bars; defaults `THE DRIFTER` / `THE CONDUCTOR`. Names are not in `MatchState`, so 4.07 wires them from the LOBBY message. (integrator amendment)

## Behaviour
1. Bars: at y 24, 380 × 22, from each screen edge inward (P1 grows right from x 20, P2 grows left from x 940). Fill `amber-1` above 50 %, `moon` 25–50 %, `danger` below. Border `outline` 3 px. A `danger` ghost segment behind the fill drains from the previous hp to the current over 400 ms.
2. Round pips: two 6 px circles per side under the bar's far end, filled `moon` when won.
3. Timer at (480, 34): `ceil(roundTicks / 60)`, 40 px bold `moon` with `outline` stroke.
4. Names under the bars in 14 px; car label bottom-right in 12 px `steel-2`.
5. Banners at (480, 240), 96 px bold: `3 / 2 / 1` at 60-tick steps then `FIGHT` in the last 60 ticks of COUNTDOWN; `ROUND n: DRIFTER|CONDUCTOR` or `DRAW ROUND` during ROUND_END; match end text per `design/04`. Each new banner pops from scale 1.4 to 1.0 over 130 ms.
6. HUD hidden in no phase; it is always visible once the arena exists.

## Invariants
- HUD reads only the sampled `MatchState`; never the socket.

## Tests
- Visual: bar colours at 30 / 15 / 8 hp; ghost drain visible after a hit; countdown sequence; banner pop.

## Done when
- [ ] renders correctly through a full match
