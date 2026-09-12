import {
  EMPTY_FRAME,
  INPUT_KEYS,
  framesEqual,
  type InputFrame,
  type InputSource,
} from "@midnight/shared";

export class MergedInputSource implements InputSource {
  private frame: Readonly<InputFrame> = EMPTY_FRAME;

  constructor(private readonly sources: InputSource[]) {}

  /** Adds an already-started source (Phase 6: the camera joins the keyboard mid-session). */
  add(source: InputSource): void {
    if (!this.sources.includes(source)) this.sources.push(source);
  }

  async start(): Promise<void> {
    for (const source of this.sources) await source.start();
  }

  stop(): void {
    for (const source of this.sources) source.stop();
  }

  sample(): Readonly<InputFrame> {
    const frames = this.sources.map((source) => source.sample());
    const next = Object.fromEntries(
      INPUT_KEYS.map((key) => [key, frames.some((frame) => frame[key])]),
    ) as unknown as InputFrame;
    if (!framesEqual(this.frame, next)) this.frame = Object.freeze(next);
    return this.frame;
  }
}
