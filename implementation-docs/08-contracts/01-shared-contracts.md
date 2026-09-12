# 8.01 — Shared contracts for the expansion

## Purpose
Every type, constant, event, protocol message and simulation hook that the parallel lanes in phases 9–11 build
on, in one commit, with every existing test still green. This feature runs **alone on `main`** before any other
lane starts. It adds names and hook points; it implements no new gameplay (hooks are no-ops). It also generalises
the existing sim, server and client from exactly two fighters to N fighters so no lane has to.

## Files
Modify: `packages/shared/src/constants.ts`, `src/input.ts`, `src/protocol.ts`, `src/index.ts`, `src/sim/types.ts`,
`src/sim/create.ts`, `src/sim/step.ts`, `src/sim/combat.ts`, `src/sim/fighter.ts`, `src/sim/rounds.ts`,
`packages/shared/test/*` (only where tuple types no longer compile).
Create: `packages/shared/src/sim/items.ts`, `src/sim/projectiles.ts`, `src/sim/hazards.ts`, `src/sim/laser.ts`,
`src/sim/maps.ts`, `src/sim/modes.ts` (each a stub exporting the names below), `packages/shared/test/contracts.test.ts`.
Modify minimally so `pnpm typecheck` stays green: `packages/server/src/rooms.ts`, `src/loop.ts`, `src/handlers.ts`,
`packages/client/src/game/hud.ts`, `src/game/ArenaScene.ts`, `src/game/effects.ts`, `src/game/session.ts`,
`src/app/result.ts`, `src/app/lobby.ts`, `src/vision/classify.ts`, `src/input/KeyboardInputSource.ts`, and their
tests. Rule for these: the smallest change that compiles and keeps behaviour for two players (e.g. `fighters[0]`,
`fighters[1]` keep working; `players.map` over four slots).

## Depends on
Phases 1–6 (all merged on `main`).

## Exposes

### `constants.ts`
- `MAX_PLAYERS = 4`
- `ITEM_IDS = ["molotov", "sword", "shield", "banana", "flash"] as const`, `type ItemId`
- `ITEMS: Record<ItemId, { uses: number; label: string; cocoLabel: string }>` — molotov `{2, "Molotov", "bottle"}`,
  sword `{6, "Umbrella sword", "umbrella"}`, shield `{3, "Backpack shield", "backpack"}`, banana `{1, "Banana peel", "banana"}`,
  flash `{1, "Phone flash", "cell phone"}`
- `DEFAULT_LOADOUT: Loadout = ["molotov", "shield"]`
- `ARSENAL = { SWORD_REACH: 130, SWORD_DAMAGE: 10, PARRY_WINDOW: 10, PARRY_STUN: 24, THROW_STARTUP: 6, THROW_RECOVERY: 12,
  MOLOTOV_VX: 6, MOLOTOV_VY: -7, BANANA_VX: 5, BANANA_VY: -4, FIRE_W: 120, FIRE_TICKS: 240, FIRE_DAMAGE: 2, FIRE_EVERY: 20,
  PEEL_W: 40, PEEL_TICKS: 900, PEEL_OWNER_IMMUNE: 30, SLIP_STUN: 36, FLASH_AT: 4, DAZZLE_TICKS: 120,
  LASER_CHARGE: 30, LASER_ACTIVE: 12, LASER_RECOVERY: 20, LASER_COOLDOWN: 720, LASER_DAMAGE: 10, LASER_CHIP: 4,
  LASER_BAND_TOP: 130, LASER_BAND_BOTTOM: 70 } as const`
- `MAP_IDS = ["roof", "gaps", "platforms", "chaos"] as const`, `type MapId`
- `MAPS: Record<MapId, { label: string; ground: { x0: number; x1: number }[]; platforms: { x0: number; x1: number; y: number }[] }>`
  with the geometry in the spec §4.4
- `PIT = { Y: 520, DAMAGE: 8, TICKS: 40, RESPAWN_INSET: 40, INVULN: 30 } as const`
- `MODE_IDS = ["rounds", "timed", "deathmatch"] as const`, `type ModeId`
- `MODES: Record<ModeId, { label: string; roundTicks: number | null; roundsToWin: number; maxRounds: number }>`:
  rounds `{1800, 2, 3}`, timed `{5400, 1, 1}`, deathmatch `{null, 1, 1}`
- `TEAMS_IDS = ["ffa", "2v2"] as const`, `type TeamsId`
- `SPAWN_X: Record<2 | 3 | 4, readonly number[]>` = `[280, 680]`, `[200, 480, 760]`, `[120, 250, 710, 840]` (every spawn sits on ground on every map: gaps are 300–380 and 580–660)
- `TEAM_OF: Record<TeamsId, (i: PlayerIndex, players: number) => number>` — ffa → `i`, 2v2 → `i < 2 ? 0 : 1`
- `CHARACTERS = ["drifter", "conductor", "stoker", "claude"] as const` (type `CharacterId` widens)
- `CHARACTER_LABEL: Record<CharacterId, string>` = "THE DRIFTER", "THE CONDUCTOR", "THE STOKER", "CLAUDE CODE"
- `interface MatchConfig { players: 2 | 3 | 4; teams: TeamsId; mode: ModeId; map: MapId; items: boolean }`
- `DEFAULT_CONFIG: MatchConfig = { players: 2, teams: "ffa", mode: "rounds", map: "roof", items: true }`
- `normalizeConfig(c: Partial<MatchConfig>): MatchConfig` — fills defaults, forces `teams: "ffa"` unless `players === 4`
- `interface RosterEntry { character: CharacterId; loadout: Loadout }`
- `MATCH.ROUND_TICKS` and `MATCH.ROUNDS_TO_WIN`/`MAX_ROUNDS` stay (they are the `rounds` mode values)

### `input.ts`
- `InputFrame` gains `special: boolean` and `item: ItemId | null`; `EMPTY_FRAME.item === null`
- `INPUT_KEYS` gains `"special"` (booleans only); `type Loadout = [ItemId, ItemId]`
- `framesEqual` also compares `item`; `risingEdges` returns the seven booleans and `item: null`

### `sim/types.ts`
- `type PlayerIndex = 0 | 1 | 2 | 3`; `type Winner = number | "draw"` (team index)
- `interface HeldItem { kind: ItemId; uses: number }`
- `interface PunchAction { kind: "punch"; arm: Arm; elapsed: number; landed: boolean; sword: boolean }`
- `interface ThrowAction { kind: "throw"; item: "molotov" | "banana"; arm: Arm; elapsed: number; released: boolean }`
- `interface LaserAction { kind: "laser"; elapsed: number; hit: PlayerIndex[] }`
- `type Action = PunchAction | ThrowAction | LaserAction`; `FighterState.action: Action | null`
- `FighterState` loses `weaponSlots` and gains `team, loadout, item, itemsUsed, laserCooldown, blockTicks, dazzle,
  pitTicks, onPlatform, invuln` exactly as spec §3.4
- `interface Projectile`, `interface Hazard` as spec §3.4
- `MatchState.fighters: FighterState[]`, `roundsWon: number[]`, plus `config, projectiles, hazards, nextId`
- `SimEvent` gains every event in spec §3.4; `ROUND_END.winner`/`MATCH_END.winner` are `Winner` (team)
- `ProjectileHeight` is deleted (superseded by `Projectile.y`)

### `sim/create.ts`
- `createFighter(i: PlayerIndex, config: MatchConfig, entry: RosterEntry): FighterState` — spawn from `SPAWN_X[config.players]`,
  `team = TEAM_OF[config.teams](i, config.players)`, facing toward the world centre
- `createMatch(config: MatchConfig = DEFAULT_CONFIG, roster?: RosterEntry[]): MatchState` — missing roster entries
  default to `character = CHARACTERS[i]`, `loadout = DEFAULT_LOADOUT`; `roundTicks = MODES[mode].roundTicks ?? 0`
- `resetForRound(s, round)` keeps `prev`, `character`, `loadout`, `team`; clears `item`, `itemsUsed`

### `sim/step.ts`
`fightTick` order, each a named export the lanes fill in:
```
advancePunches(s)                      // combat.ts (existing; also advances throw/laser elapsed and clears finished ones)
tickCooldowns(s)                       // items.ts: laserCooldown, dazzle, invuln, blockTicks
for each i: controlFighter(s, i, input, events)   // fighter.ts (existing, N players; skips ko/pit fighters)
for each i: applyEquip(s, i, input, events)       // items.ts   (stub: no-op)
for each i: applyPhysics(f, i, s.config.map, events)  // fighter.ts (existing; pushes LAND on touchdown; map-aware body lands in 10.01)
updateFacing(s)                        // fighter.ts (nearest living opponent)
resolvePunches(s, events)              // combat.ts (existing, N players; sword/parry/shield land in 09.01)
resolveLaser(s, events)                // laser.ts  (stub)
advanceProjectiles(s, events)          // projectiles.ts (stub)
advanceHazards(s, events)              // hazards.ts (stub)
applyPits(s, events)                   // maps.ts (stub)
```
then `applyOutOfBounds`, `tickRound` as today.

### `sim/combat.ts`
- `hurtbox(f)` unchanged; new `canBeHit(f): boolean` = `f.hp > 0 && f.pitTicks === 0` (every hit path checks it)
- `isInvulnerable(f)` also true while `f.invuln > 0`
- `opponentsOf(s, i): PlayerIndex[]` — living fighters on another team
- `resolvePunches` iterates attackers 0..n-1 and `opponentsOf`; one landed hit per punch
- `applyDamage(s, target: PlayerIndex, damage: number, source: "punch" | "laser" | "hazard" | "oob" | "pit", attacker: PlayerIndex | null, events): { absorbed: boolean }`
  — the single place hp goes down (shield absorption is wired here by 09.01; the stub just subtracts)

### `sim/fighter.ts`
- `controlFighter(s, i, input, events)` (now takes the match so item dispatch can see it) — unchanged rules, returns
  early (no input) when `f.hp <= 0` or `f.pitTicks > 0`; `blockTicks` increments while blocking and resets to 0 on the
  block edge; on a `punchL`/`punchR` edge it first calls `usePunchWithItem(s, i, arm, events)` and only starts a normal
  punch when that returns false; on a `special` edge it calls `startLaser(s, i, events)` (laser.ts stub, returns false)
- `applyPhysics(f, i, map: MapId, events)` — flat-roof behaviour as today plus a `LAND { player }` event on the tick the
  fighter touches down; the map-aware body is 10.01
- `updateFacing(s: MatchState)` — nearest living opponent rule (spec §3.6)

### `sim/rounds.ts`
- `livingTeams(s): number[]`, `teamHp(s, team): number`
- `roundWinner(s)`: one living team → it; none → draw; timer out (only when `MODES[mode].roundTicks !== null`) → highest
  team hp / draw
- `matchWinner(s)` uses `MODES[mode].roundsToWin` / `maxRounds`; `roundsWon` indexed by team (length = number of teams)
- `tickRound` does not decrement when `roundTicks` is null-mode (roundTicks stays 0 and is ignored)

### Stubs (`items.ts`, `projectiles.ts`, `hazards.ts`, `laser.ts`, `maps.ts`, `modes.ts`)
Exported no-op functions with final signatures: `tickCooldowns(s)`, `applyEquip(s, i, input, events)`,
`usePunchWithItem(s, i, arm, events): boolean` (returns false = fall through to a normal punch), `startThrow(s, i, arm, events): boolean`,
`startLaser(s, i, events): boolean`, `resolveLaser(s, events)`,
`advanceProjectiles(s, events)`, `advanceHazards(s, events)`, `applyPits(s, events)`, `groundYAt(map, x, y): number`
(stub returns `WORLD.ROOF_Y`), `teamCount(config): number`. Each file has a one-line header naming the feature that fills it.

### `protocol.ts`
- `PROTOCOL_VERSION = 2`
- `InputFrameSchema` gains `special: z.boolean()`, `item: z.enum(ITEM_IDS).nullable()`
- `MatchConfigSchema`, `LoadoutSchema` (two distinct `ITEM_IDS`), client messages `CONFIG { config }` and
  `CUSTOMIZE { character: z.enum(CHARACTERS), loadout: LoadoutSchema }`
- `LobbyPlayer` gains `character: CharacterId; loadout: Loadout`; `LOBBY` gains `config: MatchConfig; host: PlayerIndex`
  and `players: (LobbyPlayer | null)[]` (length 4)
- `ErrorCode` gains `"NOT_HOST" | "BAD_CONFIG"`

### Server / client compile-fixes (behaviour-preserving)
- `Room.slots` becomes a 4-array; `Room.config: MatchConfig = DEFAULT_CONFIG`; `Room.host` = lowest occupied slot;
  `inputs()` returns `InputFrame[]` of length `config.players`; `allReady` = `config.players` slots filled and ready;
  `startMatch()` calls `createMatch(config, roster)`; `lobbyMessage()` includes `config` and `host`; `join` fills the
  lowest free slot below `config.players`, `ROOM_FULL` otherwise. `CONFIG`/`CUSTOMIZE` handlers accept and store
  (host check for CONFIG). Real behaviour rules and tests: 10.03.
- Client: `hud.ts`/`ArenaScene.ts`/`effects.ts` loop over `state.fighters` instead of `[0, 1] as const` where a tuple
  was assumed; `result.ts` names the winner by `CHARACTER_LABEL` of the winning team's first fighter (2v2: "TEAM A/B");
  `lobby.ts` renders whatever slots exist; `KeyboardInputSource` and `classify` set `special: false, item: null`.

## Behaviour
1. `createMatch()` with no arguments produces a state equal to today's, plus the new fields at their zero values
   (`config = DEFAULT_CONFIG`, `projectiles = []`, `hazards = []`, `nextId = 1`, fighters with `team = i`,
   `loadout = DEFAULT_LOADOUT`, `item = null`, `itemsUsed = []`, all counters 0, `onPlatform = null`).
2. Every existing test in `packages/shared`, `packages/server`, `packages/client` passes unchanged in intent; only
   type-level edits (tuple → array, new frame fields in fixtures) are allowed.
3. `createMatch({ players: 4, teams: "2v2", ... })` spawns four fighters at `SPAWN_X[4]` with teams `[0,0,1,1]`, the
   outer two facing inward and the inner two facing the nearest opponent.
4. With three fighters and one at 0 hp, `roundWinner` is null while two teams still live; when one team remains it is
   that team's index.
5. `timed` mode: `roundTicks` starts at 5400 and a full match ends after one round. `deathmatch`: `roundTicks` is 0
   and never ends the round; only KO does.
6. `parseClientMessage` accepts `CONFIG` and `CUSTOMIZE`, rejects a loadout with two equal items and an unknown map.
7. `framesEqual` differs on `item`; `risingEdges` never reports `item`.

## Invariants
- No new gameplay lands here: with default config and two players, a full-match replay (`fullmatch.test.ts`) produces
  the same winner and hp trace as before this feature.
- `step` still never mutates `prev`.
- `packages/shared` imports nothing from server or client.

## Tests
`packages/shared/test/contracts.test.ts`: rules 1, 3, 4, 5, 6, 7. Existing suites green.

## Done when
- [ ] `pnpm test` and `pnpm typecheck` green in all three packages
- [ ] committed on `main` as `contracts: expansion types, config, N players, sim hooks`
- [ ] `STATUS.md` lane table unblocked (the integrator does this)
