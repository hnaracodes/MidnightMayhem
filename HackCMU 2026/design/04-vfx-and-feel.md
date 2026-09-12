# 04 — VFX & Feel (the mayhem)

Under-budgeted feedback is the most common reason a hackathon fighter feels dead. Everything here is code-driven
Phaser Graphics, triggered by `SimEvent`s from snapshots. Nothing here predicts damage.

## Code-driven feel (do all of these, in this order of value)

| Effect | Trigger | Spec |
|---|---|---|
| **Hit-stop** | `HIT` (not blocked) | Freeze both rigs' pose interpolation for **4 render frames**. Background keeps scrolling. This single change does more for impact than anything else |
| **Damage flash** | `HIT` (not blocked) | Target rig fills `#FFFFFF` at 70 % for 2 frames, then `danger` at 30 % for 4 frames |
| **Chip flash** | `HIT` (blocked) | Target rig fills `moon` at 40 % for 2 frames only. Visibly weaker than a clean hit |
| **Screen shake** | `HIT` with damage ≥ 12 | 3 px amplitude, 6 frames, decaying. Never on chip |
| **KO slowdown** | `ROUND_END` with a fighter at 0 HP | Renderer holds the last two snapshots and plays the KO pose over 30 frames before showing the round banner. The sim does not slow; only presentation |
| **Landing squash** | `grounded` flips true | Torso scale 1.06 × 0.94 for 4 frames, plus `fx_dust` |
| **Health bar drain** | `hp` decreases | Bar shrinks immediately; a `danger` ghost segment behind it drains over 400 ms |

## Procedural sparks and puffs

| Effect | Trigger | Drawing |
|---|---|---|
| `fx_impact` | `HIT` not blocked, at the target's chest (feet − 90) offset 20 px toward the attacker | 8 radial `amber-1` lines 14 to 26 px, plus a `moon` core circle r = 10, over 6 frames scaling 0.6 → 1.3 and fading |
| `fx_block` | `HIT` blocked | A `moon` ring r = 12 → 28 over 5 frames, 3 px stroke, fading. Tighter and cooler than impact; reads as *deflected* |
| `fx_dust` | `JUMP` and landing, and every 10th walk step | 3 `steel-2` puffs r = 6 → 12 at the feet drifting screen-left 20 px over 8 frames, fading |
| `fx_oob` | fighter at hard edge | `danger` vignette: a 72 px gradient rect on that edge, alpha 0 → 0.5 by depth past the soft edge; pulses at 2 Hz while damage applies |
| `fx_punch_trail` | `punch` active ticks | A 2-frame `moon` 30 % arc from the shoulder to the fist |

## Banners

| Moment | Text | Style |
|---|---|---|
| Countdown | `3`, `2`, `1`, `FIGHT` at 60 ticks each | 96 px bold, `moon`, `outline` stroke 6, scale pop 1.4 → 1.0 over 8 frames |
| Round end | `ROUND 1: DRIFTER` / `DRAW ROUND` | 48 px, held for the `ROUND_END` phase |
| Match end | `THE DRIFTER WINS` / `THE CONDUCTOR WINS` / `MUTUAL DERAILMENT` | 64 px, DOM result overlay takes over after 1 s |

## HUD

Always visible during `FIGHTING`, `COUNTDOWN`, `ROUND_END`:

- Two health bars at y = 24, each 380 px wide × 22 tall, from the screen edges inward (P1 left, P2 right, mirrored). Fill `amber-1` above 50 %, `danger` below 25 %, `moon` between. Border `outline` 3 px. Ghost drain segment per the table above.
- Round timer centred at (480, 34): `ceil(roundTicks / 60)`, 40 px bold `moon`.
- Round pips under each bar: two 12 px circles, filled `moon` when won.
- Character names in 14 px under the bars: `THE DRIFTER`, `THE CONDUCTOR`.
- Train car label bottom-right, 12 px `steel-2`: `STANDARD CAR`, `TUNNEL`, `FINAL CAR`.

Debug overlay (`?debug=1`): hurtboxes `moon` 1 px, active punch hitbox `danger` 1 px, tick, snapshot age, RTT.

## Sound (stretch)

Web Audio oscillator blips: punch whoosh (noise burst 60 ms), hit (square 110 Hz 80 ms), block (sine 660 Hz 40 ms),
KO (descending saw 400 ms). No audio files. Only if everything else is done.

## Weapons (deferred)

Object kits, transformation animations and projectile visuals are out of scope until weapons are re-added. When
they are, a weapon is a shape drawn at the front wrist joint (`02-rig-and-animation.md` § Weapons) and a
projectile is a moving shape with its own `height` band. Do not build this now.
