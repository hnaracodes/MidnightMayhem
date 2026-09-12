import { EMPTY_FRAME, TICK, framesEqual, type ClientMessage, type InputFrame, type InputSource } from "@midnight/shared";

interface MessageClient {
  send(message: ClientMessage): void;
}

export class InputSender {
  private interval: ReturnType<typeof setInterval> | null = null;
  private lastFrame: Readonly<InputFrame> | null = null;
  private lastSentAt = Number.NEGATIVE_INFINITY;
  private seq = 0;
  /** True while the page is blurred or hidden (Phase 6 rule 5): pumps send nothing. */
  paused = false;

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

  /**
   * Stops sending and, if the sender is running (so there is a match to send to), ships one all-false
   * frame so the fighter does not keep walking or blocking while the tab is away. Idempotent.
   */
  pause(): void {
    if (this.paused) return;
    this.paused = true;
    if (this.interval !== null) this.send(EMPTY_FRAME, this.now());
  }

  /** Resumes; the next pump sends the live frame (it differs from the all-false one). Idempotent. */
  resume(): void {
    this.paused = false;
  }

  pump(): void {
    if (this.paused) return;
    const frame = this.source.sample();
    const now = this.now();
    const changed = this.lastFrame === null || !framesEqual(this.lastFrame, frame);
    if (!changed && now - this.lastSentAt < 100) return;
    this.send(frame, now);
  }

  private send(frame: Readonly<InputFrame>, now: number): void {
    this.seq += 1;
    this.client.send({ type: "INPUT", seq: this.seq, frame });
    this.lastFrame = frame;
    this.lastSentAt = now;
  }
}
