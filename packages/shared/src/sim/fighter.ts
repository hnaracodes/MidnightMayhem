import { BALANCE, WORLD, type MapId } from "../constants";
import { risingEdges, type InputFrame } from "../input";
import { playerIndices } from "./create";
import { usePunchWithItem } from "./items";
import { startLaser } from "./laser";
import type { Arm, FighterState, MatchState, PlayerIndex, SimEvent } from "./types";

/**
 * Reads input; sets blocking, starts punches, laser and jumps, sets velocities. Does not move the fighter.
 * A KO'd fighter or one down a pit takes no input.
 */
export function controlFighter(s: MatchState, i: PlayerIndex, input: InputFrame, events: SimEvent[]): void {
  const f = s.fighters[i];
  if (!f) return;
  if (f.hp <= 0 || f.pitTicks > 0) {
    f.vx = 0;
    f.blocking = false;
    return;
  }
  const edge = risingEdges(f.prev, input);

  if (f.hitstun > 0) {
    f.hitstun--;
    f.vx = f.hitstun > 0 ? f.knockbackVx : 0;
    if (f.hitstun === 0) f.knockbackVx = 0;
    f.blocking = false;
    f.blockTicks = 0;
    return;
  }

  f.blocking = input.block && f.grounded && f.action === null;
  if (edge.block) f.blockTicks = 0;
  f.blockTicks = f.blocking ? f.blockTicks + 1 : 0;

  if (f.action === null && !f.blocking) {
    if (edge.punchL) startPunch(s, i, "L", events);
    else if (edge.punchR) startPunch(s, i, "R", events);
    else if (edge.special) startLaser(s, i, events);
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

/** The held item gets first refusal of a punch edge; otherwise a normal punch starts. */
function startPunch(s: MatchState, i: PlayerIndex, arm: Arm, events: SimEvent[]): void {
  if (usePunchWithItem(s, i, arm, events)) return;
  const f = s.fighters[i]!;
  f.action = { kind: "punch", arm, elapsed: 0, landed: false, sword: false };
  events.push({ type: "PUNCH", player: i, arm });
}

/** Flat-roof physics plus a LAND event on the touchdown tick. The map-aware body (gaps, platforms) is 10.01. */
export function applyPhysics(f: FighterState, i: PlayerIndex, _map: MapId, events: SimEvent[]): void {
  f.x += f.vx;
  if (!f.grounded) {
    f.vy += BALANCE.GRAVITY;
    f.y += f.vy;
    f.jumpTicks++;
    if (f.y >= WORLD.ROOF_Y) {
      f.y = WORLD.ROOF_Y; f.vy = 0; f.grounded = true; f.jumpTicks = 0;
      events.push({ type: "LAND", player: i });
    }
  }
  if (f.x < 0) f.x = 0;
  if (f.x > WORLD.WIDTH) f.x = WORLD.WIDTH;
}

/** A fighter not currently acting faces its nearest living opponent. Ties keep facing; dead fighters keep facing. */
export function updateFacing(s: MatchState): void {
  for (const i of playerIndices(s)) {
    const f = s.fighters[i]!;
    if (f.action !== null || f.hp <= 0) continue;
    let best: FighterState | null = null;
    let bestDist = Infinity;
    for (const j of playerIndices(s)) {
      const o = s.fighters[j]!;
      if (j === i || o.team === f.team || o.hp <= 0) continue;
      const d = Math.abs(o.x - f.x);
      if (d < bestDist) { bestDist = d; best = o; }
    }
    if (best && best.x !== f.x) f.facing = best.x > f.x ? 1 : -1;
  }
}
