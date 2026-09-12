# 9.06 — Sound: procedural Web Audio

## Purpose
Every sound in the game synthesised at runtime from oscillators and noise — no audio files — with a distinct, big
cue for equipping an item, and a mute key.

## Files
Create: `packages/client/src/game/sfx.ts`, `packages/client/dev/sfx.html`, `src/dev/sfxPreview.ts`, `test/sfx.test.ts`.
Owns nothing else. Does not edit `main.ts` or `ArenaScene.ts` (11.05 wires it).

## Depends on
8.01 (event names only).

## Exposes
```ts
type SfxName =
  | "equip_molotov" | "equip_sword" | "equip_shield" | "equip_banana" | "equip_flash"
  | "laser_charge" | "laser_fire" | "laser_hit"
  | "slash" | "parry" | "shield_absorb" | "shield_break"
  | "molotov_throw" | "fire_ignite" | "fire_loop_start" | "fire_loop_stop" | "peel_throw" | "slip" | "flash"
  | "punch_whiff" | "hit" | "block" | "jump" | "land" | "ko" | "round_start" | "round_end" | "match_end"
  | "pit_fall" | "ui_move" | "ui_select" | "countdown_tick";
class Sfx {
  constructor(ctx?: AudioContext);               // lazy: the context is created on the first play() after a user gesture
  play(name: SfxName, opts?: { pan?: number; gain?: number }): void;   // pan −1..1 from the world x
  /** Map sim events to sounds; pan from the fighter's x / WORLD.WIDTH. */
  consume(events: SimEvent[], state: MatchState): void;
  setMuted(muted: boolean): void; readonly muted: boolean;
  /** Recipes are data: the test asserts every SfxName has one and that each schedules ≥ 1 node. */
  static readonly RECIPES: Record<SfxName, Recipe>;
}
type Recipe = (ctx: BaseAudioContext, out: AudioNode, t0: number) => number; // returns duration in seconds
```
Persist mute in `localStorage["midnight-mayhem:muted"]`.

## Behaviour
1. Equip sounds are the signature cue (design ask: "special sound effects"): a two-part motif — a rising three-note
   arpeggio (square, 90 ms each, base note per item: molotov E4, sword A4, shield C4, banana G4, flash B4) followed
   by the item's texture: molotov = liquid slosh (low-passed noise burst with a 6 Hz LFO), sword = metallic ring
   (two detuned triangles, 1.2 s decay), shield = deep thunk (sine sweep 120→60 Hz), banana = comedic slide whistle
   (sawtooth glide up 400→900 Hz), flash = camera charge whine (sine 2 kHz → 4 kHz over 300 ms). Total ≤ 1.4 s.
2. Laser: charge = rising sine + noise swell 30 frames long (0.5 s); fire = 0.25 s sawtooth chord with a fast
   low-pass sweep and 0.4 s noise tail; hit = short crunch.
3. Fire: `fire_loop_start` starts a looping filtered-noise crackle (with random-ish amplitude from a periodic LFO,
   no `Math.random`) that `fire_loop_stop` fades out over 0.3 s; the scene calls start on `HAZARD_SPAWN fire` and
   stop when no fire hazard remains (11.05).
4. Existing feel: `hit` (60 ms noise + 120 Hz sine thump), `block` (short wooden tick), `jump` (quick up-chirp),
   `land` (thud), `ko` (descending 4-note), `round_start` (bell), `round_end` / `match_end` (bell chords),
   `countdown_tick`, `ui_move` / `ui_select` (tiny clicks), `pit_fall` (falling whistle), `slip` (boing), `flash` (pop).
5. `consume` maps: `ITEM_EQUIP → equip_<item>`, `LASER_CHARGE/FIRE/HIT`, `PARRY → parry`, `SHIELD_ABSORB → shield_absorb`,
   `ITEM_BREAK` shield → `shield_break`, `ITEM_USE` sword → `slash`, `PROJECTILE_SPAWN` → `molotov_throw` / `peel_throw`,
   `HAZARD_SPAWN fire → fire_ignite`, `HAZARD_HIT damage 0 → slip`, `FLASH → flash`, `HIT` blocked → `block` else `hit`,
   `JUMP → jump`, `LAND → land`, `ROUND_END` with a fighter at 0 hp → `ko`, `ROUND_START → round_start`,
   `ROUND_END → round_end`, `MATCH_END → match_end`, `PIT_FALL → pit_fall`, `PUNCH` → `punch_whiff`.
6. Master gain 0.6; muted → gain 0 immediately and no nodes are scheduled; `M` toggling is the scene's job (11.05).
7. Never throws when `AudioContext` is unavailable (tests, headless): `play` is a no-op and `consume` still returns.

## Invariants
- No audio files, no `fetch`, no `<audio>` elements.
- `Math.random` is allowed here (client only) but recipes must be deterministic given `t0` so the preview page can
  compare — use a seeded LCG in the module.
- At most 24 voices live at once; older ones are stopped first.

## Tests
`sfx.test.ts` with a minimal fake `BaseAudioContext` (records created nodes and `start`/`stop` times): every
`SfxName` has a recipe that schedules ≥ 1 node and returns a duration > 0; `consume` maps each event in rule 5 to the
named sound; muted schedules nothing; missing `AudioContext` → no throw; voice cap.

## Done when
- [ ] tests pass, `pnpm test` and `pnpm typecheck` green
- [ ] `dev/sfx.html` lists every sound with a play button (`window.__sfx`) and the agent has listened by reading the
  scheduled-node dump in the console for each (no ears required; check durations and node counts are sane)
- [ ] committed on `feat/sfx` with prefix `design:`
