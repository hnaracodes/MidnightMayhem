import type { CharacterId } from "@midnight/shared";

/**
 * Character portrait for the lobby: a 48 × 48 canvas, drawn by code (no assets).
 * INTEGRATOR: collapse after merge — 11.01's pixel parts replace the silhouettes below; keep the signature.
 * Colours mirror `palette.ts` plus 11.01's four character keys (also CSS variables in index.html).
 */
export const PORTRAIT_SIZE = 48;

const KEY: Record<CharacterId, string> = {
  drifter: "#8A6B4A",
  conductor: "#1B2A5C",
  stoker: "#4A4E57",
  claude: "#D97757",
};
const SKIN: Record<CharacterId, string> = {
  drifter: "#C9A27E",
  conductor: "#E9C9AE",
  stoker: "#B98B6B",
  claude: "#D97757",
};
const NIGHT_1 = "#101A33";
const OUTLINE = "#05070F";
const MOON = "#E8F0FF";
const AMBER_1 = "#F2A03D";
const AMBER_2 = "#C2601B";
const STOKER_RED = "#B8323C";
const CLAUDE_INK = "#1A1A1E";
const CLAUDE_GREEN = "#7CF29A";
const CLAUDE_SCREEN = "#0E1A14";

export function portrait(characterId: CharacterId): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = PORTRAIT_SIZE;
  canvas.height = PORTRAIT_SIZE;
  canvas.dataset["character"] = characterId;
  canvas.setAttribute("role", "img");
  const ctx = canvas.getContext?.("2d");
  if (!ctx) return canvas; // test DOMs have no 2D context; the CSS fallback tints the box with the key colour
  draw(ctx, characterId);
  return canvas;
}

function draw(ctx: CanvasRenderingContext2D, id: CharacterId): void {
  const S = PORTRAIT_SIZE;
  const px = (x: number, y: number, w: number, h: number, color: string): void => {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
  };
  px(0, 0, S, S, NIGHT_1);
  // Shoulders and chest: a rounded block in the key colour with a dark outline, moon rim on the right edge.
  px(8, 30, 32, 18, OUTLINE);
  px(10, 32, 28, 16, KEY[id]);
  px(36, 32, 2, 16, MOON);
  // Head.
  if (id === "claude") {
    // Eight-armed orange sunburst, two ink dot eyes, terminal torso with a green prompt.
    const cx = 24, cy = 18;
    for (let i = 0; i < 8; i++) {
      const long = i % 2 === 0 ? 9 : 6;
      const a = (i * Math.PI) / 4;
      for (let r = 6; r <= long + 6; r++) px(Math.round(cx + Math.cos(a) * r) - 1, Math.round(cy + Math.sin(a) * r) - 1, 2, 2, KEY[id]);
    }
    px(cx - 6, cy - 6, 12, 12, KEY[id]);
    px(cx - 3, cy - 1, 2, 2, CLAUDE_INK);
    px(cx + 1, cy - 1, 2, 2, CLAUDE_INK);
    px(12, 34, 24, 12, CLAUDE_GREEN);
    px(13, 35, 22, 10, CLAUDE_SCREEN);
    px(15, 38, 3, 1, CLAUDE_GREEN);
    px(16, 39, 1, 1, CLAUDE_GREEN);
    px(15, 40, 3, 1, CLAUDE_GREEN);
    px(20, 42, 4, 1, CLAUDE_GREEN);
    return;
  }
  px(14, 6, 20, 22, OUTLINE);
  px(16, 8, 16, 18, SKIN[id]);
  px(30, 8, 2, 18, MOON);
  px(20, 15, 2, 2, OUTLINE);
  px(26, 15, 2, 2, OUTLINE);
  if (id === "drifter") {
    // Wind-blown hair to the left, a beard down over the collar, a rope belt.
    px(10, 6, 8, 3, AMBER_2);
    px(8, 9, 8, 3, AMBER_2);
    px(12, 4, 20, 4, AMBER_2);
    px(16, 21, 16, 8, AMBER_2);
    px(18, 28, 12, 3, AMBER_2);
    px(10, 42, 28, 2, AMBER_2);
  } else if (id === "conductor") {
    // Peaked cap with a badge, a moon collar, two columns of amber buttons.
    px(12, 4, 24, 6, KEY[id]);
    px(12, 4, 24, 2, OUTLINE);
    px(10, 9, 28, 2, OUTLINE);
    px(23, 5, 2, 2, MOON);
    px(20, 30, 8, 3, MOON);
    px(19, 36, 2, 2, AMBER_1);
    px(27, 36, 2, 2, AMBER_1);
    px(19, 41, 2, 2, AMBER_1);
    px(27, 41, 2, 2, AMBER_1);
  } else {
    // Stoker: bald, a goggles band on the forehead, a coal smudge, a red neckerchief, sleeveless vest.
    px(16, 9, 16, 3, AMBER_2);
    px(18, 9, 4, 3, AMBER_1);
    px(26, 9, 4, 3, AMBER_1);
    px(27, 19, 4, 3, OUTLINE);
    px(18, 29, 12, 4, STOKER_RED);
    px(12, 34, 4, 12, SKIN[id]);
    px(32, 34, 4, 12, SKIN[id]);
    px(16, 38, 3, 2, OUTLINE);
  }
}
