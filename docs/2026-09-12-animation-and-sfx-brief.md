# Midnight Mayhem — animation and sound brief

For the people making animations and sounds. Written 2026-09-12 from what is on `main` after 9.10.
Two facts to know before you start:

1. **Every visual is drawn in code.** The four pixel characters are built from parts (`head`, `torso`, `arm`,
   `hand`, `leg`, one `torsoBlock`, one `headKo`) in `packages/client/src/game/sprites/parts/*.ts` and posed
   each frame by a procedural rig (`rig/pose.ts`). Nothing is a drawn frame sequence. So "animation work" means
   one of: (a) adding state-specific pixel parts, (b) tuning the pose curves (timing, anticipation, overshoot),
   (c) adding secondary FX (dust, trails, flashes) in `effects.ts` / `itemFx.ts`. The project rule "no image or
   sprite assets" stands — pixel art is authored as a grid in code, and Hruday will paste it in.
2. **Every sound is synthesised** with WebAudio oscillators in `packages/client/src/game/sfx.ts`. Recorded
   WAV/OGG assets are not currently allowed by the project rules; if you want to record, ask Hruday first — he
   would need to add an asset loader and record the decision. Until then, "sound work" means a *description* of
   each cue (character, pitch, length, layers) that he can rebuild in the synth, or a reference clip to imitate.

Timing is in **ticks (60 per second)**. A frame at 60 fps is one tick.

## Fighter animations

| State | Trigger | Length | What exists now | What's missing / wanted |
|---|---|---|---|---|
| Idle | no input | loops | Bob (sine on render time), blink | Breathing on the torso, occasional weight shift |
| **Walk** | A/D, lean gesture | loops while moving | Procedural leg swing + arm counter-swing, dust on start | Real gait: contact / down / passing / up keys, head bob synced to steps, a run lean above walk speed |
| Jump | W, jump gesture | rise → apex → fall → land | Crouch-stretch torso, land dust scaled by speed | Anticipation squat before takeoff (2–3 ticks), land squash |
| Block | S, crossed arms | held | Crossed arms, shudder while held, `torsoBlock` part | Hit reaction while blocking (push back a few px) |
| Punch L/R | F/G, thrust | 4 startup / 3 active / 8 recovery | Arm extension, fist trail, impact burst — **considered done** | — |
| Hit | took damage | hitstun ticks | Recoil pose, screen shake, nudge | Directional recoil (from above for a chop), face frame |
| KO | hp 0 | collapse then hold | Collapse curve, `headKo` part | Ground bounce, dust puff on impact |
| Win | round won | bob loop | Bob only | A real pose (arms up), per-character flourish |
| Off-bounds / pit fall | edge / gap | fall then respawn | Hidden while in pit, 50 % alpha respawn i-frames | Flail while falling, respawn shimmer |

## Special attack — laser (`Q`, both arms thrust together)

| Stage | Length | What exists now | What's missing / wanted |
|---|---|---|---|
| Charge | 180 ticks (3 s) | Arms forward, charge ring at the hands (`drawChargeRing`) | Body tension building: stance widens, slight shake that grows, hair/coat pulled toward the hands |
| Fire | 16 ticks | Beam from the hands sweeping 60 px/tick, `drawBeam`, impact burst on hit | Recoil kick on release, screen flash frame, beam heat-shimmer |
| Recover | 20 ticks | Arms drop | Exhausted lean, 720-tick cooldown shown on the fighter (e.g. faint glow fading) |

## Items — equip

Every item: on `ITEM_EQUIP` a materialise sparkle at the hand (`drawMaterialise`), a HUD toast, an equip cue.
Wanted: a per-item "pull out" beat (2–4 ticks) — bottle raised, racket flourish, backpack swung to the front,
banana peeled, phone flipped up.

## Molotov and banana — throw (9.10)

| Stage | Length | What exists now | What's missing / wanted |
|---|---|---|---|
| Wind-up (charging) | 0–90 ticks (hold elbow bent) | Arm cocked back (`throwPose` windup), dotted arc + landing ring grows with charge | Arc dots should pulse faster as charge fills; a full-charge glint at the hand; body coils (rear foot slides back) |
| Release | 6 ticks | Arm whips forward, projectile spawns | Follow-through with the torso, small dust from the pivot foot |
| Recover | 12 ticks | Return to guard | — |
| Projectile: molotov | flight | Bottle with a flame trail | Tumbling rotation |
| Projectile: banana | flight | Spinning peel | — |
| Fire hazard | 240 ticks | Flames with fade, feet-flash on damage | Embers rising, scorch mark that stays a moment after |
| Peel hazard / slip | 900 ticks / 36-tick stun | Peel on the floor, stars over the head, feet slip | Legs-out pratfall pose during the slip stun |

## Sword (racket) — 9.10, lasts 600 ticks (10 s)

| Move | Input | Length | What exists now | What's missing / wanted |
|---|---|---|---|---|
| Punch with sword | F/G | as punch | Plain punch | — (by design) |
| **Chop** | E / wrist over head then drop | 8 startup / 4 active / 14 recovery | Arm eased overhead, straight drop, vertical crescent, 2× shake + hit-stop on hit, thud | Racket smear frame on the active ticks, ground crack on a whiffed chop, guard-crush spark when it breaks a block |
| **Sweep** | R / wrist across the body | 5 startup / 5 active / 10 recovery | Arm drawn back then whipped across, horizontal crescent, 2× knockback | Torso twist, foot pivot, a wider flat smear |
| Parry | block within 10 ticks of an incoming hit | — | Spark star, parry cue | Racket "ping" flash frame, attacker stagger pose |
| Expiry | tick 600 | `ITEM_BREAK` | HUD bar flashes last 180 ticks, toast `BROKEN` | Racket dissolves/pixelates out of the hand; **no sound yet** |

## Shield (backpack)

Hex barrier in front, ripple + crack per absorb (3 hits), shatters into 6 shards on break. Wanted: a body brace
pose on absorb (lean into it), backpack sprite bouncing on the back while walking.

## Flash (phone)

Burst star at the phone, white dazzle overlay on victims. Wanted: victims' eyes-covered pose while `dazzle` is
active; phone held up pose on use.

---

## Sound effects

Each cue is one entry in `sfx.ts` and plays on the sim event in the "Trigger" column, panned to the fighter.
"Now" describes the current synth so you can hear what to replace. "Wanted" is the brief. Lengths are targets.

### Fighter

| Cue | Trigger | Now | Wanted |
|---|---|---|---|
| `punch_whiff` | `PUNCH` | short noise burst | Air swish, 80 ms, slightly different per arm |
| `hit` | `HIT` (unblocked) | sine thump + noise | Meaty body hit, 120 ms, low-end knock + crack |
| `block` | `HIT` (blocked) | dull click | Padded thud, 100 ms, no crack |
| `jump` | `JUMP` | rising blip | Cloth rustle + grunt, 100 ms |
| `land` | `LAND` | low thump | Boots on a steel roof, weight-scaled (the event has speed), 120 ms |
| **footstep** | — (none) | **missing** | Two alternating boot-on-steel taps, 60 ms each, quiet; trigger on walk contact frames (needs a `STEP` render-side timer, not a sim event) |
| `ko` | `ROUND_END` with a fighter at 0 hp | descending tone | Slam + long low tail, 600 ms |
| `pit_fall` | `PIT_FALL` | falling whistle | Whistle + distant impact, 700 ms |
| respawn | `PIT_RESPAWN` | **missing** | Rising shimmer, 300 ms |
| off-bounds damage | `OOB_DAMAGE` | **missing** | Short electric zap, 100 ms |

### Laser

| Cue | Trigger | Now | Wanted |
|---|---|---|---|
| `laser_charge` | `LASER_CHARGE` | rising sawtooth over 3 s | Building hum that pitches up over 3 s and ends in a click — must be exactly 3 s so it reads as a timer |
| `laser_fire` | `LASER_FIRE` | bright sweep | Big release: sub thump + bright beam tone that sweeps down over 400 ms |
| `laser_hit` | `LASER_HIT` | crackle | Sizzle + impact, 200 ms |

### Items

| Cue | Trigger | Now | Wanted |
|---|---|---|---|
| `equip_molotov` / `_sword` / `_shield` / `_banana` / `_flash` | `ITEM_EQUIP` | 60 ms noise snap then a note (E4/A4/C4/G4/B4) at +6 dB | Keep the shared "snap + note" motif so equip is recognisable; add one character layer per item: glass clink, racket string twang, zipper, peel squelch, phone unlock chime |
| wind-up charging | throw `charge` phase | **missing** | Soft rising tick that speeds up over 1.5 s (mirrors the arc dots); stop on release |
| `molotov_throw` | `PROJECTILE_SPAWN` molotov | whoosh | Throw grunt + bottle whoosh with a faint liquid slosh, 200 ms |
| `peel_throw` | `PROJECTILE_SPAWN` banana | light whoosh | Light flick, 120 ms |
| `fire_ignite` | `HAZARD_SPAWN` fire | burst | Glass shatter + fwoomp, 400 ms |
| `fire_loop_start` / `_stop` | first fire appears / last fire ends | filtered noise loop | Crackling fire bed that loops seamlessly, ~2 s |
| fire damage tick | `HAZARD_HIT` damage > 0 | **missing** | Short sizzle, 80 ms |
| `slip` | `HAZARD_HIT` damage 0 | slide + bonk | Cartoon slide-whistle-free version: squeak + floor bonk, 300 ms |
| `slash` | `SLASH` chop | short sweep | Heavy overhead swing, 150 ms, air rip |
| `sweep_whoosh` | `SLASH` sweep | long bandpass sweep | Wide horizontal swish, 200 ms |
| `chop_hit` | `HIT` from a chop | low thud + ring | Racket frame crack on a body + short ring, 180 ms |
| guard crush | `HIT` blocked by a chop | **missing** (plays `block`) | Block sound + a splintering crack layered, 200 ms |
| `parry` | `PARRY` | metallic ping | Bright racket-string ping + reverse swell, 250 ms |
| `shield_absorb` | `SHIELD_ABSORB` | dull hit | Canvas thud + buckle strain, 150 ms |
| `shield_break` | `ITEM_BREAK` shield | shatter | Zipper rip + straps snap, 400 ms |
| sword expiry | `ITEM_BREAK` sword | **missing** | Descending "power down" + racket clatter, 400 ms |
| `flash` | `FLASH` | bright chord | Camera shutter + high sine ring, 300 ms, ring fades over the dazzle |

### Rounds and UI

| Cue | Trigger | Now | Wanted |
|---|---|---|---|
| `countdown_tick` | countdown seconds | click | Train-station bell tick, 100 ms; final one a semitone up |
| `round_start` | `ROUND_START` | chord | Train whistle blast, 500 ms |
| `round_end` | `ROUND_END` | chord | Brake squeal resolving to a chord, 800 ms |
| `match_end` | `MATCH_END` | fanfare | Short victory sting, 1.5 s, one variant per winning team colour if cheap |
| `ui_move` / `ui_select` | lobby navigation | blips | Soft tick / confirm — keep quiet |
| ambience | always (landing + arena) | none in sfx (train rumble is a visual) | Low train rumble loop + occasional rail clack, ducks under cues |

## How to hand things back

- **Sounds:** for each cue give the name from the table, a 1–2 line description (layers, pitch movement, length),
  and if you have one, a reference clip. Hruday rebuilds it in `sfx.ts`. If the team agrees to recorded audio, deliver
  mono OGG at 44.1 kHz, peak −3 dB, named exactly as the cue (`chop_hit.ogg`).
- **Animations:** for a new pose, a 40×56 pixel grid per part (same parts as `sprites/parts/stoker.ts`) or a timing
  note ("chop: 3 ticks anticipation, hold 1 tick at the top, drop in 2"). For FX, a short description or a sketch.
  Test pages (client dev server): `sprites.html` and `rig.html` for the rig, `dev/itemfx.html` for item FX, `dev/hud.html` for the HUD, `dev/ambience.html` for the stage; `dev/sfx.html` is a soundboard that plays every current cue by name — start there; press `M` in any match to unmute.
