import type { Baseline } from "./calibration";
import { RingBuffer } from "./filters";
import { AT_HEIGHT, BLOCK_TOP, BLOCK_WIDTH, CROSS_MARGIN, THRUST_DROP, THRUST_WINDOW_MS } from "./thresholds";
import type { Landmark } from "./workerClient";

/** Named numbers behind every gesture. Image distances are in units of S; depth is metres. */
export interface Metrics {
  /** Shoulder-over-hip offset relative to rest; positive = leaning screen-right. */
  lean: number;
  /** How far the hips are above their rest height. */
  riseHip: number;
  /** How far the shoulders are above their rest height. */
  riseShoulder: number;
  /** Mirrored shoulder midpoint x, image units. */
  midX: number;
  /** Arms crossed in front of the chest. */
  crossed: boolean;
  /** Wrist-to-shoulder image distance over arm length; ~1 hanging, small when pointing at the camera. */
  extL: number;
  extR: number;
  /** Wrist ahead of shoulder, metres, positive toward the camera. */
  depthL: number;
  depthR: number;
  /** Wrist within AT_HEIGHT of shoulder height. */
  atHeightL: boolean;
  atHeightR: boolean;
  /** Extension fell by at least THRUST_DROP within THRUST_WINDOW_MS. */
  thrustL: boolean;
  thrustR: boolean;
  /** The extension drop behind thrustL / thrustR, for the harness gauge. */
  dropL: number;
  dropR: number;
  /** ARMS-style guard; always false until the hands plan. */
  guard: false;
}

/** Ring buffers computeMetrics needs across frames. One set per VisionInputSource. */
export interface MetricBuffers {
  extL: RingBuffer<number>;
  extR: RingBuffer<number>;
}

export function createMetricBuffers(): MetricBuffers {
  return { extL: new RingBuffer<number>(THRUST_WINDOW_MS), extR: new RingBuffer<number>(THRUST_WINDOW_MS) };
}

export function clearMetricBuffers(b: MetricBuffers): void {
  b.extL.clear();
  b.extR.clear();
}

const xm = (l: Landmark) => 1 - l.x;
const dist2D = (a: Landmark, b: Landmark) => Math.hypot(a.x - b.x, a.y - b.y);

function arm(
  landmarks: Landmark[],
  world: Landmark[],
  shoulderIdx: number,
  wristIdx: number,
  baseline: Baseline,
  ts: number,
  buffer: RingBuffer<number>,
): { ext: number; depth: number; atHeight: boolean; thrust: boolean; drop: number } {
  const shoulder = landmarks[shoulderIdx] as Landmark;
  const wrist = landmarks[wristIdx] as Landmark;
  const ext = dist2D(wrist, shoulder) / baseline.armLen;
  const ws = world[shoulderIdx];
  const ww = world[wristIdx];
  const depth = ws && ww ? ws.z - ww.z : 0;
  const atHeight = Math.abs(wrist.y - shoulder.y) < AT_HEIGHT * baseline.S;
  buffer.push(ts, ext);
  const drop = buffer.maxDropWithin(THRUST_WINDOW_MS);
  return { ext, depth, atHeight, thrust: drop >= THRUST_DROP, drop };
}

/** Pure apart from the ring buffers passed in. Call once per smoothed frame while calibration is ready. */
export function computeMetrics(
  landmarks: Landmark[],
  world: Landmark[],
  baseline: Baseline,
  ts: number,
  buffers: MetricBuffers,
): Metrics {
  const S = baseline.S;
  const ls = landmarks[11] as Landmark;
  const rs = landmarks[12] as Landmark;
  const lh = landmarks[23] as Landmark;
  const rh = landmarks[24] as Landmark;
  const lw = landmarks[15] as Landmark;
  const rw = landmarks[16] as Landmark;

  const midX = (xm(ls) + xm(rs)) / 2;
  const hipMidX = (xm(lh) + xm(rh)) / 2;
  const lean = (midX - hipMidX - baseline.leanZero) / S;
  const riseHip = (baseline.hipY - (lh.y + rh.y) / 2) / S;
  const riseShoulder = (baseline.shoulderY - (ls.y + rs.y) / 2) / S;

  const top = baseline.shoulderY - BLOCK_TOP * S;
  const inBand = (w: Landmark) => w.y > top && w.y < baseline.hipY && Math.abs(xm(w) - midX) < BLOCK_WIDTH * S;
  const crossed =
    xm(lw) > midX + CROSS_MARGIN * S && xm(rw) < midX - CROSS_MARGIN * S && inBand(lw) && inBand(rw);

  const L = arm(landmarks, world, 11, 15, baseline, ts, buffers.extL);
  const R = arm(landmarks, world, 12, 16, baseline, ts, buffers.extR);

  return {
    lean,
    riseHip,
    riseShoulder,
    midX,
    crossed,
    extL: L.ext,
    extR: R.ext,
    depthL: L.depth,
    depthR: R.depth,
    atHeightL: L.atHeight,
    atHeightR: R.atHeight,
    thrustL: L.thrust,
    thrustR: R.thrust,
    dropL: L.drop,
    dropR: R.drop,
    guard: false,
  };
}
