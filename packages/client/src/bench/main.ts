/**
 * Detector benchmark page (9.07). Loads both ObjectBackends in the MAIN thread (bench only; the game keeps the
 * worker) and runs each, on CPU and GPU, over the same frame set. Reports model load, median / p90 inference,
 * effective fps at the game's cadence, detections per frame and per-label hit rate. Results render as a table,
 * land on `window.__bench.results`, print to the console as one JSON line and are copied to the clipboard.
 */
import { ITEMS } from "@midnight/shared";
import { createMediapipeBackend } from "../vision/backends/mediapipe";
import type { DetectorId, ObjectBackend } from "../vision/backends/ObjectBackend";
import { createYoloBackend } from "../vision/backends/yolo";
import { OBJECT_EVERY_N, YOLO_EVERY_N, YOLO_INPUT, YOLO_MODEL_URL } from "../vision/thresholds";
import type { ObjectBox } from "../vision/workerClient";
import { drawFixture, FIXTURE_HEIGHT, FIXTURE_WIDTH, fixtureSpecs, type FixtureSpec } from "./fixtures";

/** Pose rate the game's EVERY_N is measured against (the camera is requested at 30 fps). */
const POSE_FPS = 30;
const CAMERA_FRAMES = 10;
const WARMUP = 2;
const LABELS = Object.values(ITEMS).map((i) => i.cocoLabel);

type FrameSet = "camera" | "fixtures" | "real";

interface Frame {
  set: FrameSet;
  /** Expected label for fixtures and real photos; null for the camera pattern. */
  label: string | null;
  bitmap: ImageBitmap;
}

export interface RunResult {
  backend: DetectorId;
  delegate: "CPU" | "GPU";
  provider: string;
  loadMs: number;
  medianMs: number;
  p90Ms: number;
  meanMs: number;
  /** 1000 / median: how many detections per second the backend could sustain alone. */
  inferenceFps: number;
  /** The game runs the detector every N pose frames at ~30 pose fps. */
  everyN: number;
  gameCadenceFps: number;
  /** min(inferenceFps, gameCadenceFps): what the game would actually get. */
  effectiveFps: number;
  detectionsPerFrame: number;
  /** Over labelled frames (fixtures + real): the frame's label appears among its boxes. */
  hitRate: number;
  hits: number;
  labelled: number;
  perLabel: Record<string, { hits: number; total: number }>;
  /** Hit rate split by set: the fixtures are a smoke set, the real photos are what the verdict should weigh. */
  bySet: Record<"fixtures" | "real", { hits: number; total: number }>;
  /** Detections on the camera pattern (expected 0). */
  cameraDetections: number;
  frames: Record<FrameSet, number>;
  error: string | null;
}

const $ = <T extends HTMLElement>(id: string): T => {
  const e = document.getElementById(id);
  if (!e) throw new Error(`missing #${id}`);
  return e as T;
};
const status = $("status");
const tbody = $("results").querySelector("tbody") as HTMLTableSectionElement;
const framesEl = $("frames");
const jsonEl = $("json");

const bench: { results: RunResult[]; done: boolean; error: string | null; frames: Record<FrameSet, number> } = {
  results: [], done: false, error: null, frames: { camera: 0, fixtures: 0, real: 0 },
};
(window as unknown as { __bench: typeof bench }).__bench = bench;

function say(t: string, error = false): void {
  status.textContent = t;
  status.toggleAttribute("data-error", error);
}

function percentile(xs: number[], p: number): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))] as number;
}

// ---- frame sets ----

async function cameraFrames(): Promise<Frame[]> {
  if (!navigator.mediaDevices?.getUserMedia) return [];
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
  } catch (err) {
    console.warn("[bench] camera unavailable, skipping the camera set", err);
    return [];
  }
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  await video.play();
  await new Promise<void>((r) => {
    if (video.readyState >= 2) r();
    else video.onloadeddata = () => r();
  });
  const frames: Frame[] = [];
  for (let i = 0; i < CAMERA_FRAMES; i++) {
    frames.push({ set: "camera", label: null, bitmap: await createImageBitmap(video) });
    await new Promise((r) => setTimeout(r, 100));
  }
  stream.getTracks().forEach((t) => t.stop());
  return frames;
}

async function fixtureFrames(): Promise<Frame[]> {
  const canvas = new OffscreenCanvas(FIXTURE_WIDTH, FIXTURE_HEIGHT);
  const ctx = canvas.getContext("2d");
  if (!ctx) return [];
  const frames: Frame[] = [];
  for (const spec of fixtureSpecs()) {
    drawFixture(ctx, spec);
    frames.push({ set: "fixtures", label: spec.label, bitmap: await createImageBitmap(canvas) });
  }
  return frames;
}

/** Photos the owner dropped into public/bench/: `<label>-NN.jpg|png`, NN 01..20. Probed, never listed. */
async function realFrames(): Promise<Frame[]> {
  const frames: Frame[] = [];
  const probes: Promise<void>[] = [];
  for (const label of LABELS) {
    const slug = label.replace(/\s+/g, "-");
    for (let n = 1; n <= 20; n++) {
      for (const ext of ["jpg", "png"]) {
        const url = `/bench/${slug}-${String(n).padStart(2, "0")}.${ext}`;
        probes.push((async () => {
          try {
            const res = await fetch(url);
            if (!res.ok || !(res.headers.get("content-type") ?? "").startsWith("image/")) return;
            const bitmap = await createImageBitmap(await res.blob());
            frames.push({ set: "real", label, bitmap });
          } catch { /* not there */ }
        })());
      }
    }
  }
  await Promise.all(probes);
  return frames;
}

function showFrames(frames: Frame[]): void {
  framesEl.replaceChildren();
  const sample = [...frames.filter((f) => f.set === "camera").slice(0, 2), ...frames.filter((f) => f.set !== "camera").filter((_, i) => i % 5 === 0)];
  for (const f of sample) {
    const c = document.createElement("canvas");
    c.width = f.bitmap.width;
    c.height = f.bitmap.height;
    c.getContext("2d")?.drawImage(f.bitmap, 0, 0);
    c.title = `${f.set}${f.label ? ` · ${f.label}` : ""}`;
    framesEl.append(c);
  }
}

// ---- runs ----

function makeBackend(id: DetectorId): ObjectBackend {
  return id === "yolo"
    ? createYoloBackend({ modelUrl: YOLO_MODEL_URL, inputSize: YOLO_INPUT })
    : createMediapipeBackend();
}

async function runOne(id: DetectorId, delegate: "CPU" | "GPU", frames: Frame[]): Promise<RunResult> {
  const everyN = id === "yolo" ? YOLO_EVERY_N : OBJECT_EVERY_N;
  const perLabel: Record<string, { hits: number; total: number }> = Object.fromEntries(LABELS.map((l) => [l, { hits: 0, total: 0 }]));
  const result: RunResult = {
    backend: id, delegate, provider: "", loadMs: 0, medianMs: 0, p90Ms: 0, meanMs: 0, inferenceFps: 0, everyN,
    gameCadenceFps: POSE_FPS / everyN, effectiveFps: 0, detectionsPerFrame: 0, hitRate: 0, hits: 0, labelled: 0,
    perLabel, bySet: { fixtures: { hits: 0, total: 0 }, real: { hits: 0, total: 0 } }, cameraDetections: 0,
    frames: bench.frames, error: null,
  };
  const backend = makeBackend(id);
  try {
    say(`${id} / ${delegate}: loading…`);
    const t0 = performance.now();
    await backend.init(delegate);
    result.loadMs = performance.now() - t0;
    result.provider = backend.provider;
    let ts = 1;
    for (let i = 0; i < WARMUP && frames[i]; i++) await backend.detect((frames[i] as Frame).bitmap, ts++);
    const times: number[] = [];
    let detections = 0;
    for (const [i, f] of frames.entries()) {
      say(`${id} / ${delegate}: frame ${i + 1} / ${frames.length}`);
      const boxes: ObjectBox[] = await backend.detect(f.bitmap, ts++);
      times.push(backend.lastMs);
      detections += boxes.length;
      if (f.set === "camera") result.cameraDetections += boxes.length;
      if (f.label) {
        result.labelled++;
        const p = perLabel[f.label] as { hits: number; total: number };
        const set = result.bySet[f.set === "real" ? "real" : "fixtures"];
        p.total++;
        set.total++;
        if (boxes.some((b) => b.label === f.label)) {
          p.hits++;
          set.hits++;
          result.hits++;
        }
      }
    }
    result.medianMs = percentile(times, 0.5);
    result.p90Ms = percentile(times, 0.9);
    result.meanMs = times.reduce((a, b) => a + b, 0) / Math.max(1, times.length);
    result.inferenceFps = result.medianMs > 0 ? 1000 / result.medianMs : 0;
    result.effectiveFps = Math.min(result.inferenceFps, result.gameCadenceFps);
    result.detectionsPerFrame = detections / Math.max(1, frames.length);
    result.hitRate = result.labelled > 0 ? result.hits / result.labelled : 0;
  } catch (err) {
    result.error = err instanceof Error ? `${err.message}${err.cause ? ` (${String(err.cause)})` : ""}` : String(err);
    console.warn(`[bench] ${id} / ${delegate} failed`, err);
  } finally {
    backend.dispose();
  }
  return result;
}

function render(): void {
  tbody.replaceChildren();
  for (const r of bench.results) {
    const tr = document.createElement("tr");
    const cells: (string | { t: string; cls?: string })[] = r.error
      ? [r.backend, r.delegate, r.provider || "—", { t: `failed: ${r.error}`, cls: "err" }]
      : [
        r.backend, r.delegate, r.provider, r.loadMs.toFixed(0), r.medianMs.toFixed(1), r.p90Ms.toFixed(1),
        r.inferenceFps.toFixed(1), `${r.gameCadenceFps.toFixed(1)} (1/${r.everyN})`, r.effectiveFps.toFixed(1),
        r.detectionsPerFrame.toFixed(2),
        `${(r.hitRate * 100).toFixed(0)} % (${r.hits}/${r.labelled}) · fixtures ${r.bySet.fixtures.hits}/${r.bySet.fixtures.total} · real ${r.bySet.real.hits}/${r.bySet.real.total}`,
        Object.entries(r.perLabel).map(([l, p]) => `${l} ${p.hits}/${p.total}`).join(" · "),
      ];
    for (const c of cells) {
      const td = document.createElement("td");
      td.textContent = typeof c === "string" ? c : c.t;
      if (typeof c !== "string" && c.cls) td.className = c.cls;
      if (typeof c !== "string" && c.cls === "err") td.colSpan = 9;
      tr.append(td);
    }
    tbody.append(tr);
  }
  jsonEl.textContent = JSON.stringify(bench.results, null, 2);
}

async function runAll(): Promise<void> {
  bench.done = false;
  bench.error = null;
  bench.results = [];
  render();
  try {
    say("building frame sets…");
    const frames = [...(await cameraFrames()), ...(await fixtureFrames()), ...(await realFrames())];
    bench.frames = {
      camera: frames.filter((f) => f.set === "camera").length,
      fixtures: frames.filter((f) => f.set === "fixtures").length,
      real: frames.filter((f) => f.set === "real").length,
    };
    showFrames(frames);
    for (const id of ["mediapipe", "yolo"] as const) {
      for (const delegate of ["CPU", "GPU"] as const) {
        bench.results.push(await runOne(id, delegate, frames));
        render();
      }
    }
    for (const f of frames) f.bitmap.close();
    say(`done · frames: camera ${bench.frames.camera}, fixtures ${bench.frames.fixtures}, real ${bench.frames.real}`);
    console.log(`__bench ${JSON.stringify({ frames: bench.frames, results: bench.results })}`);
    await navigator.clipboard?.writeText(JSON.stringify(bench.results)).catch(() => {});
  } catch (err) {
    bench.error = String(err);
    say(`failed: ${String(err)}`, true);
    console.error("[bench]", err);
  } finally {
    bench.done = true;
  }
}

$("run").addEventListener("click", () => void runAll());
$("copy").addEventListener("click", () => {
  void navigator.clipboard.writeText(JSON.stringify(bench.results)).then(() => say("copied"), (e: unknown) => say(`copy failed: ${String(e)}`, true));
});
void runAll();
