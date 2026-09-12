/**
 * Phaser side of the paper-doll sprite (11.01): one CanvasTexture per fighter, re-rasterised every frame from
 * `composeFrame`, shown through an Image at SPRITE_SCALE with nearest filtering and its origin on the feet.
 * No image assets: every pixel comes from PixelCanvas.
 */
import Phaser from "phaser";
import type { FighterState, PlayerIndex } from "@midnight/shared";
import type { Joints } from "../rig/pose";
import { ANCHOR, CANVAS, SPRITE_SCALE, composeFrame, createFrameCanvas } from "./compose";
import { alphaOf, rgbOf, type PixelCanvas } from "./grid";

export interface SpriteUpdateOpts {
  rimBoth: boolean;
  flash?: number | undefined;
  flashAlpha?: number | undefined;
  /** Vertical scale about the feet (1 = none); width scales by the inverse, as the vector rig did. */
  squash: number;
  itemVisible: boolean;
  /** Render clock in ms for the Claude Code prompt blink. */
  blinkMs: number;
}

let nextKey = 0;

export class SpriteFighter {
  private readonly canvas: PixelCanvas;
  private readonly texture: Phaser.Textures.CanvasTexture;
  private readonly image: Phaser.GameObjects.Image;
  private readonly imageData: ImageData;
  private lastHand = { x: 0, y: 0 };
  private scaleMultiplier = 1;

  constructor(scene: Phaser.Scene, index: PlayerIndex, depth: number) {
    this.canvas = createFrameCanvas();
    const key = `sprite-fighter-${index}-${nextKey++}`;
    const tex = scene.textures.createCanvas(key, CANVAS.w, CANVAS.h);
    if (!tex) throw new Error(`SpriteFighter: could not create texture ${key}`);
    tex.setFilter(Phaser.Textures.FilterMode.NEAREST);
    this.texture = tex;
    this.imageData = tex.context.createImageData(CANVAS.w, CANVAS.h);
    this.image = scene.add.image(0, 0, key);
    this.image.setOrigin((ANCHOR.x + CANVAS.ox) / CANVAS.w, (ANCHOR.y + CANVAS.oy) / CANVAS.h);
    this.image.setScale(SPRITE_SCALE);
    this.image.setDepth(depth);
  }

  /** Re-rasterise this frame into the fighter's CanvasTexture and position the Image. */
  update(f: FighterState, joints: Joints, opts: SpriteUpdateOpts): void {
    const c = this.canvas;
    composeFrame(c, joints, f, f.character, {
      facing: f.facing,
      rimBoth: opts.rimBoth,
      flash: opts.flash,
      flashAlpha: opts.flashAlpha,
      alpha: joints.alpha,
      itemVisible: opts.itemVisible,
      blinkMs: opts.blinkMs,
    });
    const bytes = this.imageData.data;
    const src = c.data;
    for (let i = 0, j = 0; i < src.length; i++, j += 4) {
      const px = src[i]!;
      if (px === 0) {
        bytes[j] = 0; bytes[j + 1] = 0; bytes[j + 2] = 0; bytes[j + 3] = 0;
      } else {
        const rgb = rgbOf(px);
        bytes[j] = (rgb >> 16) & 255;
        bytes[j + 1] = (rgb >> 8) & 255;
        bytes[j + 2] = rgb & 255;
        bytes[j + 3] = alphaOf(px);
      }
    }
    this.texture.context.putImageData(this.imageData, 0, 0);
    this.texture.refresh();
    this.image.setPosition(f.x, f.y);
    const squash = opts.squash || 1;
    const k = SPRITE_SCALE * this.scaleMultiplier;
    this.image.setScale(k / squash, k * squash);
    this.lastHand = { x: joints.arms.F.fist.x, y: joints.arms.F.fist.y };
  }

  setVisible(v: boolean): void { this.image.setVisible(v); }

  /** Extra display scale on top of SPRITE_SCALE (the preview's 6× row). */
  setScaleMultiplier(k: number): void { this.scaleMultiplier = k; }

  destroy(): void {
    this.image.destroy();
    this.texture.destroy();
  }

  /** World position of the front hand this frame (for item FX and materialise). */
  hand(): { x: number; y: number } { return { ...this.lastHand }; }
}
