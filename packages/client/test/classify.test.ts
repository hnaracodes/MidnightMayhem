import type { ItemId } from "@midnight/shared";
import { describe, expect, it } from "vitest";
import { classify, type GestureFlags } from "../src/vision/classify";

type Bools = Partial<
  Record<"left" | "right" | "jump" | "punchL" | "punchR" | "block" | "special" | "chop" | "sweep", boolean>
>;
type Extra = Partial<Pick<GestureFlags, "windupL" | "windupR" | "slashL" | "slashR" | "held">>;

const g = (o: Bools & Extra = {}, item: ItemId | null = null): GestureFlags => ({
  left: false,
  right: false,
  jump: false,
  punchL: false,
  punchR: false,
  block: false,
  special: false,
  chop: false,
  sweep: false,
  windupL: false,
  windupR: false,
  slashL: false,
  slashR: false,
  held: null,
  ...o,
  item,
});
/** The expected InputFrame: every flag false and no item unless overridden. */
const frame = (o: Bools = {}, item: ItemId | null = null) => ({
  left: false, right: false, jump: false, punchL: false, punchR: false, block: false, special: false,
  chop: false, sweep: false, ...o, item,
});

describe("classify priority", () => {
  it("jump beats block and punches", () => {
    expect(classify(g({ jump: true, block: true, punchL: true, punchR: true }))).toEqual(frame({ jump: true }));
  });

  it("block beats punches", () => {
    expect(classify(g({ block: true, punchL: true, punchR: true }))).toEqual(frame({ block: true }));
  });

  it("punches pass through alone", () => {
    expect(classify(g({ punchL: true, punchR: true }))).toEqual(frame({ punchL: true, punchR: true }));
  });

  it("walk passes through with everything", () => {
    expect(classify(g({ left: true, jump: true, block: true }))).toEqual(frame({ left: true, jump: true }));
    expect(classify(g({ right: true, block: true, punchR: true }))).toEqual(frame({ right: true, block: true }));
  });

  it("9.04: special cancels punches", () => {
    expect(classify(g({ special: true, punchL: true }))).toEqual(frame({ special: true }));
    expect(classify(g({ special: true, punchL: true, punchR: true, left: true }))).toEqual(
      frame({ special: true, left: true }),
    );
  });

  it("9.04: block cancels special", () => {
    expect(classify(g({ block: true, special: true }))).toEqual(frame({ block: true }));
  });

  it("special beats jump without changing the existing jump-over-block rule", () => {
    expect(classify(g({ jump: true, special: true }))).toEqual(frame({ special: true }));
    expect(classify(g({ jump: true, special: true, block: true, punchL: true }))).toEqual(frame({ jump: true }));
  });

  it("9.04: item passes through with everything", () => {
    expect(classify(g({}, "molotov"))).toEqual(frame({}, "molotov"));
    expect(classify(g({ jump: true, block: true, special: true }, "sword"))).toEqual(frame({ jump: true }, "sword"));
    expect(classify(g({ punchL: true }, "flash"))).toEqual(frame({ punchL: true }, "flash"));
  });

  it("returns a frozen object reused until a field changes", () => {
    const a = classify(g({ right: true }));
    const b = classify(g({ right: true }));
    expect(Object.isFrozen(a)).toBe(true);
    expect(b).toBe(a);
    const c = classify(g({ right: true, punchL: true }));
    expect(c).not.toBe(a);
    expect(c.punchL).toBe(true);
    // Priority-equal inputs also reuse the object.
    const d = classify(g({ right: true, punchL: true, jump: true }));
    const e = classify(g({ right: true, jump: true }));
    expect(e).toBe(d);
    // An item change is a change.
    const f = classify(g({ right: true, jump: true }, "banana"));
    expect(f).not.toBe(e);
    expect(f.item).toBe("banana");
    expect(classify(g({ right: true, jump: true }, "banana"))).toBe(f);
  });

  it("9.10: a wind-up holds that arm's punch and silences the beam while a throwable is held", () => {
    expect(classify(g({ windupR: true, special: true, held: "molotov" }))).toEqual(frame({ punchR: true }));
    expect(classify(g({ windupL: true, punchR: true, held: "banana" }))).toEqual(frame({ punchL: true, punchR: true }));
  });

  it("9.10: a wind-up flag without a throwable in hand is ignored", () => {
    expect(classify(g({ windupR: true, held: "sword" }))).toEqual(frame());
    expect(classify(g({ windupR: true }))).toEqual(frame());
  });

  it("9.10: a punch beats the beam while a throwable is held; the beam beats a punch otherwise", () => {
    expect(classify(g({ punchL: true, special: true, held: "molotov" }))).toEqual(frame({ punchL: true }));
    expect(classify(g({ punchL: true, special: true, held: "shield" }))).toEqual(frame({ special: true }));
  });

  it("9.10: a slash pulse passes through and its exclusivity suppresses that arm's punch only", () => {
    expect(classify(g({ chop: true, slashL: true, punchL: true, punchR: true, held: "sword" }))).toEqual(
      frame({ chop: true, punchR: true }),
    );
    expect(classify(g({ sweep: true, slashR: true, punchR: true, held: "sword" }))).toEqual(frame({ sweep: true }));
  });

  it("9.10: block and jump cancel wind-ups and slashes", () => {
    expect(classify(g({ block: true, windupR: true, chop: true, sweep: true, held: "molotov" }))).toEqual(frame({ block: true }));
    expect(classify(g({ jump: true, windupR: true, chop: true, held: "molotov" }))).toEqual(frame({ jump: true }));
  });
});
