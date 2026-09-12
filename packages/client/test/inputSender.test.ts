import { describe, expect, it, vi } from "vitest";
import { EMPTY_FRAME, type InputFrame, type InputSource } from "@midnight/shared";
import { InputSender } from "../src/net/inputSender";

class StubSource implements InputSource {
  frame: Readonly<InputFrame> = EMPTY_FRAME;
  async start(): Promise<void> {}
  stop(): void {}
  sample(): Readonly<InputFrame> { return this.frame; }
}

describe("InputSender", () => {
  it("sends the first frame with sequence 1", () => {
    const send = vi.fn();
    const source = new StubSource();
    const sender = new InputSender({ send }, source, () => 0);

    sender.pump();

    expect(send).toHaveBeenCalledWith({ type: "INPUT", seq: 1, frame: EMPTY_FRAME });
  });

  it("skips an unchanged frame before the heartbeat", () => {
    const send = vi.fn();
    const source = new StubSource();
    let now = 0;
    const sender = new InputSender({ send }, source, () => now);
    sender.pump();

    now = 99;
    sender.pump();

    expect(send).toHaveBeenCalledTimes(1);
  });

  it("sends a changed frame with the next sequence", () => {
    const send = vi.fn();
    const source = new StubSource();
    const sender = new InputSender({ send }, source, () => 0);
    sender.pump();

    source.frame = Object.freeze({ ...EMPTY_FRAME, jump: true });
    sender.pump();

    expect(send).toHaveBeenLastCalledWith({ type: "INPUT", seq: 2, frame: source.frame });
  });

  it("sends an unchanged heartbeat at 100 ms", () => {
    const send = vi.fn();
    const source = new StubSource();
    let now = 0;
    const sender = new InputSender({ send }, source, () => now);
    sender.pump();

    now = 100;
    sender.pump();

    expect(send).toHaveBeenLastCalledWith({ type: "INPUT", seq: 2, frame: EMPTY_FRAME });
  });
});

describe("InputSender pause", () => {
  it("pause sends one all-false frame while running and then stays silent", () => {
    const send = vi.fn();
    const source = new StubSource();
    source.frame = Object.freeze({ ...EMPTY_FRAME, right: true });
    let now = 0;
    const sender = new InputSender({ send }, source, () => now);
    sender.start();
    sender.pump();
    expect(send).toHaveBeenLastCalledWith({ type: "INPUT", seq: 1, frame: source.frame });

    sender.pause();
    expect(send).toHaveBeenLastCalledWith({ type: "INPUT", seq: 2, frame: EMPTY_FRAME });
    sender.pause();
    expect(send).toHaveBeenCalledTimes(2);

    now = 500;
    sender.pump();
    expect(send).toHaveBeenCalledTimes(2);
    sender.stop();
  });

  it("pause before start sends nothing (no room to send to yet)", () => {
    const send = vi.fn();
    const sender = new InputSender({ send }, new StubSource(), () => 0);
    sender.pause();
    expect(send).not.toHaveBeenCalled();
  });

  it("resume sends the current frame on the next pump", () => {
    const send = vi.fn();
    const source = new StubSource();
    source.frame = Object.freeze({ ...EMPTY_FRAME, left: true });
    const sender = new InputSender({ send }, source, () => 0);
    sender.start();
    sender.pump();
    sender.pause();
    sender.resume();
    sender.resume();
    sender.pump();
    expect(send).toHaveBeenLastCalledWith({ type: "INPUT", seq: 3, frame: source.frame });
    expect(sender.paused).toBe(false);
    sender.stop();
  });
});
