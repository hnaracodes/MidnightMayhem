import { z } from "zod";
import type { MatchState, PlayerIndex, SimEvent } from "./sim/types";

export const PROTOCOL_VERSION = 1;
export const MAX_MESSAGE_BYTES = 4096;
export const ROOM_ID_RE = /^[A-Z0-9]{4,8}$/;

export const InputFrameSchema = z.object({
  left: z.boolean(), right: z.boolean(), jump: z.boolean(),
  punchL: z.boolean(), punchR: z.boolean(), block: z.boolean(),
}).strict();

export const ClientMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("HELLO"), name: z.string().trim().min(1).max(16), roomId: z.string().regex(ROOM_ID_RE).optional() }).strict(),
  z.object({ type: z.literal("INPUT"), seq: z.number().int().positive(), frame: InputFrameSchema }).strict(),
  z.object({ type: z.literal("READY"), ready: z.boolean() }).strict(),
  z.object({ type: z.literal("PING"), t: z.number() }).strict(),
]);
export type ClientMessage = z.infer<typeof ClientMessageSchema>;

export type ErrorCode = "BAD_MESSAGE" | "ROOM_FULL" | "NOT_IN_ROOM" | "ALREADY_JOINED";
export interface LobbyPlayer { name: string; ready: boolean; connected: boolean }

export type ServerMessage =
  | { type: "WELCOME"; roomId: string; playerIndex: PlayerIndex; protocolVersion: number }
  | { type: "LOBBY"; roomId: string; players: [LobbyPlayer | null, LobbyPlayer | null] }
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
