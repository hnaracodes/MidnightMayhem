import { describe, expect, it, vi } from "vitest";
import { RoomLoop } from "../src/loop";
import { RoomRegistry } from "../src/rooms";
import { handleClose, handleMessage, type Conn, type ServerContext } from "../src/handlers";

function setup() {
  const sent: unknown[] = [];
  const conn: Conn = { room: null, index: null, badFrames: 0, send: (m) => sent.push(m), close: vi.fn() };
  const ctx: ServerContext = { registry: new RoomRegistry(), loops: new Map(), now: () => 1234 };
  return { ctx, conn, sent };
}

describe("message handlers", () => {
  it("HELLO creates a room, welcomes player 0, and broadcasts lobby", () => {
    const { ctx, conn, sent } = setup();
    handleMessage(ctx, conn, JSON.stringify({ type: "HELLO", name: "Alice", roomId: "ABCDE", protocolVersion: 2 }));
    expect(conn.index).toBe(0);
    expect(sent).toEqual(expect.arrayContaining([
      { type: "WELCOME", roomId: "ABCDE", playerIndex: 0, protocolVersion: 2 },
      expect.objectContaining({ type: "LOBBY", roomId: "ABCDE" }),
    ]));
  });

  it("HELLO with the wrong protocol version gets VERSION_MISMATCH, is closed, and never seats", () => {
    const { ctx, conn, sent } = setup();
    handleMessage(ctx, conn, JSON.stringify({ type: "HELLO", name: "Old", roomId: "ABCDE", protocolVersion: 1 }));
    expect(sent).toEqual([expect.objectContaining({ type: "ERROR", code: "VERSION_MISMATCH" })]);
    expect(conn.close).toHaveBeenCalledWith(1008, expect.any(String));
    expect(conn.room).toBeNull();
    expect(ctx.registry.get("ABCDE")).toBeUndefined();
  });

  it("seats a second HELLO and rejects a third with ROOM_FULL", () => {
    const { ctx, conn } = setup();
    const second = { ...setup().conn, send: vi.fn() } as Conn;
    const third = { ...setup().conn, send: vi.fn() } as Conn;
    handleMessage(ctx, conn, JSON.stringify({ type: "HELLO", name: "A", roomId: "ABCDE", protocolVersion: 2 }));
    handleMessage(ctx, second, JSON.stringify({ type: "HELLO", name: "B", roomId: "ABCDE", protocolVersion: 2 }));
    handleMessage(ctx, third, JSON.stringify({ type: "HELLO", name: "C", roomId: "ABCDE", protocolVersion: 2 }));
    expect(second.index).toBe(1);
    expect(third.send).toHaveBeenCalledWith(expect.objectContaining({ type: "ERROR", code: "ROOM_FULL" }));
  });

  it("starts a loop when both players are ready", () => {
    const { ctx, conn } = setup();
    const second = { ...setup().conn, send: vi.fn() } as Conn;
    handleMessage(ctx, conn, JSON.stringify({ type: "HELLO", name: "A", roomId: "ABCDE", protocolVersion: 2 }));
    handleMessage(ctx, second, JSON.stringify({ type: "HELLO", name: "B", roomId: "ABCDE", protocolVersion: 2 }));
    handleMessage(ctx, conn, JSON.stringify({ type: "READY", ready: true }));
    handleMessage(ctx, second, JSON.stringify({ type: "READY", ready: true }));
    const loop = ctx.loops.get("ABCDE");
    expect(loop).toBeInstanceOf(RoomLoop);
    loop?.stop();
  });

  it("requires HELLO before READY or INPUT and stores input after joining", () => {
    const { ctx, conn, sent } = setup();
    handleMessage(ctx, conn, JSON.stringify({ type: "INPUT", seq: 1, frame: { left: true, right: false, jump: false, punchL: false, punchR: false, block: false, special: false, item: null, chop: false, sweep: false } }));
    expect(sent.at(-1)).toEqual(expect.objectContaining({ type: "ERROR", code: "NOT_IN_ROOM" }));
    handleMessage(ctx, conn, JSON.stringify({ type: "HELLO", name: "A", roomId: "ABCDE", protocolVersion: 2 }));
    handleMessage(ctx, conn, JSON.stringify({ type: "INPUT", seq: 1, frame: { left: true, right: false, jump: false, punchL: false, punchR: false, block: false, special: false, item: null, chop: false, sweep: false } }));
    expect(conn.room?.inputs()[0]!.left).toBe(true);
  });

  it("closes after three malformed frames", () => {
    const { ctx, conn } = setup();
    handleMessage(ctx, conn, "not json");
    handleMessage(ctx, conn, "[]");
    handleMessage(ctx, conn, JSON.stringify({ type: "NOPE" }));
    expect(conn.badFrames).toBe(3);
    expect(conn.close).toHaveBeenCalledWith(1008, expect.any(String));
  });

  it("answers PING at any time", () => {
    const { ctx, conn, sent } = setup();
    handleMessage(ctx, conn, JSON.stringify({ type: "PING", t: 7 }));
    expect(sent).toContainEqual({ type: "PONG", t: 7, serverTime: 1234 });
  });

  it("notifies the opponent and removes an empty room on close", () => {
    const { ctx, conn } = setup();
    const second = { ...setup().conn, send: vi.fn() } as Conn;
    handleMessage(ctx, conn, JSON.stringify({ type: "HELLO", name: "A", roomId: "ABCDE", protocolVersion: 2 }));
    handleMessage(ctx, second, JSON.stringify({ type: "HELLO", name: "B", roomId: "ABCDE", protocolVersion: 2 }));
    handleClose(ctx, conn);
    expect(second.send).toHaveBeenCalledWith({ type: "OPPONENT_LEFT" });
    expect(second.room).toBeDefined();
    handleClose(ctx, second);
    expect(ctx.registry.get("ABCDE")).toBeUndefined();
  });
});

describe("message handlers (10.03: config, customise, four players)", () => {
  function conns(n: number) {
    const ctx: ServerContext = { registry: new RoomRegistry(), loops: new Map(), now: () => 1234 };
    const list = Array.from({ length: n }, () => {
      const sent: any[] = [];
      const conn: Conn = { room: null, index: null, badFrames: 0, send: (m) => sent.push(m), close: vi.fn() };
      return { conn, sent, last: (type: string) => sent.filter((m) => m.type === type).at(-1) };
    });
    const send = (i: number, m: unknown) => handleMessage(ctx, list[i]!.conn, JSON.stringify(m));
    const hello = (i: number) => send(i, { type: "HELLO", name: `P${i}`, roomId: "ABCDE", protocolVersion: 2 });
    return { ctx, list, send, hello };
  }
  const fourPlayers = { players: 4, teams: "2v2", mode: "rounds", map: "roof", items: true };

  it("rule 1: two HELLOs produce a four-slot LOBBY with host 0", () => {
    const { list, hello } = conns(2);
    hello(0); hello(1);
    const lobby = list[1]!.last("LOBBY");
    expect(lobby.players).toHaveLength(4);
    expect(lobby.players[2]).toBeNull();
    expect(lobby.players[3]).toBeNull();
    expect(lobby.host).toBe(0);
    expect(lobby.config.players).toBe(2);
  });

  it("rule 2: four players join after CONFIG and the loop starts with a four-fighter match", () => {
    const { ctx, list, send, hello } = conns(4);
    hello(0);
    send(0, { type: "CONFIG", config: fourPlayers });
    expect(list[0]!.last("LOBBY").config).toEqual(fourPlayers);
    hello(1); hello(2);
    for (const i of [0, 1, 2]) send(i, { type: "READY", ready: true });
    expect(ctx.loops.has("ABCDE")).toBe(false);
    hello(3);
    expect(list[3]!.last("WELCOME").playerIndex).toBe(3);
    send(3, { type: "READY", ready: true });
    const loop = ctx.loops.get("ABCDE");
    expect(loop).toBeInstanceOf(RoomLoop);
    const room = ctx.registry.get("ABCDE")!;
    expect(room.match?.config.players).toBe(4);
    expect(room.match?.fighters).toHaveLength(4);
    loop?.stop();
  });

  it("rule 3: non-host CONFIG → ERROR NOT_HOST, config unchanged", () => {
    const { ctx, list, send, hello } = conns(2);
    hello(0); hello(1);
    send(1, { type: "CONFIG", config: fourPlayers });
    expect(list[1]!.last("ERROR")).toEqual(expect.objectContaining({ code: "NOT_HOST" }));
    expect(ctx.registry.get("ABCDE")!.config.players).toBe(2);
  });

  it("rule 4: CONFIG players 2 with three seated → BAD_CONFIG, unchanged", () => {
    const { ctx, list, send, hello } = conns(3);
    hello(0);
    send(0, { type: "CONFIG", config: fourPlayers });
    hello(1); hello(2);
    send(0, { type: "CONFIG", config: { ...fourPlayers, players: 2, teams: "ffa" } });
    expect(list[0]!.last("ERROR")).toEqual(expect.objectContaining({ code: "BAD_CONFIG", message: expect.any(String) }));
    expect(ctx.registry.get("ABCDE")!.config.players).toBe(4);
  });

  it("rule 5: CONFIG during FIGHTING → BAD_CONFIG; after MATCH_END → ok", () => {
    const { ctx, list, send, hello } = conns(2);
    hello(0); hello(1);
    send(0, { type: "READY", ready: true }); send(1, { type: "READY", ready: true });
    const room = ctx.registry.get("ABCDE")!;
    room.match!.phase = "FIGHTING";
    send(0, { type: "CONFIG", config: { ...fourPlayers, players: 2, teams: "ffa", map: "gaps" } });
    expect(list[0]!.last("ERROR")).toEqual(expect.objectContaining({ code: "BAD_CONFIG" }));
    expect(room.config.map).toBe("roof");
    room.match!.phase = "MATCH_END";
    send(0, { type: "CONFIG", config: { ...fourPlayers, players: 2, teams: "ffa", map: "gaps" } });
    expect(room.config.map).toBe("gaps");
    expect(list[1]!.last("LOBBY").config.map).toBe("gaps");
    ctx.loops.get("ABCDE")?.stop();
  });

  it("rule 6: CUSTOMIZE un-readies the sender and shows in the next LOBBY", () => {
    const { ctx, list, send, hello } = conns(2);
    hello(0); hello(1);
    send(1, { type: "READY", ready: true });
    send(1, { type: "CUSTOMIZE", character: "stoker", loadout: ["sword", "flash"] });
    const lobby = list[0]!.last("LOBBY");
    expect(lobby.players[1]).toEqual(expect.objectContaining({ ready: false, character: "stoker", loadout: ["sword", "flash"] }));
    send(0, { type: "READY", ready: true }); send(1, { type: "READY", ready: true });
    const room = ctx.registry.get("ABCDE")!;
    expect(room.match?.fighters[1]?.character).toBe("stoker");
    expect(room.match?.fighters[1]?.loadout).toEqual(["sword", "flash"]);
    ctx.loops.get("ABCDE")?.stop();
  });

  it("rule 7: host leaves → next LOBBY names the lowest remaining slot as host", () => {
    const { ctx, list, send, hello } = conns(3);
    hello(0);
    send(0, { type: "CONFIG", config: fourPlayers });
    hello(1); hello(2);
    handleClose(ctx, list[0]!.conn);
    expect(list[1]!.last("LOBBY").host).toBe(1);
    expect(list[2]!.last("LOBBY").host).toBe(1);
  });

  it("rule 8: a disconnect during a three-player match sends OPPONENT_LEFT to the other two", () => {
    const { ctx, list, send, hello } = conns(3);
    hello(0);
    send(0, { type: "CONFIG", config: { ...fourPlayers, players: 3, teams: "ffa" } });
    hello(1); hello(2);
    for (const i of [0, 1, 2]) send(i, { type: "READY", ready: true });
    const room = ctx.registry.get("ABCDE")!;
    expect(room.match).not.toBeNull();
    handleClose(ctx, list[2]!.conn);
    expect(room.match).toBeNull();
    expect(list[0]!.last("OPPONENT_LEFT")).toBeDefined();
    expect(list[1]!.last("OPPONENT_LEFT")).toBeDefined();
    const lobby = list[1]!.last("LOBBY");
    expect(lobby.players[0].ready).toBe(false);
    expect(lobby.players[1].ready).toBe(false);
    expect(lobby.players[2]).toBeNull();
    ctx.loops.get("ABCDE")?.stop();
  });

  it("HELLO into a room whose configured slots are taken → ROOM_FULL even with slot 3 free", () => {
    const { list, send, hello } = conns(4);
    hello(0);
    send(0, { type: "CONFIG", config: { ...fourPlayers, players: 3, teams: "ffa" } });
    hello(1); hello(2); hello(3);
    expect(list[3]!.last("ERROR")).toEqual(expect.objectContaining({ code: "ROOM_FULL" }));
    expect(list[3]!.conn.room).toBeNull();
  });
});
