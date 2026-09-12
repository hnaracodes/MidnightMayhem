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

  it("drops events left over from a match aborted after an odd tick before the next match's first snapshot", () => {
    const room = new Room("ABCDE");
    const send = vi.fn();
    room.join("Alice", send); room.join("Bob", vi.fn());
    room.match = createMatch();
    const loop = new RoomLoop(room);
    loop.tickOnce(); loop.tickOnce(); loop.tickOnce();
    expect(room.match!.tick).toBe(3);
    // The odd tick's events are still pending when the room aborts the match (a player left).
    const backlog = (loop as unknown as { pending: unknown[] }).pending;
    backlog.push({ type: "KO", player: 1 });
    room.leave(1);
    expect(room.match).toBeNull();
    send.mockClear();
    room.join("Bob", vi.fn());
    room.startMatch();
    loop.tickOnce(); loop.tickOnce();
    const first = send.mock.calls.map(([m]) => m).find((m) => m.type === "SNAPSHOT");
    expect(first.state.tick).toBe(2);
    expect(first.events).not.toContainEqual({ type: "KO", player: 1 });
  });

  it("does nothing when the room has no match", () => {
    const room = new Room("ABCDE"); const send = vi.fn(); room.join("Alice", send);
    expect(() => new RoomLoop(room).tickOnce()).not.toThrow();
    expect(send).not.toHaveBeenCalled();
  });
});

describe("RoomLoop (10.03: four players)", () => {
  it("rule 10: snapshots go to every occupied slot with that slot's own seq", () => {
    const room = new Room("ABCDE");
    const sends = [vi.fn(), vi.fn(), vi.fn(), vi.fn()];
    room.join("A", sends[0]!);
    room.setConfig(0, { players: 4, teams: "ffa", mode: "rounds", map: "roof", items: true });
    room.join("B", sends[1]!); room.join("C", sends[2]!); room.join("D", sends[3]!);
    sends.forEach((_, i) => { room.slots[i]!.seq = 10 + i; });
    room.startMatch();
    const loop = new RoomLoop(room);
    loop.tickOnce(); loop.tickOnce();
    sends.forEach((send, i) => {
      expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: "SNAPSHOT", ackSeq: 10 + i }));
      const snap = send.mock.calls.at(-1)![0];
      expect(snap.state.fighters).toHaveLength(4);
    });
  });
});
