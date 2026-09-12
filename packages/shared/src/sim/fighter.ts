import { BALANCE, WORLD } from "../constants";
import { risingEdges, type InputFrame } from "../input";
import type { FighterState, PlayerIndex, SimEvent } from "./types";

/** Reads input; sets blocking, starts punches and jumps, sets velocities. Does not move the fighter. */
export function controlFighter(f: FighterState, i: PlayerIndex, input: InputFrame, events: SimEvent[]): void {
  const edge = risingEdges(f.prev, input);

  if (f.hitstun > 0) {
    f.hitstun--;
    f.vx = f.hitstun > 0 ? f.knockbackVx : 0;
    if (f.hitstun === 0) f.knockbackVx = 0;
    f.blocking = false;
    return;
  }

  f.blocking = input.block && f.grounded && f.action === null;

  if (f.action === null && !f.blocking) {
    if (edge.punchL) { f.action = { kind: "punch", arm: "L", elapsed: 0, landed: false }; events.push({ type: "PUNCH", player: i, arm: "L" }); }
    else if (edge.punchR) { f.action = { kind: "punch", arm: "R", elapsed: 0, landed: false }; events.push({ type: "PUNCH", player: i, arm: "R" }); }
  }

  const lockedOnGround = f.grounded && (f.action !== null || f.blocking);
  f.vx = lockedOnGround ? 0 : (input.left ? -BALANCE.WALK_SPEED : 0) + (input.right ? BALANCE.WALK_SPEED : 0);

  if (edge.jump && f.grounded && f.action === null && !f.blocking) {
    f.vy = BALANCE.JUMP_VELOCITY;
    f.grounded = false;
    f.jumpTicks = 0;
    events.push({ type: "JUMP", player: i });
  }
}

export function applyPhysics(f: FighterState): void {
  f.x += f.vx;
  if (!f.grounded) {
    f.vy += BALANCE.GRAVITY;
    f.y += f.vy;
    f.jumpTicks++;
    if (f.y >= WORLD.ROOF_Y) { f.y = WORLD.ROOF_Y; f.vy = 0; f.grounded = true; f.jumpTicks = 0; }
  }
  if (f.x < 0) f.x = 0;
  if (f.x > WORLD.WIDTH) f.x = WORLD.WIDTH;
}

/** A fighter not currently punching faces the opponent. Ties keep current facing. */
export function updateFacing(a: FighterState, b: FighterState): void {
  if (a.action === null && b.x !== a.x) a.facing = b.x > a.x ? 1 : -1;
  if (b.action === null && a.x !== b.x) b.facing = a.x > b.x ? 1 : -1;
}
