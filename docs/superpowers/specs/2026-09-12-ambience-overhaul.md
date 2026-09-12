# Midnight Mayhem — ambience overhaul: decisions + Claude Code prompt

Written 2026-09-12 against commit `9e10c25`. Part 1 is the decision record (what's settled, what's open,
and what I'd pick). Part 2 is the prompt to paste into Claude Code.

---

## Part 1 — Decisions

### What the codebase already gives you

Worth knowing before deciding anything, because it changes what "overhaul" means here:

- **Every visual is code.** No image assets anywhere (a hard rule in `CLAUDE.md`). Backgrounds are Graphics
  baked to textures at boot and scrolled as TileSprites; fighters are pixel grids rasterised per frame into a
  `CanvasTexture` by `sprites/compose.ts`. So "new art" means new drawing code, not new files.
- **Animation is procedural, not frames.** `rig/pose.ts` maps `FighterState` + a render clock to joint
  positions; `compose.ts` rasterises that pose. There is no sprite sheet to redraw — animation work is editing
  pose functions, which is *much* cheaper than it sounds.
- **The laser has no pose at all.** `pose.ts:269` — `if (!action || action.kind === "laser") return standing(rig)`.
  Your kamehameha is currently an idle stance with a charge ring and a beam drawn around it. `STATUS.md` even
  flags this as known-missing. This is the single highest-value animation item in the project.
- **A lighting skeleton already exists**, built for tunnel cars: `layers.dark`, `layers.glow`, `layers.tint`
  at depths -14 / -11 / -1, plus `rim` / `rimBoth` in the sprite rasteriser and `edgeDither` for the shadow
  side. The overhaul is mostly promoting this into a real light rig, not inventing one.
- **Zero post-processing.** The game config sets no `pixelArt`, no `roundPixels`, and uses `Phaser.AUTO` with
  `Scale.FIT`. Phaser 3.90's built-in camera FX (bloom, vignette, blur) are available and unused.
- **There's a screenshot harness.** `tools/shot.mjs` + `tools/e2e/*.json` drive headless Chrome and report
  console errors; `dev/fx.html`, `hud.html`, `stage.html`, `itemfx.html` are isolated preview pages. Any
  visual change can be verified without a human looking at it — use this.
- **Determinism matters.** Two laptops must draw the same sky, so all randomness runs through a seeded `Lcg`.
  New particle systems must do the same or screenshots stop being reproducible.

### Settled

| Decision | Choice |
|---|---|
| Pixel fidelity | **Hybrid HD-pixel** — pixel-grid sprites and art, smooth full-res light/fog/glow on top |
| Lighting tech | **Additive light sprites + darkness mask**, not Phaser Light2D (no normal maps; no assets rule) |
| HUD | **Arcade-readable with a Hollow Knight finish** — symmetric bars kept, chrome restyled |
| Scope | Arena/lighting/atmosphere + combat juice + fighter restyle + menus/transitions + **action animations** |

### Open — my recommendation on each

**1. How far does the pixel grid go?**
Right now fighters sit on a 3-world-px grid (`SPRITE_SCALE = 3`) while backgrounds, HUD and FX are smooth
vector Graphics, and `Scale.FIT` scales the whole canvas by a fractional factor. That inconsistency is a real
part of why it doesn't read as one picture yet.
→ **Recommend:** introduce `PIXEL = 3` and quantise background/FX geometry and sprite positions to it, set
`roundPixels: true`, and leave only lights, fog and bloom unquantised. Don't attempt a 320×180 render target —
it would break HUD text and every world coordinate in the sim.

**2. Does the darkness fall on the fighters?**
Atmosphere wants fighters swallowed by gloom; a fighting game wants them legible at a glance.
→ **Recommend:** fighters are never darkened below a floor (~75% brightness). They read against the dark via
*rim light* instead — which `compose.ts` already does — plus a contact pool under the feet. Atmosphere goes in
front of and behind them, never over their silhouette.

**3. Keep amber, or go Hollow Knight cyan?**
Your palette is already a blue-black night with one amber accent, which is structurally the right shape.
→ **Recommend:** keep `amber-1` as the *diegetic* light colour (train lamps, fire, sparks — warm light has a
source), and **add** tokens rather than rewrite any: a deeper night, a fog/haze value, a bone off-white, and
one cold bioluminescent cyan for the laser and for cold rim light. Rewriting existing tokens would churn all
four characters' colours for no gain. The HK feel comes far more from *lowering background contrast and
desaturating the mid-ground* than from adding new hues.

**4. Do animations get more frames to work with?**
A punch is 4 startup / 3 active / 8 recovery ticks ≈ 250ms, and the laser is 30/12/20. Longer windows would
animate better — but those numbers live in `shared/constants.ts`, are approved in `DECISIONS_CHANGED.md`, and
are what the netcode and balance are built on.
→ **Recommend:** don't touch them. Readability comes render-side: the `punchHint` system already poses a
cosmetic startup from your local input edge *before* the server agrees, so anticipation is free; add
overshoot on recovery, a smear/trail on the active frame, and impact juice. If after playing it still reads
too fast, changing frame data is a separate owner-approved decision, not part of this work.

**5. What does the kamehameha look like?**
→ **Recommend:** two-handed cupped-hands charge at the hip, torso coiled away, then a forward thrust with both
palms and a hard back-lean on release. It's unmistakable at a 40px sprite height, and it gives the existing
charge ring and beam an actual origin to anchor to. (The alternative — one arm overhead — reads as a throw.)

**6. Lane structure.**
`CLAUDE.md` says one feature file at a time with specs first.
→ **Recommend:** keep that. Have Claude Code write `implementation-docs/12-ambience/01`–`06` in the house
format first, then implement them in order, each ending green on `pnpm test` + `pnpm typecheck` with fresh
screenshots. Phases 2 and 5 are the only ones that touch each other.

**7. Menus: re-light or redesign?**
The landing/lobby DOM has a considered spec already (`docs/superpowers/specs/2026-09-12-ui-design-notes.md`) —
railway ticket, seat manifest, one amber accent.
→ **Recommend:** re-light it, don't redesign it. Fog gradient over the scrim, amber edge-glow, a slow
ink/iris wipe between states. Throwing away a good spec to make it "more Hollow Knight" is how you lose the
train identity that makes this game yours.

### Risks to watch

- **MediaPipe is already eating the frame.** Pose inference runs in a worker on the same laptop, and
  `compose.ts` re-rasterises every fighter in JS every frame. Post-FX bloom on top can push you off 60fps on
  a 4-player chaos match. Quality tiers and an auto-downgrade are not optional polish here.
- **`Phaser.AUTO` can pick Canvas**, where camera FX silently do nothing. Feature-detect WebGL and degrade
  deliberately rather than shipping a look that vanishes on some machine at the demo.
- **Don't move lighting into the rasteriser.** Per-pixel light math inside `composeFrame` would cost you the
  frame budget. Lighting is composited in Phaser, above the sprites.

---

## Part 2 — The prompt for Claude Code

Paste everything below into Claude Code at the repo root. Start it in plan mode.

---

We are doing a look-and-feel overhaul of Midnight Mayhem: keep the pixel-art, retro fighting-game identity,
but give the arena the ambience of Hollow Knight — deep gloom, lit pools of warm light, layered atmospheric
depth, soft bloom, and animation with real weight. Read `CLAUDE.md` first and obey it; in particular: no image
assets (every visual is Graphics, a generated texture, or a code-authored pixel grid), `packages/shared` is
the only cross-package surface, gameplay numbers stay in `shared/src/constants.ts`, keyboard control must
never break, and `pnpm test` + `pnpm typecheck` stay green. Commit small. Do not push.

### Ground rules for this work

1. **Presentation only.** Do not change `packages/shared` or `packages/server`. Do not change any value in
   `constants.ts` — not `BALANCE`, not `ARSENAL` timings, not `WORLD`. If you believe a gameplay number blocks
   a visual goal, stop and say so instead of changing it. The sim stays frame-identical; only the client's
   drawing changes.
2. **No new dependencies.** Phaser 3.90's built-in camera FX and the existing `Lcg`, `PixelCanvas`, `Effects`,
   `ItemFx` and `Motion` systems are the toolkit.
3. **Determinism.** Every new random value comes from a seeded `Lcg` (the pattern in `backgrounds.ts` /
   `stage/motion.ts`), so two laptops draw the same frame and screenshots are reproducible. Never `Math.random`,
   never `Date`.
4. **Readability beats atmosphere, always.** At no point may a fighter, an HP bar, the timer, a hazard or a
   projectile become harder to read than it is today. When the two conflict, gameplay clarity wins and the
   atmosphere moves behind or in front of the thing, never over it.
5. **Respect `session.reducedMotion`** everywhere — it must still hold the stage still and kill new particle
   motion — and keep the existing `?debug=1`, `?rig=vector`, `?input=` switches working.
6. **Spec first, in the house format.** Before writing code for a phase, write its feature file in
   `implementation-docs/12-ambience/` following the style of `implementation-docs/11-look/*` (brief, rules,
   `Exposes`, `Depends on`, acceptance). Get each phase's spec down, then implement that one phase.
7. **Verify visually, every phase.** Each phase ends with: `pnpm typecheck`, `pnpm test`, and screenshots via
   `node tools/shot.mjs` (existing `tools/e2e/*.json` plans, plus the new preview page below). Every report
   must show zero page errors. Report the measured `window.__arena.updateMs` before and after.
8. **Do not edit `DECISIONS_CHANGED.md`.** Instead, leave a proposed entry at the end of your final summary
   for the owner to approve.

### The art direction, in one paragraph

A night freight train under a cold moon, and the only warm things in the world are its lamps, its firebox and
the fighters standing in that light. Everything far away is desaturated, low-contrast and half-eaten by haze;
everything near the camera is a near-black silhouette; the fighters sit in the one band that is properly lit
and properly contrasty, ringed by warm rim light on the lamp side and cold moon rim on the other. Air is
visible — dust, embers, drifting haze, god-rays from the lamps. Light has sources you can point at. Nothing
glows for decoration.

### Palette

Extend `game/palette.ts`; **add** tokens, never repurpose existing ones (character colours depend on them).
Add both the `P` number and `CSS_P` string forms:

- `void0` — a deeper-than-`night0` blue-black for the furthest sky and foreground silhouettes
- `haze` — the desaturated mid-blue that fog and distance fade toward
- `bone` — a warm-leaning off-white, softer than `moon`, for HUD ink and small type
- `glow1` — cold bioluminescent cyan, the laser's colour and cold rim light
- `lamp` — the warm light colour of the train lamps (close to `amber1` but lighter and less saturated, so a
  light pool never reads as the same material as the amber UI accent)

Then do a **contrast pass** on the existing background drawing: push far layers toward `haze` (lower contrast,
lower saturation), push near layers toward `void0`, and leave the fighter band as the only high-contrast zone.
This pass alone should do more for the mood than any effect you add afterwards.

### Phase 1 — Pixel grid discipline

Goal: everything reads as one picture on one grid.

- Export `PIXEL = 3` (the existing `SPRITE_SCALE`) from a shared client const and use it as *the* quantisation
  unit for new art.
- Set `roundPixels: true` in `gameConfig` and verify sprites stop shimmering as they walk.
- Quantise new background/FX geometry to `PIXEL`; add a `snap(v)` helper and use it in new drawing code.
  Do not retrofit every existing draw call — quantise what you touch and what reads badly.
- Lights, fog, bloom and gradients are explicitly **exempt**: they are the smooth layer of the hybrid look.

Acceptance: a walking fighter's edges no longer crawl between pixels; `sprites.html` and `dev/stage.html`
screenshots unchanged in layout.

### Phase 2 — The light rig

New module `game/stage/lighting.ts`, exporting a `Lighting` class owned by `ArenaScene`, built by promoting
the existing `layers.dark` / `layers.glow` / `layers.tint` tunnel machinery into a general system.

- **Darkness layer**: a full-screen dark fill at a depth above the stage and below the fighters, whose alpha
  is per-car (brighter on the open roof, near-black in the tunnel) and which is *punched through* by light.
- **Light pools**: additive radial gradients drawn into a render texture and composited, one per light source.
  Sources are diegetic and declared as data: the train's roof lamps (`LAMP` in `backgrounds.ts`), the firebox
  glow on the stoker's car, the moon as a broad cold wash from upper-right, plus transient lights — fire
  hazards, the laser beam, the flashbang, impact sparks.
- **Light registration API**: `addLight({x, y, r, color, intensity, flickerHz?})` and a `pulse()` for
  transients, so `ItemFx` and `Effects` can light the world when they draw. A fire hazard must actually cast
  light on the roof around it; the laser must light both fighters as it passes.
- **Lamp flicker**: a slow seeded flicker on the train lamps (tiny, 3–5% intensity, not a strobe).
- **God-rays**: soft cones from the roof lamps, additive, very low alpha, drifting with the train, killed by
  `reducedMotion`.
- **Fighter lighting floor**: fighters are composited so they never drop below ~75% brightness; instead use
  the rasteriser's existing `rim` / `rimBoth` and `edgeDither` with `lamp` on the lit side and `glow1`/`moon`
  on the moon side. Do not put per-pixel light math inside `composeFrame`.
- **Contact shadow**: replace the flat ellipse in `rig/draw.ts`'s `drawShadow` with a soft pool that tightens
  and darkens as the fighter approaches the ground and widens/fades at jump apex.

Acceptance: on `dev/stage.html`, stepping a fighter from under a lamp into the dark visibly changes the light
on them while they remain fully readable; a lit molotov fire casts a moving pool; tunnel cars go near-black
with only lamps and rim light; a screenshot diff shows the lamps as the brightest thing on screen.

### Phase 3 — Atmosphere and post-processing

- **Atmospheric depth**: add a haze gradient between parallax bands so far layers sit behind air, and a
  near-camera foreground silhouette layer in `void0` (passing cables, poles, railing edges) scrolling faster
  than the roof. This parallax separation is the main thing that makes Hollow Knight scenes feel deep.
- **Airborne particulate**: slow drifting dust motes and warm embers near the firebox, seeded, budgeted
  (a hard cap on live particles, reported in the debug readout), dead under `reducedMotion`.
- **Camera post-FX**: add a bloom and a soft vignette on the main camera via Phaser's built-in camera FX.
  Feature-detect `this.renderer.type === Phaser.WEBGL` and skip cleanly on Canvas. Bloom must be subtle:
  light pools, the beam and impacts bleed; sprites and HUD text must not turn mushy. Reconcile with the
  existing `Effects.drawVignette` edge gradients — the OOB edge warning must stay distinguishable from the
  ambient vignette (keep it `danger`-tinted and pulsing).
- **Quality tiers**: add `session.quality: "high" | "low"` (URL `?quality=low`, default auto). `low` drops
  post-FX, god-rays and particulate, and keeps the light rig. Auto-downgrade when measured frame cost exceeds
  budget for ~2 seconds, and when WebGL is unavailable. Log the downgrade once.

Acceptance: 4-player `chaos` with fire, a beam and a flashbang holds 60fps on `high` on this machine, or
auto-downgrades and says so; `?quality=low` is visibly plainer but never broken; `updateMs` reported before/after.

### Phase 4 — Action animation

This is the part the owner cares most about. Work in `rig/pose.ts` (pure, testable) plus `Effects` / `ItemFx`
for the drawn juice. No gameplay timings change; all of this is render-side.

- **Laser / kamehameha — build the missing pose.** `pose.ts:269` currently returns `standing(rig)` for
  `action.kind === "laser"`. Write a real three-stage pose driven by the action's frame counter against
  `ARSENAL.LASER_CHARGE` (30) / `LASER_ACTIVE` (12) / `LASER_RECOVERY` (20):
  *charge* — weight shifts to the back foot, torso coils away from the target, both hands cup together at the
  back hip, head down, a rising tremble as the charge completes;
  *release* — explosive rotation into a two-palm forward thrust at chest height, front foot planted, hard
  back-lean against the recoil, head up;
  *recovery* — arms drift down, a short overshoot settle back to guard.
  Then anchor the existing charge ring to the cupped hands rather than the front fist, and have the beam
  origin track the palms. Add a light pulse (Phase 2) and a brief recoil shove on the camera.
- **Punch.** Sharpen the existing 4/3/8 read without new ticks: pull the shoulder back and coil the torso in
  startup (the `punchHint` system already lets the local player see this before the server confirms — use it),
  full extension with a smear on the active frame via the existing `drawTrail`, then recovery with a slight
  overshoot past guard before settling. Separate left/right reads must stay visually distinct.
- **Impact.** On hit: 4-frame hit-stop (exists), a white flash (exists), plus a directional spark burst along
  the punch vector, a shockwave ring quantised to the pixel grid, a light pulse, and a short camera punch
  opposite the knockback. On block: a tighter ring, a duller sound-shaped flash, no hit-stop on chip.
- **Movement weight.** Landing squash already exists — add a landing dust puff scaled to fall speed and a
  light-pool flicker on heavy landings. Walk gets a subtle 1px vertical bob already; add a trailing scuff.
  Jump gets anticipation on the takeoff frame and a stretch at the apex.
- **Sword, shield, molotov, banana, flash** each get one clear silhouette-changing pose beat rather than the
  arm staying in guard — a wind-up for the throw, a raised-forearm brace for the shield.
- **KO.** Keep the existing collapse and slowdown; add a fade of the fighter's rim light as they go down and
  a drop of the light pool they were standing in.

Acceptance: new `dev/ambience.html` preview page (modelled on `dev/fx.html`) that plays each action in
isolation at 1× and 0.25× speed for each of the four characters, with a frame counter. Screenshot the laser at
charge 0%, 50%, 100%, release frame 2, and recovery. Unit-test the new pose functions in
`packages/client/test/pose.test.ts` the way existing poses are tested: assert joint positions at named frames,
not pixels.

### Phase 5 — HUD restyle

Keep every piece of information and every layout position in `hud.ts`; restyle the chrome only.

- Bars keep their footprint and symmetry. Replace flat fills with an etched treatment: a dark recessed channel,
  the fill in team colour, a 1px `bone` top highlight, a soft inner shadow, and a faint glow that intensifies
  as HP drops. The drain animation stays.
- Numerals and names move to `bone` with a subtle warm glow instead of hard strokes; keep the existing
  condensed display stack — no new fonts, no network fonts.
- Round pips become small carved marks rather than plain circles. Item slots get a recessed bezel.
- Low-HP state: the existing danger recolour plus a slow breathing vignette at the screen edge (distinct from
  the OOB warning) and a faint heartbeat pulse on that fighter's bar only.
- Banner text (`ROUND 1`, `KO`, `FIGHT`) gets an ink-bleed entrance: bloom up from dark, hold, fade — no
  bouncy scale pop.
- `HUD_BAND` clearances and the existing `hud.test.ts` expectations must still hold. Update tests only where a
  value genuinely moved.

Acceptance: `dev/hud.html` screenshots at 2, 3 and 4 players, full HP and 1 HP; every number legible at 50%
browser zoom.

### Phase 6 — Menus and transitions

Re-light the existing landing and lobby; do not redesign them. They have an approved spec at
`docs/superpowers/specs/2026-09-12-ui-design-notes.md` — the railway ticket, the seat manifest, one amber
accent. Keep all of it.

- Swap the flat scrim for a fog gradient that lets the live stage through, warming toward the lamps.
- Amber accents get a soft outer glow; panels get an inner top highlight and a deeper recess.
- Add a slow ink/iris wipe between landing → lobby → arena → result, built in DOM/canvas, ~350ms, skipped
  under `reducedMotion`.
- Character select portraits get the same rim-light treatment as the arena sprites so selection previews match
  what you see in the fight.
- Keep focus management and keyboard navigation exactly as they are — `lobby.test.ts` and `landing.test.ts`
  must stay green.

### Deliverables

1. `implementation-docs/12-ambience/01`–`06` feature files in house format.
2. The implementation, one commit per phase, each with tests and typecheck green.
3. `dev/ambience.html` preview page, wired into `vite.config.ts`'s rollup inputs like the other dev pages.
4. Before/after screenshots in `.shots/ambience-*` for: roof 2P idle, tunnel car 4P chaos with fire, laser
   charge + release, KO, HUD at 2/3/4 players, landing, lobby.
5. A summary reporting `updateMs` before/after per phase, the live-particle caps, what degrades on `low`, and a
   proposed `DECISIONS_CHANGED.md` entry for the owner to approve.

### Start here

Begin in plan mode. Read `CLAUDE.md`, `implementation-docs/STATUS.md`, `implementation-docs/11-look/*`,
`HackCMU 2026/design/00-art-direction.md` and `04-vfx-and-feel.md`, then the client's `game/` directory. Come
back with: the phase plan, anything in the existing code that fights this direction, and any place where you
think a gameplay number is genuinely blocking a visual goal — before writing any code.
