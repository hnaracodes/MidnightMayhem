import { BALANCE, PIT, WORLD, type MapId } from "../constants";
import { risingEdges, type InputFrame } from "../input";
import { playerIndices } from "./create";
import { usePunchWithItem } from "./items";
import { laserPhase, startLaser } from "./laser";
import { groundYAt, platformAt, surfaceBelow } from "./maps";
import type { Arm, FighterState, MatchState, PlayerIndex, SimEvent } from "./types";

/**
 * Reads input; sets blocking, starts punches, laser and jumps, sets velocities. Does not move the fighter.
 * A KO'd fighter or one down a pit takes no input. Only a punch or a block pins a grounded fighter in place
 * (9.10): a laser or a throw is charged, fired and released on the move.
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

  const lockedOnGround = f.grounded && (actionLocksMovement(f) || f.blocking);
  f.vx = lockedOnGround ? 0 : (input.left ? -BALANCE.WALK_SPEED : 0) + (input.right ? BALANCE.WALK_SPEED : 0);

  if (edge.jump && f.grounded && !actionLocksMovement(f) && !f.blocking) {
    f.vy = BALANCE.JUMP_VELOCITY;
    f.grounded = false;
    f.jumpTicks = 0;
    events.push({ type: "JUMP", player: i });
  }
}

/**
 * Whether an action pins a grounded fighter: only a punch does. Every other action — a laser in any of its three
 * phases, a throw being charged or released, and anything added later — leaves walking and jumping alone, so a new
 * action is mobile by default (9.10). Blocking is a separate lock, handled by `controlFighter`.
 */
function actionLocksMovement(f: FighterState): boolean {
  return f.action?.kind === "punch";
}

/**
 * Whether the fighter's aim is committed, which freezes its facing. A punch commits for its whole animation, a
 * laser from its first beam tick, a throw from its release. A *charging* laser or throw still turns toward the
 * nearest opponent, so walking past someone mid-charge re-aims; the beam or the release then locks the direction.
 */
export function aimLocked(f: FighterState): boolean {
  const a = f.action;
  if (!a) return false;
  if (a.kind === "punch") return true;
  if (a.kind === "throw") return a.phase === "release";
  const phase = laserPhase(f);
  return phase === "beam" || phase === "recover";
}

/**
 * The held item gets first refusal of a punch edge (a throwable starts a charging throw that
 * `advanceThrowCharge` releases on the key's falling edge); otherwise a normal punch starts.
 */
function startPunch(s: MatchState, i: PlayerIndex, arm: Arm, events: SimEvent[]): void {
  if (usePunchWithItem(s, i, arm, events)) return;
  const f = s.fighters[i]!;
  f.action = { kind: "punch", arm, elapsed: 0, landed: false, sword: false };
  events.push({ type: "PUNCH", player: i, arm });
}

/**
 * Map-aware physics: walk off a gap or a platform edge and fall; land on the first surface the feet cross while
 * moving down (platforms are one-way, so they are passed through from below). Reads only the fighter, the map id
 * and constants. A fighter down a pit is frozen until `applyPits` respawns him; `y` is never clamped to the roof,
 * reaching `PIT.Y` is the pit's business.
 */
export function applyPhysics(f: FighterState, i: PlayerIndex, map: MapId, events: SimEvent[]): void {
  if (f.pitTicks > 0) return;
  f.x += f.vx;
  if (f.x < 0) f.x = 0;
  if (f.x > WORLD.WIDTH) f.x = WORLD.WIDTH;

  if (f.grounded) {
    const gy = groundYAt(map, f.x, f.y);
    if (gy > f.y + 0.5) {
      f.grounded = false; f.vy = 0; f.jumpTicks = 0; f.onPlatform = null;
    }
  }
  if (!f.grounded) {
    const prevY = f.y;
    f.vy += BALANCE.GRAVITY;
    f.y += f.vy;
    f.jumpTicks++;
    if (f.vy > 0) {
      const sy = surfaceBelow(map, f.x, prevY);
      if (f.y >= sy) {
        if (sy >= PIT.Y) {
          // Nothing under the feet: stop at the pit line and let applyPits take over. Not a landing.
          f.y = PIT.Y; f.vy = 0;
        } else {
          f.y = sy; f.vy = 0; f.grounded = true; f.jumpTicks = 0;
          f.onPlatform = platformAt(map, f.x, sy);
          events.push({ type: "LAND", player: i });
        }
      }
    }
  }
}

/**
 * A fighter whose aim is not committed faces its nearest living opponent. Ties keep facing; dead fighters keep
 * facing. A laser or throw being charged still tracks (9.10); see `aimLocked`.
 */
export function updateFacing(s: MatchState): void {
  for (const i of playerIndices(s)) {
    const f = s.fighters[i]!;
    if (aimLocked(f) || f.hp <= 0) continue;
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
