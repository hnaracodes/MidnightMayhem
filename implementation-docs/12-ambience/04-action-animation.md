# 12.04 — Action animation: the kamehameha, throws, punch weight, impact and movement juice

## Purpose
The laser is the signature move and it has no pose: `posedFighter` draws it as the block stance with a ring and a
beam around it. Throws are drawn as punches. This lane gives every action a silhouette-changing beat — a real
three-stage kamehameha, a wind-up and release for throws, anticipation and overshoot on the punch, weight on jumps
and landings, a brace for the shield, an overhead beat for the flash — and the impact juice around them: sparks
along the punch vector, a shockwave ring on the grid, light pulses, a camera nudge. No gameplay timing changes;
every number here is read from `BALANCE`, `ARSENAL` and `THROW` at runtime.

## Files
Modify: `packages/client/src/game/rig/pose.ts`, `arenaGlue.ts` (`posedFighter` narrowed), `sprites/compose.ts`
(hand parts per new state), `effects.ts` (sparks, ring, camera nudge, landing dust by fall speed, scuff, flash beat,
KO rim fade), `itemFx.ts` (beam cap at the palms), `ArenaScene.ts` (laser hand anchor, KO rim fade, flash beat),
`test/pose.test.ts`, `test/arenaGlue.test.ts`, `test/effects.test.ts`.
Create: `dev/ambience.html`, `src/dev/ambiencePreview.ts`, `tools/e2e/ambience-actions.json`.
Owns `rig/pose.ts`, `dev/ambience.html`, `src/dev/ambiencePreview.ts`.

## Depends on
12.02 (`LightSink`, `RimChoice`), 12.01 (`snap`), 9.08 (`ThrowAction.phase/charge`, `THROW`), 9.05 (`laserPhase`
boundaries: `LASER_CHARGE` / `LASER_ACTIVE` / `LASER_RECOVERY`), 11.01 (`composeFrame`).

## Exposes
`rig/pose.ts`:
- `RigState` gains `"laser" | "throw"`; `rigState` ladder: ko → hit → laser → punch → throw → jump → block →
  offbounds → walk → idle. (**9.10**: because the laser and throw rungs sit above `jump` and `walk`, both stances
  run through `withLocomotion`, which swaps in the walk cycle's or the air pose's legs while the body moves.)
- `Clock` gains `beat?: { kind: "flash"; frames: number } | undefined` — a render-side pose beat with no sim action.
- `laserHands(j: Joints): Pt` — the cupped point (midpoint of both fists) for the charge ring and beam cap.
- Pure, exported for tests: `laserStage(elapsed): { stage: "charge" | "release" | "hold" | "recover"; t: number }`,
  `throwStage(action): { stage: "windup" | "release" | "recover"; t: number }`.
`effects.ts`: `flashBeat(i): number` (frames left of the flash beat), `koRim(i): number` (0..1 rim weight, 1 → 0 over
the collapse), `cameraNudge` internals private.
`dev/ambience.html`: `window.__ambience = { play(action, character?, speed?), seek(frame), step(n?), frame(), state() }`
where `action` is one of `punch | sword | laser | throw | jump | block | shield | flash | hit | ko | walk | idle` and
`speed` 1 or 0.25.

## Behaviour
1. Laser (`laserPose`), driven by `elapsed` against `LASER_CHARGE` / `LASER_ACTIVE` / `LASER_RECOVERY`:
   charge (t = elapsed / LASER_CHARGE) — hip drops 4·t, weight to the back foot (back foot −6·t), torso coils away
   (lean −18·t), head down 10·t, both fists converge on a cupped point at the back hip (local `{−18, −60}`, the front
   fist 2 px above and ahead of the back one) with a tremble of ±1 px·t² at 14 Hz off the render clock;
   release (first 3 beam ticks) — lean +22, front foot planted +8, head up, both arms `armStraightTo` a two-palm
   thrust at local `{58, −80}` (inside the beam band `feet−105..−35`), the back arm 3 px lower;
   hold (rest of the beam) — the same with a 12 Hz ±0.5 px shudder;
   recover (t over LASER_RECOVERY) — `ease` back to guard with the lean overshooting the rest lean by −4 at t ≈ 0.6.
   Hands are open (palms) throughout; `laserHands` gives the cupped point, which `ArenaScene` feeds `ItemFx` as the
   hand anchor, so the charge ring orbits the cupped hands and the beam's cap sits at the palms (the beam rect itself
   still starts at the fighter's centre, matching the sim hitbox).
2. Throw (`throwPose`, 9.08 shape): wind-up while `phase === "charge"` (t = charge / CHARGE_MAX) — throwing arm back
   and up (fist at shoulder + `{−22 − 10·t, −26 − 8·t}`), lean −6·t, back foot −4·t, other arm in guard; release
   (elapsed < RELEASE_TICKS) — the arm snaps to `{52, −110}` over the first 2 ticks and holds, lean +14, front foot +6;
   recover (elapsed to RELEASE_TICKS + RECOVERY) — `ease` back to guard with a 3 px overshoot. The item stays in the
   hand until the sim releases it (`released`). `posedFighter` no longer rewrites throws or lasers.
3. Punch: startup pulls the shoulder back harder (fist `{−14·t, −4·t}` from guard, lean −5·t; `punchHint` already
   feeds this before the server agrees); active unchanged (fist on `PUNCH_FIST`, trail via `drawTrail`); recovery
   overshoots 3 px past guard at mid-recovery before settling. A sword punch winds up higher (fist `{−10·t, −24·t}`)
   and strikes higher (`{63, −118}`).
4. Jump: takeoff anticipation for the first 2 airborne ticks (hip +3 px crouch); at the apex (|vy| ≤ 2) the torso
   stretches up to 4 % (neck, head and shoulder move away from the hip), blending out with the rising/falling blend.
5. Shield brace: while `blocking` with a shield the front forearm is raised higher and further forward (fist at
   `{30, eye − 10}`) so the barrier reads as held, not floated.
6. Flash beat: on `FLASH`, `Effects.flashBeat(player)` runs 6 render frames; `ArenaScene` passes it as `clock.beat`
   and `computePose` raises the front arm overhead (fist at shoulder + `dir(175) · 0.95 reach`, lean −4) for those
   frames on any grounded, un-acted state.
7. Impact juice on a clean `HIT`: the existing hit-stop, white flash and impact star, plus a directional spark
   burst — 7 specks from the seeded `Lcg` fanned ±35° around the punch direction, 18–42 px, snapped to the grid,
   6 frames — a shockwave ring (r 10 → 46, 2 px, `bone`, snapped, 6 frames), the 12.02 light pulse and a camera nudge
   of 2 px opposite the knockback for 4 frames (`cameras.main.scrollX`, decaying, independent of the shake). On a
   blocked hit: the existing tighter ring and chip flash only, no hit-stop, no nudge.
8. Movement weight: the landing dust puff scales with the fall speed (scale 0.6 at |vy| ≤ 3 → 1.4 at |vy| ≥ 9,
   reading the last airborne `vy`) and a heavy landing (|vy| ≥ 7) pulses a `lamp` light at the feet (r 80, 4 frames);
   walking leaves a trailing scuff — the every-10-tick dust moves 14 px behind the trailing foot at 0.6 scale.
9. KO: the collapse and slowdown stay; `Effects.koRim(i)` runs 1 → 0 over the 30 ko-frames and `ArenaScene` mixes the
   rim colour toward `night1` by `1 − koRim` and adds up to 0.25 gloom, so the fallen fighter loses its light.
10. `dev/ambience.html`: a bare stage with the real `Lighting`, `Effects`, `ItemFx` and one `SpriteFighter`, no
    server. `play(action, character, speed)` puts the fighter into that action's state machine (a fabricated
    `FighterState` stepping one sim tick per render frame at 1×, one per 4 frames at 0.25×), `seek(frame)` jumps to
    an action frame, `step(n)` advances n frames while paused, `frame()` reads the counter drawn top-left. The laser
    emits `LASER_CHARGE` / `LASER_FIRE` at the right frames so the ring and beam appear.

## Invariants
- No gameplay timing changes: every boundary comes from `BALANCE`, `ARSENAL`, `THROW`.
- The punch fist stays inside `punchHitbox` on every active tick (existing test) — the overshoot lives in recovery.
- Every new pose keeps the sprite inside the 80 × 76 raster (the character × state matrix in `sprites.test.ts`).
- Sparks and rings are seeded and snapped; the camera nudge never persists past its frames (scrollX returns to 0).

## Tests
`pose.test.ts`: rule 1 — fists within 4 px of each other and behind the hip at charge 0 %, 50 %, 100 %, both fists
inside the beam band and ahead of the shoulder on beam ticks 0 and 2, lean monotone during the charge, guard restored
at the end of recovery, `laserHands` between the fists; rule 2 — the throwing arm behind the shoulder at full charge
and ahead at release tick 2, guard restored after recovery; rule 3 — the punch recovery passes guard (overshoot)
then settles; rule 4 — hip lower at takeoff, torso longer at the apex; rules 5–6 — brace and beat move the front
fist up; `rigState` ladder gains laser/throw. `arenaGlue.test.ts`: `posedFighter` is the identity for throw and
laser. `effects.test.ts`: rule 7 sparks spawn on a clean hit only, snapped; rule 8 landing dust scale by fall speed;
rule 9 `koRim` 1 → 0.

## Done when
- [ ] tests pass, `pnpm test` and `pnpm typecheck` green
- [ ] `.shots/ambience-laser-{0,50,100,release,recover}.png`, `ambience-punch.png`, `ambience-throw.png`,
  `ambience-ko.png` from `tools/e2e/ambience-actions.json`, reviewed by the agent
- [ ] `window.__arena.updateMs()` reported on 2P and 4P chaos
- [ ] committed on `feat/graphics-enhancement` with prefix `ambience:`
