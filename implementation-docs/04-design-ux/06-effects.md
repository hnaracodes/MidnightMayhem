# 4.06 — Effects and feel

## Purpose
The mayhem: hit-stop, flashes, shake, KO slowdown, landing squash, sparks, block ring, dust, danger vignette. Driven only by `SimEvent`s and state; never predicted.

## Files
Create: `packages/client/src/game/effects.ts`.

## Depends on
4.01, 4.02.

## Exposes
- `class Effects { constructor(scene); consume(events: SimEvent[], state: MatchState, newest?: MatchState): void; frozen(i): FighterState | null; fillFor(i): { fillOverride?, fillAlpha? }; squashFor(i): number; update(dtSec): void }`
- `consume`'s third argument is the newest snapshot in the buffer (`session.buffer.latest()`, the snapshot that carried the events; defaults to `state`). Hit-stop freezes `newest`, not the 50 ms-delayed sampled `state`, so the held pose is the contact pose: attacker's arm extended, target in hitstun, and with `?debug=1` the active hitbox stays drawn through the freeze. (polish amendment)
- `koFrames(i): number` — ko-frames since the KO `ROUND_END` for that fighter, 0 when none. Advances by `timeScale()` per render frame, so the 30-frame collapse in `koPose` spans ~120 render frames (2 s) at 0.25× (polish amendment; was render frames, which let the collapse play at full speed while only the knockback tail was slowed)
- `landFrames(i): number` — render frames since that fighter's last landing, large when none yet (integrator amendment)
- `timeScale(): number` — 0.25 while a KO collapse is playing (`koFrames(i) < 30` for a KO'd fighter), else 1; the scene multiplies its render clock by it (integrator amendment; polish amendment ties the window to the collapse instead of a fixed 30 render frames). The `RenderClock` catch-up at 2× therefore starts when the collapse ends and takes ~1.5 s to close the lag; the six-entry snapshot buffer caps the visible lag at ~200 ms meanwhile. The HUD round banner still appears when the sampled state reaches `ROUND_END` (at the start of the collapse, not after it as `design/04` describes) — owner decision, unchanged.
- `drawTrail(i, shoulder: {x,y}, fist: {x,y}): void` — the scene calls this during active punch ticks with the joints from `computePose`; draws the rule 7 arc (integrator amendment)
- Effects imports nothing from `rig/`; joints cross the boundary as structural `{x, y}` points. Hit-stop is a display freeze through `frozen(i)`, never a Phaser pause; shake goes through `scene.cameras.main.shake` (integrator amendment)
- Dev-only preview: `packages/client/dev/fx.html` + `src/dev/fxPreview.ts`, not a build input, exposes `window.__fx` for the screenshot driver (integrator amendment)

## Behaviour
1. HIT not blocked: freeze both fighters' displayed state for 4 render frames (`frozen(i)` returns the snapshot at the hit); target `fillOverride` white 70 % for 2 frames then `danger` 30 % for 4; `fx_impact` spark at the target's chest offset 20 px toward the attacker (8 radial `amber-1` lines plus a `moon` core, scale 0.6→1.3 over 6 frames, fading); camera shake 3 px for 6 frames when damage ≥ 12.
2. HIT blocked: target `moon` 40 % for 2 frames; `fx_block` ring r 12→28 over 5 frames; no shake, no stop.
3. JUMP: dust puff at the feet (three `steel-2` circles r 6→12 drifting screen-left 20 px over 8 frames). Landing (grounded false→true): dust plus `squashFor(i)` = 1.06/0.94 for 4 frames.
4. Walk: a dust puff every 10th tick of continuous walking.
5. ROUND_END with a fighter at 0 hp: KO slowdown, the scene advances its render clock at 0.25× for 30 frames so the ko pose plays slow; the sim is unaffected.
6. Danger vignette: a 72 px gradient rectangle on the edge a fighter is within `SOFT_EDGE` of, alpha `0.5 · depth / 72`, pulsing at 2 Hz while `OOB_DAMAGE` events arrive.
7. Punch trail: during active ticks, a 2-frame `moon` 30 % arc from shoulder to fist.
8. All effect Graphics are destroyed when their timer ends; a pool is not required.

## Invariants
- Nothing here changes hp, positions, or the winner; every effect is a reaction to an event or a state read.
- Effects fire once per event id (events arrive exactly once from the server; the scene drains them once).

## Tests
- `packages/client/test/effects.test.ts` (integrator amendment): frame counters, flashes, freeze, KO `timeScale`, vignette alpha and Graphics destruction against a stub scene.
- Visual in the arena: a clean hit stops, flashes, sparks and shakes; a blocked hit only rings; jumping and landing puff dust; the edge glows red and pulses while draining hp.

## Done when
- [ ] all effects visible in a keyboard match
- Rule 1 `fx_impact` position (and the blocked ring) is computed from `newest`, the snapshot that carried the HIT,
  so the spark sits on the frozen target's chest rather than up to a knockback step away from it. (review fix)
