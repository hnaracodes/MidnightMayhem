import { INPUT_KEYS } from "@midnight/shared";
import type { DebugFrame } from "../vision/VisionInputSource";
import type { Metrics } from "../vision/metrics";
import {
  DEPTH_ENTER_NO_HAND, DEPTH_EXIT, EXT_ENTER, EXT_EXIT, JUMP_LAND, JUMP_RISE,
  LEAN_ENTER, LEAN_EXIT, THRUST_DROP,
} from "../vision/thresholds";
import type { WorkerStats } from "../vision/workerClient";

export interface Panel {
  update(f: DebugFrame, stats: WorkerStats): void;
}

interface GaugeSpec {
  key: keyof Metrics;
  label: string;
  min: number;
  max: number;
  /** Enter thresholds drawn red, exit thresholds drawn white. */
  enter: number[];
  exit: number[];
  /** Which metric boolean lights the bar (optional). */
  on?: keyof Metrics;
}

const GAUGES: GaugeSpec[] = [
  { key: "lean", label: "lean", min: -0.6, max: 0.6, enter: [LEAN_ENTER, -LEAN_ENTER], exit: [LEAN_EXIT, -LEAN_EXIT] },
  { key: "riseHip", label: "riseHip", min: -0.1, max: 0.4, enter: [JUMP_RISE], exit: [JUMP_LAND] },
  { key: "riseShoulder", label: "riseShoulder", min: -0.1, max: 0.4, enter: [JUMP_RISE], exit: [JUMP_LAND] },
  { key: "extL", label: "extL", min: 0, max: 1.5, enter: [EXT_ENTER], exit: [EXT_EXIT] },
  { key: "extR", label: "extR", min: 0, max: 1.5, enter: [EXT_ENTER], exit: [EXT_EXIT] },
  { key: "depthL", label: "depthL (m)", min: -0.2, max: 0.8, enter: [DEPTH_ENTER_NO_HAND], exit: [DEPTH_EXIT] },
  { key: "depthR", label: "depthR (m)", min: -0.2, max: 0.8, enter: [DEPTH_ENTER_NO_HAND], exit: [DEPTH_EXIT] },
  { key: "dropL", label: "thrustL (ext drop)", min: 0, max: 0.6, enter: [THRUST_DROP], exit: [], on: "thrustL" },
  { key: "dropR", label: "thrustR (ext drop)", min: 0, max: 0.6, enter: [THRUST_DROP], exit: [], on: "thrustR" },
];

const BOOLS: (keyof Metrics)[] = ["crossed", "atHeightL", "atHeightR", "thrustL", "thrustR", "guard"];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function pct(v: number, min: number, max: number): number {
  return Math.max(0, Math.min(100, ((v - min) / (max - min)) * 100));
}

export function createPanel(root: HTMLElement): Panel {
  // Performance
  const perf = el("div", "card");
  perf.append(el("h2", undefined, "Performance"));
  const perfKv = el("div", "kv");
  const fps = el("span"), ms = el("span"), delegate = el("span"), dropped = el("span");
  for (const [k, v] of [["FPS", fps], ["pose ms", ms], ["delegate", delegate], ["dropped", dropped]] as const) {
    perfKv.append(el("span", undefined, k), v);
  }
  perf.append(perfKv);

  // Calibration
  const cal = el("div", "card");
  cal.append(el("h2", undefined, "Calibration"));
  const calKv = el("div", "kv");
  const phase = el("span"), progress = el("span");
  calKv.append(el("span", undefined, "phase"), phase, el("span", undefined, "progress"), progress);
  const baseKeys = ["S", "leanZero", "hipY", "shoulderY", "noseY", "eyeY", "armLen"] as const;
  const baseVals = new Map<string, HTMLSpanElement>();
  for (const k of baseKeys) {
    const v = el("span", undefined, "—");
    baseVals.set(k, v);
    calKv.append(el("span", undefined, k), v);
  }
  cal.append(calKv);

  // Indicators
  const ind = el("div", "card");
  ind.append(el("h2", undefined, "InputFrame"));
  const grid = el("div", "indicators");
  const indEls = new Map<string, HTMLDivElement>();
  for (const k of INPUT_KEYS) {
    const d = el("div", "ind", k);
    indEls.set(k, d);
    grid.append(d);
  }
  ind.append(grid);

  // Gauges
  const met = el("div", "card");
  met.append(el("h2", undefined, "Metrics"));
  const gauges = GAUGES.map((g) => {
    const wrap = el("div", "gauge");
    const label = el("div", "label");
    const name = el("span", undefined, g.label);
    const val = el("span", undefined, "—");
    label.append(name, val);
    const bar = el("div", "bar");
    const fill = el("div", "fill");
    bar.append(fill);
    for (const t of g.enter) {
      const m = el("div", "mark");
      m.style.left = `${pct(t, g.min, g.max)}%`;
      bar.append(m);
    }
    for (const t of g.exit) {
      const m = el("div", "mark exit");
      m.style.left = `${pct(t, g.min, g.max)}%`;
      bar.append(m);
    }
    wrap.append(label, bar);
    met.append(wrap);
    return { g, val, fill };
  });
  const boolRow = el("div");
  const boolEls = BOOLS.map((k) => {
    const b = el("span", "bool", k);
    boolRow.append(b);
    return { k, b };
  });
  met.append(boolRow);

  root.replaceChildren(perf, cal, ind, met);

  const zero = (g: GaugeSpec) => pct(0, g.min, g.max);

  return {
    update(f, stats) {
      fps.textContent = String(stats.fps);
      ms.textContent = stats.poseMs.toFixed(1);
      delegate.textContent = stats.delegate ?? "—";
      dropped.textContent = String(stats.dropped);

      phase.textContent = f.calibration.phase;
      progress.textContent = `${Math.round(f.calibration.progress * 100)}%`;
      const b = f.calibration.baseline;
      for (const k of baseKeys) {
        const v = baseVals.get(k);
        if (v) v.textContent = b ? b[k].toFixed(3) : "—";
      }

      for (const k of INPUT_KEYS) {
        const d = indEls.get(k);
        if (d) d.toggleAttribute("data-on", f.frame[k]);
      }

      const m = f.metrics;
      for (const { g, val, fill } of gauges) {
        if (!m) {
          val.textContent = "—";
          fill.style.left = `${zero(g)}%`;
          fill.style.width = "0%";
          fill.removeAttribute("data-on");
          continue;
        }
        const v = m[g.key] as number;
        val.textContent = v.toFixed(3);
        const z = zero(g);
        const p = pct(v, g.min, g.max);
        fill.style.left = `${Math.min(z, p)}%`;
        fill.style.width = `${Math.abs(p - z)}%`;
        fill.toggleAttribute("data-on", g.on ? (m[g.on] as boolean) : false);
      }
      for (const { k, b } of boolEls) b.toggleAttribute("data-on", m ? (m[k] as boolean) : false);
    },
  };
}
