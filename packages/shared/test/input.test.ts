import { describe, expect, it } from "vitest";
import { EMPTY_FRAME, INPUT_KEYS, framesEqual, risingEdges, type InputFrame } from "../src/input";

describe("InputFrame contract", () => {
  it("EMPTY_FRAME is frozen and all false", () => {
    expect(Object.isFrozen(EMPTY_FRAME)).toBe(true);
    expect(INPUT_KEYS.every((k) => EMPTY_FRAME[k] === false)).toBe(true);
    expect(EMPTY_FRAME.item).toBeNull();
  });
  it("risingEdges reports only false->true transitions", () => {
    const prev: InputFrame = { ...EMPTY_FRAME, punchL: true, block: true };
    const next: InputFrame = { ...EMPTY_FRAME, punchL: true, punchR: true, jump: true };
    expect(risingEdges(prev, next)).toEqual({ left: false, right: false, jump: true, punchL: false, punchR: true, block: false, special: false, item: null, chop: false, sweep: false });
  });
  it("framesEqual compares every boolean key", () => {
    expect(framesEqual(EMPTY_FRAME, { ...EMPTY_FRAME })).toBe(true);
    expect(framesEqual(EMPTY_FRAME, { ...EMPTY_FRAME, left: true })).toBe(false);
  });
});
