# 4.01 — Palette, rig data, pose functions

## Purpose
The pure part of the character art: colour tokens, per-character proportions and signature shapes, and `computePose`, which turns a `FighterState` plus a render clock into joint positions. No Phaser import.

## Files
Create: `packages/client/src/game/palette.ts`, `src/game/rig/characters.ts`, `src/game/rig/pose.ts`, `test/pose.test.ts`.

## Depends on
1.02, 1.03 (for `punchHitbox` in the test).

## Exposes
`palette.ts`: `P` with every token from `design/00` as `0xRRGGBB` numbers plus `outline` and `white`.

`characters.ts`:
- `RIG` = shared segment lengths and thicknesses from `design/01` (head 16, neck 8, torso 54, upper 30, fore 28, fist 9, thigh 34, shin 32, foot 22; widths 14/12/16/14).
- `interface CharacterRig { key, skin, hand: number; name: string; shoulderW, hipW: number; stanceSpread, kneeBend, torsoLean: number; guard: { upper, fore }; signature: "drifter" | "conductor" }`
- `CHARACTER_RIG: Record<CharacterId, CharacterRig>` with the values in `design/01` (Drifter 44/40, spread 20, bend 12, lean 6, low guard; Conductor 36/32, spread 12, bend 0, lean 0, high guard).

`pose.ts`:
- `interface Pt { x, y }`, `interface Arm { shoulder, elbow, wrist, fist }`, `interface Leg { hip, knee, foot }`
- `type RigState = "idle" | "walk" | "jump" | "punch" | "block" | "hit" | "ko" | "offbounds" | "win"`
- `interface Clock { renderMs: number; koFrames: number; landFrames: number; win?: boolean }`
- `interface Joints { state; alpha; hip; neck; head; lean; arms: { F: Arm; B: Arm }; legs: { F: Leg; B: Leg }; punchingArm: "F" | "B" | null; ghosts: Pt[] }`
- `rigState(f, koActive): RigState`
- `computePose(f, clock): Joints` in world coordinates

## Behaviour
1. Local space: origin at the feet, `+x` toward facing, `+y` down. World = `{ x: f.x + facing · lx, y: f.y + ly }`. Authored facing right; left is the sign flip.
2. Skeleton: hip at `(0, -66)`; neck at hip plus torso length rotated by `lean`; head centre `neck.y - neck - headRadius`; shoulders 4 px below the neck; each arm is upper then fore then fist, each leg thigh then shin, angles per `design/02` (0 = straight down, 90 = forward, 180 = up).
3. Front/back arm choice: the player's left arm is the back arm when facing right and the front arm when facing left. `punchingArm` records which was used.
4. State priority: `ko > hit > punch > jump > block > offbounds > walk > idle`; `win` overrides when `clock.win`.
5. Poses, exactly as the table in `design/02`: idle bob 3 px at 1400 ms; walk legs ±28° phased by `x / 40`; jump three sub-poses by `vy` sign and magnitude; punch startup pulls back 10 px over 4 ticks, active is fully straight (both angles 90), recovery eases back over 8 ticks with lean returning; block forearms vertical with a 12 Hz 0.5 px shudder; hit leans back `20° · hitstun/12`; ko interpolates over 30 frames to a collapsed pose; offbounds lean 25° with `alpha 0.6`; win both fists up.
6. Grounded, non-ko, non-jump feet are planted at `ly = 0` regardless of leg angles (feet never float).
7. `ghosts`: while `!grounded` and `jumpTicks` in `[3, 10]`, two points 6 and 12 px behind the hip along `(-vx, -vy)` normalised; otherwise empty.
8. Landing squash is a draw-time scale, not a pose change; `clock.landFrames` is passed through.

## Invariants
- `pose.ts` and `characters.ts` import nothing from Phaser or DOM.
- During active punch ticks, the punching fist lies strictly inside `punchHitbox(f)` for both facings.
- The head is always above the neck except in `ko`.

## Tests
- fist inside hitbox on every active tick, both facings (adjust `RIG` or `PUNCH_GAP`, never the test)
- state priority ladder
- feet on `f.y` when grounded in idle, walk, block, punch, hit
- ghosts non-empty only on jumpTicks 3..10

## Done when
- [ ] tests pass

## Polish amendments

- Rule 2 is now literal: the rest hip sits at `(0, -66)` for both characters; the leg IK bends the knees to reach
  the stance (`kneeBend` describes the result, it no longer lowers the hip). (review fix)
- Rule 5 walk: feet swing `±31 px` about the hip (a ±28° swing of the 66 px leg), with the rest stance fading out
  toward the extremes so the legs cross mid-stride and never stretch; arms counter-swing ±13 px (±12°). (review fix)
- Rule 5 jump: sub-pose chosen by the `design/02` thresholds (apex while `|vy| ≤ 2`, rising below, falling above)
  with a 1.5 px/tick blend past the threshold so the switch is not a pop; rising knees at 70°, arms up 30° (120 in
  this file's convention), falling arms out 20° below forward (70). (review fix)
- Rule 5 block: both forearms vertical in front of the face, fists at eye height, the back fist 14 px and the front
  fist 26 px ahead of the hip line and 8 px apart vertically so both gloves read; the draw order puts the back arm
  over the torso and head in this state only. (review fix)
