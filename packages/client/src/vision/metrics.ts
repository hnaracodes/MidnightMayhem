import type { Baseline } from "./calibration";
import { RingBuffer } from "./filters";
import {
  AT_HEIGHT, BLOCK_TOP, BLOCK_WIDTH, CROSS_MARGIN, JAB_WINDOW_MS, THRUST_DROP, THRUST_WINDOW_MS,
} from "./thresholds";
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
  /** The raw-extension drop behind thrustL / thrustR, for the harness gauge. */
  dropL: number;
  dropR: number;
  /**
   * Side-jab metric (integrator amendment): the wrist's horizontal offset away from the body past its own
   * shoulder, over arm length. ~0 hanging, ~1 with the arm straight out sideways, negative when crossed.
   */
  sideL: number;
  sideR: number;
  /** Largest rise of raw `side` within JAB_WINDOW_MS. */
  jabRiseL: number;
  jabRiseR: number;
  /** Image distance between wrists 15 and 16 over S (9.04 laser: both hands together). */
  wristGap: number;
  /** ARMS-style guard; always false until the hands plan. */
  guard: false;
}

/** Ring buffers computeMetrics needs across frames. One set per VisionInputSource. */
export interface MetricBuffers {
  extL: RingBuffer<number>;
  extR: RingBuffer<number>;
  sideL: RingBuffer<number>;
  sideR: RingBuffer<number>;
}

export function createMetricBuffers(): MetricBuffers {
  return {
    extL: new RingBuffer<number>(THRUST_WINDOW_MS),
    extR: new RingBuffer<number>(THRUST_WINDOW_MS),
    sideL: new RingBuffer<number>(JAB_WINDOW_MS),
    sideR: new RingBuffer<number>(JAB_WINDOW_MS),
  };
}

export function clearMetricBuffers(b: MetricBuffers): void {
  b.extL.clear();
  b.extR.clear();
  b.sideL.clear();
  b.sideR.clear();
}

const xm = (l: Landmark) => 1 - l.x;
const dist2D = (a: Landmark, b: Landmark) => Math.hypot(a.x - b.x, a.y - b.y);

function arm(
  landmarks: Landmark[],
  raw: Landmark[],
  world: Landmark[],
  shoulderIdx: number,
  wristIdx: number,
  outward: 1 | -1,
  baseline: Baseline,
  ts: number,
  extBuffer: RingBuffer<number>,
  sideBuffer: RingBuffer<number>,
): { ext: number; depth: number; atHeight: boolean; thrust: boolean; drop: number; side: number; jabRise: number } {
  const shoulder = landmarks[shoulderIdx] as Landmark;
  const wrist = landmarks[wristIdx] as Landmark;
  const ext = dist2D(wrist, shoulder) / baseline.armLen;
  const ws = world[shoulderIdx];
  const ww = world[wristIdx];
  const depth = ws && ww ? ws.z - ww.z : 0;
  const atHeight = Math.abs(wrist.y - shoulder.y) < AT_HEIGHT * baseline.S;
  const side = ((xm(wrist) - xm(shoulder)) * outward) / baseline.armLen;
  // Velocity gates run on the unsmoothed landmarks so the EMA cannot blunt a fast move.
  const rawShoulder = raw[shoulderIdx] ?? shoulder;
  const rawWrist = raw[wristIdx] ?? wrist;
  extBuffer.push(ts, dist2D(rawWrist, rawShoulder) / baseline.armLen);
  sideBuffer.push(ts, ((xm(rawWrist) - xm(rawShoulder)) * outward) / baseline.armLen);
  const drop = extBuffer.maxDropWithin(THRUST_WINDOW_MS);
  const jabRise = sideBuffer.maxRiseWithin(JAB_WINDOW_MS);
  return { ext, depth, atHeight, thrust: drop >= THRUST_DROP, drop, side, jabRise };
}

/**
 * Pure apart from the ring buffers passed in. Call once per smoothed frame while calibration is ready.
 * `raw` (integrator amendment) is the unsmoothed landmark set the thrust and jab velocity gates read;
 * it defaults to the smoothed set.
 */
export function computeMetrics(
  landmarks: Landmark[],
  world: Landmark[],
  baseline: Baseline,
  ts: number,
  buffers: MetricBuffers,
  raw: Landmark[] = landmarks,
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

  // The person's left arm sits on the mirrored right (larger xm), so "away from the body" is +x for L, -x for R.
  const L = arm(landmarks, raw, world, 11, 15, 1, baseline, ts, buffers.extL, buffers.sideL);
  const R = arm(landmarks, raw, world, 12, 16, -1, baseline, ts, buffers.extR, buffers.sideR);

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
    sideL: L.side,
    sideR: R.side,
    jabRiseL: L.jabRise,
    jabRiseR: R.jabRise,
    wristGap: dist2D(lw, rw) / S,
    guard: false,
  };
}
