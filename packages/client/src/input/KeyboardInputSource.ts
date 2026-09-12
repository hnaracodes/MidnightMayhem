import {
  EMPTY_FRAME,
  INPUT_KEYS,
  type InputFrame,
  type InputKey,
  type InputSource,
} from "@midnight/shared";

const KEY_MAP: Readonly<Record<string, InputKey>> = {
  KeyA: "left",
  KeyD: "right",
  KeyW: "jump",
  KeyS: "block",
  KeyF: "punchL",
  KeyG: "punchR",
};

export class KeyboardInputSource implements InputSource {
  private frame: Readonly<InputFrame> = EMPTY_FRAME;
  private started = false;

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat) return;
    const input = KEY_MAP[event.code];
    if (input) this.set(input, true);
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    const input = KEY_MAP[event.code];
    if (input) this.set(input, false);
  };

  private readonly onBlur = (): void => {
    this.clear();
  };

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
    this.clear();
  }

  sample(): Readonly<InputFrame> {
    return this.frame;
  }

  private set(input: InputKey, value: boolean): void {
    if (this.frame[input] === value) return;
    this.frame = Object.freeze({ ...this.frame, [input]: value });
  }

  private clear(): void {
    if (INPUT_KEYS.some((input) => this.frame[input])) this.frame = EMPTY_FRAME;
  }
}
