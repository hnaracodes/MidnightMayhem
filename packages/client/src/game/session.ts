import { EMPTY_FRAME, type InputFrame, type InputSource, type PlayerIndex, type SimEvent } from "@midnight/shared";
import { SnapshotBuffer } from "../net/snapshotBuffer";

export const DEFAULT_PLAYER_NAMES: readonly [string, string] = ["THE DRIFTER", "THE CONDUCTOR"];

export const session: {
  buffer: SnapshotBuffer;
  events: SimEvent[];
  localIndex: PlayerIndex;
  localSource: InputSource | null;
  /** Rising edges of the local source this render frame; written by the arena scene for the punch hint. */
  localEdge: InputFrame;
  /** Names shown under the health bars; set from the LOBBY message, defaults to the character names. */
  playerNames: [string, string];
  debug: boolean;
  visionAvailable: boolean;
} = {
  buffer: new SnapshotBuffer(),
  events: [],
  localIndex: 0,
  localSource: null,
  localEdge: { ...EMPTY_FRAME },
  playerNames: [DEFAULT_PLAYER_NAMES[0], DEFAULT_PLAYER_NAMES[1]],
  debug: typeof location !== "undefined" && new URLSearchParams(location.search).get("debug") === "1",
  visionAvailable: false,
};
