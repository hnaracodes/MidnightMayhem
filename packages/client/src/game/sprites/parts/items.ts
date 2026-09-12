/**
 * Held-item sprites, 10–14 px. Anchors are the grip point (drawn on the front fist), except the backpack,
 * whose anchor is its strap edge (drawn on the back shoulder, behind the torso).
 */
import type { ItemId } from "@midnight/shared";
import { P } from "../../palette";
import type { Part } from "../grid";

const GLASS = 0x7FA98F;
const RAG = 0xD8D2C4;
const SHAFT = 0x2B2F45;
const FRAME = P.amber2;
const BLADE = 0xB7C3D9;
const EDGE = P.moon;
const GRIP = P.steel2;
const PACK = 0x6B7A45;
const PACK_DARK = 0x46522C;
const BANANA = 0xF2D23D;
const BANANA_TIP = 0x6B4A1E;
const PHONE = 0x1A1A1E;
const SCREEN = 0xBFE3FF;

/** Bottle with amber liquid and a rag stuffed in the neck; grip on the body. */
const molotov: Part = {
  grid: [
    "..hh.",
    ".hhhh",
    "..11.",
    "..11.",
    ".1111",
    "11111",
    "1aaa1",
    "1aaa1",
    "1aaa1",
    "1aaa1",
    "1aaa1",
    ".111.",
  ],
  anchor: { x: 2, y: 8 },
  palette: { "1": GLASS, h: RAG, a: P.amber1, ".": null },
};

/**
 * A sword (owner 2026-09-12; the real object is still a tennis racket): grip at the anchor, a short amber guard,
 * then a long straight blade with a bright edge and a point. 18 x 5 px, so it reads longer than the fist reach.
 */
const sword: Part = {
  grid: [
    "...A..............",
    "GGGAbbbbbbbbbbbbb.",
    "GGGAeeeeeeeeeeeeeE",
    "GGGAbbbbbbbbbbbbb.",
    "...A..............",
  ],
  anchor: { x: 1, y: 2 },
  palette: { G: GRIP, A: FRAME, b: BLADE, e: EDGE, E: EDGE, ".": null },
};

/** Backpack worn on the back: straps on the right edge (the anchor), pack hanging behind. */
const shield: Part = {
  grid: [
    "..2222..",
    ".211112A",
    "21111112",
    "21111112",
    "21222212",
    "21122112",
    "21122112",
    "21111112",
    ".211112A",
    "..2222..",
  ],
  anchor: { x: 7, y: 4 },
  palette: { "1": PACK, "2": PACK_DARK, A: P.amber2, ".": null },
};

/** Banana, tips up, held by the middle. */
const banana: Part = {
  grid: [
    "2........2",
    "11......11",
    ".11....11.",
    "..111111..",
    "...1111...",
  ],
  anchor: { x: 4, y: 3 },
  palette: { "1": BANANA, "2": BANANA_TIP, ".": null },
};

/** Phone held up, screen lit, camera flash dot on the back edge. */
const flash: Part = {
  grid: [
    "11111",
    "12221",
    "12221",
    "12221",
    "12w21",
    "12221",
    "12221",
    "12221",
    "11111",
    ".1o1.",
  ],
  anchor: { x: 2, y: 6 },
  palette: { "1": PHONE, "2": SCREEN, w: P.white, o: P.outline, ".": null },
};

export const ITEM_PARTS: Record<ItemId, Part> = { molotov, sword, shield, banana, flash };
