/**
 * Claude Code: an eight-armed orange sunburst head (arms 2 px wide, alternating 4 and 3 px long) around a
 * 6 px disc with two ink dot eyes; a dark terminal-window torso with a 1 px green border, a `>_` prompt whose
 * underscore blinks (`torso` / `torsoBlink`), a tiny orange sunburst badge; ink limbs, white gloves, rounded
 * ink sneakers with a white stripe. No outer outline in the grids (compose.ts adds it).
 */
import { P } from "../../palette";
import { darken, type Part } from "../grid";
import type { CharacterParts } from "../compose";

const INK_FRONT = 0x26262C;
const INK_BACK = 0x141418;
const LEG = 0x1F1F24;

const PAL: Record<string, number | null> = {
  k: P.claudeOrange,
  K: darken(P.claudeOrange, 0.72),
  s: P.claudeOrange,
  S: darken(P.claudeOrange, 0.72),
  "1": P.claudeInk,
  "2": P.claudeScreen,
  "3": P.claudeGreen,
  "4": P.claudeGlove,
};

const part = (grid: string[], anchor: { x: number; y: number }): Part => ({ grid, anchor, palette: PAL });

const head = part([
  ".......kk......",
  "...k...kk...k..",
  "...kk..kk..kk..",
  "....kk.kk.kk...",
  ".....kkkkkk....",
  "....kkkkkkkk...",
  ".kkkkk1kk1kkkkk",
  ".kkkkkkkkkkkkkk",
  "....kKkkkkkk...",
  ".....KKkkkk....",
  "....kk.kk.kk...",
  "...kk..kk..kk..",
  "...k...kk...k..",
  ".......kk......",
], { x: 7, y: 3 });

const headKo = part([
  "...............",
  ".......kk......",
  "...k...kk...k..",
  "...kk..kk..kk..",
  "....kk.kk.kk...",
  ".....kkkkkk....",
  "....k1k1kk1k1..",
  ".kkkkk1kkk1kkkk",
  ".kkkkk1k1k1k1kk",
  "....kKkkkkkk...",
  ".....KKkkkk....",
  "....kk.kk.kk...",
  "...kk..kk..kk..",
  "...k...kk...k..",
  ".......kk......",
], { x: 7, y: 4 });

const TERMINAL_TOP = [
  ".33333333333.",
  ".32222222223.",
  ".32222222223.",
  ".32222222223.",
  ".32222222223.",
  ".32322222223.",
  ".32232222223.",
];
const TERMINAL_BOTTOM = [
  ".32222222223.",
  ".32222222223.",
  ".32222222223.",
  ".32222222223.",
  ".32222222223.",
  ".32222222223.",
  ".32222k2k223.",
  ".322222k2223.",
  ".32222k2k223.",
  ".33333333333.",
  "..111111111..",
];

const torso = part([...TERMINAL_TOP, ".32322233323.", ...TERMINAL_BOTTOM], { x: 6, y: 18 });
const torsoBlink = part([...TERMINAL_TOP, ".32322222223.", ...TERMINAL_BOTTOM], { x: 6, y: 18 });

const handOpen = part([
  ".444.",
  "44444",
  "44444",
  "44444",
  ".444.",
], { x: 2, y: 2 });

const handFist = part([
  ".4444",
  "44444",
  "4ooo4",
  "44444",
  ".444.",
], { x: 2, y: 2 });

const foot = part([
  ".o111..",
  "1111111",
  "1wwwww1",
  ".11111.",
], { x: 2, y: 4 });

export const CLAUDE_PARTS: CharacterParts = {
  head,
  headKo,
  torso,
  torsoBlink,
  handOpen,
  handFist,
  foot,
  extras: { "1": P.claudeInk, "2": P.claudeScreen, "3": P.claudeGreen, "4": P.claudeGlove },
  limbColor: INK_FRONT,
  limbShade: INK_BACK,
  legColor: LEG,
};
