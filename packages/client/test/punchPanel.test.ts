import { describe, expect, it } from "vitest";
import { objectsText, punchGateRows, punchWhyNot } from "../src/harness/panel";
import type { PunchDiag } from "../src/vision/gestures/punch";
import { DEPTH_ENTER_NO_HAND, EXT_ENTER, JAB_EXT } from "../src/vision/thresholds";

const diag = (o: Partial<PunchDiag> = {}): PunchDiag => ({
  ext: 0.98, depth: 0.03, drop: 0.02, atHeight: false, extOk: false, depthOk: false, thrustOk: false, jabOk: false,
  active: false, out: false, side: 0.1, jabRise: 0, path: null, ...o,
});

describe("harness punch gate rows", () => {
  it("lists ext, depth, atHeight, thrust, jab, active, out with live values and thresholds", () => {
    const rows = punchGateRows(diag());
    expect(rows.map((r) => r.label)).toEqual(["ext", "depth", "atHeight", "thrust", "jab", "active", "out"]);
    expect(rows[0]?.value).toBe(`0.98 < ${EXT_ENTER}`);
    expect(rows[1]?.value).toBe(`0.03 > ${DEPTH_ENTER_NO_HAND} m`);
    expect(rows.every((r) => !r.pass)).toBe(true);
    const on = punchGateRows(diag({ extOk: true, depthOk: true, atHeight: true, thrustOk: true, active: true, out: true, path: "thrust" }));
    expect(on.filter((r) => r.pass).map((r) => r.label)).toEqual(["ext", "depth", "atHeight", "thrust", "active", "out"]);
  });

  it("why-not names the first failing gate on each path", () => {
    expect(punchWhyNot(diag())).toBe(`thrust fails at ext 0.98 >= ${EXT_ENTER}; jab fails at wrist off shoulder height`);
    expect(punchWhyNot(diag({ ext: 0.5, extOk: true, atHeight: true }))).toBe(
      `thrust fails at depth 0.03 <= ${DEPTH_ENTER_NO_HAND}; jab fails at side 0.10 <= ${JAB_EXT}`,
    );
    expect(punchWhyNot(diag({ ext: 0.5, extOk: true, depth: 0.3, depthOk: true, atHeight: true, side: 0.95, jabRise: 0.1 }))).toBe(
      "thrust fails at drop 0.02 < 0.15; jab fails at rise 0.10 < 0.3",
    );
    expect(punchWhyNot(diag({ active: true, path: "jab" }))).toBe("entered via jab, waiting on debounce");
    expect(punchWhyNot(diag({ active: true, out: true, path: "thrust" }))).toBe("punching via thrust");
  });
});

describe("harness objects line (9.04)", () => {
  it("shows off when the detector did not load and on with the latest ms otherwise", () => {
    expect(objectsText({ objects: false, objectMs: 0 })).toBe("off");
    expect(objectsText({ objects: true, objectMs: 12.34 })).toBe("on · 12.3 ms");
  });
});
