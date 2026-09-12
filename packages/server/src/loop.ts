import { step, TICK, type SimEvent } from "@midnight/shared";
import type { Room } from "./rooms";

export class RoomLoop {
  private last = 0;
  private acc = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private pending: SimEvent[] = [];

  constructor(private readonly room: Room, private readonly now: () => number = () => performance.now()) {}

  start(): void {
    this.last = this.now();
    this.acc = 0;
    if (this.timer === null) this.timer = setInterval(() => this.pump(), 4);
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  pump(): void {
    const current = this.now();
    this.acc += current - this.last;
    this.last = current;
    let ticks = 0;
    while (this.acc + 1e-9 >= TICK.MS && ticks < TICK.MAX_CATCHUP) {
      this.tickOnce();
      this.acc -= TICK.MS;
      ticks++;
    }
    if (this.acc + 1e-9 >= TICK.MS) this.acc = 0;
  }

  tickOnce(): void {
    if (!this.room.match) return;
    const result = step(this.room.match, this.room.inputs());
    this.room.match = result.state;
    this.pending.push(...result.events);
    if (result.state.tick % TICK.SNAPSHOT_EVERY !== 0) return;
    const events = this.pending;
    this.pending = [];
    for (const slot of this.room.slots) {
      if (!slot) continue;
      slot.send({ type: "SNAPSHOT", state: result.state, events, ackSeq: slot.seq });
    }
  }
}
