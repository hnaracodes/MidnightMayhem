# 9.01 — Items core: equip, sword, shield, flash

## Purpose
The item slot in the simulation: equipping from the input frame under the loadout and per-round rules, and the
three items that live entirely inside melee resolution — sword (reach, parry), shield (absorb 3 hits), flash
(dazzle). Molotov and banana are 9.02; laser is 9.03.

## Files
Modify: `packages/shared/src/sim/items.ts` (replace stub), `src/sim/combat.ts`.
Create: `packages/shared/test/items.test.ts`.
Owns nothing else. Needs from other lanes: nothing (9.02 calls `usePunchWithItem` through the dispatch below).

## Depends on
8.01.

## Exposes
`items.ts`:
- `tickCooldowns(s: MatchState): void` — decrements `laserCooldown`, `dazzle`, `invuln` toward 0 for every fighter.
- `canEquip(s, i, item: ItemId): boolean` — all of: `s.config.items`, phase COUNTDOWN or FIGHTING, `item ∈ loadout`,
  `item ∉ itemsUsed`, `f.item === null`, `f.hitstun === 0`, `f.hp > 0`, `f.pitTicks === 0`.
- `applyEquip(s, i, input, events): void` — on the edge `input.item !== f.prev.item && input.item !== null` and `canEquip`:
  set `f.item = { kind, uses: ITEMS[kind].uses }`, push to `itemsUsed`, push `ITEM_EQUIP`.
- `consumeUse(s, i, events): void` — `uses--`; push `ITEM_USE`; at 0 push `ITEM_BREAK` and set `item = null`.
- `usePunchWithItem(s, i, arm, events): boolean` — called by `controlFighter` on a punch edge before starting a normal
  punch. Dispatch on `f.item?.kind`:
  - `sword` → `f.action = { kind: "punch", arm, elapsed: 0, landed: false, sword: true }`, push `PUNCH`, `consumeUse`, return true.
  - `flash` → `f.action = { kind: "punch", arm, elapsed: 0, landed: true, sword: false }` (`landed: true` means it can
    never hit), set `dazzle = DAZZLE_TICKS` on every living opponent, push `FLASH { player: i }`, `consumeUse`, return true.
  - `molotov` / `banana` → return `startThrow(s, i, arm, events)` from `projectiles.ts` (9.02 fills it; the 8.01 stub
    returns false, so the punch falls through until 9.02 merges).
  - `shield` or no item → return false (normal punch).
- `absorbWithShield(s, i, events): boolean` — if `f.item?.kind === "shield"`: `consumeUse` (pushing `SHIELD_ABSORB
  { player, left }` before a possible `ITEM_BREAK`) and return true; else false.

`combat.ts` changes:
- `punchHitbox(f)` uses `ARSENAL.SWORD_REACH` when `f.action.kind === "punch" && f.action.sword`.
- `applyDamage(s, target, damage, source, attacker, events)`: for `source` in `punch | laser | hazard`, first
  `absorbWithShield` → if absorbed, hp unchanged, return `{ absorbed: true }`. OOB and pit never absorb.
- `resolvePunches`: damage is `SWORD_DAMAGE` for sword punches; **parry**: if the target is blocking, holds a sword and
  `target.blockTicks < PARRY_WINDOW`, then no damage, `attacker.action = null`, `attacker.hitstun = PARRY_STUN`,
  `attacker.knockbackVx = 0`, push `PARRY { player: target, attacker }`; the punch counts as landed.
  Hits on a shield holder go through `applyDamage` and, when absorbed, cause no hitstun or knockback.

## Behaviour
1. Equip happens once per item per round; a second `item` edge for the same kind in the same round is ignored; after
   `resetForRound` it works again.
2. Equip is refused while another item is held, while in hitstun, when the item is not in the loadout, or when
   `config.items` is false.
3. Sword: a punch from 120 px away lands (normal reach 70 would miss); damage 10; the 6th swing pushes `ITEM_BREAK`
   and clears the item; the 7th punch is a normal punch.
4. Parry: block edge, then an opponent's punch that connects on tick ≤ 9 of the block → `PARRY`, attacker in hitstun
   24, target hp unchanged. Connecting on tick 10 or later → ordinary blocked hit (chip 3).
5. Shield: three unblocked hits deal 0 damage and no hitstun, each pushing `SHIELD_ABSORB` with `left` 2, 1, 0 and the
   third also `ITEM_BREAK`; the fourth hit deals 12. OOB damage is never absorbed.
6. Flash: on the punch edge every living opponent (both, in FFA with three) gets `dazzle = 120`, `FLASH` is pushed,
   the item breaks; the punch can never connect because `landed` starts true (assert no `HIT` over the full punch).
   `dazzle` counts down 1 per tick via `tickCooldowns`.
7. `tickCooldowns` never goes below 0.

## Invariants
- `f.item.uses > 0` whenever `f.item !== null`.
- `itemsUsed` never contains duplicates and never an item outside `loadout`.
- Nothing here reads `Math.random` or the clock.

## Tests
`items.test.ts`: one `it` per behaviour rule, using `createMatch` with an explicit roster and stepping with frames
built from `EMPTY_FRAME`. Helper: `stepN(s, n, inputs)`.

## Done when
- [ ] tests pass, `pnpm test` and `pnpm typecheck` green
- [ ] committed on branch `feat/sim-items` with prefix `sim:`
