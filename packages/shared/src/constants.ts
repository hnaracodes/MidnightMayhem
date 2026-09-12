/** Every gameplay number lives here and nowhere else. See implementation-docs/01-simulation/01 and 08-contracts/01. */
import type { Loadout } from "./input";
import type { PlayerIndex } from "./sim/types";

export const TICK = { HZ: 60, MS: 1000 / 60, SNAPSHOT_EVERY: 2, MAX_CATCHUP: 5 } as const;

export const WORLD = {
  WIDTH: 960, HEIGHT: 540, ROOF_Y: 430,
  SOFT_EDGE_L: 72, SOFT_EDGE_R: 888,
  PLAYER_START_X: [280, 680] as const,
  HURTBOX_W: 72, HURTBOX_H: 140,
} as const;

export const BALANCE = {
  MAX_HP: 40,
  PUNCH_DAMAGE: 12,
  CHIP_DAMAGE: 3,
  PUNCH_STARTUP: 4,
  PUNCH_ACTIVE: 3,
  PUNCH_RECOVERY: 8,
  PUNCH_GAP: 10,          // hitbox starts this far in front of the fighter centre
  PUNCH_REACH: 70,        // hitbox width
  PUNCH_HITBOX_TOP: 120,  // hitbox top, measured up from the feet
  PUNCH_HITBOX_H: 60,
  HITSTUN_TICKS: 12,
  KNOCKBACK_PX: 144,      // total displacement over the hitstun
  WALK_SPEED: 3,          // px per tick (180 px/s)
  JUMP_VELOCITY: -9.1,    // px per tick, negative is up; apex ~151 px (the drawn 150 px character height) at tick 34, airborne 68 ticks
  GRAVITY: 8 / 30,        // px per tick^2, shared with projectiles so throw arcs are unchanged
  JUMP_IFRAME_START: 3,   // inclusive, ticks since takeoff
  JUMP_IFRAME_END: 10,    // inclusive
  OOB_DAMAGE: 3,
  OOB_EVERY_TICKS: 30,
} as const;

export const MATCH = {
  ROUND_SECONDS: 30,
  ROUND_TICKS: 30 * 60,
  COUNTDOWN_TICKS: 180,
  ROUND_END_TICKS: 120,
  ROUNDS_TO_WIN: 2,
  MAX_ROUNDS: 3,
} as const;

export const MAX_PLAYERS = 4;

// ---- Items (spec §3.2) ----
export const ITEM_IDS = ["molotov", "sword", "shield", "banana", "flash"] as const;
export type ItemId = (typeof ITEM_IDS)[number];
export const ITEMS: Record<ItemId, { uses: number; label: string; cocoLabel: string }> = {
  molotov: { uses: 2, label: "Molotov", cocoLabel: "bottle" },
  sword: { uses: 6, label: "Umbrella sword", cocoLabel: "umbrella" },
  shield: { uses: 3, label: "Backpack shield", cocoLabel: "backpack" },
  banana: { uses: 1, label: "Banana peel", cocoLabel: "banana" },
  flash: { uses: 1, label: "Phone flash", cocoLabel: "cell phone" },
};
export const DEFAULT_LOADOUT: Loadout = ["molotov", "shield"];

export const ARSENAL = {
  SWORD_REACH: 130, SWORD_DAMAGE: 10, PARRY_WINDOW: 10, PARRY_STUN: 24,
  THROW_STARTUP: 6, THROW_RECOVERY: 12,
  MOLOTOV_VX: 2, MOLOTOV_VY: -3, BANANA_VX: 5, BANANA_VY: -4, // molotov: low ~41-tick lob landing 70–130 px out (9.02 rule 2)
  FIRE_W: 120, FIRE_TICKS: 240, FIRE_DAMAGE: 2, FIRE_EVERY: 20,
  PEEL_W: 40, PEEL_TICKS: 900, PEEL_OWNER_IMMUNE: 30, SLIP_STUN: 36,
  FLASH_AT: 4, DAZZLE_TICKS: 120,
  LASER_CHARGE: 180, LASER_ACTIVE: 16, LASER_RECOVERY: 20, LASER_COOLDOWN: 720, // charge 3 s; active long enough for the front to cross the world
  LASER_SPEED: 60,        // px per tick the beam front travels (960 px in 16 ticks)
  LASER_DAMAGE: 10, LASER_CHIP: 4,
  LASER_BAND_TOP: 105, LASER_BAND_BOTTOM: 35, // 70 px band (half the 140 px hurtbox) centred on the sprite's middle, feet − 70
} as const;

// ---- Maps (spec §4.4) ----
export const MAP_IDS = ["roof", "gaps", "platforms", "chaos"] as const;
export type MapId = (typeof MAP_IDS)[number];
const GAPS_GROUND = [{ x0: 0, x1: 300 }, { x0: 380, x1: 580 }, { x0: 660, x1: 960 }];
const RACK_PLATFORMS = [{ x0: 150, x1: 330, y: 330 }, { x0: 630, x1: 810, y: 330 }];
export const MAPS: Record<MapId, { label: string; ground: { x0: number; x1: number }[]; platforms: { x0: number; x1: number; y: number }[] }> = {
  roof: { label: "Roof", ground: [{ x0: 0, x1: 960 }], platforms: [] },
  gaps: { label: "Gaps", ground: GAPS_GROUND, platforms: [] },
  platforms: { label: "Platforms", ground: [{ x0: 0, x1: 960 }], platforms: RACK_PLATFORMS },
  chaos: { label: "Chaos", ground: GAPS_GROUND, platforms: RACK_PLATFORMS },
};
export const PIT = { Y: 520, DAMAGE: 8, TICKS: 40, RESPAWN_INSET: 40, INVULN: 30 } as const;

// ---- Modes (spec §4.5) ----
export const MODE_IDS = ["rounds", "timed", "deathmatch"] as const;
export type ModeId = (typeof MODE_IDS)[number];
export const MODES: Record<ModeId, { label: string; roundTicks: number | null; roundsToWin: number; maxRounds: number }> = {
  rounds: { label: "Rounds", roundTicks: MATCH.ROUND_TICKS, roundsToWin: MATCH.ROUNDS_TO_WIN, maxRounds: MATCH.MAX_ROUNDS },
  timed: { label: "Timed", roundTicks: 5400, roundsToWin: 1, maxRounds: 1 },
  deathmatch: { label: "Deathmatch", roundTicks: null, roundsToWin: 1, maxRounds: 1 },
};

// ---- Players and teams (spec §3.3, §3.6) ----
export const TEAMS_IDS = ["ffa", "2v2"] as const;
export type TeamsId = (typeof TEAMS_IDS)[number];
export const SPAWN_X: Record<2 | 3 | 4, readonly number[]> = {
  2: [280, 680],
  3: [200, 480, 760],
  4: [120, 250, 710, 840],
};
export const TEAM_OF: Record<TeamsId, (i: PlayerIndex, players: number) => number> = {
  ffa: (i) => i,
  "2v2": (i) => (i < 2 ? 0 : 1),
};

export const CHARACTERS = ["drifter", "conductor", "stoker", "claude"] as const;
export type CharacterId = (typeof CHARACTERS)[number];
export const CHARACTER_LABEL: Record<CharacterId, string> = {
  drifter: "THE DRIFTER",
  conductor: "THE CONDUCTOR",
  stoker: "THE STOKER",
  claude: "CLAUDE CODE",
};

export interface MatchConfig { players: 2 | 3 | 4; teams: TeamsId; mode: ModeId; map: MapId; items: boolean }
export const DEFAULT_CONFIG: MatchConfig = { players: 2, teams: "ffa", mode: "rounds", map: "roof", items: true };

/** Fills defaults; `2v2` is only meaningful with four players, anything else is coerced to `ffa`. */
export function normalizeConfig(c: Partial<MatchConfig>): MatchConfig {
  const players = c.players ?? DEFAULT_CONFIG.players;
  const teams = c.teams ?? DEFAULT_CONFIG.teams;
  return {
    players,
    teams: players === 4 ? teams : "ffa",
    mode: c.mode ?? DEFAULT_CONFIG.mode,
    map: c.map ?? DEFAULT_CONFIG.map,
    items: c.items ?? DEFAULT_CONFIG.items,
  };
}

export interface RosterEntry { character: CharacterId; loadout: Loadout }
