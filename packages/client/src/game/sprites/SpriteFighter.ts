/**
 * Phaser side of the paper-doll sprite (11.01): one CanvasTexture per fighter, re-rasterised from `composeFrame`
 * and shown through an Image at SPRITE_SCALE with nearest filtering and its origin on the feet. 13.02: the raster
 * runs only when `composeKey` changes (a held pose costs nothing) and uploads through a Uint32 view of the
 * ImageData. No image assets: every pixel comes from PixelCanvas.
 */
import Phaser from "phaser";
import type { FighterState, PlayerIndex } from "@midnight/shared";
import { LITTLE_ENDIAN, packForImageData } from "../raster";
import type { Joints } from "../rig/pose";
import { ANCHOR, CANVAS, SPRITE_SCALE, composeFrame, composeKey, createFrameCanvas } from "./compose";
import type { PixelCanvas } from "./grid";
import type { LightDir } from "./shade";

export interface SpriteUpdateOpts {
  rimColor: number;
  rimSide: "left" | "right" | "both";
  gloom: number;
  /** 13.02: unit vector toward the net light (screen space) or null to fall back to `rimSide`. */
  lightDir?: LightDir | null | undefined;
  /** 13.02: the `low` tier's base-only limbs. */
  flatLimbs?: boolean | undefined;
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
  private readonly words: Uint32Array;
  private lastHand = { x: 0, y: 0 };
  private lastKey = "";
  private scaleMultiplier = 1;
  /** Frames rasterised and frames served from the cache since creation (debug readout, tests). */
  readonly stats = { rasterised: 0, cached: 0 };

  constructor(scene: Phaser.Scene, index: PlayerIndex, depth: number) {
    this.canvas = createFrameCanvas();
    const key = `sprite-fighter-${index}-${nextKey++}`;
    const tex = scene.textures.createCanvas(key, CANVAS.w, CANVAS.h);
    if (!tex) throw new Error(`SpriteFighter: could not create texture ${key}`);
    tex.setFilter(Phaser.Textures.FilterMode.NEAREST);
    this.texture = tex;
    this.imageData = tex.context.createImageData(CANVAS.w, CANVAS.h);
    this.words = new Uint32Array(this.imageData.data.buffer, this.imageData.data.byteOffset, CANVAS.w * CANVAS.h);
    this.image = scene.add.image(0, 0, key);
    this.image.setOrigin((ANCHOR.x + CANVAS.ox) / CANVAS.w, (ANCHOR.y + CANVAS.oy) / CANVAS.h);
    this.image.setScale(SPRITE_SCALE);
    this.image.setDepth(depth);
  }

  /** Re-rasterise this frame (when its inputs changed) into the fighter's CanvasTexture and position the Image. */
  update(f: FighterState, joints: Joints, opts: SpriteUpdateOpts): void {
    const compose = {
      facing: f.facing,
      rimColor: opts.rimColor,
      rimSide: opts.rimSide,
      gloom: opts.gloom,
      lightDir: opts.lightDir,
      flatLimbs: opts.flatLimbs,
      flash: opts.flash,
      flashAlpha: opts.flashAlpha,
      alpha: joints.alpha,
      itemVisible: opts.itemVisible,
      blinkMs: opts.blinkMs,
    };
    const key = composeKey(joints, f, f.character, compose);
    if (key !== this.lastKey) {
      this.lastKey = key;
      const c = this.canvas;
      composeFrame(c, joints, f, f.character, compose);
      packForImageData(c.data, this.words, LITTLE_ENDIAN);
      this.texture.context.putImageData(this.imageData, 0, 0);
      this.texture.refresh();
      this.stats.rasterised += 1;
    } else {
      this.stats.cached += 1;
    }
    this.image.setPosition(f.x, f.y);
    const squash = opts.squash || 1;
    const k = SPRITE_SCALE * this.scaleMultiplier;
    this.image.setScale(k / squash, k * squash);
    this.lastHand = { x: joints.arms.F.fist.x, y: joints.arms.F.fist.y };
  }

  setVisible(v: boolean): void { this.image.setVisible(v); }

  /** Draw depth (11.05 orders fighters back-to-front every frame). */
  setDepth(depth: number): void { this.image.setDepth(depth); }

  /** Extra display scale on top of SPRITE_SCALE (the preview's 3× row). */
  setScaleMultiplier(k: number): void { this.scaleMultiplier = k; }

  destroy(): void {
    this.image.destroy();
    this.texture.destroy();
  }

  /** World position of the front hand this frame (for item FX and materialise). */
  hand(): { x: number; y: number } { return { ...this.lastHand }; }
}
