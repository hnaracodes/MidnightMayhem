# 02 — Rig & Animation

Every pose is a **pure function of `FighterState`** (plus a render clock for loops). No frames, no timers in the
renderer for action states.

## Principle: the simulation owns time

- **Action states** (punch, jump, hit, KO) → pose is derived from the sim's own counters
  (`action.elapsed`, `hitstun`, `vy`, `phase`). If the sim says the punch is active, the fist is extended.
- **Looping states** (idle, walk, block-hold, off-bounds) → pose is a function of `renderTimeMs` and `x`.

## The skeleton

Joints, in the fighter's local space (origin at the feet, `+x` = facing, `+y` = down). All lengths from
`01-characters.md`.

```
hip           (0, -66)
neck          (hip.x + leanX, hip.y - 54)
head          (neck.x, neck.y - 24)
shoulderF/B   (neck.x ± 0, neck.y + 4)   // front and back arm share the shoulder line, drawn at different depth
elbowF/B, wristF/B, fistF/B
kneeF/B, footF/B
```

Drawing order (back to front): back leg, back arm, torso, head group (with cap or beard and hair), front leg,
front arm. This keeps the punching arm in front and the guard readable.

`punchL` uses the **back** arm when facing right and the **front** arm when facing left (the player's left arm
is the far arm when they face right). `punchR` is the opposite. This is the only place handedness matters.

## Pose functions

All angles in degrees, 0 = straight down for legs, 0 = along facing for arms. `t` is the normalised phase in
[0, 1]. `ease(t) = t < 0.5 ? 2t² : 1 - (-2t + 2)² / 2`.

| State | Source | Pose |
|---|---|---|
| **idle** | `renderTimeMs` | Stance from character table. Vertical bob `sin(t · 2π / 1400 ms) · 3 px` on hip and everything above. Fists at guard: Drifter hip height, Conductor chin height. Front fist 4 px further forward |
| **walk** | `x` (world) | Legs swing ±28° with phase `x / 40 px`; opposite arm swings ±12°. Hip bob 2 px at double frequency. Walking backward (away from opponent) uses the same cycle with the guard raised 10 px |
| **jump** | `vy`, `grounded=false`, `jumpTicks` | While `jumpTicks` is inside the i-frame window (3–10) draw 2 ghost copies of the rig 6 and 12 px behind along the velocity vector at 35 % and 18 % alpha in `moon`; this is the evade tell. Rising (`vy < -2`): legs tucked, knees at 70°, arms up 30°. Apex (`|vy| ≤ 2`): legs half tucked. Falling (`vy > 2`): legs extended down, arms out 20°. Landing squash for 4 render frames after `grounded` flips true: torso scaled 1.06 × 0.94 |
| **punch** | `action.elapsed` over 15 ticks | `startup` ticks 0–3: fist pulls back 10 px, shoulder rotates back 8°, `t = elapsed/4`. `active` ticks 4–6: arm fully straight along facing, fist at `(hip.x + 78, hip.y - 44)`, torso leans 8° into it. `recovery` ticks 7–14: interpolate back to guard with `ease`. **The fist during active ticks must lie inside the sim punch hitbox** (`x` from +10 to +80, `y` from feet -120 to -60): assert in a test |
| **block** | `blocking=true` | Both forearms raised vertical in front of the face, fists at eye height, elbows tucked to ribs, torso leaned back 4°. Small 1 px shudder at 12 Hz |
| **hit** | `hitstun > 0` | Torso leaned back `20° · (hitstun / 12)`, head back 8°, arms trailing behind, front foot lifted 6 px. Knockback translation is the sim's, do not add any |
| **ko** | `phase = ROUND_END` and `hp = 0` | Over the first 30 render frames: hip drops to `feet.y - 20`, torso rotates to 80° back, legs fold, arms fall. Hold the final pose. Cap stays on the head |
| **offbounds** | `x ≤ 0` or `x ≥ 960` | Lean 25° against the wind (toward the arena), one arm raised, coat fringe and hair streaming. Drawn at 60 % alpha |
| **countdown/win** | `phase = COUNTDOWN`, `MATCH_END` winner | idle. Winner during `MATCH_END`: both fists raised, 2 px bob |

Priority when several apply, highest first: `ko > hit > punch > jump > block > offbounds > walk > idle`.

## Tick→phase mapping

```ts
export function punchPhase(elapsed: number): { phase: "startup" | "active" | "recovery"; t: number } {
  const { PUNCH_STARTUP: s, PUNCH_ACTIVE: a, PUNCH_RECOVERY: r } = BALANCE;
  if (elapsed < s) return { phase: "startup", t: elapsed / s };
  if (elapsed < s + a) return { phase: "active", t: (elapsed - s) / a };
  return { phase: "recovery", t: (elapsed - s - a) / r };
}
```

The renderer reads `BALANCE` from `@midnight/shared`; it never hard-codes 4/3/8.

## Interpolation

Snapshots arrive at 30 Hz; the renderer draws at display rate. Interpolate `x`, `y` between the two most recent
snapshots (render 50 ms behind). Discrete fields (`action`, `blocking`, `hitstun`, `hp`, `facing`) come from the
newer snapshot. Do not interpolate `action.elapsed`; a punch pose changes once per snapshot and looks fine.

## Local cosmetic hint

When the local `InputSource` shows a rising edge on `punchL`/`punchR`, the renderer may start the `startup`
pose immediately for up to 4 render frames before the confirming snapshot arrives. If the snapshot does not show
a punch (the sim rejected it: hitstun, blocking, already punching), fade back to the snapshot pose. Damage, hit
sparks and knockback are never predicted.

## Wind

Everything loose trails screen-left regardless of facing: Drifter hair and coat rags, Conductor coat tails, dust
puffs. Amplitude scales with the roof scroll speed (240 = normal, 180 = final car, 420 = tunnel). This one rule
is most of what makes the roof feel like it is moving.

## Weapons (deferred)

A future weapon is a shape drawn at the front wrist joint, rotated with the forearm. The rig exposes
`wristF` in world space so nothing else needs to change.
