import {
  parseClientMessage,
  type PlayerIndex,
  type ServerMessage,
} from "@midnight/shared";
import { Room, RoomRegistry } from "./rooms";
import { RoomLoop } from "./loop";

export interface Conn {
  room: Room | null;
  index: PlayerIndex | null;
  badFrames: number;
  send(m: ServerMessage): void;
  close(code: number, reason: string): void;
}

export interface ServerContext {
  registry: RoomRegistry;
  loops: Map<string, RoomLoop>;
  now(): number;
}

function error(conn: Conn, code: "BAD_MESSAGE" | "ROOM_FULL" | "NOT_IN_ROOM" | "ALREADY_JOINED", message: string): void {
  conn.send({ type: "ERROR", code, message });
}

export function handleMessage(ctx: ServerContext, conn: Conn, raw: string): void {
  const parsed = parseClientMessage(raw);
  if (!parsed.ok) {
    conn.badFrames++;
    error(conn, "BAD_MESSAGE", parsed.reason);
    if (conn.badFrames >= 3) conn.close(1008, "too many malformed frames");
    return;
  }

  const message = parsed.message;
  if (message.type === "PING") {
    conn.send({ type: "PONG", t: message.t, serverTime: ctx.now() });
    return;
  }

  if (message.type === "HELLO") {
    if (conn.room !== null) {
      error(conn, "ALREADY_JOINED", "connection is already in a room");
      return;
    }
    const room = ctx.registry.getOrCreate(message.roomId);
    const index = room.join(message.name, (m) => conn.send(m));
    if (index === null) {
      error(conn, "ROOM_FULL", "room is full");
      return;
    }
    conn.room = room;
    conn.index = index;
    conn.send({ type: "WELCOME", roomId: room.id, playerIndex: index, protocolVersion: 1 });
    room.broadcast(room.lobbyMessage());
    return;
  }

  if (conn.room === null || conn.index === null) {
    error(conn, "NOT_IN_ROOM", "send HELLO first");
    return;
  }

  if (message.type === "READY") {
    conn.room.setReady(conn.index, message.ready);
    conn.room.broadcast(conn.room.lobbyMessage());
    maybeStart(ctx, conn.room);
  } else if (message.type === "INPUT") {
    conn.room.setInput(conn.index, message.seq, message.frame);
  }
}

export function handleClose(ctx: ServerContext, conn: Conn): void {
  if (conn.room === null || conn.index === null) return;
  const room = conn.room;
  room.leave(conn.index);
  conn.room = null;
  conn.index = null;
  room.broadcast({ type: "OPPONENT_LEFT" });
  room.broadcast(room.lobbyMessage());
  if (room.empty) {
    ctx.loops.get(room.id)?.stop();
    ctx.loops.delete(room.id);
    ctx.registry.remove(room.id);
  }
}

export function maybeStart(ctx: ServerContext, room: Room): void {
  if (!room.allReady || (room.match !== null && room.match.phase !== "MATCH_END")) return;
  room.startMatch();
  if (!ctx.loops.has(room.id)) {
    const loop = new RoomLoop(room, ctx.now);
    ctx.loops.set(room.id, loop);
    loop.start();
  }
}
