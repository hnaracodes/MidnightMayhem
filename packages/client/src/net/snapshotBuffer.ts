import type { MatchState } from "@midnight/shared";

interface TimedSnapshot {
  state: MatchState;
  at: number;
}

export class SnapshotBuffer {
  private readonly snapshots: TimedSnapshot[] = [];
  private lastRenderTime = Number.NEGATIVE_INFINITY;

  constructor(private readonly delayMs = 50) {}

  push(state: MatchState, at: number): void {
    const newest = this.snapshots.at(-1);
    if (newest && state.tick <= newest.state.tick) return;
    this.snapshots.push({ state, at });
    if (this.snapshots.length > 6) this.snapshots.splice(0, this.snapshots.length - 6);
  }

  latest(): MatchState | null {
    return this.snapshots.at(-1)?.state ?? null;
  }

  sample(now: number): MatchState | null {
    if (this.snapshots.length === 0) return null;
    if (this.snapshots.length === 1) return this.snapshots[0]!.state;

    const renderTime = Math.max(now - this.delayMs, this.lastRenderTime);
    this.lastRenderTime = renderTime;
    const oldest = this.snapshots[0]!;
    const newest = this.snapshots.at(-1)!;
    if (renderTime <= oldest.at) return oldest.state;
    if (renderTime >= newest.at) return newest.state;

    for (let index = 1; index < this.snapshots.length; index += 1) {
      const a = this.snapshots[index - 1]!;
      const b = this.snapshots[index]!;
      if (renderTime > b.at) continue;
      const span = b.at - a.at;
      const amount = span === 0 ? 1 : (renderTime - a.at) / span;
      return {
        ...b.state,
        fighters: [
          {
            ...b.state.fighters[0],
            x: lerp(a.state.fighters[0].x, b.state.fighters[0].x, amount),
            y: lerp(a.state.fighters[0].y, b.state.fighters[0].y, amount),
          },
          {
            ...b.state.fighters[1],
            x: lerp(a.state.fighters[1].x, b.state.fighters[1].x, amount),
            y: lerp(a.state.fighters[1].y, b.state.fighters[1].y, amount),
          },
        ],
      };
    }

    return newest.state;
  }
}

function lerp(a: number, b: number, amount: number): number {
  return a + (b - a) * amount;
}
