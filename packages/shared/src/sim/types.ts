import type { InputFrame } from "../input";
import type { CharacterId } from "../constants";

export type PlayerIndex = 0 | 1;
export type Facing = 1 | -1;
export type Arm = "L" | "R";
export type TrainCar = "STANDARD" | "TUNNEL" | "FINAL_CAR";
export type Phase = "COUNTDOWN" | "FIGHTING" | "ROUND_END" | "MATCH_END";
export type Winner = PlayerIndex | "draw";
/** RESERVED for future projectiles. Unused by the MVP. */
export type ProjectileHeight = "LOW" | "MID" | "HIGH";

export interface PunchAction { kind: "punch"; arm: Arm; elapsed: number; landed: boolean }

export interface FighterState {
  character: CharacterId;
  x: number; y: number; vx: number; vy: number;
  facing: Facing;
  grounded: boolean;
  jumpTicks: number;
  hp: number;
  action: PunchAction | null;
  hitstun: number;
  knockbackVx: number;
  blocking: boolean;
  prev: InputFrame;
  oobTicks: number;
  /** RESERVED for future weapons. Always [null, null, null] in the MVP. */
  weaponSlots: [null, null, null];
}

export interface MatchState {
  tick: number;
  phase: Phase;
  phaseTicks: number;
  round: number;
  roundsWon: [number, number];
  roundTicks: number;
  trainCar: TrainCar;
  fighters: [FighterState, FighterState];
  winner: Winner | null;
}

export type SimEvent =
  | { type: "ROUND_START"; round: number }
  | { type: "ROUND_END"; round: number; winner: Winner }
  | { type: "MATCH_END"; winner: Winner }
  | { type: "JUMP"; player: PlayerIndex }
  | { type: "PUNCH"; player: PlayerIndex; arm: Arm }
  | { type: "HIT"; attacker: PlayerIndex; target: PlayerIndex; damage: number; blocked: boolean }
  | { type: "OOB_DAMAGE"; player: PlayerIndex; damage: number };

export interface StepResult { state: MatchState; events: SimEvent[] }
export interface Rect { x: number; y: number; w: number; h: number }
