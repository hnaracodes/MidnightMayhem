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
    handleMessage(ctx, conn, JSON.stringify({ type: "HELLO", name: "Alice", roomId: "ABCDE" }));
    expect(conn.index).toBe(0);
    expect(sent).toEqual(expect.arrayContaining([
      { type: "WELCOME", roomId: "ABCDE", playerIndex: 0, protocolVersion: 1 },
      expect.objectContaining({ type: "LOBBY", roomId: "ABCDE" }),
    ]));
  });

  it("seats a second HELLO and rejects a third with ROOM_FULL", () => {
    const { ctx, conn } = setup();
    const second = { ...setup().conn, send: vi.fn() } as Conn;
    const third = { ...setup().conn, send: vi.fn() } as Conn;
    handleMessage(ctx, conn, JSON.stringify({ type: "HELLO", name: "A", roomId: "ABCDE" }));
    handleMessage(ctx, second, JSON.stringify({ type: "HELLO", name: "B", roomId: "ABCDE" }));
    handleMessage(ctx, third, JSON.stringify({ type: "HELLO", name: "C", roomId: "ABCDE" }));
    expect(second.index).toBe(1);
    expect(third.send).toHaveBeenCalledWith(expect.objectContaining({ type: "ERROR", code: "ROOM_FULL" }));
  });

  it("starts a loop when both players are ready", () => {
    const { ctx, conn } = setup();
    const second = { ...setup().conn, send: vi.fn() } as Conn;
    handleMessage(ctx, conn, JSON.stringify({ type: "HELLO", name: "A", roomId: "ABCDE" }));
    handleMessage(ctx, second, JSON.stringify({ type: "HELLO", name: "B", roomId: "ABCDE" }));
    handleMessage(ctx, conn, JSON.stringify({ type: "READY", ready: true }));
    handleMessage(ctx, second, JSON.stringify({ type: "READY", ready: true }));
    const loop = ctx.loops.get("ABCDE");
    expect(loop).toBeInstanceOf(RoomLoop);
    loop?.stop();
  });

  it("requires HELLO before READY or INPUT and stores input after joining", () => {
    const { ctx, conn, sent } = setup();
    handleMessage(ctx, conn, JSON.stringify({ type: "INPUT", seq: 1, frame: { left: true, right: false, jump: false, punchL: false, punchR: false, block: false } }));
    expect(sent.at(-1)).toEqual(expect.objectContaining({ type: "ERROR", code: "NOT_IN_ROOM" }));
    handleMessage(ctx, conn, JSON.stringify({ type: "HELLO", name: "A", roomId: "ABCDE" }));
    handleMessage(ctx, conn, JSON.stringify({ type: "INPUT", seq: 1, frame: { left: true, right: false, jump: false, punchL: false, punchR: false, block: false } }));
    expect(conn.room?.inputs()[0].left).toBe(true);
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
    handleMessage(ctx, conn, JSON.stringify({ type: "HELLO", name: "A", roomId: "ABCDE" }));
    handleMessage(ctx, second, JSON.stringify({ type: "HELLO", name: "B", roomId: "ABCDE" }));
    handleClose(ctx, conn);
    expect(second.send).toHaveBeenCalledWith({ type: "OPPONENT_LEFT" });
    expect(second.room).toBeDefined();
    handleClose(ctx, second);
    expect(ctx.registry.get("ABCDE")).toBeUndefined();
  });
});
