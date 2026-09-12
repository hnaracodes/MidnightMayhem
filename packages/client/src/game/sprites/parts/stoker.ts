/**
 * The Stoker: the engine hand. Bald, goggles pushed up on the forehead, thick brows, stubble, a coal smudge on
 * the back cheek, sleeveless coal-grey vest with soot smudges, red neckerchief, bare sooty arms and hands,
 * heavy boots. No outer outline in the grids (compose.ts adds it).
 */
import { P } from "../../palette";
import { darken, type Part } from "../grid";
import type { CharacterParts } from "../compose";

const COAL_DARK = darken(P.stokerKey, 0.64);
const SOOT = 0x1E2024;
const BOOT = 0x2A2622;

const PAL: Record<string, number | null> = {
  k: P.stokerKey,
  K: COAL_DARK,
  s: P.stokerSkin,
  S: darken(P.stokerSkin, 0.76),
  "1": P.stokerRed,
  "2": SOOT,
  "3": BOOT,
};

const part = (grid: string[], anchor: { x: number; y: number }): Part => ({ grid, anchor, palette: PAL });

const head = part([
  ".....sssss.....",
  "...sssssssss...",
  "..KKKKKKaaKKaa.",
  "..KKKKKKaaKKaa.",
  ".sssssssssssss.",
  ".sssssssssssss.",
  ".ssssooossooos.",
  ".sssssohsssohs.",
  ".sssssssssssSs.",
  ".ss2sssssssssS.",
  ".ssSsSssoooSss.",
  "..sSsSsSsSsSs..",
  "...sSsSsSsSs...",
  ".....ssssss....",
], { x: 7, y: 3 });

const headKo = part([
  ".....sssss.....",
  "...sssssssss...",
  ".sssssssssssss.",
  "KKKKKKaaKKaa...",
  "KKKKKKaaKKaa...",
  ".sssssssssssss.",
  ".ssssooossooos.",
  ".sssssososossss",
  ".ssssssososossS",
  ".ss2ssososossss",
  ".ssSsSssoooSss.",
  "..sSsSsSsSsSs..",
  "...sSsSsSsSs...",
  ".....ssssss....",
], { x: 7, y: 3 });

const torso = part([
  ".sskkkkkkkkkss.",
  ".sskkkkkkkkkss.",
  "sskkkk1111kkkss",
  "sskkk111111kkss",
  "KKkkkk1111kkkkk",
  "KKkkkk2211kkkkk",
  "KKkkkkkkk1kkkkk",
  "KKkkkkkkkkk2kkk",
  "KKkkkkkkkkk22kk",
  "KKkkkk2kkkkkkkk",
  ".Kkkkkkkkkkkk..",
  ".Kkkkkkkkkkkk..",
  ".KKKKKKaKKKKK..",
  ".KKKKKKKKKKKK..",
  ".KKKKKKKKKKKK..",
  "KKKKKKKKKKKKKK.",
  "KKKKKKKKKKKKKK.",
  "KKKKKKKKKKKKKK.",
  "KKKKKK..KKKKKK.",
], { x: 7, y: 18 });

const handOpen = part([
  ".sss.",
  "ss2ss",
  "sssss",
  "s2sss",
  ".sss.",
], { x: 2, y: 2 });

const handFist = part([
  ".ssss",
  "sss2s",
  "SoooS",
  "sssss",
  ".SSS.",
], { x: 2, y: 2 });

const foot = part([
  ".oooo..",
  "333333.",
  "333333A",
  "3333333",
], { x: 2, y: 4 });

export const STOKER_PARTS: CharacterParts = {
  head,
  headKo,
  torso,
  handOpen,
  handFist,
  foot,
  extras: { "1": P.stokerRed, "2": SOOT, "3": BOOT },
  limbColor: P.stokerSkin,
  limbShade: darken(P.stokerSkin, 0.76),
  legColor: COAL_DARK,
};
