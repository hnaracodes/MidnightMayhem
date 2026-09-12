import {
  CHARACTERS,
  DEFAULT_CONFIG,
  DEFAULT_LOADOUT,
  EMPTY_FRAME,
  createMatch,
  normalizeConfig,
  type CharacterId,
  type InputFrame,
  type Loadout,
  type LobbyPlayer,
  type MatchConfig,
  type MatchState,
  type PlayerIndex,
  type RosterEntry,
  type ServerMessage,
} from "@midnight/shared";

export type Send = (m: ServerMessage) => void;

export interface PlayerSlot {
  name: string;
  ready: boolean;
  connected: boolean;
  seq: number;
  latest: InputFrame;
  send: Send;
  character: CharacterId;
  loadout: Loadout;
}

const PLAYER_INDICES: readonly PlayerIndex[] = [0, 1, 2, 3];

export class Room {
  readonly id: string;
  slots: [PlayerSlot | null, PlayerSlot | null, PlayerSlot | null, PlayerSlot | null] = [null, null, null, null];
  match: MatchState | null = null;
  config: MatchConfig = DEFAULT_CONFIG;

  constructor(id: string) {
    this.id = id;
  }

  /** The lowest occupied slot, or null when the room is empty. */
  get host(): PlayerIndex | null {
    return PLAYER_INDICES.find((i) => this.slots[i] !== null) ?? null;
  }

  /** True while a match is running; config and customisation are locked then. */
  get inMatch(): boolean {
    return this.match !== null && this.match.phase !== "MATCH_END";
  }

  /** Player indices below the configured player count. */
  private get active(): PlayerIndex[] {
    return PLAYER_INDICES.filter((i) => i < this.config.players);
  }

  join(name: string, send: Send): PlayerIndex | null {
    const index = this.active.find((i) => this.slots[i] === null);
    if (index === undefined) return null;
    this.slots[index] = {
      name,
      ready: false,
      connected: true,
      seq: 0,
      latest: { ...EMPTY_FRAME },
      send,
      character: CHARACTERS[index] ?? CHARACTERS[0],
      loadout: [DEFAULT_LOADOUT[0], DEFAULT_LOADOUT[1]],
    };
    return index;
  }

  leave(i: PlayerIndex): void {
    this.slots[i] = null;
    this.match = null;
    for (const slot of this.slots) {
      if (!slot) continue;
      slot.ready = false;
      slot.seq = 0;
      slot.latest = { ...EMPTY_FRAME };
    }
  }

  setReady(i: PlayerIndex, ready: boolean): void {
    const slot = this.slots[i];
    if (slot) slot.ready = ready;
  }

  setInput(i: PlayerIndex, seq: number, frame: InputFrame): boolean {
    const slot = this.slots[i];
    if (!slot || i >= this.config.players || seq <= slot.seq) return false;
    slot.seq = seq;
    slot.latest = { ...frame };
    return true;
  }

  /**
   * Stores a player's character and loadout for the next match and un-readies them.
   * Allowed any time in the lobby; false mid-match or for an empty slot.
   */
  setCustomize(i: PlayerIndex, character: CharacterId, loadout: Loadout): boolean {
    const slot = this.slots[i];
    if (!slot || this.inMatch) return false;
    slot.character = character;
    slot.loadout = [loadout[0], loadout[1]];
    slot.ready = false;
    return true;
  }

  /**
   * Applies a host-chosen config in the lobby. Refused when `i` is not the host, a match is running, or the
   * player count would drop below the seated players (any occupied slot at index >= players counts as seated
   * beyond the limit, so nobody is ever unseated). Stores the normalised config and un-readies everyone.
   */
  setConfig(i: PlayerIndex, config: MatchConfig): "ok" | "not-host" | "in-match" | "too-many-players" {
    if (i !== this.host) return "not-host";
    if (this.inMatch) return "in-match";
    const normalized = normalizeConfig(config);
    const occupied = PLAYER_INDICES.filter((j) => this.slots[j] !== null);
    if (occupied.length > normalized.players || occupied.some((j) => j >= normalized.players)) return "too-many-players";
    this.config = normalized;
    for (const slot of this.slots) if (slot) slot.ready = false;
    return "ok";
  }

  /** One entry per configured slot; empty slots fall back to the default character for that index. */
  roster(): RosterEntry[] {
    return this.active.map((i) => {
      const slot = this.slots[i];
      return slot
        ? { character: slot.character, loadout: [slot.loadout[0], slot.loadout[1]] }
        : { character: CHARACTERS[i] ?? CHARACTERS[0], loadout: [DEFAULT_LOADOUT[0], DEFAULT_LOADOUT[1]] };
    });
  }

  inputs(): InputFrame[] {
    return this.active.map((i) => {
      const slot = this.slots[i];
      return slot ? { ...slot.latest } : { ...EMPTY_FRAME };
    });
  }

  lobbyMessage(): ServerMessage {
    const players: (LobbyPlayer | null)[] = this.slots.map((slot) =>
      slot ? { name: slot.name, ready: slot.ready, connected: slot.connected, character: slot.character, loadout: slot.loadout } : null,
    );
    // The wire type carries a non-null host; an empty room never has a listener for this message.
    return { type: "LOBBY", roomId: this.id, players, config: this.config, host: this.host ?? 0 };
  }

  broadcast(m: ServerMessage): void {
    for (const slot of this.slots) if (slot?.connected) slot.send(m);
  }

  startMatch(): void {
    this.match = createMatch(this.config, this.roster());
    for (const slot of this.slots) if (slot) slot.ready = false;
  }

  get full(): boolean { return this.active.every((i) => this.slots[i] !== null); }
  get empty(): boolean { return this.slots.every((slot) => slot === null); }
  get allReady(): boolean {
    return this.full && this.active.every((i) => this.slots[i]!.ready);
  }
}

export class RoomRegistry {
  private readonly rooms = new Map<string, Room>();
  private static readonly alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

  static generateId(): string {
    let id = "";
    for (let i = 0; i < 5; i++) {
      id += RoomRegistry.alphabet[Math.floor(Math.random() * RoomRegistry.alphabet.length)];
    }
    return id;
  }

  get(id: string): Room | undefined { return this.rooms.get(id); }

  getOrCreate(id?: string): Room {
    if (id) {
      const existing = this.rooms.get(id);
      if (existing) return existing;
      const room = new Room(id);
      this.rooms.set(id, room);
      return room;
    }
    let generated = RoomRegistry.generateId();
    while (this.rooms.has(generated)) generated = RoomRegistry.generateId();
    const room = new Room(generated);
    this.rooms.set(generated, room);
    return room;
  }

  remove(id: string): void { this.rooms.delete(id); }
}
