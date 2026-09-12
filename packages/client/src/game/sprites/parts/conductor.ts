/**
 * The Conductor: peaked cap with a brass badge, navy uniform buttoned in two brass columns, moon collar,
 * watch chain across the lower coat, coat tails off the back, white gloves, polished shoes.
 * Navy, brass, white only. No outer outline in the grids (compose.ts adds it).
 */
import { P } from "../../palette";
import { darken, type Part } from "../grid";
import type { CharacterParts } from "../compose";

const NAVY_DARK = darken(P.conductorKey, 0.62);
const TROUSER = 0x16224A;
const SHOE = 0x0C1226;

const PAL: Record<string, number | null> = {
  k: P.conductorKey,
  K: NAVY_DARK,
  s: 0xE9C9AE,
  S: darken(0xE9C9AE, 0.8),
  "1": P.conductorGlove,
  "2": TROUSER,
  "3": SHOE,
};

const part = (grid: string[], anchor: { x: number; y: number }): Part => ({ grid, anchor, palette: PAL });

const head = part([
  "...kkkkkkkkkk..",
  "..kkkkkkkkkkkk.",
  "..kkkkkkkkkkkk.",
  "..KKKKKKKKaKKKK",
  "....KKKKKKKKKKK",
  "....sssssssss..",
  "...sssssssssss.",
  "...sssohsssohs.",
  "...ssssssssssS.",
  "...sssssssssss.",
  "....ssssoosss..",
  "....ssssssss...",
  ".....ssssss....",
  "......ssss.....",
], { x: 7, y: 3 });

const headKo = part([
  ".kkkkkkkkkk....",
  "kkkkkkkkkkkk...",
  "kkkkkkkkkkkk...",
  "KKKKKKKKaKKKK..",
  "..KKKKKKKKKKK..",
  "....sssssssss..",
  "...sssssssssss.",
  "...ssosossosos.",
  "...sssosssossS.",
  "...ssosossosos.",
  "....sssoooss...",
  "....ssssssss...",
  ".....ssssss....",
  "......ssss.....",
], { x: 7, y: 3 });

const torso = part([
  ".kkkkhhkkkkk.",
  "KKkkkkhkkkkkk",
  "KKkkkkkkkkkkk",
  "KKkkkakkkakkk",
  "KKkkkkkkkkkkk",
  "KKkkkkkkkkkkk",
  "KKkkkakkkakkk",
  "KKkkkkkkkkkkk",
  "KKkkkkkkkkkkk",
  "KKkkkakkkakkk",
  "KKkkkkkkkkkkk",
  ".Kkkkkkkkkkk.",
  ".Kkkkkkkkkkk.",
  ".Kkkakkkakkk.",
  ".Kkkkaaakkkk.",
  ".Kkkkkkkkkkk.",
  "KKkkkkkkkkkkk",
  "KK.kkkkkkkkk.",
  "K..kkkkkkkk..",
], { x: 6, y: 18 });

const handOpen = part([
  ".111.",
  "11111",
  "11111",
  "11111",
  ".111.",
], { x: 2, y: 2 });

const handFist = part([
  ".1111",
  "11111",
  "1ooo1",
  "11111",
  ".111.",
], { x: 2, y: 2 });

const foot = part([
  ".oooo..",
  "333333.",
  "3h33333",
  "3333333",
], { x: 2, y: 4 });

export const CONDUCTOR_PARTS: CharacterParts = {
  head,
  headKo,
  torso,
  handOpen,
  handFist,
  foot,
  extras: { "1": P.conductorGlove, "2": TROUSER, "3": SHOE },
  limbColor: P.conductorKey,
  limbShade: NAVY_DARK,
  legColor: TROUSER,
  cuff: P.amber1,
};
