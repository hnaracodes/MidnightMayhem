import type { InputFrame, Loadout } from "../input";
import type { CharacterId, ItemId, MatchConfig } from "../constants";

export type PlayerIndex = 0 | 1 | 2 | 3;
export type Facing = 1 | -1;
export type Arm = "L" | "R";
export type TrainCar = "STANDARD" | "TUNNEL" | "FINAL_CAR";
export type Phase = "COUNTDOWN" | "FIGHTING" | "ROUND_END" | "MATCH_END";
/** A TEAM index (== player index in free-for-all), or "draw". */
export type Winner = number | "draw";

export interface HeldItem { kind: ItemId; uses: number }

export interface PunchAction { kind: "punch"; arm: Arm; elapsed: number; landed: boolean; sword: boolean }
/**
 * 9.08: a throw charges while the punch key stays held (`phase: "charge"`, `charge` 0..THROW.CHARGE_MAX, `elapsed`
 * held at 0), then releases (`phase: "release"`, `elapsed` counts up; the projectile spawns at THROW.RELEASE_TICKS).
 */
export interface ThrowAction {
  kind: "throw"; item: "molotov" | "banana"; arm: Arm;
  phase: "charge" | "release"; charge: number; elapsed: number; released: boolean;
}
export interface LaserAction { kind: "laser"; elapsed: number; hit: PlayerIndex[] }
export type Action = PunchAction | ThrowAction | LaserAction;

export interface FighterState {
  character: CharacterId;
  x: number; y: number; vx: number; vy: number;
  facing: Facing;
  grounded: boolean;
  jumpTicks: number;
  hp: number;
  action: Action | null;
  hitstun: number;
  knockbackVx: number;
  blocking: boolean;
  prev: InputFrame;
  oobTicks: number;
  team: number;
  loadout: Loadout;
  item: HeldItem | null;
  /** Items equipped this round; reset each round. */
  itemsUsed: ItemId[];
  /** Ticks until the laser may fire again. */
  laserCooldown: number;
  /** Ticks block has been held (parry window). */
  blockTicks: number;
  /** Ticks of flashbang whiteout left. */
  dazzle: number;
  /** Ticks left in a pit fall. */
  pitTicks: number;
  /** Index into MAPS[map].platforms when standing on one. */
  onPlatform: number | null;
  /** Respawn i-frames after a pit. */
  invuln: number;
}

export interface Projectile { id: number; kind: "molotov" | "banana"; owner: PlayerIndex; x: number; y: number; vx: number; vy: number }
export interface Hazard { id: number; kind: "fire" | "peel"; owner: PlayerIndex; x: number; y: number; w: number; ticks: number; age: number }

export interface MatchState {
  tick: number;
  phase: Phase;
  phaseTicks: number;
  round: number;
  /** Indexed by team. */
  roundsWon: number[];
  roundTicks: number;
  trainCar: TrainCar;
  fighters: FighterState[];
  winner: Winner | null;
  config: MatchConfig;
  projectiles: Projectile[];
  hazards: Hazard[];
  nextId: number;
}

export type SimEvent =
  | { type: "ROUND_START"; round: number }
  | { type: "ROUND_END"; round: number; winner: Winner }
  | { type: "MATCH_END"; winner: Winner }
  | { type: "JUMP"; player: PlayerIndex }
  | { type: "PUNCH"; player: PlayerIndex; arm: Arm }
  | { type: "HIT"; attacker: PlayerIndex; target: PlayerIndex; damage: number; blocked: boolean }
  | { type: "OOB_DAMAGE"; player: PlayerIndex; damage: number }
  | { type: "ITEM_EQUIP"; player: PlayerIndex; item: ItemId }
  | { type: "ITEM_USE"; player: PlayerIndex; item: ItemId }
  | { type: "ITEM_BREAK"; player: PlayerIndex; item: ItemId }
  | { type: "SHIELD_ABSORB"; player: PlayerIndex; left: number }
  | { type: "PARRY"; player: PlayerIndex; attacker: PlayerIndex }
  | { type: "LASER_CHARGE"; player: PlayerIndex }
  | { type: "LASER_FIRE"; player: PlayerIndex }
  | { type: "LASER_HIT"; attacker: PlayerIndex; target: PlayerIndex; damage: number; blocked: boolean }
  | { type: "PROJECTILE_SPAWN"; id: number; kind: Projectile["kind"]; owner: PlayerIndex }
  | { type: "HAZARD_SPAWN"; id: number; kind: Hazard["kind"]; x: number }
  | { type: "HAZARD_HIT"; id: number; kind: Hazard["kind"]; target: PlayerIndex; damage: number }
  | { type: "FLASH"; player: PlayerIndex }
  | { type: "PIT_FALL"; player: PlayerIndex }
  | { type: "PIT_RESPAWN"; player: PlayerIndex }
  | { type: "LAND"; player: PlayerIndex };

export interface StepResult { state: MatchState; events: SimEvent[] }
export interface Rect { x: number; y: number; w: number; h: number }
