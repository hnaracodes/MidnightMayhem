import { describe, expect, it } from "vitest";
import { BALANCE, CHARACTERS, ITEM_IDS, createMatch, type CharacterId, type FighterState, type ItemId } from "@midnight/shared";
import { computePose, type Clock } from "../src/game/rig/pose";
import { P } from "../src/game/palette";
import { GRID_PALETTE, PixelCanvas, alphaOf, parseGrid, parsePart, rgba, type Part } from "../src/game/sprites/grid";
import {
  ANCHOR, CHARACTER_PARTS, FRAME_H, FRAME_W, composeFrame, createFrameCanvas, isBlinkOn, jointToSprite,
  type ComposeOpts,
} from "../src/game/sprites/compose";
import { ITEM_PARTS } from "../src/game/sprites/parts/items";

const clock: Clock = { renderMs: 0, koFrames: 0, landFrames: 0 };
const base = (over: Partial<FighterState> = {}): FighterState => ({ ...createMatch().fighters[0]!, ...over });
const OPTS: ComposeOpts = { facing: 1, rimBoth: true, alpha: 1, itemVisible: true };
const OUTLINE = rgba(P.outline);

function frame(f: FighterState, opts: Partial<ComposeOpts> = {}, clk: Clock = clock): PixelCanvas {
  const c = createFrameCanvas();
  composeFrame(c, computePose(f, clk), f, f.character, { ...OPTS, facing: f.facing, ...opts });
  return c;
}

/** Bounding box of opaque pixels in frame coordinates. */
function bounds(c: PixelCanvas): { x0: number; y0: number; x1: number; y1: number } {
  const b = c.bounds();
  if (!b) throw new Error("empty frame");
  return b;
}

function opaqueCount(part: Part): number {
  const { data } = parsePart(part);
  let n = 0;
  for (const px of data) if (px !== 0) n += 1;
  return n;
}

function colourCount(part: Part): number {
  const { data } = parsePart(part);
  const set = new Set<number>();
  for (const px of data) if (px !== 0 && px !== OUTLINE) set.add(px);
  return set.size;
}

/** Centre of the opaque pixels that `part` contributed, found by re-blitting it alone and comparing. */
function centreOfPartAt(c: PixelCanvas, part: Part, x: number, y: number): { x: number; y: number } {
  const solo = createFrameCanvas();
  solo.blit(part, x, y, false);
  let sx = 0, sy = 0, n = 0;
  for (let yy = -solo.oy; yy < solo.h - solo.oy; yy++) {
    for (let xx = -solo.ox; xx < solo.w - solo.ox; xx++) {
      const px = solo.get(xx, yy);
      if (px !== 0 && c.get(xx, yy) === px) { sx += xx; sy += yy; n += 1; }
    }
  }
  expect(n).toBeGreaterThan(0);
  return { x: sx / n, y: sy / n };
}

describe("rule 1: every grid parses and every character has every part at the minimum size", () => {
  it("parseGrid rejects ragged rows and unknown characters", () => {
    expect(() => parseGrid(["..", "..."], GRID_PALETTE)).toThrow(/row 1/);
    expect(() => parseGrid(["..", ".z"], GRID_PALETTE)).toThrow(/unknown char 'z'/);
    const p = parseGrid([".o", "h."], GRID_PALETTE);
    expect([p.w, p.h]).toEqual([2, 2]);
    expect(p.data[1]).toBe(OUTLINE);
    expect(p.data[2]).toBe(rgba(P.moon));
    expect(p.data[0]).toBe(0);
  });

  for (const id of CHARACTERS) {
    const parts = CHARACTER_PARTS[id];
    it(`${id}: parts present, parse, and meet the minimum sizes`, () => {
      for (const key of ["head", "headKo", "torso", "handOpen", "handFist", "foot"] as const) {
        const part = parts[key];
        expect(part, key).toBeDefined();
        expect(() => parsePart(part)).not.toThrow();
        expect(part.anchor.x).toBeGreaterThanOrEqual(0);
        expect(part.anchor.y).toBeGreaterThanOrEqual(0);
      }
      const size = (p: Part): [number, number] => [parsePart(p).w, parsePart(p).h];
      expect(size(parts.head)[0]).toBeGreaterThanOrEqual(14);
      expect(size(parts.head)[1]).toBeGreaterThanOrEqual(14);
      expect(size(parts.headKo)[0]).toBeGreaterThanOrEqual(14);
      expect(size(parts.headKo)[1]).toBeGreaterThanOrEqual(14);
      expect(colourCount(parts.head)).toBeGreaterThanOrEqual(3);
      expect(size(parts.torso)[0]).toBeGreaterThanOrEqual(12);
      expect(size(parts.torso)[1]).toBeGreaterThanOrEqual(18);
      expect(size(parts.handOpen)).toEqual([5, 5]);
      expect(size(parts.handFist)).toEqual([5, 5]);
      expect(size(parts.foot)).toEqual([7, 4]);
      expect(opaqueCount(parts.head)).toBeGreaterThan(80);
      expect(parts.headKo.grid).not.toEqual(parts.head.grid);
      for (const v of [parts.limbColor, parts.limbShade, parts.legColor]) expect(v).toBeGreaterThanOrEqual(0);
      for (const [k, v] of Object.entries(parts.extras)) {
        expect(k).toMatch(/^[1-4]$/);
        expect(v).toBeGreaterThanOrEqual(0);
      }
    });
  }

  it("claude has a blink torso that differs from the torso by the prompt underscore only", () => {
    const c = CHARACTER_PARTS.claude;
    expect(c.torsoBlink).toBeDefined();
    const diff = c.torso.grid.filter((row, i) => row !== c.torsoBlink!.grid[i]);
    expect(diff).toHaveLength(1);
  });

  it("every item part parses and is 10–14 px on its long side", () => {
    for (const id of ITEM_IDS) {
      const p = ITEM_PARTS[id];
      expect(() => parsePart(p)).not.toThrow();
      const { w, h } = parsePart(p);
      expect(Math.max(w, h), id).toBeGreaterThanOrEqual(10);
      expect(Math.max(w, h), id).toBeLessThanOrEqual(14);
    }
  });
});

describe("rule 2: the idle frame fills the nominal frame from the feet up", () => {
  for (const id of CHARACTERS) {
    it(`${id} idle spans ≥ 44 rows, ≤ ${FRAME_W} columns, feet at row ${ANCHOR.y}`, () => {
      const c = frame(base({ character: id }));
      const b = bounds(c);
      expect(b.y1).toBe(ANCHOR.y);
      expect(b.y1 - b.y0 + 1).toBeGreaterThanOrEqual(44);
      expect(b.y1 - b.y0 + 1).toBeLessThanOrEqual(FRAME_H);
      expect(b.x1 - b.x0 + 1).toBeLessThanOrEqual(FRAME_W);
      expect(b.x0).toBeGreaterThanOrEqual(0);
      expect(b.x1).toBeLessThan(FRAME_W);
    });
  }
});

describe("rule 3: facing left is a pixel-for-pixel mirror", () => {
  // the same local pose for both facings: walking forward, punching with the front arm
  const states: Array<(facing: 1 | -1) => Partial<FighterState>> = [
    () => ({}),
    (facing) => ({ vx: 3 * facing }),
    (facing) => ({ action: { kind: "punch", arm: facing === 1 ? "R" : "L", elapsed: 5, landed: false, sword: false } }),
    () => ({ blocking: true }),
    () => ({ hitstun: 8 }),
    () => ({ hp: 0 }),
    () => ({ item: { kind: "sword", uses: 6 } }),
  ];
  for (const id of CHARACTERS) {
    states.forEach((over, i) => {
      it(`${id} state ${i}`, () => {
        const right = frame(base({ character: id, ...over(1), facing: 1 }));
        const left = frame(base({ character: id, ...over(-1), facing: -1 }));
        for (let y = -right.oy; y < right.h - right.oy; y++) {
          for (let x = -right.ox; x < right.w - right.ox; x++) {
            expect(left.get(2 * ANCHOR.x - 1 - x, y)).toBe(right.get(x, y));
          }
        }
      });
    });
  }
});

describe("rule 4: the silhouette edge is always outline", () => {
  for (const id of CHARACTERS) {
    for (const over of [{}, { hp: 0 }, { action: { kind: "punch" as const, arm: "L" as const, elapsed: 5, landed: false, sword: false } }]) {
      it(`${id} ${JSON.stringify(over)}`, () => {
        const c = frame(base({ character: id, ...over }), { rimBoth: false });
        let edge = 0;
        for (let y = 0; y < c.h; y++) {
          for (let x = 0; x < c.w; x++) {
            const px = c.data[y * c.w + x]!;
            if (px === 0) continue;
            const touchesEmpty = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
              const nx = x + dx!;
              const ny = y + dy!;
              return nx >= 0 && ny >= 0 && nx < c.w && ny < c.h && c.data[ny * c.w + nx] === 0;
            });
            if (touchesEmpty) {
              edge += 1;
              expect(px, `pixel ${x},${y}`).toBe(OUTLINE);
            }
          }
        }
        expect(edge).toBeGreaterThan(40);
      });
    }
  }
});

describe("rule 5: the punching hand sits on the fist joint", () => {
  const start = BALANCE.PUNCH_STARTUP;
  for (const id of CHARACTERS) {
    for (const arm of ["L", "R"] as const) {
      it(`${id} arm ${arm}`, () => {
        const f = base({ character: id, action: { kind: "punch", arm, elapsed: start + 1, landed: false, sword: false } });
        const joints = computePose(f, clock);
        expect(joints.punchingArm).not.toBeNull();
        const fist = jointToSprite(joints.arms[joints.punchingArm!].fist, f);
        // fist inside the nominal frame, forward of the body
        expect(fist.x).toBeGreaterThan(ANCHOR.x + 8);
        const c = createFrameCanvas();
        composeFrame(c, joints, f, id, OPTS);
        const hand = CHARACTER_PARTS[id].handFist;
        const centre = centreOfPartAt(c, hand, fist.x, fist.y);
        expect(Math.abs(centre.x - fist.x)).toBeLessThanOrEqual(2);
        expect(Math.abs(centre.y - fist.y)).toBeLessThanOrEqual(2);
      });
    }
  }
});

describe("rule 6: items ride the front hand or the back", () => {
  const handItems: ItemId[] = ["molotov", "sword", "banana", "flash"];
  for (const kind of handItems) {
    it(`${kind} is centred on the front fist`, () => {
      const f = base({ character: "drifter", item: { kind, uses: 1 } });
      const joints = computePose(f, clock);
      const c = createFrameCanvas();
      composeFrame(c, joints, f, "drifter", OPTS);
      const fist = jointToSprite(joints.arms.F.fist, f);
      const part = ITEM_PARTS[kind];
      const centre = centreOfPartAt(c, part, fist.x, fist.y);
      const { w, h } = parsePart(part);
      // the grip (anchor) is on the fist: the part's centroid lies within its own extent of it
      expect(Math.abs(centre.x - fist.x)).toBeLessThanOrEqual(w);
      expect(Math.abs(centre.y - fist.y)).toBeLessThanOrEqual(h);
      const without = frame(base({ character: "drifter" }));
      expect(c.data).not.toEqual(without.data);
    });
  }

  it("the backpack is drawn behind the torso at the back shoulder", () => {
    const f = base({ character: "conductor", item: { kind: "shield", uses: 3 } });
    const joints = computePose(f, clock);
    const c = createFrameCanvas();
    composeFrame(c, joints, f, "conductor", OPTS);
    const sh = jointToSprite(joints.arms.B.shoulder, f);
    const b = bounds(c);
    // the pack extends behind (left of) the body compared with the bare frame
    const bare = bounds(frame(base({ character: "conductor" })));
    expect(b.x0).toBeLessThan(bare.x0);
    // pack pixels are visible behind the body but the torso stays intact in front (row through the pack)
    const packColour = rgba(0x6B7A45);
    let pack = 0;
    for (let x = -c.ox; x < sh.x; x++) if (c.get(x, sh.y + 2) === packColour) pack += 1;
    expect(pack).toBeGreaterThan(0);
    expect(c.get(sh.x + 1, sh.y + 4)).not.toBe(packColour);
  });

  it("itemVisible: false draws no item", () => {
    const f = base({ character: "stoker", item: { kind: "sword", uses: 6 } });
    const hidden = frame(f, { itemVisible: false });
    const bare = frame(base({ character: "stoker" }));
    expect(hidden.data).toEqual(bare.data);
  });
});

describe("rule 7: KO head and blink torso", () => {
  it("headKo replaces head when the pose is ko", () => {
    const f = base({ character: "conductor", hp: 0 });
    const ko = frame(f, {}, { ...clock, koFrames: 60 });
    const alive = frame(base({ character: "conductor" }));
    expect(ko.data).not.toEqual(alive.data);
    // the ko frame is low and wide: sprawled on the roof
    const b = bounds(ko);
    expect(b.y1 - b.y0 + 1).toBeLessThan(30);
    expect(b.x1 - b.x0 + 1).toBeGreaterThan(30);
  });

  it("isBlinkOn toggles every 500 ms", () => {
    expect(isBlinkOn(0)).toBe(false);
    expect(isBlinkOn(499)).toBe(false);
    expect(isBlinkOn(500)).toBe(true);
    expect(isBlinkOn(999)).toBe(true);
    expect(isBlinkOn(1000)).toBe(false);
  });

  it("claude's prompt underscore is off in the blink half", () => {
    const f = base({ character: "claude" });
    const on = frame(f, { blinkMs: 0 });
    const off = frame(f, { blinkMs: 600 });
    expect(on.data).not.toEqual(off.data);
    let diff = 0;
    for (let i = 0; i < on.data.length; i++) if (on.data[i] !== off.data[i]) diff += 1;
    expect(diff).toBeLessThanOrEqual(3);
    // other characters ignore the clock
    const d0 = frame(base({ character: "drifter" }), { blinkMs: 0 });
    const d1 = frame(base({ character: "drifter" }), { blinkMs: 600 });
    expect(d0.data).toEqual(d1.data);
  });
});

describe("lighting and flash", () => {
  it("flash mixes every opaque pixel toward the flash colour", () => {
    const f = base({ character: "drifter" });
    const c = frame(f, { flash: P.white, flashAlpha: 1 });
    for (const px of c.data) if (px !== 0) expect(px).toBe(rgba(P.white));
  });
  it("alpha scales every pixel", () => {
    const c = frame(base({ character: "drifter" }), { alpha: 0.5 });
    for (const px of c.data) if (px !== 0) expect(alphaOf(px)).toBe(128);
  });
  it("the rim sits on the screen-right edge only unless rimBoth", () => {
    const f = base({ character: "conductor" });
    const one = frame(f, { rimBoth: false });
    const both = frame(f, { rimBoth: true });
    const amber = rgba(P.amber1);
    const count = (c: PixelCanvas): number => { let n = 0; for (const px of c.data) if (px === amber) n += 1; return n; };
    expect(count(both)).toBeGreaterThan(count(one));
  });
});

describe("every character × state composes without throwing", () => {
  const states: Array<[string, Partial<FighterState>, Partial<Clock>]> = [
    ["idle", {}, {}],
    ["walk", { vx: 3 }, {}],
    ["jump", { grounded: false, vy: -6, jumpTicks: 5 }, {}],
    ["punch", { action: { kind: "punch", arm: "R", elapsed: 5, landed: false, sword: false } }, {}],
    ["block", { blocking: true }, {}],
    ["hit", { hitstun: 6 }, {}],
    ["ko", { hp: 0 }, { koFrames: 30 }],
    ["win", {}, { win: true }],
    ["throw", { action: { kind: "throw", item: "molotov", arm: "R", elapsed: 3, released: false }, item: { kind: "molotov", uses: 2 } }, {}],
    ["laser", { action: { kind: "laser", elapsed: 10, hit: [] } }, {}],
  ];
  for (const id of CHARACTERS as readonly CharacterId[]) {
    for (const [name, over, clk] of states) {
      for (const facing of [1, -1] as const) {
        for (const item of [null, "sword", "shield"] as const) {
          it(`${id} ${name} facing ${facing} item ${item}`, () => {
            const f = base({ character: id, ...over, facing, item: item ? { kind: item, uses: 1 } : null });
            const c = frame(f, {}, { ...clock, ...clk });
            const b = bounds(c);
            expect(b.y1).toBeLessThanOrEqual(ANCHOR.y);
            // nothing touches the raster border: the outline pass needs a free ring, and a pixel on the
            // border means the pose (punch reach, sword, KO sprawl) is clipped
            expect(b.x0).toBeGreaterThan(-c.ox);
            expect(b.y0).toBeGreaterThan(-c.oy);
            expect(b.x1).toBeLessThan(c.w - c.ox - 1);
            expect(b.y1).toBeLessThan(c.h - c.oy - 1);
          });
        }
      }
    }
  }
});
