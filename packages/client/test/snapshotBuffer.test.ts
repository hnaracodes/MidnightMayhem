import { describe, expect, it } from "vitest";
import { createMatch, type MatchState } from "@midnight/shared";
import { SnapshotBuffer } from "../src/net/snapshotBuffer";

function state(tick: number, x: number): MatchState {
  const match = createMatch();
  match.tick = tick;
  match.fighters[0]!.x = x;
  return match;
}

describe("SnapshotBuffer", () => {
  it("interpolates fighter positions at the midpoint", () => {
    const buffer = new SnapshotBuffer(50);
    buffer.push(state(1, 100), 100);
    buffer.push(state(2, 200), 200);

    const sampled = buffer.sample(200);

    expect(sampled?.fighters[0]!.x).toBe(150);
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

describe("SnapshotBuffer rematch", () => {
  function phased(tick: number, phase: MatchState["phase"]): MatchState {
    const match = state(tick, 100);
    match.phase = phase;
    return match;
  }

  it("reset() empties the buffer so an earlier tick is accepted again", () => {
    const buffer = new SnapshotBuffer();
    buffer.push(phased(1834, "MATCH_END"), 1000);
    buffer.sample(1100);
    buffer.reset();
    expect(buffer.latest()).toBeNull();
    const fresh = phased(2, "COUNTDOWN");
    buffer.push(fresh, 1200);
    expect(buffer.latest()).toBe(fresh);
    expect(buffer.sample(1300)).toBe(fresh);
  });

  it("push() detects the server restarting after MATCH_END and starts over from the new match", () => {
    const buffer = new SnapshotBuffer();
    buffer.push(phased(1832, "MATCH_END"), 1000);
    buffer.push(phased(1834, "MATCH_END"), 1033);
    buffer.push(phased(2, "COUNTDOWN"), 1066);
    buffer.push(phased(4, "COUNTDOWN"), 1100);
    expect(buffer.latest()?.tick).toBe(4);
    expect(buffer.latest()?.phase).toBe("COUNTDOWN");
    // the sampled state never falls back to the old match
    expect(buffer.sample(1200)?.tick).toBe(4);
  });

  it("still ignores a genuinely older tick of the same match", () => {
    const buffer = new SnapshotBuffer();
    buffer.push(phased(200, "FIGHTING"), 1000);
    buffer.push(phased(198, "FIGHTING"), 1033);
    expect(buffer.latest()?.tick).toBe(200);
  });
});
