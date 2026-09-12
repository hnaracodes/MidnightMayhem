import { describe, expect, it, vi } from "vitest";
import { createMatch } from "@midnight/shared";
import { Room } from "../src/rooms";
import { RoomLoop } from "../src/loop";

describe("RoomLoop", () => {
  it("advances ticks, snapshots on even ticks, and acks each slot", () => {
    const room = new Room("ABCDE");
    const a = vi.fn(); const b = vi.fn();
    room.join("Alice", a); room.join("Bob", b);
    room.slots[0]!.seq = 4; room.slots[1]!.seq = 9;
    room.match = createMatch();
    const loop = new RoomLoop(room);
    loop.tickOnce();
    expect(room.match.tick).toBe(1);
    expect(a).not.toHaveBeenCalled();
    loop.tickOnce();
    expect(room.match.tick).toBe(2);
    expect(a).toHaveBeenCalledWith(expect.objectContaining({ type: "SNAPSHOT", ackSeq: 4 }));
    expect(b).toHaveBeenCalledWith(expect.objectContaining({ type: "SNAPSHOT", ackSeq: 9 }));
  });

  it("bundles ROUND_START at the first fighting snapshot", () => {
    const room = new Room("ABCDE");
    const send = vi.fn();
    room.join("Alice", send); room.match = createMatch();
    const loop = new RoomLoop(room);
    for (let i = 0; i < 180; i++) loop.tickOnce();
    const snapshots = send.mock.calls.map(([m]) => m).filter((m) => m.type === "SNAPSHOT");
    expect(snapshots.at(-1).events).toContainEqual({ type: "ROUND_START", round: 1 });
  });

  it("caps catch-up at five ticks and drops the backlog", () => {
    let now = 0;
    const room = new Room("ABCDE"); room.match = createMatch();
    const loop = new RoomLoop(room, () => now);
    loop.start();
    now = 50 * (1000 / 60);
    loop.pump();
    expect(room.match.tick).toBe(5);
    now += 1000 / 60;
    loop.pump();
    expect(room.match.tick).toBe(6);
    loop.stop();
  });

  it("does nothing when the room has no match", () => {
    const room = new Room("ABCDE"); const send = vi.fn(); room.join("Alice", send);
    expect(() => new RoomLoop(room).tickOnce()).not.toThrow();
    expect(send).not.toHaveBeenCalled();
  });
});
