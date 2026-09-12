import { TICK, framesEqual, type ClientMessage, type InputFrame, type InputSource } from "@midnight/shared";

interface MessageClient {
  send(message: ClientMessage): void;
}

export class InputSender {
  private interval: ReturnType<typeof setInterval> | null = null;
  private lastFrame: Readonly<InputFrame> | null = null;
  private lastSentAt = Number.NEGATIVE_INFINITY;
  private seq = 0;

  constructor(
    private readonly client: MessageClient,
    private readonly source: InputSource,
    private readonly now: () => number = () => performance.now(),
  ) {}

  start(): void {
    if (this.interval !== null) return;
    this.interval = setInterval(() => this.pump(), TICK.MS);
  }

  stop(): void {
    if (this.interval === null) return;
    clearInterval(this.interval);
    this.interval = null;
  }

  pump(): void {
    const frame = this.source.sample();
    const now = this.now();
    const changed = this.lastFrame === null || !framesEqual(this.lastFrame, frame);
    if (!changed && now - this.lastSentAt < 100) return;

    this.seq += 1;
    this.client.send({ type: "INPUT", seq: this.seq, frame });
    this.lastFrame = frame;
    this.lastSentAt = now;
  }
}
