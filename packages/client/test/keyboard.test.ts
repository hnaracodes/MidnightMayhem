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

  it("maps E to chop and R to sweep (9.10)", async () => {
    const source = new KeyboardInputSource();
    await source.start();
    fakeWindow.dispatchEvent(keyEvent("keydown", "KeyE"));
    expect(source.sample().chop).toBe(true);
    expect(source.sample().sweep).toBe(false);
    fakeWindow.dispatchEvent(keyEvent("keyup", "KeyE"));
    fakeWindow.dispatchEvent(keyEvent("keydown", "KeyR"));
    expect(source.sample().chop).toBe(false);
    expect(source.sample().sweep).toBe(true);
    fakeWindow.dispatchEvent(keyEvent("keyup", "KeyR"));
    expect(source.sample().sweep).toBe(false);
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
      special: false,
      item: null,
      chop: false,
      sweep: false,
    });
  });

  it("preserves frame identity when blur has nothing to clear", async () => {
    const source = new KeyboardInputSource();
    await source.start();
    const idle = source.sample();

    fakeWindow.dispatchEvent(new Event("blur"));

    expect(source.sample()).toBe(idle);
  });

  describe("9.04: Q and the digit keys", () => {
    it("Q holds special", async () => {
      const source = new KeyboardInputSource();
      await source.start();
      fakeWindow.dispatchEvent(keyEvent("keydown", "KeyQ"));
      expect(source.sample().special).toBe(true);
      fakeWindow.dispatchEvent(keyEvent("keyup", "KeyQ"));
      expect(source.sample().special).toBe(false);
    });

    it("holding 1 samples item molotov; releasing clears it", async () => {
      const source = new KeyboardInputSource();
      await source.start();
      fakeWindow.dispatchEvent(keyEvent("keydown", "Digit1"));
      expect(source.sample().item).toBe("molotov");
      fakeWindow.dispatchEvent(keyEvent("keyup", "Digit1"));
      expect(source.sample().item).toBeNull();
    });

    it("maps 1–5 to molotov, sword, shield, banana, flash", async () => {
      const source = new KeyboardInputSource();
      await source.start();
      const expected = ["molotov", "sword", "shield", "banana", "flash"];
      for (let i = 0; i < 5; i++) {
        fakeWindow.dispatchEvent(keyEvent("keydown", `Digit${i + 1}`));
        expect(source.sample().item).toBe(expected[i]);
        fakeWindow.dispatchEvent(keyEvent("keyup", `Digit${i + 1}`));
      }
      expect(source.sample().item).toBeNull();
    });

    it("holding 1 then 3 is shield; releasing 1 while 3 is held keeps shield; releasing 3 clears", async () => {
      const source = new KeyboardInputSource();
      await source.start();
      fakeWindow.dispatchEvent(keyEvent("keydown", "Digit1"));
      fakeWindow.dispatchEvent(keyEvent("keydown", "Digit3"));
      expect(source.sample().item).toBe("shield");
      fakeWindow.dispatchEvent(keyEvent("keyup", "Digit1"));
      expect(source.sample().item).toBe("shield");
      fakeWindow.dispatchEvent(keyEvent("keyup", "Digit3"));
      expect(source.sample().item).toBeNull();
    });

    it("repeated digit keydown keeps the frame identity", async () => {
      const source = new KeyboardInputSource();
      await source.start();
      fakeWindow.dispatchEvent(keyEvent("keydown", "Digit2"));
      const held = source.sample();
      fakeWindow.dispatchEvent(keyEvent("keydown", "Digit2", true));
      expect(source.sample()).toBe(held);
    });

    it("blur clears a held item and special", async () => {
      const source = new KeyboardInputSource();
      await source.start();
      fakeWindow.dispatchEvent(keyEvent("keydown", "Digit4"));
      fakeWindow.dispatchEvent(keyEvent("keydown", "KeyQ"));
      fakeWindow.dispatchEvent(new Event("blur"));
      expect(source.sample().item).toBeNull();
      expect(source.sample().special).toBe(false);
    });
  });
});
