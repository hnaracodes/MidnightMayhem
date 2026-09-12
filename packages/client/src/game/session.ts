import { CHARACTERS, CHARACTER_LABEL, EMPTY_FRAME, type InputFrame, type InputSource, type PlayerIndex, type SimEvent } from "@midnight/shared";
import { SnapshotBuffer } from "../net/snapshotBuffer";

export const DEFAULT_PLAYER_NAMES: readonly string[] = CHARACTERS.map((c) => CHARACTER_LABEL[c]);

export const session: {
  buffer: SnapshotBuffer;
  events: SimEvent[];
  localIndex: PlayerIndex;
  localSource: InputSource | null;
  /** Rising edges of the local source this render frame; written by the arena scene for the punch hint. */
  localEdge: InputFrame;
  /** Names shown under the health bars, one per slot; set from the LOBBY message, defaults to the character names. */
  playerNames: string[];
  debug: boolean;
  /** Smoothed round-trip time in ms from the debug PING loop; null until the first PONG (or when not debugging). */
  rtt: number | null;
  visionAvailable: boolean;
} = {
  buffer: new SnapshotBuffer(),
  events: [],
  localIndex: 0,
  localSource: null,
  localEdge: { ...EMPTY_FRAME },
  playerNames: [...DEFAULT_PLAYER_NAMES],
  debug: typeof location !== "undefined" && new URLSearchParams(location.search).get("debug") === "1",
  rtt: null,
  visionAvailable: false,
};
