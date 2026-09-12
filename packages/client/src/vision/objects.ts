/**
 * Held-item detection (9.04): turns detector boxes plus the wrist landmarks into an ItemId, then debounces it.
 * Pure apart from the HoldTracker's own state; never touches MediaPipe or the DOM.
 */
import { ITEM_IDS, ITEMS, type ItemId } from "@midnight/shared";
import { HOLD_OFF_MS, HOLD_ON, HOLD_RADIUS } from "./thresholds";
import type { Landmark, ObjectBox } from "./workerClient";

const BY_COCO: ReadonlyMap<string, ItemId> = new Map(ITEM_IDS.map((id) => [ITEMS[id].cocoLabel, id]));

/** The item behind a COCO label ("bottle" → molotov), or null for any other label. */
export function cocoToItem(label: string): ItemId | null {
  return BY_COCO.get(label) ?? null;
}

const contains = (b: ObjectBox, p: Landmark): boolean =>
  p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;

/**
 * The highest-scoring item box that is "held": its centre within HOLD_RADIUS · S of wrist 15 or 16, or
 * the wrist inside the box. Boxes with non-item labels are ignored. Null when nothing is held.
 */
export function heldItem(objects: ObjectBox[], landmarks: Landmark[], S: number): ItemId | null {
  const wrists = [landmarks[15], landmarks[16]].filter((w): w is Landmark => w !== undefined);
  if (wrists.length === 0) return null;
  const radius = HOLD_RADIUS * S;
  let best: { item: ItemId; score: number } | null = null;
  for (const b of objects) {
    const item = cocoToItem(b.label);
    if (!item) continue;
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    const held = wrists.some((w) => Math.hypot(cx - w.x, cy - w.y) <= radius || contains(b, w));
    if (!held) continue;
    if (!best || b.score > best.score) best = { item, score: b.score };
  }
  return best?.item ?? null;
}

/**
 * Debounce for held items: HOLD_ON consecutive equal candidates turn an item on; it then stays on while
 * any positive for it arrives within HOLD_OFF_MS; a different item needs its own HOLD_ON run (the current
 * one holds until it times out or the new one wins). A null candidate breaks any pending run.
 */
export class HoldTracker {
  private current: ItemId | null = null;
  private lastPositive = 0;
  private candidate: ItemId | null = null;
  private run = 0;

  update(candidate: ItemId | null, ts: number): ItemId | null {
    if (candidate === null) {
      this.candidate = null;
      this.run = 0;
    } else {
      if (candidate === this.candidate) this.run++;
      else {
        this.candidate = candidate;
        this.run = 1;
      }
      if (candidate === this.current) {
        this.lastPositive = ts;
      } else if (this.run >= HOLD_ON) {
        this.current = candidate;
        this.lastPositive = ts;
      }
    }
    if (this.current !== null && ts - this.lastPositive >= HOLD_OFF_MS) this.current = null;
    return this.current;
  }

  reset(): void {
    this.current = null;
    this.lastPositive = 0;
    this.candidate = null;
    this.run = 0;
  }
}
