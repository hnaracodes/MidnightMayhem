import {
  CHARACTERS, CHARACTER_LABEL, DEFAULT_CONFIG, EMPTY_FRAME,
  type CharacterId, type InputFrame, type InputSource, type MatchConfig, type PlayerIndex, type RosterEntry, type SimEvent,
} from "@midnight/shared";
import { SnapshotBuffer } from "../net/snapshotBuffer";
import type { DetectorId } from "../vision/backends/ObjectBackend";
import { selectDetector } from "../vision/selectDetector";
import type { Sfx } from "./sfx";

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
  /** Landing attract mode: the characters idling on the roof while no match runs; null once the landing hides. Set by 11.03, read by the arena (11.05). */
  attract: readonly CharacterId[] | null;
  /** From `prefers-reduced-motion`; the stage stops scrolling. Set by 11.03, read by the arena (11.05). */
  reducedMotion: boolean;
  /** `M` toggles it; persisted by `Sfx` under MUTE_KEY. Set by main.ts, read by the arena (11.05). */
  muted: boolean;
  /** The synthesised sound bank; null until the first user gesture on the page creates the AudioContext (11.05). */
  sfx: Sfx | null;
  /** `?rig=vector`: draw the old vector rig instead of the pixel sprites (11.05). */
  useVectorRig: boolean;
  debug: boolean;
  /** Smoothed round-trip time in ms from the debug PING loop; null until the first PONG (or when not debugging). */
  rtt: number | null;
  visionAvailable: boolean;
  /** `?detector=yolo|mediapipe`: the object-detection backend the camera worker loads (9.07). */
  detector: DetectorId;
  /** The backend the worker actually loaded once the camera is on (9.07); null before then or when objects are off. */
  detectorActive: DetectorId | null;
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
  muted: false,
  sfx: null,
  useVectorRig: typeof location !== "undefined" && new URLSearchParams(location.search).get("rig") === "vector",
  debug: typeof location !== "undefined" && new URLSearchParams(location.search).get("debug") === "1",
  rtt: null,
  visionAvailable: false,
  detector: typeof location !== "undefined" ? selectDetector(location.search) : "mediapipe",
  detectorActive: null,
};
