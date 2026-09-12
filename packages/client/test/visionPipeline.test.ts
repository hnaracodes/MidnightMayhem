import { EMPTY_FRAME, framesEqual, type InputFrame, type InputKey } from "@midnight/shared";
import { describe, expect, it, vi } from "vitest";
import {
  VisionInputSource, createPipeline, processLandmarks, type DebugFrame, type Pipeline,
} from "../src/vision/VisionInputSource";
import {
  CALIBRATION_MS,
  HOLD_OFF_MS,
  HOLD_ON,
  JAB_EXT,
  JAB_WINDOW_MS,
  JUMP_LAND,
  JUMP_RISE,
  LASER_DEBOUNCE_ON,
  LEAN_ENTER,
  LEAN_EXIT,
  RELOST_MS,
  THRUST_WINDOW_MS,
  WINDUP_ELBOW_DEG,
  WINDUP_OFF,
  WINDUP_ON,
  WINDUP_RAISE,
} from "../src/vision/thresholds";
import type { Landmark, ObjectBox, PoseResult, ResultMessage } from "../src/vision/workerClient";

// The wind-up ships disabled (owner: throwables are use-only); these tests exercise it with the flag on.
vi.mock("../src/vision/thresholds", async (importOriginal) => ({ ...(await importOriginal<object>()), WINDUP_ENABLED: true }));

/**
 * End-to-end pipeline tests: synthetic 33-landmark frames (image + world) go through the exact
 * code path VisionInputSource runs per worker result: EMA -> calibration -> metrics -> gestures ->
 * classify -> InputFrame. Geometry is authored in mirrored x (xm = 1 - x) and in units of S, the
 * shoulder width, so the same body works at any distance from the camera.
 */

const FRAME_MS = 33;

/** Wrist placement relative to its own shoulder, in units of S; z is world depth in metres. */
interface Wrist {
  /** Horizontal offset from the shoulder in S toward the person's left (smaller mirrored xm). */
  dx: number;
  dy: number;
  z?: number;
}

interface BodyOptions {
  /** Distance from the camera in metres; only scales the image-space body. */
  dist?: number;
  /** Shoulder-over-hip offset in S, positive = screen-right in the mirrored view. */
  lean?: number;
  /** Whole-body rise above rest in S (a hop). */
  rise?: number;
  wristL?: Wrist;
  wristR?: Wrist;
}

const HANGING_L: Wrist = { dx: 0.1, dy: 2, z: 0 };
const HANGING_R: Wrist = { dx: -0.1, dy: 2, z: 0 };

/** A person facing the camera: shoulders 0.3 m apart, so S = 0.3 / dist in image units. */
function body(o: BodyOptions = {}): PoseResult {
  const dist = o.dist ?? 1.5;
  const S = 0.3 / dist;
  const lean = o.lean ?? 0;
  const rise = o.rise ?? 0;
  const wristL = o.wristL ?? HANGING_L;
  const wristR = o.wristR ?? HANGING_R;

  const hipMidX = 0.5;
  const midX = hipMidX + lean * S;
  const hipY = 0.5 + 0.5 * S - rise * S;
  const shoulderY = hipY - 1.25 * S;
  const noseY = shoulderY - 0.75 * S;
  const eyeY = shoulderY - 0.85 * S;

  const image: Landmark[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.95 }));
  const world: Landmark[] = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 0.95 }));
  const set = (i: number, xm: number, y: number, worldZ = 0) => {
    image[i] = { x: 1 - xm, y, z: 0, visibility: 0.95 };
    world[i] = { x: 0, y: 0, z: worldZ, visibility: 0.95 };
  };

  // Mirrored space, as in a mirror: the person's anatomical left has the smaller xm (controls doc conventions).
  // A wrist's `dx` is a horizontal offset from its shoulder in S toward the person's left (smaller xm), so a
  // positive dx takes the left wrist outward and the right wrist inward, across the chest.
  const lsX = midX - 0.5 * S;
  const rsX = midX + 0.5 * S;
  set(0, midX, noseY);
  set(2, midX - 0.1 * S, eyeY);
  set(5, midX + 0.1 * S, eyeY);
  set(11, lsX, shoulderY);
  set(12, rsX, shoulderY);
  set(13, lsX - 0.1 * S, shoulderY + S);
  set(14, rsX + 0.1 * S, shoulderY + S);
  set(15, lsX - wristL.dx * S, shoulderY + wristL.dy * S, wristL.z ?? 0);
  set(16, rsX - wristR.dx * S, shoulderY + wristR.dy * S, wristR.z ?? 0);
  set(23, hipMidX - 0.25 * S, hipY);
  set(24, hipMidX + 0.25 * S, hipY);
  return { landmarks: image, worldLandmarks: world };
}

/** Linear blend between two wrist placements. */
function mixWrist(a: Wrist, b: Wrist, t: number): Wrist {
  return { dx: a.dx + (b.dx - a.dx) * t, dy: a.dy + (b.dy - a.dy) * t, z: (a.z ?? 0) + ((b.z ?? 0) - (a.z ?? 0)) * t };
}

// Left wrist thrown straight at the camera: near the shoulder in the image, half a metre ahead of it.
const THRUST_L: Wrist = { dx: 0.1, dy: 0.25, z: -0.5 };
// Left wrist jabbed straight out sideways at shoulder height: a full arm length (2 S) away, no depth.
const SIDE_L: Wrist = { dx: 2.0, dy: 0.0, z: 0 };
// Left arm raised straight overhead (a swing up to block): a full arm length above the shoulder.
const OVERHEAD_L: Wrist = { dx: 0.1, dy: -2.0, z: 0 };
// Arms crossed in front of the chest: each wrist 0.3 S past the midline (0.5 S in from its shoulder, then 0.3 S
// more onto the other side), at chest height.
const CROSSED_L: Wrist = { dx: -0.8, dy: 0.5, z: 0 };
const CROSSED_R: Wrist = { dx: 0.8, dy: 0.5, z: 0 };
// Hands on the hips: just outside the hip line, slightly below hip height.
const ON_HIP_L: Wrist = { dx: -0.2, dy: 1.35, z: 0 };
const ON_HIP_R: Wrist = { dx: 0.2, dy: 1.35, z: 0 };
// The special pose: only the right wrist moves outward to the player's right.
const BEAM_L: Wrist = HANGING_L;
const BEAM_R: Wrist = { dx: -2.0, dy: 0.25, z: 0 };

/** A detector box of `label` centred on landmark `idx` of `pose`, 0.5 S wide. */
function boxAt(pose: PoseResult, idx: number, label = "bottle", score = 0.8): ObjectBox {
  const l = pose.landmarks[idx] as Landmark;
  const S = 0.2;
  return { label, score, x: l.x - 0.25 * S, y: l.y - 0.25 * S, w: 0.5 * S, h: 0.5 * S };
}

class Driver {
  readonly pipeline: Pipeline = createPipeline();
  readonly debug: DebugFrame[] = [];
  t = 0;

  /** Feeds one frame (and, for 9.04, the detector's boxes or null) and returns its debug output. */
  step(pose: PoseResult | null, objects: ObjectBox[] | null = null): DebugFrame {
    const d = processLandmarks(this.pipeline, pose, this.t, objects);
    this.debug.push(d);
    this.t += FRAME_MS;
    return d;
  }

  /** Feeds `n` frames produced by `make(i)`. Returns the debug frames of this run only. */
  run(n: number, make: (i: number) => PoseResult | null): DebugFrame[] {
    const start = this.debug.length;
    for (let i = 0; i < n; i++) this.step(make(i));
    return this.debug.slice(start);
  }

  /** Feeds `ms` worth of the same pose. */
  hold(ms: number, pose: PoseResult | null): DebugFrame[] {
    return this.run(Math.ceil(ms / FRAME_MS), () => pose);
  }

  /** begin() plus enough standing frames to reach `ready`. */
  calibrate(dist = 1.5): DebugFrame[] {
    void this.pipeline.calibration.begin();
    const out = this.hold(CALIBRATION_MS + 4 * FRAME_MS, body({ dist }));
    expect(this.pipeline.calibration.state().phase).toBe("ready");
    return out;
  }

  phase(): string {
    return this.pipeline.calibration.state().phase;
  }
}

const frames = (d: DebugFrame[]): InputFrame[] => d.map((f) => f.frame);

/** Number of false -> true transitions of `key` across the frames, starting from `prev`. */
function risingEdges(d: DebugFrame[], key: InputKey, prev = false): number {
  let n = 0;
  for (const f of d) {
    if (f.frame[key] && !prev) n++;
    prev = f.frame[key];
  }
  return n;
}

const anyTrue = (d: DebugFrame[], key: InputKey) => d.some((f) => f.frame[key]);
/** Every classified frame is all-false (by value; while ready, classify hands out its own frozen object). */
const allFalseFrames = (d: DebugFrame[]) => d.every((f) => framesEqual(f.frame, EMPTY_FRAME));
/** Every frame is the EMPTY_FRAME singleton itself, which is what the layer emits when not ready. */
const allEmptySingleton = (d: DebugFrame[]) => d.every((f) => f.frame === EMPTY_FRAME);

describe("vision pipeline: calibration", () => {
  it("standing still for CALIBRATION_MS reaches ready and emits EMPTY_FRAME throughout", () => {
    const drv = new Driver();
    void drv.pipeline.calibration.begin();
    expect(drv.phase()).toBe("calibrating");

    const during = drv.hold(CALIBRATION_MS - 2 * FRAME_MS, body());
    expect(drv.phase()).toBe("calibrating");
    expect(allEmptySingleton(during)).toBe(true);
    expect(during.every((f) => f.metrics === null)).toBe(true);
    expect(during[during.length - 1]?.calibration.progress).toBeGreaterThan(0.9);

    const after = drv.hold(4 * FRAME_MS, body());
    expect(drv.phase()).toBe("ready");
    expect(after[after.length - 1]?.calibration.progress).toBe(1);
    const b = drv.pipeline.calibration.baseline;
    expect(b).not.toBeNull();
    expect(b!.S).toBeCloseTo(0.2, 3);
    expect(b!.leanZero).toBeCloseTo(0, 3);
    expect(allFalseFrames(after)).toBe(true);

    // At rest after calibration: metrics flow but every input stays false.
    const rest = drv.hold(500, body());
    expect(rest.every((f) => f.metrics !== null)).toBe(true);
    expect(allFalseFrames(rest)).toBe(true);
  });

  it("the same body at 2.5 m calibrates to a smaller S and still rests all-false", () => {
    const drv = new Driver();
    drv.calibrate(2.5);
    expect(drv.pipeline.calibration.baseline!.S).toBeCloseTo(0.12, 3);
    expect(allFalseFrames(drv.hold(500, body({ dist: 2.5 })))).toBe(true);
  });
});

describe("vision pipeline: remembered baseline (owner rule 2026-09-12)", () => {
  it("a restored baseline is ready on the first frame, metrics flow at once, and a still window that agrees keeps it", () => {
    const drv = new Driver();
    const stored = { S: 0.2, leanZero: 0, hipY: 0.6, shoulderY: 0.35, noseY: 0.2, eyeY: 0.18, armLen: 0.4 };
    drv.pipeline.calibration.restore(stored);
    void drv.pipeline.calibration.begin();
    const first = drv.step(body());
    expect(first.calibration.phase).toBe("ready");
    expect(first.metrics).not.toBeNull();
    const rest = drv.hold(CALIBRATION_MS + 4 * FRAME_MS, body());
    expect(allFalseFrames(rest)).toBe(true);
    expect(drv.pipeline.calibration.baseline).toEqual(stored);
    expect(drv.pipeline.calibration.provisional).toBe(false);
  });

  it("losing the body mid-match and coming back is ready at once with the same baseline", () => {
    const drv = new Driver();
    drv.calibrate();
    const baseline = drv.pipeline.calibration.baseline;
    drv.hold(RELOST_MS + 3 * FRAME_MS, null);
    expect(drv.phase()).toBe("lost");
    const back = drv.step(body());
    expect(back.calibration.phase).toBe("ready");
    expect(back.metrics).not.toBeNull();
    expect(drv.pipeline.calibration.baseline).toBe(baseline);
  });
});

describe("vision pipeline: walk", () => {
  it("leaning right past LEAN_ENTER walks right, holds inside the band, stops below LEAN_EXIT", () => {
    const drv = new Driver();
    drv.calibrate();

    const enter = drv.hold(600, body({ lean: LEAN_ENTER + 0.1 }));
    expect(risingEdges(enter, "right")).toBe(1);
    expect(enter[enter.length - 1]?.frame.right).toBe(true);
    expect(anyTrue(enter, "left")).toBe(false);
    const m = enter[enter.length - 1]!.metrics!;
    expect(m.lean).toBeCloseTo(LEAN_ENTER + 0.1, 2);

    // Between exit and enter: stays on, no flicker even while the lean wobbles across the band.
    const hold = drv.run(30, (i) => body({ lean: i % 2 ? LEAN_EXIT + 0.02 : LEAN_ENTER - 0.02 }));
    expect(hold.every((f) => f.frame.right)).toBe(true);
    expect(risingEdges(hold, "right", true)).toBe(0);

    // Below LEAN_EXIT: turns off exactly once and stays off.
    const release = drv.hold(600, body({ lean: LEAN_EXIT - 0.05 }));
    expect(release[release.length - 1]?.frame.right).toBe(false);
    expect(risingEdges(release, "right", true)).toBe(0);
    const offAt = release.findIndex((f) => !f.frame.right);
    expect(offAt).toBeGreaterThanOrEqual(0);
    expect(release.slice(offAt).some((f) => f.frame.right)).toBe(false);

    // Back inside the band from below: does not re-enter.
    const inside = drv.run(30, (i) => body({ lean: i % 2 ? LEAN_EXIT + 0.02 : LEAN_ENTER - 0.02 }));
    expect(anyTrue(inside, "right")).toBe(false);
    expect(anyTrue(inside, "left")).toBe(false);

    // Only walking flags ever fired.
    for (const k of ["jump", "block", "punchL", "punchR"] as const) expect(anyTrue(drv.debug, k)).toBe(false);
  });

  it("leaning left mirrors to left and never right", () => {
    const drv = new Driver();
    drv.calibrate();
    const d = drv.hold(600, body({ lean: -(LEAN_ENTER + 0.1) }));
    expect(risingEdges(d, "left")).toBe(1);
    expect(d[d.length - 1]?.frame.left).toBe(true);
    expect(anyTrue(d, "right")).toBe(false);
  });
});

describe("vision pipeline: jump", () => {
  /** Two frames up, airborne, two frames down: one physical hop. */
  const hop = (drv: Driver, rise: number, dist = 1.5) => {
    const up = drv.run(2, (i) => body({ dist, rise: (rise * (i + 1)) / 2 }));
    const air = drv.hold(200, body({ dist, rise }));
    const down = drv.run(2, (i) => body({ dist, rise: (rise * (1 - i)) / 2 }));
    const landed = drv.hold(600, body({ dist }));
    return { up, air, down, landed, all: [...up, ...air, ...down, ...landed] };
  };

  it("a physical hop produces exactly one jump edge and none on landing", () => {
    const drv = new Driver();
    drv.calibrate();
    const h = hop(drv, JUMP_RISE * 2);
    expect(risingEdges(h.all, "jump")).toBe(1);
    expect(h.air.some((f) => f.frame.jump)).toBe(true);
    expect(h.landed[h.landed.length - 1]?.frame.jump).toBe(false);
    // Jump is level while airborne: contiguous true run, no gap.
    const seq = frames(h.all).map((f) => f.jump);
    const first = seq.indexOf(true);
    const last = seq.lastIndexOf(true);
    expect(seq.slice(first, last + 1).every(Boolean)).toBe(true);
    expect(h.landed.slice(-5).every((f) => f.metrics!.riseHip < JUMP_LAND)).toBe(true);
  });

  it("five hops in a row give five edges", () => {
    const drv = new Driver();
    drv.calibrate();
    let edges = 0;
    for (let i = 0; i < 5; i++) edges += risingEdges(hop(drv, JUMP_RISE * 2).all, "jump");
    expect(edges).toBe(5);
  });

  it("a slow rise onto the toes never jumps", () => {
    const drv = new Driver();
    drv.calibrate();
    const slow = drv.run(45, (i) => body({ rise: (JUMP_RISE * 2 * i) / 45 }));
    const held = drv.hold(300, body({ rise: JUMP_RISE * 2 }));
    expect(anyTrue([...slow, ...held], "jump")).toBe(false);
  });
});

describe("vision pipeline: block", () => {
  it("crossed wrists at chest height block; hands on hips do not", () => {
    const drv = new Driver();
    drv.calibrate();

    const cross = drv.hold(400, body({ wristL: CROSSED_L, wristR: CROSSED_R }));
    expect(risingEdges(cross, "block")).toBe(1);
    expect(cross[cross.length - 1]?.frame.block).toBe(true);
    expect(cross[cross.length - 1]?.metrics!.crossed).toBe(true);
    // Crossing brings the wrists close to the shoulders, but with no depth it must never punch.
    expect(anyTrue(cross, "punchL")).toBe(false);
    expect(anyTrue(cross, "punchR")).toBe(false);

    const uncross = drv.hold(400, body());
    expect(uncross[uncross.length - 1]?.frame.block).toBe(false);

    const hips = drv.hold(600, body({ wristL: ON_HIP_L, wristR: ON_HIP_R }));
    expect(anyTrue(hips, "block")).toBe(false);
    expect(hips.every((f) => f.metrics!.crossed === false)).toBe(true);
    expect(allFalseFrames(hips)).toBe(true);
  });

  it("jump suppresses block while airborne and block returns on landing", () => {
    const drv = new Driver();
    drv.calibrate();
    const crossed = { wristL: CROSSED_L, wristR: CROSSED_R };
    const before = drv.hold(400, body(crossed));
    expect(before[before.length - 1]?.frame.block).toBe(true);

    const rise = JUMP_RISE * 2;
    drv.run(2, (i) => body({ ...crossed, rise: (rise * (i + 1)) / 2 }));
    const air = drv.hold(200, body({ ...crossed, rise }));
    const airborne = air.filter((f) => f.frame.jump);
    expect(airborne.length).toBeGreaterThan(0);
    expect(airborne.every((f) => f.frame.block === false)).toBe(true);
    // The raw gesture still sees crossed arms; only the classified frame drops it.
    expect(airborne.every((f) => f.gestures.block)).toBe(true);

    drv.run(2, (i) => body({ ...crossed, rise: (rise * (1 - i)) / 2 }));
    const landed = drv.hold(400, body(crossed));
    const last = landed[landed.length - 1]!;
    expect(last.frame.jump).toBe(false);
    expect(last.frame.block).toBe(true);
  });
});

describe("vision pipeline: punch", () => {
  const punchFrames = Math.ceil(THRUST_WINDOW_MS / FRAME_MS);

  /** A straight left thrust: out in `outFrames`, held, back in `outFrames`. */
  const jab = (drv: Driver, outFrames: number, dist = 1.5) => {
    const out = drv.run(outFrames, (i) => body({ dist, wristL: mixWrist(HANGING_L, THRUST_L, (i + 1) / outFrames) }));
    const held = drv.hold(300, body({ dist, wristL: THRUST_L }));
    const back = drv.run(outFrames, (i) =>
      body({ dist, wristL: mixWrist(THRUST_L, HANGING_L, (i + 1) / outFrames) }),
    );
    const rest = drv.hold(400, body({ dist }));
    return { out, held, back, rest, all: [...out, ...held, ...back, ...rest] };
  };

  it("a fast straight thrust at 1.5 m produces exactly one punchL edge", () => {
    const drv = new Driver();
    drv.calibrate(1.5);
    const j = jab(drv, 2, 1.5);
    expect(risingEdges(j.all, "punchL")).toBe(1);
    expect(j.held.some((f) => f.frame.punchL)).toBe(true);
    expect(anyTrue(j.all, "punchR")).toBe(false);
    expect(anyTrue(j.all, "block")).toBe(false);
    expect(anyTrue(j.all, "jump")).toBe(false);
    expect(j.rest[j.rest.length - 1]?.frame.punchL).toBe(false);
    const m = j.held[j.held.length - 1]!.metrics!;
    expect(m.depthL).toBeCloseTo(0.5, 2);
    expect(m.atHeightL).toBe(true);
  });

  it("the same fast thrust also lands at 1 m and 2.5 m", () => {
    for (const dist of [1, 2.5]) {
      const drv = new Driver();
      drv.calibrate(dist);
      expect(risingEdges(jab(drv, 2, dist).all, "punchL")).toBe(1);
    }
  });

  it("a slow push over 1.5 s never punches", () => {
    const drv = new Driver();
    drv.calibrate();
    const j = jab(drv, punchFrames * 7, 1.5);
    expect(anyTrue(j.all, "punchL")).toBe(false);
    // The push does reach full depth and extension: only the missing thrust keeps it off.
    const m = j.held[j.held.length - 1]!.metrics!;
    expect(m.depthL).toBeCloseTo(0.5, 2);
    expect(m.thrustL).toBe(false);
  });

  it("two jabs in a row give two edges", () => {
    const drv = new Driver();
    drv.calibrate();
    const a = jab(drv, 2);
    const b = jab(drv, 2);
    expect(risingEdges([...a.all, ...b.all], "punchL")).toBe(2);
  });
});

describe("vision pipeline: side jab (SIDE_JAB_ENABLED)", () => {
  /** A horizontal left jab: out in `outFrames`, held 300 ms, back, rest. */
  const sideJab = (drv: Driver, outFrames: number, dist = 1.5) => {
    const out = drv.run(outFrames, (i) => body({ dist, wristL: mixWrist(HANGING_L, SIDE_L, (i + 1) / outFrames) }));
    const held = drv.hold(300, body({ dist, wristL: SIDE_L }));
    const back = drv.run(outFrames, (i) => body({ dist, wristL: mixWrist(SIDE_L, HANGING_L, (i + 1) / outFrames) }));
    const rest = drv.hold(400, body({ dist }));
    return { out, held, back, rest, all: [...out, ...held, ...back, ...rest] };
  };

  it("a fast sideways jab with zero depth produces exactly one punchL edge via the jab path", () => {
    const drv = new Driver();
    drv.calibrate();
    const j = sideJab(drv, 3);
    expect(risingEdges(j.all, "punchL")).toBe(1);
    expect(j.held.some((f) => f.frame.punchL)).toBe(true);
    expect(anyTrue(j.all, "punchR")).toBe(false);
    expect(anyTrue(j.all, "block")).toBe(false);
    expect(j.rest[j.rest.length - 1]?.frame.punchL).toBe(false);
    const on = j.held.find((f) => f.frame.punchL)!;
    expect(on.punch?.L.path).toBe("jab");
    expect(on.punch?.L.depthOk).toBe(false);
    expect(on.punch?.L.thrustOk).toBe(false);
    expect(on.metrics!.sideL).toBeGreaterThan(JAB_EXT);
    expect(on.metrics!.depthL).toBeCloseTo(0, 3);
  });

  it("the same jab lands at 1 m and 2.5 m", () => {
    for (const dist of [1, 2.5]) {
      const drv = new Driver();
      drv.calibrate(dist);
      expect(risingEdges(sideJab(drv, 3, dist).all, "punchL")).toBe(1);
    }
  });

  it("a slow sideways raise never punches, and neither does holding the arm out", () => {
    const drv = new Driver();
    drv.calibrate();
    const slowFrames = Math.ceil(JAB_WINDOW_MS / FRAME_MS) * 6;
    const j = sideJab(drv, slowFrames);
    expect(anyTrue(j.all, "punchL")).toBe(false);
    const last = j.held[j.held.length - 1]!;
    expect(last.metrics!.sideL).toBeGreaterThan(JAB_EXT);
    expect(last.punch?.L.jabOk).toBe(false);
  });

  it("crossing the arms fast and swinging an arm up fast never punch", () => {
    const drv = new Driver();
    drv.calibrate();
    const cross = drv.run(2, (i) =>
      body({ wristL: mixWrist(HANGING_L, CROSSED_L, (i + 1) / 2), wristR: mixWrist(HANGING_R, CROSSED_R, (i + 1) / 2) }),
    );
    const held = drv.hold(400, body({ wristL: CROSSED_L, wristR: CROSSED_R }));
    expect(anyTrue([...cross, ...held], "punchL")).toBe(false);
    expect(anyTrue([...cross, ...held], "punchR")).toBe(false);
    expect(held[held.length - 1]?.frame.block).toBe(true);
    expect(held.every((f) => f.metrics!.sideL < 0 && f.metrics!.sideR < 0)).toBe(true);

    drv.hold(400, body());
    const up = drv.run(2, (i) => body({ wristL: mixWrist(HANGING_L, OVERHEAD_L, (i + 1) / 2) }));
    const overhead = drv.hold(400, body({ wristL: OVERHEAD_L }));
    expect(anyTrue([...up, ...overhead], "punchL")).toBe(false);
    expect(overhead.every((f) => f.punch!.L.atHeight === false)).toBe(true);
  });

  it("punch diagnostics ride on every ready frame and vanish when not ready", () => {
    const drv = new Driver();
    const during = drv.calibrate();
    expect(during[0]?.punch).toBeUndefined();
    const rest = drv.hold(200, body());
    for (const f of rest) {
      expect(f.punch).toBeDefined();
      expect(f.punch!.L).toMatchObject({ extOk: false, depthOk: false, thrustOk: false, jabOk: false, active: false, out: false });
      expect(f.punch!.R.out).toBe(false);
    }
  });
});

describe("vision pipeline: dropout", () => {
  it("a landmark dropout longer than RELOST_MS puts the source in lost and every frame goes all-false", () => {
    const drv = new Driver();
    drv.calibrate();
    const walking = drv.hold(600, body({ lean: LEAN_ENTER + 0.1 }));
    expect(walking[walking.length - 1]?.frame.right).toBe(true);

    const gone = drv.hold(RELOST_MS + 3 * FRAME_MS, null);
    expect(allEmptySingleton(gone)).toBe(true);
    expect(gone[0]?.landmarks).toBeNull();
    expect(drv.phase()).toBe("lost");
    expect(drv.pipeline.calibration.baseline).not.toBeNull(); // kept (owner rule 2026-09-12)
    expect(drv.pipeline.frame).toBe(EMPTY_FRAME);

    // Coming back is ready at once with the kept baseline, then works again.
    const back = drv.step(body());
    expect(back.calibration.phase).toBe("ready");
    expect(allFalseFrames(drv.hold(CALIBRATION_MS + 4 * FRAME_MS, body()))).toBe(true);
    expect(drv.phase()).toBe("ready");
    const again = drv.hold(600, body({ lean: LEAN_ENTER + 0.1 }));
    expect(again[again.length - 1]?.frame.right).toBe(true);
  });

  it("a brief dropout keeps the baseline but still reports all-false while the pose is gone", () => {
    const drv = new Driver();
    drv.calibrate();
    drv.hold(600, body({ lean: LEAN_ENTER + 0.1 }));
    const blink = drv.hold(RELOST_MS / 2, null);
    expect(allEmptySingleton(blink)).toBe(true);
    expect(drv.phase()).toBe("ready");
    expect(drv.pipeline.calibration.baseline).not.toBeNull();
    const resume = drv.hold(600, body({ lean: LEAN_ENTER + 0.1 }));
    expect(resume[resume.length - 1]?.frame.right).toBe(true);
  });
});

describe("vision pipeline: laser (9.04)", () => {
  it("a fast right-hand outward motion sets special and never blocks", () => {
    const drv = new Driver();
    drv.calibrate();
    const beam = [
      ...drv.run(2, (i) => body({ wristR: mixWrist(HANGING_R, BEAM_R, (i + 1) / 2) })),
      ...drv.hold(250, body({ wristR: BEAM_R })),
    ];
    expect(risingEdges(beam, "special")).toBe(1);
    expect(beam.slice(0, LASER_DEBOUNCE_ON - 1).every((f) => !f.frame.special)).toBe(true);
    expect(anyTrue(beam, "block")).toBe(false);
    expect(anyTrue(beam, "punchL")).toBe(false);
    const m = beam[beam.length - 1]!.metrics!;
    expect(m.sideR).toBeGreaterThan(0.6);

    const rest = drv.hold(400, body());
    expect(rest[rest.length - 1]?.frame.special).toBe(false);
  });

  it("ramping the right wrist outward never reads as a block on the way", () => {
    for (const n of [6, 8]) {
      const drv = new Driver();
      drv.calibrate();
      const ramp = drv.run(n, (i) => body({
        wristR: mixWrist(HANGING_R, BEAM_R, (i + 1) / n),
      }));
      const held = drv.hold(300, body({ wristL: BEAM_L, wristR: BEAM_R }));
      expect(anyTrue(ramp, "block")).toBe(false);
      expect(anyTrue(held, "block")).toBe(false);
      expect(ramp.every((f) => !f.metrics?.crossed)).toBe(true);
      expect(risingEdges(held, "special")).toBe(1);
    }
  });

  it("a single-arm thrust is a punch, not a laser", () => {
    const drv = new Driver();
    drv.calibrate();
    drv.run(2, (i) => body({ wristL: mixWrist(HANGING_L, THRUST_L, (i + 1) / 2) }));
    const held = drv.hold(300, body({ wristL: THRUST_L }));
    expect(anyTrue(held, "special")).toBe(false);
    expect(held.some((f) => f.frame.punchL)).toBe(true);
  });

  it("the pipeline reports special in gestures and the debug frame carries objects and item", () => {
    const drv = new Driver();
    drv.calibrate();
    const f = [
      ...drv.run(2, (i) => body({ wristL: BEAM_L, wristR: mixWrist(HANGING_R, BEAM_R, (i + 1) / 2) })),
      ...drv.hold(300, body({ wristL: BEAM_L, wristR: BEAM_R })),
    ];
    const special = f.find((frame) => frame.frame.special);
    const last = f[f.length - 1]!;
    expect(special?.frame.special).toBe(true);
    expect(last.objects).toBeNull();
    expect(last.item).toBeNull();
  });
});

describe("vision pipeline: held items (9.04)", () => {
  it("a bottle box near the wrist for HOLD_ON consecutive results yields item molotov", () => {
    const drv = new Driver();
    drv.calibrate();
    const pose = body();
    const out: DebugFrame[] = [];
    for (let i = 0; i < HOLD_ON; i++) out.push(drv.step(pose, [boxAt(pose, 15)]));
    expect(out.slice(0, HOLD_ON - 1).every((f) => f.frame.item === null)).toBe(true);
    expect(out[HOLD_ON - 1]?.frame.item).toBe("molotov");
    expect(out[HOLD_ON - 1]?.item).toBe("molotov");
    expect(out[HOLD_ON - 1]?.objects).toHaveLength(1);
    expect(out[HOLD_ON - 1]?.gestures.item).toBe("molotov");
  });

  it("results with objects: null in between (the detector's off frames) do not reset the item or a pending run", () => {
    const drv = new Driver();
    drv.calibrate();
    const pose = body();
    // Detector every third frame: box, null, null, box, null, null, box.
    let last: DebugFrame | undefined;
    for (let i = 0; i < 3 * HOLD_ON; i++) last = drv.step(pose, i % 3 === 0 ? [boxAt(pose, 15)] : null);
    expect(last?.frame.item).toBe("molotov");
    expect(last?.objects).toBeNull();

    // Still on through a run of off frames; the debug frame keeps the item while objects is null.
    expect(drv.run(6, () => pose).every((f) => f.frame.item === "molotov")).toBe(true);
    const skip = drv.step(pose, null);
    expect(skip.item).toBe("molotov");
    expect(skip.frame.item).toBe("molotov");
  });

  it("the item times out HOLD_OFF_MS after the last positive, and a box away from both wrists is nothing", () => {
    const drv = new Driver();
    drv.calibrate();
    const pose = body();
    for (let i = 0; i < HOLD_ON; i++) drv.step(pose, [boxAt(pose, 15)]);
    expect(drv.pipeline.frame.item).toBe("molotov");
    const gone = drv.run(Math.ceil((HOLD_OFF_MS + 3 * FRAME_MS) / FRAME_MS), () => pose);
    expect(gone[0]?.frame.item).toBe("molotov");
    expect(gone[gone.length - 1]?.frame.item).toBeNull();
    const away: ObjectBox = { label: "bottle", score: 0.9, x: 0.02, y: 0.02, w: 0.05, h: 0.05 };
    for (let i = 0; i < 2 * HOLD_ON; i++) expect(drv.step(pose, [away]).frame.item).toBeNull();
  });

  it("losing the pose clears the item and calibrating again starts from nothing", () => {
    const drv = new Driver();
    drv.calibrate();
    const pose = body();
    for (let i = 0; i < HOLD_ON; i++) drv.step(pose, [boxAt(pose, 16, "tennis racket")]);
    expect(drv.pipeline.frame.item).toBe("sword");
    const gone = drv.hold(RELOST_MS + 3 * FRAME_MS, null);
    expect(gone.every((f) => f.frame.item === null && f.item === null)).toBe(true);
  });
});

describe("vision pipeline: molotov wind-up (9.10)", () => {
  /** A body with the right arm's world landmarks bent to `elbowDeg` and the wrist raised `raise` S above the shoulder. */
  function windupBody(elbowDeg: number, raise: number): PoseResult {
    const pose = body({ wristR: { dx: 0.3, dy: -raise, z: 0 } });
    const rad = (elbowDeg * Math.PI) / 180;
    // Shoulder at the origin, elbow 0.3 m down, wrist 0.25 m from the elbow at the requested angle.
    pose.worldLandmarks[12] = { x: 0, y: 0, z: 0, visibility: 0.95 };
    pose.worldLandmarks[14] = { x: 0, y: 0.3, z: 0, visibility: 0.95 };
    pose.worldLandmarks[16] = { x: 0.25 * Math.sin(rad), y: 0.3 + 0.25 * Math.cos(rad) * -1, z: 0, visibility: 0.95 };
    return pose;
  }

  it("a held wind-up yields N frames of punchR then a falling edge on release; nothing without a throwable", () => {
    const p = createPipeline();
    void p.calibration.begin();
    let t = 0;
    const n = Math.ceil((CALIBRATION_MS + 4 * FRAME_MS) / FRAME_MS);
    for (let i = 0; i < n; i++, t += FRAME_MS) processLandmarks(p, body(), t);
    expect(p.calibration.state().phase).toBe("ready");

    // Nothing held: the bent pose never punches.
    const bent = windupBody(70, 0.4);
    const idle: DebugFrame[] = [];
    for (let i = 0; i < 10; i++, t += FRAME_MS) idle.push(processLandmarks(p, bent, t));
    expect(idle.some((f) => f.frame.punchR)).toBe(false);
    expect(idle[idle.length - 1]?.metrics?.elbowR).toBeLessThan(WINDUP_ELBOW_DEG);
    expect(idle[idle.length - 1]?.metrics?.raiseR).toBeGreaterThan(WINDUP_RAISE);

    // The arena says the fighter holds a molotov: the same pose winds up and holds punchR.
    p.held = "molotov";
    const held: DebugFrame[] = [];
    for (let i = 0; i < 12; i++, t += FRAME_MS) held.push(processLandmarks(p, bent, t));
    const first = held.findIndex((f) => f.frame.punchR);
    expect(first).toBe(WINDUP_ON - 1);
    expect(held.slice(first).every((f) => f.frame.punchR && f.gestures.windupR)).toBe(true);
    expect(held[held.length - 1]?.windup?.R.active).toBe(true);
    expect(held.some((f) => f.frame.special)).toBe(false);

    // Straightening the arm overhead releases: a single falling edge and no further punch.
    const thrown = windupBody(175, 0.9);
    const rel: DebugFrame[] = [];
    for (let i = 0; i < 10; i++, t += FRAME_MS) rel.push(processLandmarks(p, thrown, t));
    // The EMA lags the straightening by about a frame, so the release lands one frame after WINDUP_OFF.
    const drop = rel.findIndex((f) => !f.frame.punchR);
    expect(drop).toBeGreaterThanOrEqual(WINDUP_OFF - 1);
    expect(drop).toBeLessThanOrEqual(WINDUP_OFF);
    expect(rel.slice(drop).every((f) => !f.frame.punchR)).toBe(true);
    expect(rel.every((f) => f.frame.chop === false && f.frame.sweep === false)).toBe(true);
  });

  it("VisionInputSource.setHeldItem threads the held item to the classifier", () => {
    const src = new VisionInputSource();
    src.setHeldItem("sword");
    const pipe = (src as unknown as { pipeline: { held: string | null } }).pipeline;
    expect(pipe.held).toBe("sword");
    src.setHeldItem(null);
    expect(pipe.held).toBeNull();
  });
});

describe("vision pipeline: recorder and debug frame (9.04 rule 8)", () => {
  /** handleResult is the only private step between a worker result and the recorder; drive it directly. */
  const feed = (src: VisionInputSource, r: ResultMessage) =>
    (src as unknown as { handleResult(r: ResultMessage): void }).handleResult(r);
  const result = (ts: number, pose: PoseResult | null, objects: ObjectBox[] | null = null): ResultMessage => ({
    type: "result", ts, pose, poseMs: 5, delegate: "GPU", objects, objectMs: objects ? 12 : 0, backend: "mediapipe",
  });

  it("samples and debug frames carry item and special", () => {
    const src = new VisionInputSource();
    const seen: DebugFrame[] = [];
    src.onDebug((f) => seen.push(f));
    void src.calibrate();
    let t = 0;
    const n = Math.ceil((CALIBRATION_MS + 4 * FRAME_MS) / FRAME_MS);
    for (let i = 0; i < n; i++, t += FRAME_MS) feed(src, result(t, body()));
    expect(src.calibrationState().phase).toBe("ready");

    const pose = body();
    for (let i = 0; i < HOLD_ON; i++, t += FRAME_MS) feed(src, result(t, pose, [boxAt(pose, 15)]));
    expect(src.sample().item).toBe("molotov");
    for (let i = 0; i < 6; i++, t += FRAME_MS) feed(src, result(t, body({ wristL: BEAM_L, wristR: BEAM_R }), null));
    expect(src.sample().special).toBe(true);

    const dump = src.dump();
    const last = dump[dump.length - 1]!;
    expect(last.item).toBe("molotov");
    expect(last.frame.special).toBe(true);
    expect(last.frame.item).toBe("molotov");
    expect(last.gestures.special).toBe(true);
    expect(dump.some((s) => s.item === null)).toBe(true);

    const lastDebug = seen[seen.length - 1]!;
    expect(lastDebug.item).toBe("molotov");
    expect(lastDebug.objects).toBeNull();
    expect(lastDebug.frame.special).toBe(true);
    const withBoxes = seen.find((f) => f.objects !== null)!;
    expect(withBoxes.objects).toHaveLength(1);
  });
});
