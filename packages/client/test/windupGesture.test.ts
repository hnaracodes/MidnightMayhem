import { describe, expect, it, vi } from "vitest";
import { classify } from "../src/vision/classify";
import { Slash } from "../src/vision/gestures/slash";
import { Windup } from "../src/vision/gestures/windup";
import { jointAngle, type Metrics } from "../src/vision/metrics";
import {
  CHOP_DROP, CHOP_EXT, SLASH_EXCLUSIVE_MS, SWEEP_TRAVEL, WINDUP_DROP, WINDUP_ELBOW_DEG, WINDUP_EXTEND, WINDUP_OFF,
  WINDUP_ON, WINDUP_RAISE,
} from "../src/vision/thresholds";

// The wind-up ships disabled (owner: throwables are use-only); these tests exercise it with the flag on.
vi.mock("../src/vision/thresholds", async (importOriginal) => ({ ...(await importOriginal<object>()), WINDUP_ENABLED: true }));

const FRAME = 33;

/** A resting body: arms hanging (elbow straight, wrists two S below the shoulders, well below the nose). */
function metrics(o: Partial<Metrics> = {}): Metrics {
  return {
    lean: 0, riseHip: 0, riseShoulder: 0, midX: 0.5, crossed: false,
    extL: 1, extR: 1, depthL: 0, depthR: 0, atHeightL: false, atHeightR: false,
    thrustL: false, thrustR: false, dropL: 0, dropR: 0, sideL: 0, sideR: 0, jabRiseL: 0, jabRiseR: 0,
    wristGap: 2, guard: false,
    elbowL: 180, elbowR: 180, raiseL: -2, raiseR: -2, noseDropL: 2.75, noseDropR: 2.75, wristXL: -0.5, wristXR: 0.5,
    ...o,
  };
}

const REST = metrics();
/** Right elbow folded to 70°, hand a third of a shoulder width above the shoulder. */
const BENT_R = metrics({ elbowR: 70, raiseR: 0.35 });
/** Right arm straight overhead / forward: the throw. */
const THROWN_R = metrics({ elbowR: WINDUP_ELBOW_DEG + WINDUP_EXTEND + 5, raiseR: 0.6 });
/** Hand dropped below the shoulder with the elbow still bent: abort. */
const DROPPED_R = metrics({ elbowR: 80, raiseR: WINDUP_DROP - 0.1 });
const BLOCK = metrics({ crossed: true, elbowL: 60, elbowR: 60, raiseL: -0.5, raiseR: -0.5 });

function run(w: Windup, m: Metrics, n: number, t0 = 0, held: "molotov" | "sword" | null = "molotov"): boolean[] {
  const out: boolean[] = [];
  for (let i = 0; i < n; i++) out.push(w.update(m, t0 + i * FRAME, held));
  return out;
}

describe("Windup gesture (9.10)", () => {
  it("thresholds are the spec's numbers", () => {
    expect([WINDUP_ELBOW_DEG, WINDUP_RAISE, WINDUP_EXTEND, WINDUP_DROP, WINDUP_ON, WINDUP_OFF]).toEqual(
      [110, 0.1, 40, -0.2, 3, 2],
    );
  });

  it("rest never winds up", () => {
    expect(run(new Windup("R"), REST, 20).some(Boolean)).toBe(false);
  });

  it("block (arms crossed low) never winds up", () => {
    expect(run(new Windup("R"), BLOCK, 20).some(Boolean)).toBe(false);
    expect(run(new Windup("L"), BLOCK, 20).some(Boolean)).toBe(false);
  });

  it("a punch (straight arm at shoulder height) never winds up", () => {
    const punch = metrics({ elbowR: 170, raiseR: 0, extR: 0.4, depthR: 0.5, atHeightR: true });
    expect(run(new Windup("R"), punch, 20).some(Boolean)).toBe(false);
  });

  it("wind-up-and-throw: on after WINDUP_ON bent frames, off after WINDUP_OFF extended frames", () => {
    const w = new Windup("R");
    const on = run(w, BENT_R, WINDUP_ON + 2);
    expect(on.slice(0, WINDUP_ON - 1).every((v) => !v)).toBe(true);
    expect(on.slice(WINDUP_ON - 1).every(Boolean)).toBe(true);
    const off = run(w, THROWN_R, WINDUP_OFF + 1, 1000);
    expect(off.slice(0, WINDUP_OFF - 1).every(Boolean)).toBe(true);
    expect(off.slice(WINDUP_OFF - 1).every((v) => !v)).toBe(true);
    expect(w.diag().released).toBe(true);
  });

  it("wind-up-and-drop: lowering the hand below WINDUP_DROP also releases", () => {
    const w = new Windup("R");
    run(w, BENT_R, WINDUP_ON);
    const off = run(w, DROPPED_R, WINDUP_OFF, 1000);
    expect(off[WINDUP_OFF - 1]).toBe(false);
  });

  it("a held wind-up stays on through in-between poses (neither bent nor released)", () => {
    const w = new Windup("R");
    run(w, BENT_R, WINDUP_ON);
    const mid = metrics({ elbowR: WINDUP_ELBOW_DEG + 10, raiseR: 0.2 });
    expect(run(w, mid, 30, 1000).every(Boolean)).toBe(true);
  });

  it("only runs while a throwable is held; a sword or nothing never winds up", () => {
    expect(run(new Windup("R"), BENT_R, 20, 0, "sword").some(Boolean)).toBe(false);
    expect(run(new Windup("R"), BENT_R, 20, 0, null).some(Boolean)).toBe(false);
    const w = new Windup("R");
    run(w, BENT_R, WINDUP_ON);
    expect(w.update(BENT_R, 500, null)).toBe(false);
  });

  it("arms are independent", () => {
    const l = new Windup("L");
    expect(run(l, BENT_R, 20).some(Boolean)).toBe(false);
    expect(run(l, metrics({ elbowL: 70, raiseL: 0.35 }), WINDUP_ON)[WINDUP_ON - 1]).toBe(true);
  });

  it("reset drops the output", () => {
    const w = new Windup("R");
    run(w, BENT_R, WINDUP_ON);
    w.reset();
    expect(w.update(BENT_R, 5000, "molotov")).toBe(false);
    expect(w.diag().active).toBe(false);
  });

  it("classify holds punchR while the wind-up is active and drops it on release (falling edge throws)", () => {
    const w = new Windup("R");
    const g = () => ({
      left: false, right: false, jump: false, punchL: false, punchR: false, block: false, special: false, item: null,
      windupL: false, windupR: w.diag().active, chop: false, sweep: false, slashL: false, slashR: false,
      held: "molotov" as const,
    });
    run(w, BENT_R, WINDUP_ON);
    expect(classify(g()).punchR).toBe(true);
    run(w, THROWN_R, WINDUP_OFF, 1000);
    expect(classify(g()).punchR).toBe(false);
  });
});

describe("Metrics.jointAngle (elbow)", () => {
  it("is 180 for a straight arm, 90 for a right angle, 180 when degenerate", () => {
    const p = (x: number, y: number, z = 0) => ({ x, y, z, visibility: 1 });
    expect(jointAngle(p(0, 0), p(0, 1), p(0, 2))).toBeCloseTo(180, 5);
    expect(jointAngle(p(0, 0), p(0, 1), p(1, 1))).toBeCloseTo(90, 5);
    expect(jointAngle(p(0, 0), p(0, 1), p(0, 0))).toBeCloseTo(0, 5);
    expect(jointAngle(p(0, 0), p(0, 0), p(0, 0))).toBe(180);
    expect(jointAngle(undefined, p(0, 0), p(1, 1))).toBe(180);
  });
});

describe("Slash gesture (9.10)", () => {
  /** Right wrist above the nose, arm stretched up. */
  const OVERHEAD_R = metrics({ noseDropR: -0.5, extR: 0.9, raiseR: 1.25, atHeightR: false });
  /** Right wrist swung down to chest height with the arm extended. */
  const LANDED_R = metrics({ noseDropR: 0.6, extR: 0.9, raiseR: 0.1, atHeightR: true });
  /** Right wrist far out on its own side at shoulder height, then across the midline. */
  const SIDE_R = metrics({ wristXR: 1.2, atHeightR: true, extR: 1.0 });
  const ACROSS_R = metrics({ wristXR: -0.4, atHeightR: true, extR: 0.8 });

  function chopRun(s: Slash, t0 = 0, held: "sword" | "molotov" | null = "sword") {
    // update() reuses its output object, so each frame is copied at once.
    const outs = [];
    outs.push({ ...s.update(OVERHEAD_R, t0, held) });
    outs.push({ ...s.update(OVERHEAD_R, t0 + FRAME, held) });
    outs.push({ ...s.update(metrics({ noseDropR: 0.0, extR: 0.9 }), t0 + 2 * FRAME, held) });
    outs.push({ ...s.update(LANDED_R, t0 + 3 * FRAME, held) });
    return outs;
  }

  it("chop: wrist above the nose then a drop ≥ CHOP_DROP within the window with ext > CHOP_EXT pulses once", () => {
    const s = new Slash("R");
    const out = chopRun(s);
    expect(out.map((o) => o.chop)).toEqual([false, false, false, true]);
    expect(out[3]?.sweep).toBe(false);
    expect(out[3]?.exclusive).toBe(true);
    // The next frame in the same pose is not a second pulse.
    expect(s.update(LANDED_R, 4 * FRAME, "sword").chop).toBe(false);
    expect(CHOP_DROP).toBe(0.6);
  });

  it("chop needs the arm extended as it lands", () => {
    const s = new Slash("R");
    s.update(OVERHEAD_R, 0, "sword");
    const folded = s.update(metrics({ ...LANDED_R, extR: CHOP_EXT - 0.1 }), FRAME, "sword");
    expect(folded.chop).toBe(false);
  });

  it("chop needs the wrist to have been above the nose", () => {
    const s = new Slash("R");
    s.update(metrics({ noseDropR: 0.05, extR: 0.9 }), 0, "sword");
    expect(s.update(LANDED_R, FRAME, "sword").chop).toBe(false);
  });

  it("chop needs a sword: a molotov or empty hand never slashes", () => {
    expect(chopRun(new Slash("R"), 0, "molotov").some((o) => o.chop)).toBe(false);
    expect(chopRun(new Slash("R"), 0, null).some((o) => o.chop)).toBe(false);
  });

  it("sweep: horizontal travel ≥ SWEEP_TRAVEL across the midline at shoulder height pulses once", () => {
    const s = new Slash("R");
    expect(s.update(SIDE_R, 0, "sword").sweep).toBe(false);
    expect(s.update(metrics({ wristXR: 0.4, atHeightR: true }), FRAME, "sword").sweep).toBe(false);
    const hit = s.update(ACROSS_R, 2 * FRAME, "sword");
    expect(hit.sweep).toBe(true);
    expect(hit.chop).toBe(false);
    expect(s.update(ACROSS_R, 3 * FRAME, "sword").sweep).toBe(false);
    expect(SWEEP_TRAVEL).toBe(0.8);
  });

  it("sweep needs the midline crossing and shoulder height", () => {
    const s = new Slash("R");
    s.update(metrics({ wristXR: 2.0, atHeightR: true }), 0, "sword");
    expect(s.update(metrics({ wristXR: 0.3, atHeightR: true }), FRAME, "sword").sweep).toBe(false);
    const low = new Slash("R");
    low.update(metrics({ ...SIDE_R, atHeightR: false }), 0, "sword");
    expect(low.update(metrics({ ...ACROSS_R, atHeightR: false }), FRAME, "sword").sweep).toBe(false);
  });

  it("a slash suppresses that arm's punch for SLASH_EXCLUSIVE_MS, then a punch is free again", () => {
    const s = new Slash("R");
    chopRun(s);
    const t0 = 3 * FRAME;
    expect(s.update(REST, t0 + SLASH_EXCLUSIVE_MS - 1, "sword").exclusive).toBe(true);
    expect(s.update(REST, t0 + SLASH_EXCLUSIVE_MS, "sword").exclusive).toBe(false);
    const gFor = (slashR: boolean) => ({
      left: false, right: false, jump: false, punchL: false, punchR: true, block: false, special: false, item: null,
      windupL: false, windupR: false, chop: false, sweep: false, slashL: false, slashR, held: "sword" as const,
    });
    expect(classify(gFor(true)).punchR).toBe(false);
    expect(classify(gFor(false)).punchR).toBe(true);
    expect(SLASH_EXCLUSIVE_MS).toBe(300);
  });

  it("no new slash fires inside the exclusivity window", () => {
    const s = new Slash("R");
    chopRun(s);
    const again = chopRun(s, 3 * FRAME + 50);
    expect(again.some((o) => o.chop)).toBe(false);
  });

  it("reset clears the buffers and the window", () => {
    const s = new Slash("R");
    chopRun(s);
    s.reset();
    expect(s.diag().exclusive).toBe(false);
    expect(s.update(LANDED_R, 5000, "sword").chop).toBe(false);
  });
});
