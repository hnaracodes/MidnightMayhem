import { z } from "zod";
import { CHARACTERS, ITEM_IDS, MAP_IDS, MODE_IDS, TEAMS_IDS, type CharacterId, type MatchConfig } from "./constants";
import type { Loadout } from "./input";
import type { MatchState, PlayerIndex, SimEvent } from "./sim/types";

export const PROTOCOL_VERSION = 2;
export const MAX_MESSAGE_BYTES = 4096;
export const ROOM_ID_RE = /^[A-Z0-9]{4,8}$/;

export const InputFrameSchema = z.object({
  left: z.boolean(), right: z.boolean(), jump: z.boolean(),
  punchL: z.boolean(), punchR: z.boolean(), block: z.boolean(),
  special: z.boolean(), item: z.enum(ITEM_IDS).nullable(),
  chop: z.boolean(), sweep: z.boolean(),
}).strict();

export const MatchConfigSchema = z.object({
  players: z.union([z.literal(2), z.literal(3), z.literal(4)]),
  teams: z.enum(TEAMS_IDS),
  mode: z.enum(MODE_IDS),
  map: z.enum(MAP_IDS),
  items: z.boolean(),
}).strict();

/** Two distinct item ids. */
export const LoadoutSchema = z.tuple([z.enum(ITEM_IDS), z.enum(ITEM_IDS)])
  .refine((l) => l[0] !== l[1], { message: "loadout items must differ" });

export const ClientMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("HELLO"), name: z.string().trim().min(1).max(16), roomId: z.string().regex(ROOM_ID_RE).optional(),
    protocolVersion: z.number().int(),
  }).strict(),
  z.object({ type: z.literal("INPUT"), seq: z.number().int().positive(), frame: InputFrameSchema }).strict(),
  z.object({ type: z.literal("READY"), ready: z.boolean() }).strict(),
  z.object({ type: z.literal("PING"), t: z.number() }).strict(),
  z.object({ type: z.literal("CONFIG"), config: MatchConfigSchema }).strict(),
  z.object({ type: z.literal("CUSTOMIZE"), character: z.enum(CHARACTERS), loadout: LoadoutSchema }).strict(),
]);
export type ClientMessage = z.infer<typeof ClientMessageSchema>;

export type ErrorCode = "BAD_MESSAGE" | "ROOM_FULL" | "NOT_IN_ROOM" | "ALREADY_JOINED" | "NOT_HOST" | "BAD_CONFIG" | "VERSION_MISMATCH";
export interface LobbyPlayer { name: string; ready: boolean; connected: boolean; character: CharacterId; loadout: Loadout }

export type ServerMessage =
  | { type: "WELCOME"; roomId: string; playerIndex: PlayerIndex; protocolVersion: number }
  | { type: "LOBBY"; roomId: string; players: (LobbyPlayer | null)[]; config: MatchConfig; host: PlayerIndex }
  | { type: "SNAPSHOT"; state: MatchState; events: SimEvent[]; ackSeq: number }
  | { type: "PONG"; t: number; serverTime: number }
  | { type: "OPPONENT_LEFT" }
  | { type: "ERROR"; code: ErrorCode; message: string };

export type ParseResult = { ok: true; message: ClientMessage } | { ok: false; reason: string };

const encoder = new TextEncoder();

export function parseClientMessage(raw: unknown): ParseResult {
  if (typeof raw !== "string") return { ok: false, reason: "not a text frame" };
  if (encoder.encode(raw).length > MAX_MESSAGE_BYTES) return { ok: false, reason: "frame too large" };
  let json: unknown;
  try { json = JSON.parse(raw); } catch { return { ok: false, reason: "not json" }; }
  if (json === null || typeof json !== "object" || Array.isArray(json)) return { ok: false, reason: "not an object" };
  const r = ClientMessageSchema.safeParse(json);
  if (!r.success) return { ok: false, reason: r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  return { ok: true, message: r.data };
}
