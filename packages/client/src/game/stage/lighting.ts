/**
 * 12.02 — The light rig. A full-screen darkness that light sources punch through, a warm additive cast under each
 * source, god-rays from the roof lamps, and the rim/gloom choice for every fighter. Sources are diegetic and
 * declared as data: the carriage windows, the roof lamps, the tunnel wall lamps, the red tail lamp, the moon, the
 * firebox, plus transients (fire hazards, the beam, the flash, impacts) that `Effects` and `ItemFx` register
 * through `LightSink`. Everything random comes from a seeded `Lcg`; nothing here touches the sim.
 *
 * Depths: darkness 0 (above every stage layer, below hazards at 0.5 and fighters at 2), rays 0.05, cast 0.1.
 */
import type Phaser from "phaser";
import { WORLD, type TrainCar } from "@midnight/shared";
import { Lcg, ROOF_LAMPS, ROOF_LAMP_PERIOD, TUNNEL_LAMP, WINDOW_CENTRE, makeTexture } from "../backgrounds";
import { P } from "../palette";

export interface Light {
  x: number;
  y: number;
  /** Horizontal radius of the pool in world px. */
  r: number;
  /** Vertical radius; defaults to `r` (a round pool). Window spill and the beam are flat ellipses. */
  ry?: number;
  color: number;
  /** 0..1: how much darkness the pool removes at its centre and how strong the cast is. */
  intensity: number;
  /** Seeded random-walk flicker at this rate; amplitude `flickerAmp` (default 5 %). */
  flickerHz?: number;
  flickerAmp?: number;
  /** Sinusoidal pulse (the tail lamp): intensity swings between 40 % and 100 %. */
  pulseHz?: number;
}

export interface LightHandle { readonly id: number }
export type RimSide = "left" | "right" | "both";
export interface RimChoice { color: number; side: RimSide; gloom: number }

/** What `Effects` and `ItemFx` need: transient lights, without owning the rig. */
export interface LightSink {
  addLight(l: Light): LightHandle;
  moveLight(h: LightHandle, x: number, y: number, intensity?: number): void;
  removeLight(h: LightHandle): void;
  /** A light that decays linearly to nothing over `frames` render frames, then removes itself. */
  pulse(l: Light, frames: number): void;
}

/** Darkness alpha per car: the open roof is dusky, the last car darker, the tunnel near-black. */
export const DARK_ALPHA: Record<TrainCar, number> = { STANDARD: 0.35, TUNNEL: 0.7, FINAL_CAR: 0.45 };
/** Fighters never drop below this brightness: the gloom mix is capped at 1 − this. */
export const FIGHTER_MIN_BRIGHTNESS = 0.75;
/** Darkness → gloom mapping (rule 8): how much a fully dark spot dims a fighter, before the cap. */
const GLOOM_GAIN = 0.5;
const GLOOM_LIGHT_WEIGHT = 0.6;
/** Radial pool texture: 256 px, radius 128, `RINGS` alpha steps with an ease-out falloff. */
export const POOL_TEXTURE = "light_pool";
const POOL_R = 128;
const RINGS = 128;
const CAST_ALPHA = 0.35;
const RAY_ALPHA = 0.06;
const RAY_PERIOD_SEC = 9;
const RAYS = [
  { deg: -14, width: 24 },
  { deg: 4, width: 20 },
  { deg: 22, width: 30 },
] as const;
const TRANSITION_MS = 400;
export const DEFAULT_SEED = 0x11a7;
const DEPTH = { DARK: 0, RAYS: 0.05, CAST: 0.1 } as const;
/** `BLEND.ADD` and `.ERASE` by value, so this module has no runtime Phaser import (tests run in node). */
const BLEND = { ADD: 1, ERASE: 17 } as const;

/** A static source: which tile offset it scrolls with (if any), how often it repeats along that tile, its kind. */
export interface LightSpec extends Light {
  scroll?: "roof" | "tunnel";
  every?: number;
  kind: "lamp" | "window" | "tunnel" | "tail" | "moon" | "firebox";
}

/** A light placed in world space this frame, with the flicker applied. */
export interface Resolved {
  x: number;
  y: number;
  rx: number;
  ry: number;
  color: number;
  intensity: number;
  cold: boolean;
  kind: LightSpec["kind"] | "transient";
}

const MOON = { x: 740, y: 110 } as const;
/** 11.02 tunnel speed in px/s, for callers that step the tunnel offset themselves (the stage preview). */
export const TUNNEL_SPEED = 420;

/** The static sources of a car (rule 3). Pure. */
export function carLights(car: TrainCar): LightSpec[] {
  const windows: LightSpec = {
    kind: "window", x: WINDOW_CENTRE.x, y: WORLD.ROOF_Y + 8, r: 80, ry: 34, color: P.lamp, intensity: 0.4,
    scroll: "roof", every: WINDOW_CENTRE.every,
  };
  const lamps: LightSpec[] = ROOF_LAMPS.map((l) => ({
    kind: "lamp", x: l.x, y: l.y, r: 210, color: P.lamp, intensity: 0.85, flickerHz: 0.7, flickerAmp: 0.05,
    scroll: "roof", every: ROOF_LAMP_PERIOD,
  }));
  const moon: LightSpec = { kind: "moon", x: MOON.x, y: MOON.y, r: 520, color: P.glow1, intensity: 0.25 };
  const firebox: LightSpec = { kind: "firebox", x: WORLD.WIDTH + 40, y: 300, r: 260, color: P.amber1, intensity: 0.5, flickerHz: 2, flickerAmp: 0.12 };
  if (car === "TUNNEL") {
    const wall: LightSpec = {
      kind: "tunnel", x: TUNNEL_LAMP.x, y: TUNNEL_LAMP.y, r: 170, color: P.amber1, intensity: 0.7,
      scroll: "tunnel", every: TUNNEL_LAMP.every,
    };
    return [windows, ...lamps, wall, firebox];
  }
  const base = [windows, ...lamps, moon, firebox];
  if (car === "FINAL_CAR") {
    base.push({ kind: "tail", x: 950, y: 372, r: 120, color: P.danger, intensity: 0.6, pulseHz: 1 });
  }
  return base;
}

/** Ease-out falloff of one pool at a point, 0..intensity. */
export function falloff(l: Resolved, x: number, y: number): number {
  const d = Math.hypot((x - l.x) / l.rx, (y - l.y) / l.ry);
  if (d >= 1) return 0;
  const k = 1 - d;
  return l.intensity * k * k;
}

/** Sum of every pool's falloff at a point (0..1+). Pure. */
export function lightLevel(lights: readonly Resolved[], x: number, y: number): number {
  let sum = 0;
  for (const l of lights) sum += falloff(l, x, y);
  return sum;
}

/** Rule 8: gloom from the light level and the car's darkness, capped so the fighter keeps 75 % brightness. */
export function gloomFor(level: number, darkAlpha: number): number {
  const raw = (darkAlpha - GLOOM_LIGHT_WEIGHT * level) * GLOOM_GAIN;
  return Math.max(0, Math.min(1 - FIGHTER_MIN_BRIGHTNESS, raw));
}

/**
 * Rule 8: rim colour and side from the strongest warm light against the moon; `both` in the tunnel or when two
 * warm lights straddle the fighter within 20 % of each other. Pure.
 */
export function rimFor(lights: readonly Resolved[], darkAlpha: number, x: number, y: number, tunnel = false): RimChoice {
  const gloom = gloomFor(lightLevel(lights, x, y), darkAlpha);
  if (tunnel) return { color: P.amber1, side: "both", gloom };
  let best: Resolved | null = null;
  let bestF = 0;
  let second: Resolved | null = null;
  let secondF = 0;
  let cold = 0;
  for (const l of lights) {
    const f = falloff(l, x, y);
    if (f <= 0) continue;
    if (l.cold) { cold = Math.max(cold, f); continue; }
    if (f > bestF) { second = best; secondF = bestF; best = l; bestF = f; }
    else if (f > secondF) { second = l; secondF = f; }
  }
  if (!best || bestF < cold || bestF === 0) {
    return { color: P.glow1, side: x < MOON.x ? "right" : "left", gloom };
  }
  const sideOf = (l: Resolved): RimSide => (l.x < x ? "left" : "right");
  const side = sideOf(best);
  if (second && secondF >= 0.8 * bestF && sideOf(second) !== side) return { color: best.color, side: "both", gloom };
  return { color: best.color, side, gloom };
}

/** Rule 5: a seeded random walk toward a new target every `1 / hz` seconds, eased; frozen at 1 under reduced motion. */
export interface FlickerState { value: number; target: number; timer: number }
export function flicker(rng: Lcg, st: FlickerState, hz: number, amp: number, dtSec: number): number {
  st.timer -= dtSec;
  if (st.timer <= 0) {
    st.timer += 1 / hz;
    st.target = 1 + rng.range(-amp, amp);
  }
  st.value += (st.target - st.value) * Math.min(1, dtSec * hz * 4);
  return st.value;
}

/** Instances of a repeating source that overlap the screen for the current scroll offset. Pure. */
export function placeRepeating(spec: LightSpec, offset: number): number[] {
  if (!spec.every) return [spec.x];
  const every = spec.every;
  const base = ((spec.x - offset) % every + every) % every; // first instance at or after x = 0
  const xs: number[] = [];
  for (let x = base - every; x < WORLD.WIDTH + spec.r; x += every) if (x > -spec.r) xs.push(x);
  return xs;
}

interface Transient { id: number; light: Light; frames: number; left: number }

export class Lighting implements LightSink {
  private readonly dark: Phaser.GameObjects.RenderTexture;
  private readonly cast: Phaser.GameObjects.RenderTexture;
  private readonly rays: Phaser.GameObjects.Graphics;
  private readonly rng: Lcg;
  private readonly flickers = new Map<string, FlickerState>();
  private readonly transients = new Map<number, Transient>();
  private readonly tweenState = { darkAlpha: DARK_ALPHA.STANDARD };
  private specs: LightSpec[] = carLights("STANDARD");
  private car: TrainCar = "STANDARD";
  private resolved: Resolved[] = [];
  private t = 0;
  private nextId = 1;

  constructor(private readonly scene: Phaser.Scene, seed = DEFAULT_SEED) {
    this.rng = new Lcg(seed);
    makeTexture(scene, POOL_TEXTURE, (g) => {
      for (let i = RINGS; i >= 1; i -= 1) {
        const k = i / RINGS;
        g.fillStyle(P.white, (1 - k) * (1 - k) * (1 - k));
        g.fillCircle(POOL_R, POOL_R, POOL_R * k);
      }
    }, POOL_R * 2, POOL_R * 2);
    this.dark = scene.add.renderTexture(0, 0, WORLD.WIDTH, WORLD.HEIGHT).setOrigin(0, 0).setDepth(DEPTH.DARK);
    this.cast = scene.add.renderTexture(0, 0, WORLD.WIDTH, WORLD.HEIGHT).setOrigin(0, 0).setDepth(DEPTH.CAST)
      .setBlendMode(BLEND.ADD);
    this.rays = scene.add.graphics().setDepth(DEPTH.RAYS).setBlendMode(BLEND.ADD);
  }

  /** Rule 1: darkness tweens to the car's alpha over 400 ms (immediately with `{ immediate: true }`); sources swap. */
  setCar(car: TrainCar, opts: { immediate?: boolean } = {}): void {
    this.car = car;
    this.specs = carLights(car);
    this.scene.tweens.killTweensOf(this.tweenState);
    if (opts.immediate) this.tweenState.darkAlpha = DARK_ALPHA[car];
    else this.scene.tweens.add({ targets: this.tweenState, darkAlpha: DARK_ALPHA[car], duration: TRANSITION_MS, ease: "Sine.easeInOut" });
  }

  get darkAlpha(): number { return this.tweenState.darkAlpha; }

  addLight(l: Light): LightHandle {
    const id = this.nextId++;
    this.transients.set(id, { id, light: { ...l }, frames: 0, left: 0 });
    return { id };
  }

  moveLight(h: LightHandle, x: number, y: number, intensity?: number): void {
    const t = this.transients.get(h.id);
    if (!t) return;
    t.light.x = x;
    t.light.y = y;
    if (intensity !== undefined) t.light.intensity = intensity;
  }

  removeLight(h: LightHandle): void {
    this.transients.delete(h.id);
    this.flickers.delete(`t${h.id}`);
  }

  pulse(l: Light, frames: number): void {
    const id = this.nextId++;
    this.transients.set(id, { id, light: { ...l }, frames, left: frames });
  }

  /** Live lights this frame (static instances plus transients), for the rim choice, tests and the debug readout. */
  lights(): readonly Resolved[] { return this.resolved; }

  rimFor(x: number, y: number): RimChoice {
    return rimFor(this.resolved, this.tweenState.darkAlpha, x, y, this.car === "TUNNEL");
  }

  /**
   * Once per render frame. `offsets` are the roof and tunnel tile offsets (`tilePositionX`) so the pools sit on
   * their fixtures; `rays` off drops the god-rays (quality low); `reducedMotion` freezes flicker and ray drift.
   */
  update(dtSec: number, offsets: { roof: number; tunnel: number }, opts: { reducedMotion: boolean; rays: boolean }): void {
    if (!opts.reducedMotion) this.t += dtSec;
    const out: Resolved[] = [];
    for (const [i, spec] of this.specs.entries()) {
      const key = `${spec.kind}${i}`;
      let gain = 1;
      if (spec.flickerHz && !opts.reducedMotion) {
        let st = this.flickers.get(key);
        if (!st) { st = { value: 1, target: 1, timer: 0 }; this.flickers.set(key, st); }
        gain = flicker(this.rng, st, spec.flickerHz, spec.flickerAmp ?? 0.05, dtSec);
      }
      if (spec.pulseHz) gain *= 0.7 + 0.3 * Math.sin(this.t * spec.pulseHz * Math.PI * 2);
      const offset = spec.scroll === "roof" ? offsets.roof : spec.scroll === "tunnel" ? offsets.tunnel : 0;
      for (const x of placeRepeating(spec, offset)) {
        out.push({ x, y: spec.y, rx: spec.r, ry: spec.ry ?? spec.r, color: spec.color, intensity: spec.intensity * gain, cold: spec.kind === "moon", kind: spec.kind });
      }
    }
    for (const [id, tr] of this.transients) {
      let k = 1;
      if (tr.frames > 0) {
        k = tr.left / tr.frames;
        tr.left -= 1;
        if (tr.left < 0) { this.transients.delete(id); this.flickers.delete(`t${id}`); continue; }
      }
      const l = tr.light;
      if (l.flickerHz && !opts.reducedMotion) {
        const key = `t${id}`;
        let st = this.flickers.get(key);
        if (!st) { st = { value: 1, target: 1, timer: 0 }; this.flickers.set(key, st); }
        k *= flicker(this.rng, st, l.flickerHz, l.flickerAmp ?? 0.05, dtSec);
      }
      out.push({ x: l.x, y: l.y, rx: l.r, ry: l.ry ?? l.r, color: l.color, intensity: l.intensity * k, cold: false, kind: "transient" });
    }
    this.resolved = out;
    this.draw(opts.rays && !opts.reducedMotion, opts.rays);
  }

  private draw(driftRays: boolean, rays: boolean): void {
    const dark = this.dark;
    dark.clear();
    dark.fill(P.void0, this.tweenState.darkAlpha);
    const cast = this.cast;
    cast.clear();
    for (const l of this.resolved) {
      const scaleX = l.rx / POOL_R;
      const scaleY = l.ry / POOL_R;
      const a = Math.max(0, Math.min(1, l.intensity));
      if (a <= 0) continue;
      dark.stamp(POOL_TEXTURE, undefined, l.x, l.y, { scaleX, scaleY, alpha: a, blendMode: BLEND.ERASE });
      cast.stamp(POOL_TEXTURE, undefined, l.x, l.y, { scaleX, scaleY, alpha: CAST_ALPHA * a, tint: l.color });
    }
    const g = this.rays;
    g.clear();
    if (!rays) return;
    const drift = driftRays ? Math.sin((this.t / RAY_PERIOD_SEC) * Math.PI * 2) * 2 : 0;
    for (const l of this.resolved) {
      if (l.kind !== "lamp") continue;
      for (const ray of RAYS) {
        const a0 = ((90 + ray.deg + drift - ray.width / 2) * Math.PI) / 180;
        const a1 = ((90 + ray.deg + drift + ray.width / 2) * Math.PI) / 180;
        const len = l.rx * 1.6;
        g.fillStyle(l.color, RAY_ALPHA * l.intensity);
        g.fillTriangle(l.x, l.y, l.x + Math.cos(a0) * len, l.y + Math.sin(a0) * len, l.x + Math.cos(a1) * len, l.y + Math.sin(a1) * len);
      }
    }
  }

  destroy(): void {
    this.scene.tweens.killTweensOf(this.tweenState);
    this.dark.destroy();
    this.cast.destroy();
    this.rays.destroy();
    this.transients.clear();
  }
}
