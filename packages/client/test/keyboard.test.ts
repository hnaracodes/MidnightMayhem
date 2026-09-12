import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KeyboardInputSource } from "../src/input/KeyboardInputSource";

function keyEvent(type: "keydown" | "keyup", code: string, repeat = false): Event {
  const event = new Event(type);
  Object.defineProperties(event, { code: { value: code }, repeat: { value: repeat } });
  return event;
}

describe("KeyboardInputSource", () => {
  let fakeWindow: EventTarget;

  beforeEach(() => {
    fakeWindow = new EventTarget();
    vi.stubGlobal("window", fakeWindow);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("toggles mapped inputs on key down and up", async () => {
    const source = new KeyboardInputSource();
    await source.start();

    fakeWindow.dispatchEvent(keyEvent("keydown", "KeyA"));
    expect(source.sample().left).toBe(true);
    fakeWindow.dispatchEvent(keyEvent("keyup", "KeyA"));
    expect(source.sample().left).toBe(false);
  });

  it("ignores repeated keydown events and preserves frame identity", async () => {
    const source = new KeyboardInputSource();
    await source.start();
    fakeWindow.dispatchEvent(keyEvent("keydown", "KeyF"));
    const pressed = source.sample();

    fakeWindow.dispatchEvent(keyEvent("keydown", "KeyF", true));

    expect(source.sample()).toBe(pressed);
    expect(source.sample().punchL).toBe(true);
  });

  it("clears every held input when the window blurs", async () => {
    const source = new KeyboardInputSource();
    await source.start();
    fakeWindow.dispatchEvent(keyEvent("keydown", "KeyD"));
    fakeWindow.dispatchEvent(keyEvent("keydown", "KeyS"));

    fakeWindow.dispatchEvent(new Event("blur"));

    expect(source.sample()).toEqual({
      left: false,
      right: false,
      jump: false,
      punchL: false,
      punchR: false,
      block: false,
    });
  });

  it("preserves frame identity when blur has nothing to clear", async () => {
    const source = new KeyboardInputSource();
    await source.start();
    const idle = source.sample();

    fakeWindow.dispatchEvent(new Event("blur"));

    expect(source.sample()).toBe(idle);
  });
});
