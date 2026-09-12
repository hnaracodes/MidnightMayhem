# 4.03 — Rig preview page (OWNER GATE)

## Purpose
A standalone page that shows both fighters in every pose at 2× on the real generated background so the owner can approve or correct the look before the arena is built around it. This is the earliest and cheapest point to find out whether the procedural style works.

## Files
Create: `packages/client/rig.html`, `packages/client/src/rigPreview.ts`.

## Depends on
4.01, 4.02, 4.04 (backgrounds; if 4.04 is not ready, use a flat `night-1` fill and a `steel-1` roof band).

## Exposes
- URL `/rig.html` in dev and build.
- `window.__rig = { setState(state, tick), setFacing(f), setCar(car), setWind(px), flash(), overlays(bool) }` dev hook so the headless driver can pose the page without clicking (integrator amendment). `setState` pins a per-state tick: punch elapsed, ko frames, hit hitstun, walk x, idle/block/win render ms.

## Behaviour
1. A Phaser scene at 960 × 540 rendered at 2× CSS scale. Background per 4.04 scrolling at the standard speed.
2. Two rows: Drifter facing right, Conductor facing left, each showing a column per state: idle, walk, jump (rising, apex, falling, with ghosts), punch, block, hit, ko, offbounds, win. Labels under each in 12 px `steel-2`.
3. Controls (DOM above the canvas): a punch tick slider 0–14 applied to the punch column; a facing toggle; a train-car select (STANDARD / TUNNEL / FINAL_CAR); a wind-speed slider; a "flash" button that triggers the damage flash on both; a checkbox for hurtbox and hitbox overlays.
4. The idle and walk columns animate; walk uses a fake `x` that increases with time.
5. A readability checklist panel (from `design/00`) with checkboxes the owner ticks; nothing is stored.

## Invariants
- Uses `computePose` and `drawFighter` unchanged; no preview-only drawing code.

## Tests
- Owner gate: silhouettes read at 150 px against the sky; Drifter reads as shaggy, bearded, ragged; Conductor reads as capped and uniformed; punch contact pose is obvious at tick 4; ghosts read as a dodge; feet sit on the roof line in every grounded state; the wind direction is visible.

## Done when
- [ ] owner writes "rig approved" or a list of corrections; corrections are applied in 4.01/4.02 and re-reviewed before 4.05–4.08 start
