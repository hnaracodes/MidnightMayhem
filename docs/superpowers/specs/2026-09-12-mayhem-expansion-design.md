# Midnight Mayhem expansion — design spec

Date: 2026-09-12 (session 2). Owner directive: "go, no intervention". Every decision below was made by the
planning agent under that directive and is recorded in `DECISIONS_CHANGED.md` rows 34–48.

This spec is the reasoning behind the feature files in `implementation-docs/08-contracts`, `09-arsenal`,
`10-arenas`, `11-look`. Agents build from the feature files; this file explains why they say what they say.

## 1. What is being added

| Area | Adds |
|---|---|
| Arsenal | Laser beam (gesture, cooldown). Five detectable items with usage limits: water bottle → molotov, umbrella → sword (reach + parry), backpack → shield (3 hits), banana → peel trap, cell phone → flashbang. Item equip has a materialise effect and a synthesised sound. |
| Object detection | MediaPipe `ObjectDetector` (EfficientDet-Lite0, COCO labels) inside the existing pose worker. "Held" = box near a wrist. |
| Players | 2, 3 or 4 players. 3 = free-for-all. 4 = free-for-all or 2v2. |
| Customisation | Pre-fight: character pick, 2-item loadout; host picks map, mode, player count, teams, items on/off. |
| Maps | `roof` (flat), `gaps` (two pits), `platforms` (two floating one-way platforms), `chaos` (both). |
| Modes | `rounds` (best of 3 × 30 s, current), `timed` (one 90 s round, HP decides), `deathmatch` (no timer, KO). |
| Look | Pixel-art paper-doll sprites for four characters (Drifter, Conductor, Stoker, Claude Code). Moving train: wheels, sparks, smoke, telegraph poles, bob, lightning, tunnel whoosh. Landing page with the live stage behind it. HUD for up to four fighters. |
| Sound | Procedural Web Audio (`sfx.ts`), no files. |

## 2. Non-negotiables carried over

- `packages/shared` is the only cross-package surface; the sim never touches DOM, Phaser, `Date`, `Math.random`, sockets.
- Balance and geometry numbers live only in `packages/shared/src/constants.ts`.
- Keyboard always works. Camera and object detection are additive.
- No image files. Pixel art is data (string grids) rasterised at boot. This is the same rule as before: every visual
  is code.
- Server authoritative, 60 Hz, full snapshots at 30 Hz.
- Do not push.

## 3. Contracts (built first, alone — `08-contracts/01`)

### 3.1 InputFrame

```ts
interface InputFrame {
  left, right, jump, punchL, punchR, block: boolean;
  special: boolean;          // laser: both arms thrust forward together / key Q
  item: ItemId | null;       // what the camera sees in the hand / keys 1–5 while held
}
```
`INPUT_KEYS` lists the seven booleans; `item` is compared separately by `framesEqual`. `risingEdges` covers the
booleans only. `EMPTY_FRAME.item === null`.

Why one frame and not a new message: the seq/heartbeat/ack path already exists and the sim already does edge
detection on `prev`. Equip is the edge `prev.item !== item && item !== null`.

### 3.2 Items

```ts
const ITEM_IDS = ["molotov", "sword", "shield", "banana", "flash"] as const;
type ItemId = typeof ITEM_IDS[number];
interface HeldItem { kind: ItemId; uses: number }       // uses = remaining swings / throws / hits
type Loadout = [ItemId, ItemId];                        // two distinct items chosen pre-fight
```
`ITEMS: Record<ItemId, { uses: number; label: string; cocoLabel: string }>` in constants:
molotov 2 / "bottle", sword 6 / "umbrella", shield 3 / "backpack", banana 1 / "banana", flash 1 / "cell phone".

### 3.3 Match configuration

```ts
type MapId = "roof" | "gaps" | "platforms" | "chaos";
type ModeId = "rounds" | "timed" | "deathmatch";
type TeamsId = "ffa" | "2v2";
interface MatchConfig { players: 2 | 3 | 4; teams: TeamsId; mode: ModeId; map: MapId; items: boolean }
interface RosterEntry { character: CharacterId; loadout: Loadout }
DEFAULT_CONFIG = { players: 2, teams: "ffa", mode: "rounds", map: "roof", items: true }
createMatch(config = DEFAULT_CONFIG, roster?: RosterEntry[]): MatchState
```
`teams: "2v2"` is only valid with `players: 4`; `normalizeConfig` coerces.

### 3.4 State

```ts
type PlayerIndex = 0 | 1 | 2 | 3;
type Winner = number | "draw";          // a TEAM index (== player index in FFA)
type Action =
  | { kind: "punch"; arm: Arm; elapsed: number; landed: boolean; sword: boolean }
  | { kind: "throw"; item: "molotov" | "banana"; arm: Arm; elapsed: number; released: boolean }
  | { kind: "laser"; elapsed: number; hit: PlayerIndex[] };
interface FighterState {
  ...existing, minus weaponSlots, plus:
  team: number;
  loadout: Loadout;
  item: HeldItem | null;
  itemsUsed: ItemId[];         // equipped this round; reset each round
  laserCooldown: number;       // ticks until the laser may fire again
  blockTicks: number;          // ticks block has been held (parry window)
  dazzle: number;              // ticks of flashbang whiteout left
  pitTicks: number;            // ticks left in a pit fall
  onPlatform: number | null;   // index into MAPS[map].platforms when standing on one
  invuln: number;              // respawn i-frames after a pit
}
interface Projectile { id: number; kind: "molotov" | "banana"; owner: PlayerIndex; x, y, vx, vy: number }
interface Hazard { id: number; kind: "fire" | "peel"; owner: PlayerIndex; x: number; y: number; w: number; ticks: number; age: number }
interface MatchState {
  ...existing with fighters: FighterState[], roundsWon: number[], plus:
  config: MatchConfig; projectiles: Projectile[]; hazards: Hazard[]; nextId: number;
}
```

New events: `ITEM_EQUIP {player,item}`, `ITEM_USE {player,item}`, `ITEM_BREAK {player,item}`,
`SHIELD_ABSORB {player, left}`, `PARRY {player, attacker}`, `LASER_CHARGE {player}`, `LASER_FIRE {player}`,
`LASER_HIT {attacker,target,damage,blocked}`, `PROJECTILE_SPAWN {id,kind,owner}`, `HAZARD_SPAWN {id,kind,x}`,
`HAZARD_HIT {id,kind,target,damage}`, `FLASH {player}`, `PIT_FALL {player}`, `PIT_RESPAWN {player}`,
`LAND {player}`.

### 3.5 Protocol

Client: `CONFIG {config}` (host only, lobby only), `CUSTOMIZE {character, loadout}`.
`LobbyPlayer` gains `character`, `loadout`. `LOBBY` gains `config`, `host: PlayerIndex`, and `players` becomes
a 4-slot array. `PROTOCOL_VERSION = 2`.

### 3.6 N-player generalisation of existing rules

- Spawn X: 2 → `[280, 680]`; 3 → `[200, 480, 760]`; 4 → `[140, 340, 620, 820]`. Teams for 2v2: `[0, 0, 1, 1]`.
- Facing: the nearest living opponent (different team, hp > 0). Ties keep facing. Dead fighters keep facing.
- Punch resolution: every attacker against every living opponent; one hit per punch still (first overlap wins,
  lowest index).
- Round winner: when every living fighter is on one team → that team. Timer out → team with the highest total HP,
  equal → draw. A fighter at 0 hp is `ko`: no input, no hitbox/hurtbox, drawn collapsed.
- `roundsWon` is per team.

## 4. Simulation rules

### 4.1 Laser (`09-arsenal/03`)
`special` edge, grounded, no action, not blocking, `laserCooldown === 0`, hp > 0 → action laser. Charge 30 ticks
(locked in place; being hit cancels and refunds no cooldown), beam active ticks 30–41 (12 ticks): a hitbox from
the fighter's x in the facing direction to the world edge, y band `[feet − 130, feet − 70]`. Each living opponent is
hit at most once per beam: damage 10, blocked chip 4, jump i-frames and being above the band avoid it. Recovery
20 ticks. Cooldown 720 ticks starts when the beam starts. Events LASER_CHARGE at start, LASER_FIRE at tick 30,
LASER_HIT per target.

### 4.2 Equip (`09-arsenal/01`)
On the edge `input.item` → `X` (from anything else) while `phase` is COUNTDOWN or FIGHTING, `config.items`,
`X ∈ loadout`, `X ∉ itemsUsed`, `item === null`, not in hitstun, not ko: `item = { kind: X, uses: ITEMS[X].uses }`,
push X to `itemsUsed`, event ITEM_EQUIP. Otherwise ignore. `itemsUsed` and `item` reset at round reset.

### 4.3 Item behaviour
- **sword**: punches use `SWORD_REACH 130`, `SWORD_DAMAGE 10`, `action.sword = true`, `uses--` per swing; 0 → ITEM_BREAK,
  item null. **Parry**: block edge sets `blockTicks = 0`; while `blockTicks < PARRY_WINDOW 10` and holding a sword,
  an incoming punch/sword hit deals nothing, attacker gets `PARRY_STUN 24` hitstun with no knockback, event PARRY.
- **shield**: passive. Any HIT, LASER_HIT or HAZARD_HIT damage → absorbed fully (no hp loss, no hitstun),
  `uses--`, SHIELD_ABSORB; at 0 → ITEM_BREAK. Does not absorb OOB or pit damage. Chip through block is still absorbed.
- **molotov**: punch edge with item → throw action (startup 6, release at 6, recovery 12); projectile from the hand at
  `(x + facing·20, feet − 100)`, `vx = facing·6`, `vy = −7`, gravity `BALANCE.GRAVITY`; on reaching ground
  (`groundYAt`) or leaving the world → fire hazard `w 120`, `ticks 240`, `HAZARD_DAMAGE_FIRE 2` every 20 ticks to any
  fighter (owner included) whose hurtbox overlaps and who is grounded on it. `uses--`; 0 → ITEM_BREAK.
- **banana**: same throw; `vx = facing·5`, `vy = −4`; lands → peel hazard `w 40`, `ticks 900`. A grounded fighter with
  `vx ≠ 0` overlapping the peel (owner immune for 30 ticks after spawn) slips: `hitstun = SLIP_STUN 36`, no knockback,
  peel removed, HAZARD_HIT with damage 0. 1 use.
- **flash**: punch edge → action punch (arm) with no hitbox; at elapsed 4 every living opponent gets `dazzle = DAZZLE_TICKS 120`,
  event FLASH. 1 use → ITEM_BREAK.

### 4.4 Maps (`10-arenas/01`)
`MAPS: Record<MapId, { ground: {x0,x1}[]; platforms: {x0,x1,y}[] }>` in constants:
- roof: ground `[0, 960]`.
- gaps: ground `[0, 300] [380, 580] [660, 960]`.
- platforms: ground `[0, 960]`, platforms `[150, 330, 330]`, `[630, 810, 330]`.
- chaos: gaps' ground + platforms' platforms.
`groundYAt(map, x, y): number` = the highest surface with `y_surface ≥ y` under x (roof if on a ground segment,
a platform if x within span), or `PIT_Y = ROOF_Y + 90` when over a gap. Physics: a grounded fighter whose x leaves
every surface starts falling (`grounded=false, vy=0`). A falling fighter that crosses a surface lands on it (one-way
platforms: only when `vy > 0` and previous feet ≤ platform y). Reaching `PIT_Y` → PIT_FALL: `PIT_DAMAGE 8`,
`pitTicks = PIT_TICKS 40`, no input; after that respawn at the nearest ground edge 40 px inward, `invuln = 30`,
PIT_RESPAWN. Spawn X on gap maps are checked to be on ground (they are).

### 4.5 Modes (`10-arenas/02`)
`MODES: Record<ModeId, { roundTicks: number | null; roundsToWin: number; maxRounds: number }>`:
rounds `{1800, 2, 3}`, timed `{5400, 1, 1}`, deathmatch `{null, 1, 1}`. `roundTicks === null` → timer never
counts down, HUD shows `∞`.

## 5. Vision (`09-arsenal/04`)

- Worker creates `ObjectDetector` beside the pose landmarker (`efficientdet_lite0.tflite`, score ≥ 0.4,
  `categoryAllowlist` = the five COCO labels, VIDEO mode). Runs every `OBJECT_EVERY_N = 3` frames; the result
  message carries `objects: Detection[] | null` and `objectMs`.
- Held test on the main thread: box centre within `HOLD_RADIUS 0.35·S` of either wrist landmark **or** the wrist
  inside the box. Debounce `HOLD_ON 3` consecutive positives; `HOLD_OFF_MS 600` without a positive clears.
  Output `item: ItemId | null` in the frame.
- Laser gesture: both arms extended toward the camera (`extL, extR < LASER_EXT 0.55`), both `atHeight`, wrists within
  `LASER_GAP 0.5·S` of each other, debounce 2 on / 3 off. `classify`: `special` beats punches; block beats special.
- Keyboard: `Q` special, `Digit1..5` item molotov/sword/shield/banana/flash while held.
- Preview shows the detected label and box; harness shows object ms.
- `vision:setup` also downloads the detector model into `public/models/`.

## 6. Client

### 6.1 Sprites (`11-look/01`)
Pixel paper-doll. Sprite space: 1 sprite px = 3 world px. Hand-authored parts per character as string grids
(palette-indexed characters): head (with signature), torso, hands, feet, plus item sprites. Limbs are rasterised
from `computePose` joints converted to sprite space with 1 px-snapped 3–4 px thick lines, 1 px outline, 2-tone
dither on the moon side. Drawn every frame into one `CanvasTexture` per fighter, blitted at scale 3 with nearest
filtering. Vector rig stays behind `?rig=vector`. Preview page `sprites.html` shows every character in every
state for screenshot review.

Characters: `drifter`, `conductor` (looks per `design/01`), `stoker` (engine hand: bald, goggles on forehead, soot,
sleeveless, red neckerchief, coal-grey key colour), `claude` (Claude Code: an eight-armed orange sunburst head with two
dot eyes, a dark terminal-window torso with a blinking `>_` prompt, black limbs, white gloves).

### 6.2 Stage (`11-look/02`) and map drawing (`10-arenas/04`)
Wheels and bogies drawn under the roof lip at the bottom edge, rotating with roof speed; sparks from the wheels;
engine smoke plumes drifting back across the sky; telegraph poles whipping past at 300 px/s; 1 px train bob at
1.5 Hz applied to roof/body layers; distant lightning in the tunnel-free rounds every ~9 s; tunnel entry whoosh
(a dark sweep). Gaps are drawn as breaks in the roof with a visible car coupling; platforms as riveted steel
cargo racks with amber underlight.

### 6.3 Landing and lobby (`11-look/03`)
The live stage (arena scene) runs behind the DOM from the first frame. The landing hero is the moving train with
the four characters idling on the roof in attract mode (`session.attract`), title, join form. Lobby: room code,
up to four slots, character pick (with sprite preview), loadout pick (2 of 5), host controls (players, teams,
mode, map, items). Frontend-design skill is mandatory for this lane; fonts must be local (offline demo).

### 6.4 HUD (`11-look/04`)
Up to four bars (two per side, stacked), team tint, name, item slot icons with remaining uses, laser cooldown
ring, `∞` timer in deathmatch, round pips per team.

### 6.5 Item FX (`09-arsenal/05`) and SFX (`09-arsenal/06`)
Materialise: amber particle implosion into the hand over 20 frames, then the item sprite appears; laser charge
ring and beam (moon core, amber edge, 12 frames + fade); sword slash arc; shield bubble with cracks per absorb;
molotov arc trail, fire tongues; peel on the ground; flash: local whiteout when the local fighter is dazzled.
SFX: synthesised equip chime, laser charge/fire, slash, parry clang, shield thunk/crack, molotov whoosh/crackle,
slip, flash pop, plus hit/block/jump/land/ko/round bells. Master gain from a mute toggle (`M`).

### 6.6 Arena integration (`11-look/05`, last)
Wires sprites (or rig), item FX, map drawing, HUD, SFX, attract mode, N fighters, dazzle overlay.

## 7. Execution plan

Phase A (alone): `08-contracts/01`. Phase B (parallel worktrees, disjoint file ownership): the lanes in
`STATUS.md`. Phase C (alone): merge, then `11-look/05`. Phase D: parallel reviewers per area, fixers, final
verification (tests, typecheck, build, headless four-window match).
