/**
 * 13.06 — Ambient map props: a flickering and occasionally failing roof lamp, a chattering vent flap, swaying
 * chains, steam puffs from a roof vent, a snapping tarpaulin corner on each rack and ballast dust rising through
 * each gap. A fixed pool (nothing allocated after boot), one Graphics redrawn per frame, every timing from one
 * seeded `Lcg`, phase-locked to the train bob and the wheel clack, frozen under reduced motion and thinned on the
 * low tier. Spec: implementation-docs/13-art/06-props.md. Owned by the scene like `Particulate`.
 */
import type Phaser from "phaser";
import { WORLD } from "@midnight/shared";
import { Lcg, ROOF_LAMPS, ROOF_LAMP_PERIOD } from "../backgrounds";
import { P } from "../palette";
import { PIXEL, snap } from "../pixel";
import type { Quality } from "./quality";

export const MAX_PROPS = 24;
export const DEFAULT_SEED = 0x9a0b;
export type PropKind = "lamp" | "flap" | "chain" | "steam" | "tarp" | "dust";

/** Roof-texture x of the fixtures that scroll with the roof (period ROOF_LAMP_PERIOD). */
const FLAP = { x: 150, every: 240, w: 10, h: 4, lift: 2, settleFrames: 6 } as const;
const CHAIN = { x: 60, every: 480, links: 3, link: 2, hz: 1.5, swing: 2, kick: 2 } as const;
const STEAM = { x: 700, every: 1.6, jitter: 0.4, rise: 18, drift: 26, life: 1.2, r: 3, max: 6 } as const;
const TARP = { hz: 4, flip: 3, len: 8 } as const;
const DUST = { every: 0.15, y0: 480, y1: 500, rise: 25, drift: 30, life: 0.6 } as const;
const LAMP = { walkHz: 1.4, walkAmp: 0.06, failMin: 6, failMax: 11, stutter: [0.3, 1, 0.5, 1] as const, dropMin: 4, dropMax: 8, drop: 0.15, recoverSec: 0.4 } as const;
const DEPTH = { FIXTURES: -12.1, PARTICLES: -9.4 } as const;
const MAX_STEAM = 6;
const MAX_DUST = MAX_PROPS - MAX_STEAM - 6; // lamps 2, flap 1, chain 2, tarps ≤ 2 (reserved)

interface Puff { live: boolean; x: number; y: number; age: number; tunnel: boolean }
interface Speck { live: boolean; x: number; y: number; age: number }
interface LampState { walk: { value: number; target: number; timer: number }; fail: number; failing: number; phase: "ok" | "stutter" | "drop" | "recover"; gain: number }

export interface PropsOpts {
  reducedMotion: boolean;
  quality: Quality;
  /** The roof tile's tilePositionX, so fixtures sit on the scrolling roof. */
  roofOffset: number;
  /** This frame's train bob in px and whether a wheel clack fired (from `Motion`). */
  bob: number;
  clack: boolean;
  tunnel: boolean;
}

export class Props {
  private readonly rng: Lcg;
  private readonly g: Phaser.GameObjects.Graphics;
  private readonly particles: Phaser.GameObjects.Graphics;
  private readonly puffs: Puff[] = [];
  private readonly specks: Speck[] = [];
  private readonly lamps: LampState[] = [];
  private racks: { x0: number; x1: number; y: number }[] = [];
  private gaps: { x0: number; x1: number }[] = [];
  private flapLift = 0;
  private chainKick = 0;
  private steamTimer = STEAM.every;
  private dustTimer = 0;
  private t = 0;
  private liveCount = 0;
  private yOffset = 0;

  constructor(
    scene: Phaser.Scene,
    private readonly lighting: { setLampGain(index: number, gain: number): void },
    seed = DEFAULT_SEED,
  ) {
    this.rng = new Lcg(seed);
    this.g = scene.add.graphics().setDepth(DEPTH.FIXTURES);
    this.particles = scene.add.graphics().setDepth(DEPTH.PARTICLES);
    for (let i = 0; i < MAX_STEAM; i++) this.puffs.push({ live: false, x: 0, y: 0, age: 0, tunnel: false });
    for (let i = 0; i < MAX_DUST; i++) this.specks.push({ live: false, x: 0, y: 0, age: 0 });
    for (let i = 0; i < ROOF_LAMPS.length; i++) {
      this.lamps.push({ walk: { value: 1, target: 1, timer: 0 }, fail: this.rng.range(LAMP.failMin, LAMP.failMax), failing: 0, phase: "ok", gain: 1 });
    }
  }

  /** Rule 6–7: tarps follow the racks, dust the gaps. */
  setMap(spans: { gaps: { x0: number; x1: number }[]; platforms: { x0: number; x1: number; y: number }[] }): void {
    this.racks = spans.platforms.slice(0, 2);
    this.gaps = spans.gaps.slice(0, 2);
    for (const s of this.specks) s.live = false;
  }

  /** Animated props drawn this frame (never above MAX_PROPS). */
  live(): number { return this.liveCount; }

  /** The train bob moves everything drawn here (the fixtures ride the roof, the particles the track). */
  bob(offset: number): void {
    this.yOffset = offset;
    this.g.setY(offset);
    this.particles.setY(offset);
  }

  /** Current gain of roof lamp `i` (tests). */
  lampGain(i: number): number { return this.lamps[i]?.gain ?? 1; }

  update(dtSec: number, opts: PropsOpts): void {
    const dt = Math.min(Math.max(dtSec, 0), 0.1);
    const frozen = opts.reducedMotion;
    const high = opts.quality === "high";
    if (!frozen) this.t += dt;
    let live = 0;

    // rule 2: lamp flicker and the failing lamp (the second one), through the light rig
    this.lamps.forEach((lamp, i) => {
      if (frozen) { lamp.gain = 1; this.lighting.setLampGain(i, 1); return; }
      const w = lamp.walk;
      w.timer -= dt;
      if (w.timer <= 0) { w.timer += 1 / LAMP.walkHz; w.target = 1 + this.rng.range(-LAMP.walkAmp, LAMP.walkAmp); }
      w.value += (w.target - w.value) * Math.min(1, dt * LAMP.walkHz * 4);
      let fail = 1;
      if (i === 1) {
        lamp.fail -= dt;
        if (lamp.phase === "ok" && lamp.fail <= 0) { lamp.phase = "stutter"; lamp.failing = 0; }
        if (lamp.phase === "stutter") {
          const k = Math.min(LAMP.stutter.length - 1, Math.floor(lamp.failing / (0.25 / LAMP.stutter.length)));
          fail = LAMP.stutter[k]!;
          lamp.failing += dt;
          if (lamp.failing >= 0.25) { lamp.phase = "drop"; lamp.failing = 0; lamp.fail = Math.floor(this.rng.range(LAMP.dropMin, LAMP.dropMax + 1)) / 60; }
        } else if (lamp.phase === "drop") {
          fail = LAMP.drop;
          lamp.failing += dt;
          if (lamp.failing >= lamp.fail) { lamp.phase = "recover"; lamp.failing = 0; }
        } else if (lamp.phase === "recover") {
          lamp.failing += dt;
          fail = LAMP.drop + (1 - LAMP.drop) * Math.min(1, lamp.failing / LAMP.recoverSec);
          if (lamp.failing >= LAMP.recoverSec) { lamp.phase = "ok"; lamp.fail = this.rng.range(LAMP.failMin, LAMP.failMax); }
        }
      }
      lamp.gain = w.value * fail;
      this.lighting.setLampGain(i, lamp.gain);
      live += 1;
    });

    // rule 3: the vent flap flips up on a clack and settles
    if (!frozen) {
      if (opts.clack) { this.flapLift = FLAP.lift; this.chainKick = CHAIN.kick; }
      else { this.flapLift = Math.max(0, this.flapLift - FLAP.lift / FLAP.settleFrames); this.chainKick *= 0.85; }
    }
    live += 1;

    // rules 5 and 7: steam puffs and ballast dust are the pooled particles (high tier only)
    if (high && !frozen) {
      this.steamTimer -= dt;
      if (this.steamTimer <= 0) {
        this.steamTimer += STEAM.every + this.rng.range(-STEAM.jitter, STEAM.jitter);
        const slot = this.puffs.find((p) => !p.live);
        if (slot) { slot.live = true; slot.age = 0; slot.tunnel = opts.tunnel; slot.x = 0; slot.y = 0; }
      }
      for (const p of this.puffs) { if (!p.live) continue; p.age += dt; if (p.age >= STEAM.life) p.live = false; }
      if (this.gaps.length > 0) {
        this.dustTimer -= dt;
        while (this.dustTimer <= 0) {
          this.dustTimer += DUST.every / this.gaps.length;
          const gap = this.gaps[Math.floor(this.rng.range(0, this.gaps.length))]!;
          const slot = this.specks.find((s) => !s.live);
          if (!slot) break;
          slot.live = true; slot.age = 0;
          slot.x = this.rng.range(gap.x0 + 6, gap.x1 - 6);
          slot.y = this.rng.range(DUST.y0, DUST.y1);
        }
      }
      for (const s of this.specks) { if (!s.live) continue; s.age += dt; if (s.age >= DUST.life) s.live = false; }
    } else {
      for (const p of this.puffs) p.live = false;
      for (const s of this.specks) s.live = false;
      if (!high) this.particles.clear(); // the tier dropped: no stale puffs or dust
    }

    this.draw(opts, high, frozen);
    live += this.puffs.filter((p) => p.live).length + this.specks.filter((s) => s.live).length;
    if (high) live += CHAIN.links > 0 ? 2 : 0;
    if (high) live += this.racks.length;
    this.liveCount = Math.min(MAX_PROPS, live);
  }

  private draw(opts: PropsOpts, high: boolean, frozen: boolean): void {
    const g = this.g;
    g.clear();
    const period = ROOF_LAMP_PERIOD;
    const offset = ((opts.roofOffset % period) + period) % period;
    /** World x of every instance of a roof-texture fixture at `tx` repeating every `every`. */
    const instances = (tx: number, every: number): number[] => {
      const base = (((tx - offset) % every) + every) % every;
      const xs: number[] = [];
      for (let x = base - every; x < WORLD.WIDTH + every; x += every) if (x > -40 && x < WORLD.WIDTH + 40) xs.push(x);
      return xs;
    };
    // lamp heads dim with their gain: a translucent cap over the fixture head (ROOF_LAMPS y is the head)
    ROOF_LAMPS.forEach((lamp, i) => {
      const gain = this.lamps[i]?.gain ?? 1;
      if (gain >= 0.97) return;
      for (const x of instances(lamp.x, period)) {
        g.fillStyle(P.void0, Math.min(0.85, 1 - gain));
        g.fillCircle(snap(x), snap(lamp.y), 6);
      }
    });
    // vent flaps on the roof lip
    for (const x of instances(FLAP.x, FLAP.every)) {
      const lift = Math.round(this.flapLift + (frozen ? 0 : Math.abs(opts.bob) * 0.5));
      g.fillStyle(P.outline, 1);
      g.fillRect(snap(x) - 1, WORLD.ROOF_Y - lift - 1, FLAP.w + 2, FLAP.h + 2);
      g.fillStyle(P.steel2, 1);
      g.fillRect(snap(x), WORLD.ROOF_Y - lift, FLAP.w, FLAP.h);
      g.fillStyle(P.steel0, 1);
      g.fillRect(snap(x), WORLD.ROOF_Y - lift + FLAP.h - PIXEL, FLAP.w, PIXEL);
    }
    if (!high) return;
    // chains under the roof lip
    const swing = frozen ? 0 : Math.sin(this.t * CHAIN.hz * Math.PI * 2 + opts.bob) * CHAIN.swing + this.chainKick;
    for (const x of instances(CHAIN.x, CHAIN.every)) {
      for (let k = 0; k < CHAIN.links; k++) {
        const dx = Math.round((swing * (k + 1)) / CHAIN.links);
        g.fillStyle(k % 2 === 0 ? P.steel2 : P.steel1, 1);
        g.fillRect(snap(x) + dx, WORLD.ROOF_Y + 30 + k * (CHAIN.link + PIXEL), CHAIN.link, CHAIN.link + PIXEL);
      }
    }
    // tarpaulin corners on the racks
    for (const [i, r] of this.racks.entries()) {
      const flip = frozen ? 0 : Math.round(Math.sin(this.t * TARP.hz * Math.PI * 2 + i * 1.7) * TARP.flip);
      const x = r.x1 - 6;
      g.fillStyle(P.haze, 0.9);
      g.fillTriangle(x, r.y + 2, x - TARP.len, r.y + 2 + 6 + flip, x - 2, r.y + 2 + 10 + flip);
      g.lineStyle(1, P.outline, 1);
      g.lineBetween(x, r.y + 2, x - 2, r.y + 12 + flip);
    }
    // particles: steam from the roof vent, dust in the gaps
    const pg = this.particles;
    pg.clear();
    const ventXs = instances(STEAM.x, period);
    for (const p of this.puffs) {
      if (!p.live) continue;
      const k = p.age / STEAM.life;
      const rise = STEAM.rise * (p.tunnel ? 0.5 : 1) * k;
      const r = STEAM.r * (1 + k) * (p.tunnel ? 1.4 : 1);
      for (const vx of ventXs) {
        pg.fillStyle(p.tunnel ? P.night2 : P.steel2, 0.35 * (1 - k));
        pg.fillCircle(snap(vx - STEAM.drift * k), snap(WORLD.ROOF_Y - 6 - rise), Math.max(PIXEL, Math.round(r / PIXEL) * PIXEL));
      }
    }
    for (const s of this.specks) {
      if (!s.live) continue;
      const k = s.age / DUST.life;
      pg.fillStyle(P.bone, 0.5 * (1 - k));
      pg.fillRect(snap(s.x - DUST.drift * k), snap(s.y - DUST.rise * k), PIXEL, PIXEL);
    }
  }

  destroy(): void {
    this.g.destroy();
    this.particles.destroy();
    for (let i = 0; i < this.lamps.length; i++) this.lighting.setLampGain(i, 1);
  }
}
