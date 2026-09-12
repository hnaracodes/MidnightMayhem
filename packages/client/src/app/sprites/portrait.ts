import type { CharacterId } from "@midnight/shared";
import { CSS_P, P } from "../../game/palette";
import { CHARACTER_PARTS } from "../../game/sprites/compose";
import { PixelCanvas, alphaOf, parsePart, rgbOf } from "../../game/sprites/grid";

/**
 * Character portrait for the lobby: a 48 × 48 canvas drawn from 11.01's pixel paper-doll parts (head over
 * shoulders, outlined and rimmed like the in-game sprite) at 2× on a night-1 ground. No assets.
 */
export const PORTRAIT_SIZE = 48;

/** Sprite pixels per side; each becomes a 2 × 2 block on the 48 px canvas. */
const CELL = PORTRAIT_SIZE / 2;
const HEAD_TOP = 2;
/** Rows the shoulders tuck under the chin. */
const CHIN_OVERLAP = 2;

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

/** Composes the head and torso parts into a small raster; exported for tests (pure, no DOM). */
export function portraitPixels(characterId: CharacterId): PixelCanvas {
  const parts = CHARACTER_PARTS[characterId];
  const c = new PixelCanvas(CELL, CELL);
  const centreX = Math.floor(CELL / 2);
  const headH = parsePart(parts.head).h;
  const torsoTop = HEAD_TOP + headH - CHIN_OVERLAP;
  // `blit` puts grid row 0 at y − anchor.y, so add the anchor back to land the top rows where we want them.
  c.blit(parts.torso, centreX, torsoTop + parts.torso.anchor.y);
  c.blit(parts.head, centreX, HEAD_TOP + parts.head.anchor.y);
  c.outline(P.outline);
  c.rim(P.amber1, "right", P.outline);
  return c;
}

function draw(ctx: CanvasRenderingContext2D, id: CharacterId): void {
  ctx.fillStyle = CSS_P.night1;
  ctx.fillRect(0, 0, PORTRAIT_SIZE, PORTRAIT_SIZE);
  const c = portraitPixels(id);
  const k = PORTRAIT_SIZE / CELL;
  for (let y = 0; y < CELL; y++) {
    for (let x = 0; x < CELL; x++) {
      const px = c.get(x, y);
      if (px === 0) continue;
      ctx.globalAlpha = alphaOf(px) / 255;
      ctx.fillStyle = `#${rgbOf(px).toString(16).padStart(6, "0")}`;
      ctx.fillRect(x * k, y * k, k, k);
    }
  }
  ctx.globalAlpha = 1;
}
