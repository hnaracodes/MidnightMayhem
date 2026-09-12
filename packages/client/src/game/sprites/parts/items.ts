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
const HOOK = P.amber2;
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

/** Folded umbrella held like a sabre: hooked handle at the grip, shaft forward, metal ferrule. */
const sword: Part = {
  grid: [
    ".AA...........",
    "A..A..........",
    "...A111111111h",
    "...A111111111h",
    "...A1.1.1.1...",
  ],
  anchor: { x: 4, y: 2 },
  palette: { "1": SHAFT, A: HOOK, h: P.moon, ".": null },
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
