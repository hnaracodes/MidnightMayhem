import {
  CHARACTERS,
  DEFAULT_CONFIG,
  DEFAULT_LOADOUT,
  EMPTY_FRAME,
  createMatch,
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

  /** The lowest occupied slot; 0 when the room is empty. */
  get host(): PlayerIndex {
    return PLAYER_INDICES.find((i) => this.slots[i] !== null) ?? 0;
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
    if (!slot || seq <= slot.seq) return false;
    slot.seq = seq;
    slot.latest = { ...frame };
    return true;
  }

  /** Stores a player's character and loadout for the next match (behaviour rules: 10.03). */
  setCustomize(i: PlayerIndex, character: CharacterId, loadout: Loadout): void {
    const slot = this.slots[i];
    if (!slot) return;
    slot.character = character;
    slot.loadout = [loadout[0], loadout[1]];
  }

  /** Applies a host-chosen config; false when it would unseat a joined player (behaviour rules: 10.03). */
  setConfig(config: MatchConfig): boolean {
    const highest = PLAYER_INDICES.filter((i) => this.slots[i] !== null).at(-1) ?? -1;
    if (highest >= config.players) return false;
    this.config = config;
    return true;
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
    return { type: "LOBBY", roomId: this.id, players, config: this.config, host: this.host };
  }

  broadcast(m: ServerMessage): void {
    for (const slot of this.slots) if (slot?.connected) slot.send(m);
  }

  startMatch(): void {
    const roster: RosterEntry[] = this.active.map((i) => {
      const slot = this.slots[i];
      return slot
        ? { character: slot.character, loadout: slot.loadout }
        : { character: CHARACTERS[i] ?? CHARACTERS[0], loadout: DEFAULT_LOADOUT };
    });
    this.match = createMatch(this.config, roster);
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
