import { INPUT_KEYS, type InputFrame, type InputKey } from "@midnight/shared";

/** A detection is a new occasion only after the input has been false this long. */
export const OCCASION_GAP_MS = 500;
export const OCCASIONS_NEEDED = 3;

export interface Checklist {
  update(frame: Readonly<InputFrame>, ts: number): void;
  reset(): void;
}

interface RowState {
  active: boolean;
  falseSince: number;
  count: number;
}

/** Pure counter behind the checklist rows; exported so it can be unit-tested. */
export class OccasionCounter {
  private readonly rows = new Map<InputKey, RowState>();
  constructor() {
    this.reset();
  }
  update(frame: Readonly<InputFrame>, ts: number): void {
    for (const k of INPUT_KEYS) {
      const r = this.rows.get(k) as RowState;
      if (frame[k]) {
        if (!r.active) {
          r.active = true;
          if (ts - r.falseSince >= OCCASION_GAP_MS) r.count++;
        }
      } else if (r.active) {
        r.active = false;
        r.falseSince = ts;
      }
    }
  }
  count(k: InputKey): number {
    return (this.rows.get(k) as RowState).count;
  }
  reset(): void {
    for (const k of INPUT_KEYS) this.rows.set(k, { active: false, falseSince: -Infinity, count: 0 });
  }
}

export function createChecklist(root: HTMLElement): Checklist {
  const counter = new OccasionCounter();
  const card = document.createElement("div");
  card.className = "card";
  const h = document.createElement("h2");
  h.textContent = "Checklist";
  card.append(h);

  const rows = INPUT_KEYS.map((k) => {
    const row = document.createElement("div");
    row.className = "row";
    const name = document.createElement("span");
    name.textContent = k;
    const dot = document.createElement("span");
    dot.className = "dot";
    const count = document.createElement("span");
    count.textContent = `0/${OCCASIONS_NEEDED}`;
    const box = document.createElement("input");
    box.type = "checkbox";
    box.disabled = true;
    row.append(name, dot, count, box);
    card.append(row);
    return { k, dot, count, box };
  });

  const reset = document.createElement("button");
  reset.textContent = "Reset";
  reset.style.marginTop = "10px";
  card.append(reset);
  root.replaceChildren(card);

  const render = (frame: Readonly<InputFrame>) => {
    for (const r of rows) {
      const n = counter.count(r.k);
      r.dot.toggleAttribute("data-on", frame[r.k]);
      r.count.textContent = `${Math.min(n, OCCASIONS_NEEDED)}/${OCCASIONS_NEEDED}`;
      r.box.checked = n >= OCCASIONS_NEEDED;
    }
  };

  const api: Checklist = {
    update(frame, ts) {
      counter.update(frame, ts);
      render(frame);
    },
    reset() {
      counter.reset();
      render({ left: false, right: false, jump: false, punchL: false, punchR: false, block: false, special: false, item: null });
    },
  };
  reset.addEventListener("click", () => api.reset());
  return api;
}
