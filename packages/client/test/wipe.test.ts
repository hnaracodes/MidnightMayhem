// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WIPE_MS, irisWipe, wipeDurationMs } from "../src/app/wipe";

describe("12.06 rule 4: iris wipe", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { cb(0); return 1; });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it("is instant under reduced motion and adds no overlay", async () => {
    expect(wipeDurationMs(true)).toBe(0);
    expect(wipeDurationMs(false)).toBe(WIPE_MS);
    const swap = vi.fn();
    const p = irisWipe(true, swap);
    expect(swap).toHaveBeenCalledTimes(1);
    expect(document.getElementById("iris-wipe")).toBeNull();
    await p;
  });

  it("closes, swaps at the closed point, opens, and removes the overlay", async () => {
    const swap = vi.fn();
    const done = irisWipe(false, swap);
    const el = document.getElementById("iris-wipe")!;
    expect(el).not.toBeNull();
    expect(el.getAttribute("aria-hidden")).toBe("true");
    expect(el.style.pointerEvents).toBe("none");
    expect(swap).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(WIPE_MS / 2);
    expect(swap).toHaveBeenCalledTimes(1);
    expect(document.getElementById("iris-wipe")).not.toBeNull();
    await vi.advanceTimersByTimeAsync(WIPE_MS / 2);
    await done;
    expect(document.getElementById("iris-wipe")).toBeNull();
  });

  it("a second wipe during the first queues its swap on the same overlay", async () => {
    const order: string[] = [];
    const first = irisWipe(false, () => order.push("a"));
    const second = irisWipe(false, () => order.push("b"));
    expect(document.querySelectorAll("#iris-wipe").length).toBe(1);
    await vi.advanceTimersByTimeAsync(WIPE_MS);
    await Promise.all([first, second]);
    expect(order).toEqual(["a", "b"]);
    expect(document.getElementById("iris-wipe")).toBeNull();
  });
});
