import { describe, expect, it } from "vitest";
import { BASELINE_KEY, loadBaseline, saveBaseline, type StorageLike } from "../src/vision/baselineStore";

const good = { S: 0.2, leanZero: 0, hipY: 0.6, shoulderY: 0.35, noseY: 0.2, eyeY: 0.18, armLen: 0.4 };

function mem(): StorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) };
}

describe("baselineStore", () => {
  it("round-trips a baseline under BASELINE_KEY", () => {
    const s = mem();
    saveBaseline(s, good);
    expect(s.map.has(BASELINE_KEY)).toBe(true);
    expect(loadBaseline(s)).toEqual(good);
  });
  it("returns null for nothing stored, garbage, a missing field, a non-finite or non-positive S", () => {
    expect(loadBaseline(mem())).toBeNull();
    expect(loadBaseline(null)).toBeNull();
    const s = mem();
    s.map.set(BASELINE_KEY, "not json");
    expect(loadBaseline(s)).toBeNull();
    s.map.set(BASELINE_KEY, JSON.stringify({ ...good, armLen: undefined }));
    expect(loadBaseline(s)).toBeNull();
    s.map.set(BASELINE_KEY, JSON.stringify({ ...good, S: 0 }));
    expect(loadBaseline(s)).toBeNull();
    s.map.set(BASELINE_KEY, JSON.stringify({ ...good, hipY: "0.6" }));
    expect(loadBaseline(s)).toBeNull();
  });
  it("a storage that throws is treated as empty and never throws out", () => {
    const bad: StorageLike = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("full"); } };
    expect(loadBaseline(bad)).toBeNull();
    expect(() => saveBaseline(bad, good)).not.toThrow();
  });
});
