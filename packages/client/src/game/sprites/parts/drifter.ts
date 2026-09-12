/**
 * The Drifter: shaggy hair trailing back, beard, ripped brown coat over a grey shirt, rope belt, bare hands
 * with amber wrist wraps, worn boots. Authored facing right; the back (screen-left) side is the shaded side.
 * Grids carry no outer outline: compose.ts adds it around the whole silhouette. Internal `o` only where a
 * part overlaps another (chin over collar, knuckles, boot top).
 */
import { P } from "../../palette";
import { darken, type Part } from "../grid";
import type { CharacterParts } from "../compose";

const HAIR = 0x3B2718;
const BEARD = 0x4E3524;
const SHIRT = 0x6E6A66;
const TROUSER = 0x4E4A47;

const PAL: Record<string, number | null> = {
  k: P.drifterKey,
  K: darken(P.drifterKey, 0.66),
  s: P.drifterSkin,
  S: darken(P.drifterSkin, 0.78),
  "1": HAIR,
  "2": BEARD,
  "3": SHIRT,
  "4": TROUSER,
};

const part = (grid: string[], anchor: { x: number; y: number }): Part => ({ grid, anchor, palette: PAL });

const head = part([
  "......11111......",
  "....111111111....",
  "...11111111111...",
  "1.1111111111111..",
  "11.111111sssss...",
  "111111111ssssss..",
  ".1111111ssohsoh..",
  "1111111ssssssssS.",
  "11111..sssssssS..",
  "..111.sssssssss..",
  ".....2ssssssssS..",
  ".....22ssooosS...",
  "......2222222S...",
  "......222222222..",
  ".......2222222...",
  ".......22.222....",
  "........2...2....",
], { x: 9, y: 3 });

const headKo = part([
  ".................",
  "....111111.......",
  "..1111111111.....",
  "1.11111111111....",
  "11.11111111ssss..",
  "1111111111sssss..",
  ".111111111sososs.",
  "1111111ssssosoS..",
  "11111..ssssosoS..",
  "..111.sssssssss..",
  ".....2ssssssssS..",
  ".....22sssoooS...",
  "......2222222S...",
  "......222222222..",
  ".......2222222...",
  ".......22.222....",
  "........2...2....",
], { x: 9, y: 3 });

const torso = part([
  ".KKkkkkkkkkkkk.",
  "KKKkkkk3kkkkkkk",
  "KKKkkk333kkkkkk",
  "KKKkkk333kkkkkk",
  "KKKkkkk3kkkkkkk",
  "KKKkkkkkkkkkkkk",
  "KKKkkkkkkkkkkkk",
  "KKKkkkkkkkkkkkk",
  "KKKkkkkkkkkkkkk",
  ".KKkkkkkkkkkkk.",
  ".KKkkkkkkkkkkk.",
  ".KKkkkkkkkkkkk.",
  ".AAAAAAAAAoAAA.",
  ".KKkkkkkkkkkkk.",
  ".KKkkkkkkkkkkk.",
  "KKKkkkkkkkkkkkk",
  "KKKkk.kkkk.kkkk",
  "KK.kk.kk.kk.kk.",
  "K..k..k.....k..",
], { x: 7, y: 18 });

const handOpen = part([
  ".sss.",
  "sssss",
  "ssSss",
  "sssss",
  ".sSs.",
], { x: 2, y: 2 });

const handFist = part([
  ".ssss",
  "sssss",
  "SoooS",
  "sssss",
  ".SSS.",
], { x: 2, y: 2 });

const foot = part([
  ".oooo..",
  "KKKKKK.",
  "KKKKKKK",
  "KKKKKKK",
], { x: 2, y: 4 });

export const DRIFTER_PARTS: CharacterParts = {
  head,
  headKo,
  torso,
  handOpen,
  handFist,
  foot,
  extras: { "1": HAIR, "2": BEARD, "3": SHIRT, "4": TROUSER },
  limbColor: P.drifterKey,
  limbShade: darken(P.drifterKey, 0.66),
  legColor: TROUSER,
  cuff: P.amber2,
};
