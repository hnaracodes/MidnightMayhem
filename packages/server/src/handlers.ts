import {
  PROTOCOL_VERSION,
  parseClientMessage,
  type ErrorCode,
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

function error(conn: Conn, code: ErrorCode, message: string): void {
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
    if (message.protocolVersion !== PROTOCOL_VERSION) {
      error(conn, "VERSION_MISMATCH", `client protocol ${message.protocolVersion}, server protocol ${PROTOCOL_VERSION}; reload the page`);
      conn.close(1008, "protocol version mismatch");
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
    conn.send({ type: "WELCOME", roomId: room.id, playerIndex: index, protocolVersion: PROTOCOL_VERSION });
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
  } else if (message.type === "CONFIG") {
    const result = conn.room.setConfig(conn.index, message.config);
    if (result === "not-host") error(conn, "NOT_HOST", "only the host can change the match config");
    else if (result === "in-match") error(conn, "BAD_CONFIG", "the config can only change in the lobby");
    else if (result === "too-many-players") error(conn, "BAD_CONFIG", "player count is below the players already seated");
    else conn.room.broadcast(conn.room.lobbyMessage());
  } else if (message.type === "CUSTOMIZE") {
    if (conn.room.setCustomize(conn.index, message.character, message.loadout)) {
      conn.room.broadcast(conn.room.lobbyMessage());
    }
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
  if (!room.allReady || room.inMatch) return;
  room.startMatch();
  if (!ctx.loops.has(room.id)) {
    const loop = new RoomLoop(room, ctx.now);
    ctx.loops.set(room.id, loop);
    loop.start();
  }
}
