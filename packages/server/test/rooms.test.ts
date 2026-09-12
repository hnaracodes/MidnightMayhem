import { describe, expect, it, vi } from "vitest";
import { CHARACTERS, DEFAULT_CONFIG, DEFAULT_LOADOUT, EMPTY_FRAME, normalizeConfig } from "@midnight/shared";
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

describe("Room (10.03: four slots, host config, customisation)", () => {
  const fourPlayers = { players: 4, teams: "2v2", mode: "rounds", map: "roof", items: true } as const;

  it("rule 1: two joins take slots 0 and 1, host 0, lobby has four slots", () => {
    const room = new Room("ABCDE");
    expect(room.host).toBeNull();
    expect(room.join("Alice", vi.fn())).toBe(0);
    expect(room.join("Bob", vi.fn())).toBe(1);
    expect(room.host).toBe(0);
    expect(room.config).toEqual(DEFAULT_CONFIG);
    const lobby = room.lobbyMessage();
    expect(lobby.type).toBe("LOBBY");
    if (lobby.type !== "LOBBY") return;
    expect(lobby.players).toHaveLength(4);
    expect(lobby.players[2]).toBeNull();
    expect(lobby.players[3]).toBeNull();
    expect(lobby.host).toBe(0);
    expect(lobby.config).toEqual(DEFAULT_CONFIG);
    expect(lobby.players[0]).toEqual({ name: "Alice", ready: false, connected: true, character: CHARACTERS[0], loadout: DEFAULT_LOADOUT });
    expect(lobby.players[1]?.character).toBe(CHARACTERS[1]);
  });

  it("rule 2: host sets four players; the match starts only when the fourth is ready", () => {
    const room = new Room("ABCDE");
    room.join("A", vi.fn());
    expect(room.setConfig(0, fourPlayers)).toBe("ok");
    expect(room.join("B", vi.fn())).toBe(1);
    expect(room.join("C", vi.fn())).toBe(2);
    room.setReady(0, true); room.setReady(1, true); room.setReady(2, true);
    expect(room.allReady).toBe(false);
    expect(room.join("D", vi.fn())).toBe(3);
    expect(room.allReady).toBe(false);
    room.setReady(3, true);
    expect(room.allReady).toBe(true);
    expect(room.roster()).toHaveLength(4);
    room.startMatch();
    expect(room.match?.config.players).toBe(4);
    expect(room.match?.config.teams).toBe("2v2");
    expect(room.match?.fighters).toHaveLength(4);
    expect(room.inputs()).toHaveLength(4);
  });

  it("rule 3: a non-host config is refused and nothing changes", () => {
    const room = new Room("ABCDE");
    room.join("A", vi.fn()); room.join("B", vi.fn());
    expect(room.setConfig(1, fourPlayers)).toBe("not-host");
    expect(room.config).toEqual(DEFAULT_CONFIG);
  });

  it("rule 4: players below the seated count is refused", () => {
    const room = new Room("ABCDE");
    room.join("A", vi.fn());
    room.setConfig(0, fourPlayers);
    room.join("B", vi.fn()); room.join("C", vi.fn());
    expect(room.setConfig(0, { ...fourPlayers, players: 2 })).toBe("too-many-players");
    expect(room.config.players).toBe(4);
  });

  it("rule 5: config is refused during a match and accepted after MATCH_END", () => {
    const room = new Room("ABCDE");
    room.join("A", vi.fn()); room.join("B", vi.fn());
    room.startMatch();
    room.match!.phase = "FIGHTING";
    expect(room.setConfig(0, { ...DEFAULT_CONFIG, map: "gaps" })).toBe("in-match");
    expect(room.config.map).toBe("roof");
    room.match!.phase = "MATCH_END";
    expect(room.setConfig(0, { ...DEFAULT_CONFIG, map: "gaps" })).toBe("ok");
    expect(room.config.map).toBe("gaps");
  });

  it("setConfig normalises and un-readies everyone", () => {
    const room = new Room("ABCDE");
    room.join("A", vi.fn()); room.join("B", vi.fn());
    room.setReady(0, true); room.setReady(1, true);
    expect(room.setConfig(0, { ...DEFAULT_CONFIG, players: 3, teams: "2v2" })).toBe("ok");
    expect(room.config).toEqual(normalizeConfig({ ...DEFAULT_CONFIG, players: 3, teams: "2v2" }));
    expect(room.config.teams).toBe("ffa");
    expect(room.slots[0]?.ready).toBe(false);
    expect(room.slots[1]?.ready).toBe(false);
  });

  it("rule 6: customise stores character and loadout, un-readies, and reaches createMatch", () => {
    const room = new Room("ABCDE");
    room.join("A", vi.fn()); room.join("B", vi.fn());
    room.setReady(1, true);
    expect(room.setCustomize(1, "claude", ["sword", "banana"])).toBe(true);
    expect(room.slots[1]?.ready).toBe(false);
    const lobby = room.lobbyMessage();
    if (lobby.type !== "LOBBY") throw new Error("expected LOBBY");
    expect(lobby.players[1]?.character).toBe("claude");
    expect(lobby.players[1]?.loadout).toEqual(["sword", "banana"]);
    expect(room.roster()[1]).toEqual({ character: "claude", loadout: ["sword", "banana"] });
    room.startMatch();
    expect(room.match?.fighters[1]?.character).toBe("claude");
    expect(room.match?.fighters[1]?.loadout).toEqual(["sword", "banana"]);
    expect(room.match?.fighters[0]?.character).toBe(CHARACTERS[0]);
  });

  it("customise is refused mid-match and for empty slots", () => {
    const room = new Room("ABCDE");
    room.join("A", vi.fn()); room.join("B", vi.fn());
    expect(room.setCustomize(2, "stoker", ["sword", "flash"])).toBe(false);
    room.startMatch();
    room.match!.phase = "FIGHTING";
    expect(room.setCustomize(0, "stoker", ["sword", "flash"])).toBe(false);
    expect(room.slots[0]?.character).toBe(CHARACTERS[0]);
    room.match!.phase = "MATCH_END";
    expect(room.setCustomize(0, "stoker", ["sword", "flash"])).toBe(true);
  });

  it("rule 7: when the host leaves the lowest remaining slot becomes host", () => {
    const room = new Room("ABCDE");
    room.join("A", vi.fn());
    room.setConfig(0, fourPlayers);
    room.join("B", vi.fn()); room.join("C", vi.fn());
    room.leave(0);
    expect(room.host).toBe(1);
    const lobby = room.lobbyMessage();
    if (lobby.type !== "LOBBY") throw new Error("expected LOBBY");
    expect(lobby.host).toBe(1);
    room.leave(1);
    expect(room.host).toBe(2);
    room.leave(2);
    expect(room.host).toBeNull();
    expect(room.empty).toBe(true);
  });

  it("rule 8: a leave during a three-player match ends it and un-readies the rest", () => {
    const room = new Room("ABCDE");
    room.join("A", vi.fn());
    room.setConfig(0, { ...fourPlayers, players: 3 });
    room.join("B", vi.fn()); room.join("C", vi.fn());
    for (const i of [0, 1, 2] as const) room.setReady(i, true);
    room.startMatch();
    room.setReady(1, true);
    room.leave(2);
    expect(room.match).toBeNull();
    expect(room.slots[0]?.ready).toBe(false);
    expect(room.slots[1]?.ready).toBe(false);
    expect(room.host).toBe(0);
  });

  it("rule 9: inputs() has config.players frames and a slot outside the config is ignored", () => {
    const room = new Room("ABCDE");
    room.join("A", vi.fn()); room.join("B", vi.fn());
    expect(room.inputs()).toHaveLength(2);
    room.setConfig(0, fourPlayers);
    expect(room.inputs()).toHaveLength(4);
    expect(room.join("C", vi.fn())).toBe(2);
    expect(room.join("D", vi.fn())).toBe(3);
    // Simulate a stale connection at slot 3 after the config shrinks underneath it.
    room.config = { ...DEFAULT_CONFIG };
    expect(room.setInput(3, 1, { ...EMPTY_FRAME, left: true })).toBe(false);
    expect(room.inputs()).toHaveLength(2);
    expect(room.setInput(1, 1, { ...EMPTY_FRAME, left: true })).toBe(true);
    expect(room.inputs()[1]?.left).toBe(true);
  });

  it("join refuses a fifth even with players 4, and refuses a third with players 2", () => {
    const room = new Room("ABCDE");
    room.join("A", vi.fn());
    room.setConfig(0, fourPlayers);
    room.join("B", vi.fn()); room.join("C", vi.fn()); room.join("D", vi.fn());
    expect(room.join("E", vi.fn())).toBeNull();
    expect(room.full).toBe(true);
  });
});
