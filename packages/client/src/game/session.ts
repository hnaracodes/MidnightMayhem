import {
  CHARACTERS, CHARACTER_LABEL, DEFAULT_CONFIG, EMPTY_FRAME,
  type CharacterId, type InputFrame, type InputSource, type MatchConfig, type PlayerIndex, type RosterEntry, type SimEvent,
} from "@midnight/shared";
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
  /** The host's match configuration, from the last LOBBY message (11.03). */
  config: MatchConfig;
  /** Character and loadout per seated player, from the last LOBBY message (11.03). */
  roster: RosterEntry[];
  /**
   * Landing attract mode: the characters idling on the roof while no match runs; null once the landing hides.
   * INTEGRATOR: collapse after merge — 11.05 declares this field and reads it in the arena scene.
   */
  attract: readonly CharacterId[] | null;
  /** From `prefers-reduced-motion`; the stage stops scrolling. INTEGRATOR: collapse after merge — 11.05 declares it too. */
  reducedMotion: boolean;
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
  config: { ...DEFAULT_CONFIG },
  roster: [],
  attract: null,
  reducedMotion: false,
  debug: typeof location !== "undefined" && new URLSearchParams(location.search).get("debug") === "1",
  rtt: null,
  visionAvailable: false,
};
