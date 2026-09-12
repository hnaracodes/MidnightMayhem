import { describe, expect, it } from "vitest";
import { createMatch, type MatchState } from "@midnight/shared";
import { SnapshotBuffer } from "../src/net/snapshotBuffer";

function state(tick: number, x: number): MatchState {
  const match = createMatch();
  match.tick = tick;
  match.fighters[0].x = x;
  return match;
}

describe("SnapshotBuffer", () => {
  it("interpolates fighter positions at the midpoint", () => {
    const buffer = new SnapshotBuffer(50);
    buffer.push(state(1, 100), 100);
    buffer.push(state(2, 200), 200);

    const sampled = buffer.sample(200);

    expect(sampled?.fighters[0].x).toBe(150);
    expect(sampled?.tick).toBe(2);
  });

  it("returns its single snapshot unchanged", () => {
    const buffer = new SnapshotBuffer();
    const only = state(4, 320);
    buffer.push(only, 100);

    expect(buffer.sample(500)).toBe(only);
    expect(buffer.latest()).toBe(only);
  });

  it("ignores a state whose tick is older than the newest", () => {
    const buffer = new SnapshotBuffer();
    const newest = state(8, 400);
    buffer.push(newest, 200);
    buffer.push(state(7, 100), 300);

    expect(buffer.latest()).toBe(newest);
  });
});
