# 9.10 — Molotov wind-up, sword slashes, sword timer

Owner request (2026-09-12 13:00): "molotov should have a separate throw action: charge by holding the elbow bent, the
time bent is how far it goes, draw a dotted predicted trajectory. Sword gets slash attack patterns (punch still
works with a sword). Sword can only be equipped for 10 seconds." Design approved in chat; this file is the
architecture. Three lanes on disjoint files after a shared contract commit. Sim stays pure (no DOM/Date/random).

## Contract (committed first, by the integrator)
- `InputFrame` gains `chop: boolean`, `sweep: boolean` (protocol v3; `EMPTY_FRAME`, `INPUT_KEYS`, `risingEdges`,
  server zod schema). Decision 35 amended.
- `sim/types.ts`: `SlashAction { kind: "slash"; style: "chop" | "sweep"; elapsed: number; landed: boolean }` joins
  `Action`; `HeldItem` gains `ticksLeft: number | null` (null = use-counted); `SimEvent` gains
  `{ type: "SLASH"; player; style }`.
- `constants.ts`: `ITEMS.sword` → `{ uses: 0, ttl: 600, ... }` (`ItemMeta.ttl?: number`); `THROW.CHARGE_MAX` 45 → 90;
  `ARSENAL` gains the chop / sweep timing, damage, hitbox and push numbers; `SWORD_REACH` / `SWORD_DAMAGE` removed.

## Lane V — vision (`src/vision/**`, `src/harness/panel.ts`, `src/app/cameraPreview.ts`, `test/*Gesture*.test.ts`)
Wind-up (A): metrics `elbowL/R` (shoulder–elbow–wrist angle, degrees, world landmarks) and `raiseL/R`
((shoulder.y − wrist.y) / S). Gesture `gestures/windup.ts`, per arm: active after `WINDUP_ON` frames of
`elbow ≤ WINDUP_ELBOW_DEG && raise ≥ WINDUP_RAISE`, released after `WINDUP_OFF` frames of
`elbow ≥ WINDUP_ELBOW_DEG + WINDUP_EXTEND || raise < WINDUP_DROP`. While active the arm's `punchX` is held true;
release drops it (the sim's falling edge throws). Only evaluated while the local fighter holds a throwable:
`VisionInputSource.setHeldItem(item)` fed from the last snapshot by the arena (sim truth, not the detector).
Priority per arm while a throwable is held: windup > punch > laser. Block cancels.
Slashes (B): `gestures/slash.ts`, per arm, only while the held item is `sword`. Chop = wrist above the nose then a
drop ≥ `CHOP_DROP·S` within `CHOP_WINDOW_MS` with `ext > CHOP_EXT`. Sweep = horizontal wrist travel across the
shoulder midline ≥ `SWEEP_TRAVEL·S` within `SWEEP_WINDOW_MS` at shoulder height. Each fires a one-frame pulse on
`chop` / `sweep` and suppresses that arm's punch for `SLASH_EXCLUSIVE_MS`; block on for ≥ 2 frames suppresses both.
This lane owns the exclusivity table in `classify.ts` (laser column filled by 9.09).
Harness and camera preview: `windup` row (elbow°, raise, active), `slash` row (chop / sweep gates).
Tests: synthetic metric sequences — rest, block, punch, wind-up-and-throw, wind-up-and-drop, chop, sweep, a punch
during the exclusivity window; pipeline test that a held wind-up yields N frames of `punchR` then a falling edge.

## Lane S — sim (`packages/shared/src/sim/**`, `packages/shared/test/**`, `src/input/KeyboardInputSource.ts`)
- Keyboard: `E` = chop, `R` = sweep.
- `chop` / `sweep` rising edge with a sword held and the fighter free (same gates as a punch) starts a
  `SlashAction`; without a sword the edge is ignored. A punch with a sword is a plain punch (no reach or damage
  bonus). Parry on block unchanged.
- Chop: `CHOP_STARTUP / ACTIVE / RECOVERY`, `CHOP_DAMAGE`, tall narrow hitbox, guard-crushing (a blocking target
  takes half damage, not chip). Sweep: faster, wide low hitbox, `SWEEP_PUSH` knockback ×2 a punch. Emit `SLASH` on
  start; hits go through the existing hit path (`PUNCH_HIT`-style events carry `style`).
- Timer (C): equip sets `ticksLeft = ITEMS[kind].ttl ?? null`; `tickCooldowns` counts it down; at 0 the slot clears
  with `ITEM_BREAK`. `consumeUse` is a no-op for a timed item. KO / pit do not pause the clock.
- Attract-mode inputs and any `InputFrame` literal in shared tests gain the two fields.
Tests: both hitboxes, guard crush, knockback, no sword → no slash, sword punch is plain, expiry at 600, swings free.

## Lane R — render (`src/game/**` except `arenaGlue.ts` input plumbing, `src/game/rig/pose.ts`, `test/*`)
- `rig/pose.ts`: `chop` (arm overhead → down) and `sweep` (arm across the body) poses; `posedFighter` maps a
  `SlashAction` to them (stop faking a swing as a punch).
- `itemFx.ts`: on `SLASH`, the existing crescent rotated vertical (chop) or horizontal (sweep); the throw arc (9.08
  rule 5) already reads `charge` and needs no change. `effects.ts` / `sfx.ts`: heavier chop hit, sweep whoosh.
- `hud.ts`: a timed item shows a draining bar instead of use pips; last 3 s flash.
- Every `InputFrame` literal in client tests / e2e plans gains the two fields; `tools/e2e/match-sword.json`.

## Gate
`pnpm test`, `pnpm typecheck`, `pnpm build` green; headless `match.json` and `match-sword.json` with zero page errors.
Human: wind-up on a real body at 1–2.5 m charges and the arc grows; chop / sweep fire and a thrust still punches.
