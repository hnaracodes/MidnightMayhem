import { Sfx, type Recipe, type SfxName } from "../game/sfx";

/**
 * Dev-only preview for 9.06 (`dev/sfx.html`, not a build input). Lists every `SfxName` with a play button, and
 * "dumps" a sound by running its recipe against a recording `OfflineAudioContext`: which nodes it created, when each
 * source starts and stops, the rendered peak and RMS. `window.__sfx` drives it headlessly so an agent can check the
 * dump without ears.
 */

export interface NodeRecord { kind: string; start?: number; stop?: number; type?: string; loop?: boolean }
export interface SfxDump {
  name: SfxName;
  /** What the recipe returned. */
  duration: number;
  /** Seconds actually rendered offline (loops are capped). */
  rendered: number;
  nodes: NodeRecord[];
  nodeCount: number;
  sourceCount: number;
  peak: number;
  rms: number;
  /** Seconds from t0 until the rendered signal last exceeds -60 dBFS. */
  lastAudible: number;
}

interface SfxDriver {
  sfx: Sfx;
  names: SfxName[];
  play(name: SfxName, pan?: number): void;
  dump(name: SfxName): Promise<SfxDump>;
  dumpAll(): Promise<SfxDump[]>;
  setMuted(muted: boolean): void;
}

declare global {
  interface Window { __sfx: SfxDriver }
}

const SAMPLE_RATE = 48_000;
const LOOP_RENDER_SECONDS = 2;
const T0 = 0.05;

/** Wrap an offline context so every created node and every source start/stop is recorded. */
function recordingContext(ctx: OfflineAudioContext, into: NodeRecord[]): BaseAudioContext {
  return new Proxy(ctx, {
    get(target, prop) {
      const value = Reflect.get(target, prop, target) as unknown;
      if (typeof value !== "function") return value;
      const fn = value as (...args: unknown[]) => unknown;
      return (...args: unknown[]) => {
        const result = fn.apply(target, args);
        if (typeof prop === "string" && prop.startsWith("create") && prop !== "createBuffer") {
          const record: NodeRecord = { kind: prop.slice(6) };
          into.push(record);
          const node = result as AudioScheduledSourceNode & { type?: string; loop?: boolean };
          if (typeof node.start === "function") {
            const start = node.start.bind(node);
            const stop = node.stop.bind(node);
            node.start = (when?: number) => {
              record.start = when ?? target.currentTime;
              if (node.type !== undefined) record.type = node.type;
              if (node.loop !== undefined) record.loop = node.loop;
              start(when);
            };
            node.stop = (when?: number) => { record.stop = when ?? target.currentTime; stop(when); };
          }
        }
        return result;
      };
    },
  });
}

async function dumpSound(name: SfxName): Promise<SfxDump> {
  const recipe: Recipe = Sfx.RECIPES[name];
  // A first pass on a throwaway context to learn the duration, then render for that long (plus a tail).
  const probe = new OfflineAudioContext(1, SAMPLE_RATE, SAMPLE_RATE);
  const duration = recipe(probe, probe.destination, T0);
  const rendered = Math.min(duration, name.startsWith("fire_loop") ? LOOP_RENDER_SECONDS : 8) + T0 + 0.3;
  const ctx = new OfflineAudioContext(1, Math.ceil(rendered * SAMPLE_RATE), SAMPLE_RATE);
  const nodes: NodeRecord[] = [];
  const out = ctx.createGain();
  out.gain.value = 0.6; // the master gain, so peak reflects what the game plays
  out.connect(ctx.destination);
  recipe(recordingContext(ctx, nodes), out, T0);
  const buffer = await ctx.startRendering();
  const data = buffer.getChannelData(0);
  let peak = 0;
  let sum = 0;
  let lastAudible = 0;
  const floor = Math.pow(10, -60 / 20);
  for (let i = 0; i < data.length; i++) {
    const v = Math.abs(data[i]!);
    if (v > peak) peak = v;
    sum += v * v;
    if (v > floor) lastAudible = i;
  }
  const sources = nodes.filter((n) => n.start !== undefined);
  return {
    name, duration, rendered, nodes, nodeCount: nodes.length, sourceCount: sources.length,
    peak, rms: Math.sqrt(sum / data.length), lastAudible: Math.max(0, lastAudible / SAMPLE_RATE - T0),
  };
}

function fmt(n: number): string { return n.toFixed(3); }

/** The recipe's declared duration, learned on a throwaway offline context. */
function durationOf(name: SfxName): number {
  const probe = new OfflineAudioContext(1, 1, SAMPLE_RATE);
  return Sfx.RECIPES[name](probe, probe.destination, 0);
}

function main(): void {
  const sfx = new Sfx();
  const names = Object.keys(Sfx.RECIPES) as SfxName[];
  const tbody = document.querySelector<HTMLTableSectionElement>("#sounds tbody")!;
  const log = document.querySelector<HTMLPreElement>("#log")!;
  const status = document.querySelector<HTMLSpanElement>("#status")!;
  const panInput = document.querySelector<HTMLInputElement>("#pan")!;
  const muteInput = document.querySelector<HTMLInputElement>("#mute")!;
  const rows = new Map<SfxName, HTMLTableRowElement>();

  const logLine = (text: string) => { log.textContent = `${text}\n${log.textContent ?? ""}`.slice(0, 20_000); };

  const showDump = (d: SfxDump) => {
    const row = rows.get(d.name)!;
    const cells = row.querySelectorAll("td");
    cells[2]!.textContent = fmt(d.duration);
    cells[3]!.textContent = String(d.nodeCount);
    cells[4]!.textContent = String(d.sourceCount);
    cells[5]!.textContent = fmt(d.peak);
    cells[6]!.textContent = fmt(d.rms);
    cells[5]!.classList.toggle("warn", d.peak > 0.99 || d.peak < 0.01);
    const lines = d.nodes.map((n) => `  ${n.kind}${n.type ? `:${n.type}` : ""}${n.loop ? " loop" : ""}${n.start !== undefined ? ` ${fmt(n.start - T0)}→${n.stop !== undefined ? fmt(n.stop - T0) : "…"}` : ""}`);
    const text = `${d.name}: duration ${fmt(d.duration)} s, rendered ${fmt(d.rendered)} s, ${d.nodeCount} nodes (${d.sourceCount} sources), peak ${fmt(d.peak)}, rms ${fmt(d.rms)}, audible until ${fmt(d.lastAudible)} s\n${lines.join("\n")}`;
    console.log(text);
    logLine(text);
  };

  const play = (name: SfxName, pan = Number(panInput.value)) => {
    sfx.play(name, { pan });
    const row = rows.get(name)!;
    row.classList.add("playing");
    setTimeout(() => row.classList.remove("playing"), Math.min(2.5, Math.max(0.3, durationOf(name))) * 1000);
  };

  for (const name of names) {
    const row = document.createElement("tr");
    row.innerHTML = `<td><button data-play>▶</button></td><td>${name}</td><td class="num">–</td><td class="num">–</td><td class="num">–</td><td class="num">–</td><td class="num">–</td><td><button data-dump>dump</button></td>`;
    row.querySelector<HTMLButtonElement>("[data-play]")!.addEventListener("click", () => play(name));
    row.querySelector<HTMLButtonElement>("[data-dump]")!.addEventListener("click", () => { void dumpSound(name).then(showDump); });
    tbody.append(row);
    rows.set(name, row);
  }

  const dumpAll = async (): Promise<SfxDump[]> => {
    const out: SfxDump[] = [];
    for (const name of names) {
      status.textContent = `rendering ${name}…`;
      const d = await dumpSound(name);
      showDump(d);
      out.push(d);
    }
    status.textContent = `${out.length} sounds dumped`;
    console.table(out.map((d) => ({ name: d.name, duration: d.duration, nodes: d.nodeCount, sources: d.sourceCount, peak: +fmt(d.peak), rms: +fmt(d.rms), audible: +fmt(d.lastAudible) })));
    return out;
  };

  const playAll = () => {
    let t = 0;
    for (const name of names) {
      setTimeout(() => play(name), t);
      t += (name === "fire_loop_start" ? 1.5 : Math.min(2.5, Math.max(0.3, durationOf(name)))) * 1000 + 150;
    }
  };

  document.querySelector<HTMLButtonElement>("#play-all")!.addEventListener("click", playAll);
  document.querySelector<HTMLButtonElement>("#dump-all")!.addEventListener("click", () => { void dumpAll(); });
  muteInput.checked = sfx.muted;
  muteInput.addEventListener("change", () => sfx.setMuted(muteInput.checked));
  window.addEventListener("keydown", (e) => {
    if (e.code === "KeyM") { sfx.setMuted(!sfx.muted); muteInput.checked = sfx.muted; }
  });

  window.__sfx = {
    sfx, names, play, dump: dumpSound, dumpAll,
    setMuted: (m) => { sfx.setMuted(m); muteInput.checked = m; },
  };
}

main();
