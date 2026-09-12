import {
  createMatch,
  EMPTY_FRAME,
  type InputFrame,
  type MatchState,
  type PlayerIndex,
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
}

export class Room {
  readonly id: string;
  slots: [PlayerSlot | null, PlayerSlot | null] = [null, null];
  match: MatchState | null = null;

  constructor(id: string) {
    this.id = id;
  }

  join(name: string, send: Send): PlayerIndex | null {
    const index = this.slots[0] === null ? 0 : this.slots[1] === null ? 1 : null;
    if (index === null) return null;
    this.slots[index] = {
      name,
      ready: false,
      connected: true,
      seq: 0,
      latest: { ...EMPTY_FRAME },
      send,
    };
    return index;
  }

  leave(i: PlayerIndex): void {
    this.slots[i] = null;
    this.match = null;
    const opponent = (i === 0 ? this.slots[1] : this.slots[0]);
    if (opponent) {
      opponent.ready = false;
      opponent.seq = 0;
      opponent.latest = { ...EMPTY_FRAME };
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

  inputs(): [InputFrame, InputFrame] {
    return [this.slots[0] ? { ...this.slots[0].latest } : { ...EMPTY_FRAME }, this.slots[1] ? { ...this.slots[1].latest } : { ...EMPTY_FRAME }];
  }

  lobbyMessage(): ServerMessage {
    return {
      type: "LOBBY",
      roomId: this.id,
      players: this.slots.map((slot) => slot ? ({ name: slot.name, ready: slot.ready, connected: slot.connected }) : null) as [
        { name: string; ready: boolean; connected: boolean } | null,
        { name: string; ready: boolean; connected: boolean } | null,
      ],
    };
  }

  broadcast(m: ServerMessage): void {
    for (const slot of this.slots) if (slot?.connected) slot.send(m);
  }

  startMatch(): void {
    this.match = createMatch();
    for (const slot of this.slots) if (slot) slot.ready = false;
  }

  get full(): boolean { return this.slots[0] !== null && this.slots[1] !== null; }
  get empty(): boolean { return this.slots[0] === null && this.slots[1] === null; }
  get allReady(): boolean {
    return this.full && this.slots[0]!.ready && this.slots[1]!.ready;
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
