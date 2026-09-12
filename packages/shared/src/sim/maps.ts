// STUB — filled by 10-arenas/01 (sim-maps): gaps, one-way platforms and pit falls.
import { WORLD, type MapId } from "../constants";
import type { MatchState, SimEvent } from "./types";

/** The highest surface at or below `y` under `x` (roof, platform, or the pit). Flat roof until 10.01. */
export function groundYAt(_map: MapId, _x: number, _y: number): number {
  return WORLD.ROOF_Y;
}

/** Pit falls and respawns. No-op until 10.01. */
export function applyPits(_s: MatchState, _events: SimEvent[]): void {}
