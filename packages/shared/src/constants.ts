/** Every gameplay number lives here and nowhere else. See implementation-docs/01-simulation/01. */
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
  JUMP_VELOCITY: -8,      // px per tick, negative is up
  GRAVITY: 8 / 30,        // px per tick^2, apex 120 px at tick 30
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

export const CHARACTERS = ["drifter", "conductor"] as const;
export type CharacterId = (typeof CHARACTERS)[number];
