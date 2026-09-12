/**
 * 11.05 — pure helpers behind the arena scene: draw order, the fire-loop edge, attract-mode inputs and the
 * pose adapter for the actions `rig/pose.ts` has no pose for (throw, laser). No Phaser, no DOM, no session.
 */
import {
  ARSENAL, BALANCE, EMPTY_FRAME, WORLD,
  type CharacterId, type FighterState, type InputFrame, type MatchConfig, type PlayerIndex, type RosterEntry,
} from "@midnight/shared";

/**
 * Attract loop: the last fighter walks right, rests, walks left, rests — 6 s at 60 Hz. The last slot spawns
 * nearest the right edge, and the sim ignores inputs through the 180-tick countdown, so its first move (loop
 * tick 180) is the walk left: it swings 270 px inward and back and never reaches the soft edge.
 */
export const ATTRACT = { LOOP_TICKS: 360, WALK_TICKS: 90 } as const;

/** The walking fighter's slot: the last one. */
export function attractWalker(players: number): PlayerIndex {
  return Math.max(0, players - 1) as PlayerIndex;
}

/**
 * Fighters back-to-front by their distance from the camera centre: the farthest first, the nearest last, so the
 * scene can give the nearest the highest depth. Ties keep slot order.
 */
export function drawOrder(fighters: readonly { x: number }[]): PlayerIndex[] {
  const centre = WORLD.WIDTH / 2;
  return fighters
    .map((f, i) => ({ i: i as PlayerIndex, d: Math.abs(f.x - centre) }))
    .sort((a, b) => b.d - a.d || a.i - b.i)
    .map((e) => e.i);
}

/** The fire-loop edge: start when the first fire hazard appears, stop when the last one goes, else nothing. */
export function fireLoopTransition(prevHas: boolean, nowHas: boolean): "start" | "stop" | null {
  if (!prevHas && nowHas) return "start";
  if (prevHas && !nowHas) return "stop";
  return null;
}

/**
 * Idle inputs for `players` attract fighters at sim tick `tick`: everyone stands still except the walker (the
 * last slot), who walks right for the first quarter of the loop, rests, walks left for the third quarter, rests.
 */
export function attractInputs(tick: number, players = 4): InputFrame[] {
  const t = ((tick % ATTRACT.LOOP_TICKS) + ATTRACT.LOOP_TICKS) % ATTRACT.LOOP_TICKS;
  const inputs: InputFrame[] = Array.from({ length: players }, () => ({ ...EMPTY_FRAME }));
  const walker = inputs[attractWalker(players)];
  if (!walker) return inputs;
  if (t < ATTRACT.WALK_TICKS) walker.right = true;
  else if (t >= 2 * ATTRACT.WALK_TICKS && t < 3 * ATTRACT.WALK_TICKS) walker.left = true;
  return inputs;
}

/** The local attract match: deathmatch (no timer, never ends), roof, items off, one fighter per character. */
export function attractSetup(characters: readonly CharacterId[]): { config: MatchConfig; roster: RosterEntry[] } {
  const players = Math.min(4, Math.max(2, characters.length)) as 2 | 3 | 4;
  return {
    config: { players, teams: "ffa", mode: "deathmatch", map: "roof", items: false },
    roster: characters.slice(0, players).map((character) => ({ character, loadout: ["molotov", "shield"] })),
  };
}

/**
 * What `computePose` sees for a fighter. Since 12.04 `rig/pose.ts` poses throws and lasers itself, so this is the
 * identity; it stays as the single seam where a drawn fighter could still differ from the sim one.
 */
export function posedFighter(f: FighterState): FighterState {
  return f;
}

/** Respawn i-frames after a pit fall are drawn at half alpha (10.01 rule: invuln 30 ticks, 50 % alpha). */
export const INVULN_ALPHA = 0.5;

export function fighterAlpha(f: Pick<FighterState, "invuln" | "pitTicks">): number {
  if (f.pitTicks > 0) return 0;
  return f.invuln > 0 ? INVULN_ALPHA : 1;
}
