# 9.08 — Aimed charged throws, shield redesign, equip feedback

Owner feedback after the first LAN test (2026-09-12): "the molotov can't be thrown far — we need a way to angle and
throw it effectively with proper physics; the shield visuals are not great; equipping has no satisfying sound /
text next to the health bar." Two lanes, disjoint files, both after the expansion merged on `main`.

## Lane A — sim: charged, aimed throw (`feat/throw-charge`)

### Files
Modify: `packages/shared/src/constants.ts` (add `THROW` block only), `src/sim/projectiles.ts`, `src/sim/fighter.ts`
(punch-edge dispatch for throwables only), `src/sim/types.ts` (`ThrowAction` fields), `packages/shared/test/throwables.test.ts`.
Do not touch `combat.ts`, `items.ts`, `laser.ts`, `maps.ts`, `rounds.ts`, `create.ts` (other teammates).

### Exposes
- `THROW = { CHARGE_MAX: 45, MIN_RANGE: 120, MAX_RANGE: 640, ANGLE_DEG: 45, VISION_CHARGE: 0.7, RELEASE_TICKS: 6, RECOVERY: 12 } as const`
- `ThrowAction` becomes `{ kind: "throw"; item: "molotov" | "banana"; arm: Arm; phase: "charge" | "release"; charge: number; elapsed: number; released: boolean }`
- `throwVelocity(range: number): { vx: number; vy: number }` — pure: the launch speed that lands `range` px away on
  flat ground at `ANGLE_DEG` under `BALANCE.GRAVITY` from a release height of 100 px (`vx = v·cos θ`, `vy = −v·sin θ`;
  solve `range = vx · t_land` with `t_land` from the quadratic on 100 px + `vy` rise); tested to land within ±10 px.
- `chargeToRange(charge: number): number` — linear `MIN_RANGE → MAX_RANGE` over `0 → CHARGE_MAX`.
- `startThrow(s, i, arm, events)` now enters `phase: "charge"`, `charge: 0`; while the same punch key stays held,
  `advanceThrowCharge(s, inputs)` increments `charge` up to `CHARGE_MAX`; on the key's falling edge (or at
  `CHARGE_MAX`), phase → `release`, `elapsed = 0`; release at `elapsed === RELEASE_TICKS` spawns the projectile with
  `throwVelocity(chargeToRange(charge))` in the facing direction; recovery `RECOVERY` ticks.
- A fighter in `charge` phase cannot move, jump or block (same lock as a punch); a hit cancels it without spending
  a use.
- Vision input has no hold, so the keyboard and camera differ only in charge: `InputFrame.punchL/R` from the camera
  is a one-frame pulse; the sim cannot tell, so the rule is: **a charge released before 3 ticks throws at
  `VISION_CHARGE · CHARGE_MAX`** (a tap = medium throw, a hold = aimed throw).
- Projectile physics unchanged (gravity, landing → hazard); ceiling: clamp `y ≥ 0`.

### Behaviour
1. Tap `F` (held 1 tick) with a molotov → lands 0.7 · (640 − 120) + 120 ≈ 484 px ± 15 away on `roof`.
2. Hold `F` for 45+ ticks then release → lands 640 ± 15 px; hold 22 ticks → ~374 ± 15.
3. Hold 45 ticks and keep holding → auto-release at `CHARGE_MAX`.
4. During charge: no walk, no jump; a hit cancels the throw, use not spent, item still held.
5. Banana uses the same charge; existing peel rules unchanged.
6. Landing beyond the world edge → no hazard; landing in a pit → no hazard (existing).
7. The 9.02 "70–130 px" test is replaced by rules 1–2 (note this in the commit).

### Tests
`throwables.test.ts`: rules 1–6 plus `throwVelocity` accuracy at 120, 380, 640.

## Lane B — client: shield barrier, equip feedback, throw preview (`feat/equip-feel`)

### Files
Modify: `packages/client/src/game/itemFx.ts` (shield + materialise + arc preview), `src/game/hud.ts` (equip toast +
icon pop), `src/game/sfx.ts` (equip cue), `src/game/sprites/parts/items.ts` (racket replaces the umbrella art),
`test/itemFx.test.ts`, `test/hud.test.ts`, `test/sfx.test.ts`.
Do not touch `ArenaScene.ts` beyond passing the local input sample to `ItemFx.draw` (one argument) if needed.

### Exposes / rules
1. **Shield barrier** (replaces the bubble): a hexagonal `moon` 35 % barrier 70 × 150 on the facing side, offset 30 px
   in front of the fighter, 2 px `steel-2` edge, a slow shimmer band (moves top→bottom every 1.2 s); `SHIELD_ABSORB` →
   a ripple ring from the impact point + one jagged crack line per hit used (`3 − left` cracks), 4-frame `white` flash;
   `ITEM_BREAK` shield → the hexagon shatters into 6 shards flying outward over 12 frames with a `shield_break` cue.
   The backpack sprite stays on the back. Barrier follows facing.
2. **Equip toast** in the HUD: on `ITEM_EQUIP`, beside that fighter's bar (inside for P0/P2, mirrored for P1/P3) a
   panel slides in over 10 frames: item glyph, `MOLOTOV ×2` in `amber-1`, `EQUIPPED` beneath in `moon`; holds 90
   frames, slides out 10. `ITEM_USE` pulses the slot pips; `ITEM_BREAK` shows `BROKEN` in `danger` for 45 frames.
   Pure `toastLayout(players, i)` exported and tested (no overlap with bars or names).
3. **Materialise** is bigger: 24 particles, ring 60 px, a 2-frame screen-edge `amber-1` 8 % flash for the local
   player only, and the item sprite scales 1.6 → 1 over 6 frames after it appears.
4. **Equip cue** in `sfx.ts`: two stages — a 60 ms noise "snap" then the existing per-item motif at +6 dB, total ≤ 1.4 s.
   `equip_*` recipes updated; test asserts the snap node precedes the motif.
5. **Throw preview**: while the local fighter's action is `throw` in `charge` phase, draw a dotted arc (12 dots,
   `amber-1`, 60 % → 20 %) of the predicted flight for the current `charge` using `throwVelocity(chargeToRange(charge))`
   from `@midnight/shared` (Lane A exports; until it merges, import from a local `throwPreview.ts` that duplicates the
   two pure functions with a comment `INTEGRATOR: collapse after merge`). A landing marker (`danger` ring r 10) at the
   predicted ground point. Removed on release.
6. **Racket art**: `ITEM_PARTS.sword` is a tennis racket (oval head with 3 × 3 string grid, short handle), 12–14 px.

### Tests
`itemFx.test.ts`: barrier created/removed with the item, crack count, shards on break, preview dots while charging,
none after release. `hud.test.ts`: `toastLayout` for 2/3/4 players, toast lifecycle frames. `sfx.test.ts`: snap +
motif order.

## Done when (both lanes)
- tests green, `pnpm typecheck` green, committed on the lane branch with the trailers, not pushed
- Lane B: `dev/itemfx.html` screenshots `.shots/equip-*.png` reviewed (barrier, crack, shatter, toast, preview arc)
- Integrator merges both, collapses the preview shim, rebuilds, restarts the LAN server
