import { INPUT_KEYS } from "@midnight/shared";
import type { DebugFrame, PunchDiag, RecorderSample } from "../vision/VisionInputSource";
import type { Metrics } from "../vision/metrics";
import {
  AT_HEIGHT, DEPTH_ENTER_NO_HAND, DEPTH_EXIT, EXT_ENTER, EXT_EXIT, JAB_EXIT, JAB_EXT, JAB_RISE, JAB_WINDOW_MS,
  JUMP_LAND, JUMP_RISE, LEAN_ENTER, LEAN_EXIT, RECORDER_SECONDS, SIDE_JAB_ENABLED, THRUST_DROP, THRUST_ENABLED,
  THRUST_WINDOW_MS,
} from "../vision/thresholds";
import type { WorkerStats } from "../vision/workerClient";

export interface Panel {
  update(f: DebugFrame, stats: WorkerStats): void;
}

export interface PanelOptions {
  /** The recorder behind the "Copy last N s" and "Download JSON" buttons. */
  dump?: () => RecorderSample[];
}

/** One punch gate row: its label, live value text and whether it passes. Exported for tests. */
export interface GateRow {
  label: string;
  value: string;
  pass: boolean;
}

/** The gate rows for one arm, in the order the entry rule ANDs them, then the jab alternative and the outputs. */
export function punchGateRows(d: PunchDiag): GateRow[] {
  const rows: GateRow[] = [
    { label: "ext", value: `${d.ext.toFixed(2)} < ${EXT_ENTER}`, pass: d.extOk },
    { label: "depth", value: `${d.depth.toFixed(2)} > ${DEPTH_ENTER_NO_HAND} m`, pass: d.depthOk },
    { label: "atHeight", value: `|dy| < ${AT_HEIGHT} S`, pass: d.atHeight },
    {
      label: "thrust",
      value: THRUST_ENABLED ? `drop ${d.drop.toFixed(2)} >= ${THRUST_DROP} in ${THRUST_WINDOW_MS} ms` : "disabled",
      pass: d.thrustOk,
    },
  ];
  if (SIDE_JAB_ENABLED) {
    rows.push({
      label: "jab",
      value: `side ${d.side.toFixed(2)} > ${JAB_EXT}, rise ${d.jabRise.toFixed(2)} >= ${JAB_RISE} in ${JAB_WINDOW_MS} ms`,
      pass: d.jabOk,
    });
  }
  rows.push(
    { label: "active", value: d.path ? `via ${d.path}` : "—", pass: d.active },
    { label: "out", value: d.out ? "PUNCH" : "—", pass: d.out },
  );
  return rows;
}

const IDLE_DIAG: PunchDiag = {
  ext: 0, depth: 0, drop: 0, atHeight: false, extOk: false, depthOk: false, thrustOk: false, jabOk: false,
  active: false, out: false, side: 0, jabRise: 0, path: null,
};

/** One line naming the first failing gate on each entry path, or what the punch is doing. Exported for tests. */
export function punchWhyNot(d: PunchDiag): string {
  if (d.out) return `punching via ${d.path ?? "hold"}`;
  if (d.active) return `entered via ${d.path}, waiting on debounce`;
  const thrustFail = !d.extOk
    ? `ext ${d.ext.toFixed(2)} >= ${EXT_ENTER}`
    : !d.depthOk
      ? `depth ${d.depth.toFixed(2)} <= ${DEPTH_ENTER_NO_HAND}`
      : !d.atHeight
        ? "wrist off shoulder height"
        : !d.thrustOk
          ? `drop ${d.drop.toFixed(2)} < ${THRUST_DROP}`
          : null;
  const jabFail = !SIDE_JAB_ENABLED
    ? "disabled"
    : !d.atHeight
      ? "wrist off shoulder height"
      : d.side <= JAB_EXT
        ? `side ${d.side.toFixed(2)} <= ${JAB_EXT}`
        : d.jabRise < JAB_RISE
          ? `rise ${d.jabRise.toFixed(2)} < ${JAB_RISE}`
          : null;
  const t = thrustFail ? `thrust fails at ${thrustFail}` : "thrust path ok";
  const j = jabFail ? `jab fails at ${jabFail}` : "jab path ok";
  return `${t}; ${j}`;
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
  { key: "sideL", label: "sideL (jab)", min: -0.6, max: 1.4, enter: [JAB_EXT], exit: [JAB_EXIT] },
  { key: "sideR", label: "sideR (jab)", min: -0.6, max: 1.4, enter: [JAB_EXT], exit: [JAB_EXIT] },
  { key: "jabRiseL", label: "jabRiseL (side rise)", min: 0, max: 1.2, enter: [JAB_RISE], exit: [] },
  { key: "jabRiseR", label: "jabRiseR (side rise)", min: 0, max: 1.2, enter: [JAB_RISE], exit: [] },
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

export function createPanel(root: HTMLElement, opts: PanelOptions = {}): Panel {
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

  // Punch gates, one column per arm
  const punch = el("div", "card");
  punch.append(el("h2", undefined, "Punch gates"));
  const armGrid = el("div", "arms");
  const arms = (["L", "R"] as const).map((arm) => {
    const col = el("div", "arm");
    col.append(el("h3", undefined, arm === "L" ? "Left arm" : "Right arm"));
    const rowsEl = el("div", "gates");
    const why = el("div", "why", "—");
    col.append(rowsEl, why);
    armGrid.append(col);
    return { arm, rowsEl, why, rows: [] as { row: HTMLDivElement; val: HTMLSpanElement; res: HTMLSpanElement }[] };
  });
  punch.append(armGrid);

  // Recorder
  const rec = el("div", "recorder");
  const copyBtn = el("button", undefined, `Copy last ${RECORDER_SECONDS} s`);
  copyBtn.id = "rec-copy";
  const dlBtn = el("button", undefined, "Download JSON");
  dlBtn.id = "rec-download";
  const recStatus = el("span", "rec-status", "");
  rec.append(copyBtn, dlBtn, recStatus);
  punch.append(rec);
  const samples = () => opts.dump?.() ?? [];
  const say = (t: string) => {
    recStatus.textContent = t;
  };
  copyBtn.addEventListener("click", () => {
    const list = samples();
    navigator.clipboard
      .writeText(JSON.stringify(list))
      .then(() => say(`copied ${list.length} samples`))
      .catch((e: unknown) => say(`copy failed: ${String(e)}`));
  });
  dlBtn.addEventListener("click", () => {
    const list = samples();
    const blob = new Blob([JSON.stringify(list)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = el("a");
    a.href = url;
    a.download = `vision-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    say(`downloaded ${list.length} samples`);
  });

  root.replaceChildren(perf, cal, ind, punch, met);

  function renderArm(a: (typeof arms)[number], d: PunchDiag | undefined): void {
    // Rows are laid out even before calibration so the owner sees which gates exist; values fill in when ready.
    const gates = punchGateRows(d ?? IDLE_DIAG);
    if (a.rows.length !== gates.length) {
      a.rowsEl.replaceChildren();
      a.rows = gates.map((g) => {
        const row = el("div", "gate");
        const name = el("span", "name", g.label);
        const val = el("span", "val");
        const res = el("span", "res");
        row.append(name, val, res);
        a.rowsEl.append(row);
        return { row, val, res };
      });
    }
    gates.forEach((g, i) => {
      const r = a.rows[i];
      if (!r) return;
      r.val.textContent = d ? g.value : "—";
      r.res.textContent = d ? (g.pass ? "PASS" : "FAIL") : "—";
      r.row.toggleAttribute("data-pass", g.pass);
      r.row.toggleAttribute("data-idle", !d);
    });
    a.why.textContent = d ? punchWhyNot(d) : "not ready";
  }

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

      for (const a of arms) renderArm(a, f.punch?.[a.arm]);
    },
  };
}
