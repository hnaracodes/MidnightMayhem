import { describe, expect, it } from "vitest";
import { EMPTY_FRAME, framesEqual, risingEdges, type InputFrame } from "../src/input";

describe("InputFrame contract", () => {
  it("EMPTY_FRAME is frozen and all false", () => {
    expect(Object.isFrozen(EMPTY_FRAME)).toBe(true);
    expect(Object.values(EMPTY_FRAME).every((v) => v === false)).toBe(true);
  });
  it("risingEdges reports only false->true transitions", () => {
    const prev: InputFrame = { ...EMPTY_FRAME, punchL: true, block: true };
    const next: InputFrame = { ...EMPTY_FRAME, punchL: true, punchR: true, jump: true };
    expect(risingEdges(prev, next)).toEqual({ left: false, right: false, jump: true, punchL: false, punchR: true, block: false });
  });
  it("framesEqual compares all six keys", () => {
    expect(framesEqual(EMPTY_FRAME, { ...EMPTY_FRAME })).toBe(true);
    expect(framesEqual(EMPTY_FRAME, { ...EMPTY_FRAME, left: true })).toBe(false);
  });
});
