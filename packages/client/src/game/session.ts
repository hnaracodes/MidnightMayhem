import type { InputSource, PlayerIndex, SimEvent } from "@midnight/shared";
import { SnapshotBuffer } from "../net/snapshotBuffer";

export const session: {
  buffer: SnapshotBuffer;
  events: SimEvent[];
  localIndex: PlayerIndex;
  localSource: InputSource | null;
  debug: boolean;
  visionAvailable: boolean;
} = {
  buffer: new SnapshotBuffer(),
  events: [],
  localIndex: 0,
  localSource: null,
  debug: typeof location !== "undefined" && new URLSearchParams(location.search).get("debug") === "1",
  visionAvailable: false,
};
