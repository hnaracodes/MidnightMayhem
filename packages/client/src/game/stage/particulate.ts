/**
 * 12.03 — Airborne particulate: slow cold dust motes over the whole stage and warm embers rising from the firebox
 * edge. Fixed pools (no allocation after boot), seeded so both laptops draw the same air, cleared under reduced
 * motion or on the low quality tier. Depths: motes 0.4 (behind fighters, above the darkness), embers 3.9 (in
 * front of fighters, behind item FX).
 */
import type Phaser from "phaser";
import { WORLD } from "@midnight/shared";
import { Lcg } from "../backgrounds";
import { P } from "../palette";

export const MAX_MOTES = 40;
export const MAX_EMBERS = 24;
export const DEFAULT_SEED = 0x0d05;
const DEPTH = { MOTES: 0.4, EMBERS: 3.9 } as const;
const MOTE = { vxMin: 8, vxMax: 20, bobHz: 0.4, bobPx: 6, alphaMin: 0.18, alphaMax: 0.35, yMin: 40, yMax: WORLD.ROOF_Y - 10 } as const;
const EMBER = { x0: 900, x1: 960, y0: 260, y1: 340, riseMin: 30, riseMax: 60, drift: 0.3, lifeMin: 2, lifeMax: 4, every: 0.12 } as const;

interface Mote { x: number; y: number; vx: number; size: number; alpha: number; phase: number }
interface Ember { x: number; y: number; rise: number; age: number; life: number; warm: boolean; live: boolean }

export class Particulate {
  private readonly rng: Lcg;
  private readonly motes: Mote[] = [];
  private readonly embers: Ember[] = [];
  private readonly moteG: Phaser.GameObjects.Graphics;
  private readonly emberG: Phaser.GameObjects.Graphics;
  private emberTimer = 0;
  private t = 0;
  private wasEnabled = false;

  constructor(scene: Phaser.Scene, seed = DEFAULT_SEED) {
    this.rng = new Lcg(seed);
    this.moteG = scene.add.graphics().setDepth(DEPTH.MOTES);
    this.emberG = scene.add.graphics().setDepth(DEPTH.EMBERS);
    for (let i = 0; i < MAX_EMBERS; i++) this.embers.push({ x: 0, y: 0, rise: 0, age: 0, life: 1, warm: true, live: false });
  }

  /** Live counts, for the debug readout and the caps test. */
  live(): { motes: number; embers: number } {
    return { motes: this.motes.length, embers: this.embers.filter((e) => e.live).length };
  }

  update(dtSec: number, opts: { reducedMotion: boolean; enabled: boolean; roofSpeed: number }): void {
    const on = opts.enabled && !opts.reducedMotion;
    if (!on) {
      if (this.wasEnabled || this.motes.length > 0) {
        this.motes.length = 0;
        for (const e of this.embers) e.live = false;
        this.moteG.clear();
        this.emberG.clear();
      }
      this.wasEnabled = false;
      return;
    }
    this.wasEnabled = true;
    this.t += dtSec;
    // motes: fill the pool once, then drift; a mote that leaves on the left re-enters on the right
    while (this.motes.length < MAX_MOTES) {
      this.motes.push({
        x: this.rng.range(0, WORLD.WIDTH), y: this.rng.range(MOTE.yMin, MOTE.yMax), vx: this.rng.range(MOTE.vxMin, MOTE.vxMax),
        size: this.rng.next() < 0.7 ? 1 : 2, alpha: this.rng.range(MOTE.alphaMin, MOTE.alphaMax), phase: this.rng.range(0, Math.PI * 2),
      });
    }
    for (const m of this.motes) {
      m.x -= m.vx * dtSec;
      if (m.x < -4) { m.x = WORLD.WIDTH + 4; m.y = this.rng.range(MOTE.yMin, MOTE.yMax); }
    }
    // embers: born at the firebox edge on a fixed cadence while a slot is free
    this.emberTimer += dtSec;
    while (this.emberTimer >= EMBER.every) {
      this.emberTimer -= EMBER.every;
      const slot = this.embers.find((e) => !e.live);
      if (!slot) continue;
      slot.live = true;
      slot.x = this.rng.range(EMBER.x0, EMBER.x1);
      slot.y = this.rng.range(EMBER.y0, EMBER.y1);
      slot.rise = this.rng.range(EMBER.riseMin, EMBER.riseMax);
      slot.age = 0;
      slot.life = this.rng.range(EMBER.lifeMin, EMBER.lifeMax);
      slot.warm = this.rng.next() < 0.5;
    }
    for (const e of this.embers) {
      if (!e.live) continue;
      e.age += dtSec;
      if (e.age >= e.life || e.x < -4) { e.live = false; continue; }
      e.y -= e.rise * dtSec;
      e.x -= EMBER.drift * opts.roofSpeed * dtSec;
    }
    this.draw();
  }

  private draw(): void {
    const g = this.moteG;
    g.clear();
    for (const m of this.motes) {
      const bob = Math.sin(this.t * MOTE.bobHz * Math.PI * 2 + m.phase) * MOTE.bobPx;
      g.fillStyle(P.moon, m.alpha);
      g.fillRect(Math.round(m.x), Math.round(m.y + bob), m.size, m.size);
    }
    const e = this.emberG;
    e.clear();
    for (const p of this.embers) {
      if (!p.live) continue;
      const k = 1 - p.age / p.life;
      e.fillStyle(p.warm ? P.amber1 : P.lamp, 0.9 * k);
      e.fillRect(Math.round(p.x), Math.round(p.y), 2, 2);
    }
  }

  destroy(): void {
    this.moteG.destroy();
    this.emberG.destroy();
    this.motes.length = 0;
  }
}
