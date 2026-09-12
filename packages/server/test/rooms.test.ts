import { describe, expect, it, vi } from "vitest";
import { EMPTY_FRAME } from "@midnight/shared";
import { Room, RoomRegistry } from "../src/rooms";

describe("Room", () => {
  it("seats two, refuses a third, and reports full", () => {
    const room = new Room("ABCDE");
    const send = vi.fn();
    expect(room.join("Alice", send)).toBe(0);
    expect(room.join("Bob", send)).toBe(1);
    expect(room.join("Carol", send)).toBeNull();
    expect(room.full).toBe(true);
    expect(room.empty).toBe(false);
  });

  it("gates ready and clears ready flags on start", () => {
    const room = new Room("ABCDE");
    room.join("Alice", vi.fn());
    room.join("Bob", vi.fn());
    expect(room.allReady).toBe(false);
    room.setReady(0, true);
    expect(room.allReady).toBe(false);
    room.setReady(1, true);
    expect(room.allReady).toBe(true);
    room.startMatch();
    expect(room.match).not.toBeNull();
    expect(room.allReady).toBe(false);
    expect(room.slots[0]?.ready).toBe(false);
    expect(room.slots[1]?.ready).toBe(false);
  });

  it("accepts monotonic sequence numbers and reflects the latest input", () => {
    const room = new Room("ABCDE");
    room.join("Alice", vi.fn());
    const frame = { ...EMPTY_FRAME, right: true };
    expect(room.setInput(0, 1, frame)).toBe(true);
    frame.right = false;
    expect(room.setInput(0, 1, frame)).toBe(false);
    expect(room.setInput(0, 0, frame)).toBe(false);
    expect(room.inputs()[0]!.right).toBe(true);
    expect(room.slots[0]?.seq).toBe(1);
  });

  it("leaving clears the match and opponent readiness", () => {
    const room = new Room("ABCDE");
    room.join("Alice", vi.fn());
    room.join("Bob", vi.fn());
    room.setReady(1, true);
    room.startMatch();
    room.leave(0);
    expect(room.match).toBeNull();
    expect(room.slots[0]).toBeNull();
    expect(room.slots[1]?.ready).toBe(false);
    expect(room.inputs()[1]).toEqual(EMPTY_FRAME);
  });

  it("generates valid ids and reuses rooms", () => {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const id = RoomRegistry.generateId();
    expect(id).toMatch(/^[A-Z2-9]{5}$/);
    expect([...id].every((c) => alphabet.includes(c))).toBe(true);
    const registry = new RoomRegistry();
    const a = registry.getOrCreate("HELLO");
    expect(registry.get("HELLO")).toBe(a);
    expect(registry.getOrCreate("HELLO")).toBe(a);
    const b = registry.getOrCreate();
    expect(b.id).toHaveLength(5);
    expect(registry.get(b.id)).toBe(b);
    registry.remove(b.id);
    expect(registry.get(b.id)).toBeUndefined();
  });
});
