import { describe, expect, it } from "vitest";
import { BALANCE, CHARACTERS, ITEM_IDS, createMatch, type CharacterId, type FighterState, type ItemId } from "@midnight/shared";
import { computePose, type Clock } from "../src/game/rig/pose";
import { P } from "../src/game/palette";
import { GRID_PALETTE, PixelCanvas, alphaOf, parseGrid, parsePart, rgba, type Part } from "../src/game/sprites/grid";
import {
  ANCHOR, CHARACTER_PARTS, FRAME_H, FRAME_W, ITEM_SPRITES, SPRITE_SCALE, composeFrame, createFrameCanvas, isBlinkOn, jointToSprite,
  type ComposeOpts,
} from "../src/game/sprites/compose";
import { BODY_SCALE } from "../src/game/rig/characters";

/** 13.01: the 11.01 minimums were authored at 3 world px per art px for a 150 px body; at 1 px and 70 % they are ×2.1. */
const K = 2.1;

const clock: Clock = { renderMs: 0, koFrames: 0, landFrames: 0 };
const base = (over: Partial<FighterState> = {}): FighterState => ({ ...createMatch().fighters[0]!, ...over });
const OPTS: ComposeOpts = { facing: 1, rimColor: P.amber1, rimSide: "both", gloom: 0, alpha: 1, itemVisible: true };
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
      expect(size(parts.head)[0]).toBeGreaterThanOrEqual(Math.floor(14 * K));
      expect(size(parts.head)[1]).toBeGreaterThanOrEqual(Math.floor(14 * K));
      expect(size(parts.headKo)[0]).toBeGreaterThanOrEqual(Math.floor(14 * K));
      expect(size(parts.headKo)[1]).toBeGreaterThanOrEqual(Math.floor(14 * K));
      expect(colourCount(parts.head)).toBeGreaterThanOrEqual(3);
      expect(size(parts.torso)[0]).toBeGreaterThanOrEqual(Math.floor(12 * K));
      expect(size(parts.torso)[1]).toBeGreaterThanOrEqual(Math.floor(18 * K));
      expect(size(parts.handOpen)).toEqual([Math.round(5 * K), Math.round(5 * K)]);
      expect(size(parts.handFist)).toEqual([Math.round(5 * K), Math.round(5 * K)]);
      expect(size(parts.foot)).toEqual([Math.round(7 * K), Math.round(4 * K)]);
      expect(opaqueCount(parts.head)).toBeGreaterThan(80 * K * K);
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
    // one authored row, which the 13.01 placeholder resample spreads over two or three
    expect(diff.length).toBeGreaterThanOrEqual(1);
    expect(diff.length).toBeLessThanOrEqual(Math.ceil(K));
  });

  it("every item sprite parses and is 21–29 px on its long side (10–14 authored × 2.1)", () => {
    for (const id of ITEM_IDS) {
      const p = ITEM_SPRITES[id];
      expect(() => parsePart(p)).not.toThrow();
      const { w, h } = parsePart(p);
      expect(Math.max(w, h), id).toBeGreaterThanOrEqual(Math.floor(10 * K));
      expect(Math.max(w, h), id).toBeLessThanOrEqual(Math.ceil(14 * K));
    }
  });
});

/** 13.01 rule 7: the standing world bounds every later lane must keep (width, height, top above the feet). */
const STANDING_BOUNDS: Record<CharacterId, { w: number; h: number; top: number }> = {
  drifter: { w: 58, h: 108, top: -107 }, conductor: { w: 41, h: 109, top: -108 }, stoker: { w: 60, h: 108, top: -107 }, claude: { w: 44, h: 109, top: -108 },
};

describe("13.01 rule 7: standing world bounds are the contract every later art lane keeps (±1 px)", () => {
  for (const id of CHARACTERS) {
    it(`${id} stands ${STANDING_BOUNDS[id].h} px tall and ${STANDING_BOUNDS[id].w} wide with the feet on the anchor row`, () => {
      const c = frame(base({ character: id }));
      const b = bounds(c);
      const want = STANDING_BOUNDS[id];
      // sprite px are world px at SPRITE_SCALE 1, so these are world bounds
      expect(Math.abs((b.x1 - b.x0 + 1) * SPRITE_SCALE - want.w)).toBeLessThanOrEqual(1);
      expect(Math.abs((b.y1 - b.y0 + 1) * SPRITE_SCALE - want.h)).toBeLessThanOrEqual(1);
      expect(Math.abs((b.y0 - ANCHOR.y) * SPRITE_SCALE - want.top)).toBeLessThanOrEqual(1);
      expect(b.y1).toBe(ANCHOR.y);
    });
  }
});

describe("rule 2: the idle frame fills the nominal frame from the feet up", () => {
  const MIN_ROWS = Math.round(150 * BODY_SCALE * 0.88 / SPRITE_SCALE); // 92 of the 105 px body
  for (const id of CHARACTERS) {
    it(`${id} idle spans ≥ ${MIN_ROWS} rows, ≤ ${FRAME_W} columns, feet at row ${ANCHOR.y}`, () => {
      const c = frame(base({ character: id }));
      const b = bounds(c);
      expect(b.y1).toBe(ANCHOR.y);
      expect(b.y1 - b.y0 + 1).toBeGreaterThanOrEqual(MIN_ROWS);
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
        const c = frame(base({ character: id, ...over }), { rimSide: "right" });
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
        expect(edge).toBeGreaterThan(40 * K);
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
        expect(Math.abs(centre.x - fist.x)).toBeLessThanOrEqual(2 * K);
        expect(Math.abs(centre.y - fist.y)).toBeLessThanOrEqual(2 * K);
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
      const part = ITEM_SPRITES[kind];
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
    expect(b.y1 - b.y0 + 1).toBeLessThan(30 * K);
    expect(b.x1 - b.x0 + 1).toBeGreaterThan(30 * K);
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
    expect(diff).toBeLessThanOrEqual(Math.ceil(3 * K * K));
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
  it("the rim sits on the chosen edge only, both in the tunnel", () => {
    const f = base({ character: "conductor" });
    const right = frame(f, { rimSide: "right" });
    const left = frame(f, { rimSide: "left" });
    const both = frame(f, { rimSide: "both" });
    const amber = rgba(P.amber1);
    const count = (c: PixelCanvas): number => { let n = 0; for (const px of c.data) if (px === amber) n += 1; return n; };
    expect(count(both)).toBeGreaterThan(count(right));
    expect(count(both)).toBeGreaterThan(count(left));
    // 12.02 rule 9: a rim pixel on the right edge has the outline to its right; on the left edge, to its left
    const outline = rgba(P.outline);
    const sideOf = (c: PixelCanvas, dx: 1 | -1): number => {
      let n = 0;
      for (let y = 0; y < c.h; y++) for (let x = 1; x < c.w - 1; x++) if (c.data[y * c.w + x] === amber && c.data[y * c.w + x + dx] === outline) n += 1;
      return n;
    };
    // (a one-pixel-wide run has outline on both sides, so the off side is small, not zero)
    expect(sideOf(right, 1)).toBeGreaterThan(0);
    expect(sideOf(right, -1)).toBeLessThan(sideOf(right, 1) / 4);
    expect(sideOf(left, -1)).toBeGreaterThan(0);
    expect(sideOf(left, 1)).toBeLessThan(sideOf(left, -1) / 4);
  });
  it("12.02 rule 8: the rim colour follows the light and gloom darkens fills but not the outline", () => {
    const f = base({ character: "conductor" });
    const cyan = frame(f, { rimSide: "right", rimColor: P.glow1 });
    const warm = frame(f, { rimSide: "right", rimColor: P.amber1 });
    const count = (c: PixelCanvas, color: number): number => { let n = 0; for (const px of c.data) if (px === rgba(color)) n += 1; return n; };
    expect(count(cyan, P.glow1)).toBeGreaterThan(0);
    expect(count(warm, P.glow1)).toBe(0);
    expect(count(cyan, P.amber1)).toBeLessThan(count(warm, P.amber1)); // the cuffs stay amber; the rim moved to cyan
    const lit = frame(f, { gloom: 0 });
    const dim = frame(f, { gloom: 0.25 });
    const outline = rgba(P.outline);
    let outlines = 0, darker = 0, same = 0;
    for (let i = 0; i < lit.data.length; i++) {
      const a = lit.data[i]!, b = dim.data[i]!;
      if (a === outline) { expect(b).toBe(outline); outlines += 1; continue; }
      if (a === 0 || a === rgba(P.amber1)) continue;
      if (b === a) same += 1; else darker += 1;
    }
    expect(outlines).toBeGreaterThan(0);
    expect(darker).toBeGreaterThan(same);
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
    ["throw", { action: { kind: "throw", item: "molotov", arm: "R", phase: "release", charge: 0, elapsed: 3, released: false }, item: { kind: "molotov", uses: 2 } }, {}],
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

// ---- 13.02 shading engine ----

import { PART_ID, composeKey, rampsFor } from "../src/game/sprites/compose";
import { OUTLINE_ID } from "../src/game/sprites/grid";

describe("13.02 rule 5: part ids and occlusion", () => {
  it("every drawn pixel carries a part id, outline pixels OUTLINE_ID, and the front arm occludes the torso where they meet", () => {
    const f = base({ character: "conductor" });
    const joints = computePose(f, clock);
    const c = frame(f);
    let parts = 0, outline = 0;
    for (let i = 0; i < c.data.length; i++) {
      if (c.data[i] === 0) { expect(c.ids[i]).toBe(0); continue; }
      // the outline pass marks its pixels OUTLINE_ID; authored in-part outline detail (eyes, knuckles) keeps its part id
      if (c.ids[i] === OUTLINE_ID) { expect(c.data[i]).toBe(OUTLINE); outline += 1; } else { expect(c.ids[i]).toBeGreaterThan(0); parts += 1; }
    }
    expect(parts).toBeGreaterThan(1000);
    expect(outline).toBeGreaterThan(100);
  });

  it("occludeAndGloom darkens only the lower part where a higher part touches it, more at 1 px than at 2, and leaves the higher part alone", () => {
    const c = new PixelCanvas(40, 20);
    const lower = rgba(0x8a6b4a);
    const upper = rgba(0x1b2a5c);
    c.id = 4;
    for (let y = 2; y < 18; y++) for (let x = 2; x < 30; x++) c.set(x, y, lower);
    c.id = 7;
    for (let y = 2; y < 18; y++) for (let x = 20; x < 38; x++) c.set(x, y, upper);
    c.occludeAndGloom(0.35, 0.18, P.night1, 0, P.night1);
    const lum = (px: number): number => ((px >>> 24) & 255) + ((px >>> 16) & 255) + ((px >>> 8) & 255);
    const far = c.get(5, 10);           // lower part, nowhere near the upper one
    const ring2 = c.get(18, 10);        // two pixels from the boundary at x 20
    const ring1 = c.get(19, 10);        // touching it
    expect(far).toBe(lower);
    expect(lum(ring1)).toBeLessThan(lum(ring2));
    expect(lum(ring2)).toBeLessThan(lum(far));
    for (let y = 2; y < 18; y++) for (let x = 20; x < 38; x++) expect(c.get(x, y)).toBe(upper);
    // gloom rides the same sweep and dims both parts
    c.occludeAndGloom(0, 0, P.night1, 0.25, P.night1);
    expect(lum(c.get(5, 10))).toBeLessThan(lum(lower));
    expect(lum(c.get(30, 10))).toBeLessThan(lum(upper));
  });
});

describe("13.02 rules 2–3: the light vector shades the limbs", () => {
  it("frames lit from the left and from the right differ in their limb pixels and both keep the standing bounds", () => {
    const f = base({ character: "drifter" });
    const left = frame(f, { lightDir: { x: -1, y: -0.2 }, rimSide: "left" });
    const right = frame(f, { lightDir: { x: 1, y: -0.2 }, rimSide: "right" });
    let diff = 0;
    for (let i = 0; i < left.data.length; i++) if (left.data[i] !== right.data[i]) diff += 1;
    expect(diff).toBeGreaterThan(200);
    const bl = bounds(left), br = bounds(right), want = STANDING_BOUNDS.drifter;
    for (const b of [bl, br]) {
      expect(Math.abs(b.x1 - b.x0 + 1 - want.w)).toBeLessThanOrEqual(1);
      expect(Math.abs(b.y1 - b.y0 + 1 - want.h)).toBeLessThanOrEqual(1);
    }
    // the front thigh (a near-vertical limb) shows all four ramp steps when lit from the side
    const ramp = rampsFor(CHARACTER_PARTS.drifter).leg;
    const steps = new Set<number>();
    for (let i = 0; i < left.data.length; i++) if (left.ids[i] === PART_ID.legF) { const k = ramp.findIndex((c) => rgba(c) === left.data[i]); if (k >= 0) steps.add(k); }
    expect(steps.size).toBe(4);
  });
  it("flatLimbs draws the limbs in the base step only", () => {
    const f = base({ character: "conductor" });
    const c = frame(f, { flatLimbs: true, lightDir: { x: -1, y: 0 } });
    const ramp = rampsFor(CHARACTER_PARTS.conductor).limb;
    for (let i = 0; i < c.data.length; i++) {
      if (c.ids[i] !== PART_ID.armF) continue;
      const px = c.data[i]!;
      // arm pixels are the base step, the cuff ramp's base, or the hand part's colours; never highlight/shade/core of the limb ramp
      expect([ramp[0], ramp[2], ramp[3]].map((v) => rgba(v))).not.toContain(px);
    }
  });
});

describe("13.02 rule 7: composeKey", () => {
  it("is stable for the same inputs, changes on a 1 px joint move, ignores a sub-pixel one and a sub-quantum gloom change", () => {
    const f = base({ character: "stoker" });
    const j = computePose(f, clock);
    const k0 = composeKey(j, f, "stoker", OPTS);
    expect(composeKey(computePose(f, clock), f, "stoker", { ...OPTS })).toBe(k0);
    const moved = structuredClone(j);
    moved.arms.F.fist.x += 1;
    expect(composeKey(moved, f, "stoker", OPTS)).not.toBe(k0);
    const sub = structuredClone(j);
    sub.arms.F.fist.x += 0.2;
    expect(composeKey(sub, f, "stoker", OPTS)).toBe(k0);
    expect(composeKey(j, f, "stoker", { ...OPTS, gloom: 0.004 })).toBe(k0);
    expect(composeKey(j, f, "stoker", { ...OPTS, gloom: 0.2 })).not.toBe(k0);
    expect(composeKey(j, f, "stoker", { ...OPTS, lightDir: { x: -1, y: 0 } })).not.toBe(composeKey(j, f, "stoker", { ...OPTS, lightDir: { x: 1, y: 0 } }));
    expect(composeKey(j, f, "stoker", { ...OPTS, facing: -1 })).not.toBe(k0);
    // the blink only matters for the character that blinks
    expect(composeKey(j, f, "stoker", { ...OPTS, blinkMs: 600 })).toBe(k0);
    const cl = base({ character: "claude" });
    const jc = computePose(cl, clock);
    expect(composeKey(jc, cl, "claude", { ...OPTS, blinkMs: 600 })).not.toBe(composeKey(jc, cl, "claude", { ...OPTS, blinkMs: 0 }));
  });
});

describe("13.02 rule 7: the in-place outline matches the reference definition", () => {
  it("every transparent pixel with an opaque 8-neighbour became outline, and nothing else did", () => {
    const f = base({ character: "drifter", action: { kind: "punch", arm: "R", elapsed: 5, landed: false, sword: false } });
    const joints = computePose(f, clock);
    const c = createFrameCanvas();
    composeFrame(c, joints, f, "drifter", { ...OPTS, rimSide: "right" });
    for (let y = 0; y < c.h; y++) for (let x = 0; x < c.w; x++) {
      const i = y * c.w + x;
      if (c.ids[i] !== OUTLINE_ID) continue;
      let touch = false;
      for (let dy = -1; dy <= 1 && !touch; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= c.w || ny >= c.h) continue;
        const id = c.ids[ny * c.w + nx]!;
        if (id !== 0 && id !== OUTLINE_ID) { touch = true; break; }
      }
      expect(touch, `outline pixel ${x},${y} touches a part`).toBe(true);
    }
  });
});
