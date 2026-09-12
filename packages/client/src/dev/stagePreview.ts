/**
 * Dev-only stage preview: mounts createBackgrounds + scrollBackgrounds in a bare 960 x 540 scene and exposes
 * `window.__stage` so the screenshot driver can switch cars and maps. `?map=` and `?car=` set the start state.
 * The frame cost of scrollBackgrounds (which drives Motion and the map layer) is logged below the canvas.
 * No drawing logic lives here.
 */
import Phaser from "phaser";
import { MAP_IDS, WORLD, createMatch, type FighterState, type MapId, type TrainCar } from "@midnight/shared";
import { CSS_P, P } from "../game/palette";
import { ROOF_INDEX, applyTrainCar, createBackgrounds, scrollBackgrounds, type Layers } from "../game/backgrounds";
import { drawShadow } from "../game/rig/draw";
import { computePose } from "../game/rig/pose";
import { SpriteFighter } from "../game/sprites/SpriteFighter";
import { Lighting, type LightHandle, type RimChoice } from "../game/stage/lighting";
import { Particulate } from "../game/stage/particulate";
import { qualityFromQuery, resolveQuality } from "../game/stage/quality";

declare global {
  interface Window {
    __stage?: {
      setCar(car: TrainCar): void;
      setMap(map: MapId): void;
      scroll(sec: number): void;
      /** Force a lightning strike, held for `frames` render frames (default: the real 2). */
      strike(frames?: number): void;
      /** Exponential moving average of scrollBackgrounds + Lighting ms per frame. */
      cost(): number;
      /** 12.02: the stand-in fighter's current rim choice, and where he is. */
      rim(): RimChoice & { x: number };
      /** 12.02: park the stand-in at x (stops the walk) or let him walk again with `walk()`. */
      park(x: number): void;
      walk(): void;
      /** 12.02: toggle the fire light at x 600 (key F). */
      fire(on?: boolean): boolean;
    };
  }
}

/** Where the 12.02 stand-in fighter walks: across the roof between the two edges, turning at each end. */
const WALK = { x0: 120, x1: 840, speed: 120 } as const;
const FIRE_X = 600;

const CARS: Record<string, TrainCar> = { Digit1: "STANDARD", Digit2: "TUNNEL", Digit3: "FINAL_CAR" };
const MAP_KEYS: Record<string, MapId> = { KeyQ: "roof", KeyW: "gaps", KeyE: "platforms", KeyR: "chaos" };
const CAR_IDS: TrainCar[] = ["STANDARD", "TUNNEL", "FINAL_CAR"];

const query = new URLSearchParams(window.location.search);
const startMap = MAP_IDS.find((m) => m === query.get("map")) ?? "roof";
const startCar = CAR_IDS.find((c) => c === query.get("car")) ?? "STANDARD";

class StagePreviewScene extends Phaser.Scene {
  private layers!: Layers;
  private lighting!: Lighting;
  private particulate!: Particulate;
  private high = true;
  private sprite!: SpriteFighter;
  private shadow!: Phaser.GameObjects.Graphics;
  private fighter: FighterState = { ...createMatch().fighters[0]!, x: WALK.x0, vx: 3, facing: 1 };
  private walking = true;
  private fireLight: LightHandle | null = null;
  private rimNow: RimChoice = { color: P.amber1, side: "right", gloom: 0 };
  private costMs = 0;
  private frames = 0;

  constructor() {
    super("stage-preview");
  }

  create(): void {
    this.layers = createBackgrounds(this, startMap);
    this.lighting = new Lighting(this);
    this.particulate = new Particulate(this);
    this.high = resolveQuality(qualityFromQuery(location.search), this.renderer.type === Phaser.WEBGL) === "high";
    this.lighting.setQuality(this.high);
    if (startCar !== "STANDARD") {
      applyTrainCar(this, this.layers, startCar);
      this.lighting.setCar(startCar, { immediate: true });
    }
    this.shadow = this.add.graphics().setDepth(1);
    this.sprite = new SpriteFighter(this, 0, 2);
    window.__stage = {
      setCar: (car) => { applyTrainCar(this, this.layers, car); this.lighting.setCar(car); },
      setMap: (map) => this.layers.map.setMap(map),
      scroll: (sec) => {
        // Advance in render-sized steps so the clamp inside scrollBackgrounds never trims a long jump.
        for (let left = sec; left > 0; left -= 1 / 60) scrollBackgrounds(this.layers, Math.min(left, 1 / 60));
      },
      strike: (frames) => this.layers.motion.strike(frames),
      cost: () => this.costMs,
      rim: () => ({ ...this.rimNow, x: this.fighter.x }),
      park: (x) => { this.walking = false; this.fighter = { ...this.fighter, x, vx: 0 }; },
      walk: () => { this.walking = true; },
      fire: (on) => this.setFire(on ?? this.fireLight === null),
    };
    this.input.keyboard?.on("keydown", (event: KeyboardEvent) => {
      const car = CARS[event.code];
      if (car) { applyTrainCar(this, this.layers, car); this.lighting.setCar(car); }
      const map = MAP_KEYS[event.code];
      if (map) this.layers.map.setMap(map);
      if (event.code === "KeyL") this.layers.motion.strike();
      if (event.code === "KeyF") this.setFire(this.fireLight === null);
    });
  }

  /** A molotov-sized fire light on the roof (rule 7), without the sim hazard. */
  private setFire(on: boolean): boolean {
    if (on && !this.fireLight) {
      this.fireLight = this.lighting.addLight({ x: FIRE_X, y: WORLD.ROOF_Y, r: 160, ry: 110, color: P.amber1, intensity: 0.8, flickerHz: 8, flickerAmp: 0.3 });
    } else if (!on && this.fireLight) {
      this.lighting.removeLight(this.fireLight);
      this.fireLight = null;
    }
    return this.fireLight !== null;
  }

  update(_time: number, delta: number): void {
    const start = performance.now();
    const dt = delta / 1000;
    scrollBackgrounds(this.layers, dt);
    this.lighting.update(dt, { roof: this.layers.tiles[ROOF_INDEX]?.tilePositionX ?? 0, tunnel: this.layers.tunnel.tilePositionX }, { reducedMotion: false, rays: this.high });
    this.particulate.update(dt, { reducedMotion: false, enabled: this.high, roofSpeed: this.layers.roofSpeed });
    this.stepStandIn(dt);
    this.costMs += (performance.now() - start - this.costMs) * 0.05;
    if (++this.frames % 30 === 0) {
      const el = document.getElementById("cost");
      if (el) el.textContent = `scrollBackgrounds + Motion.update + Lighting.update: ${this.costMs.toFixed(3)} ms/frame (budget 1 ms)  lights ${this.lighting.lights().length}  q ${this.high ? "high" : "low"}  motes ${this.particulate.live().motes} embers ${this.particulate.live().embers}  rim ${this.rimNow.side} gloom ${this.rimNow.gloom.toFixed(2)}`;
    }
  }

  /** The stand-in walks the roof so a screenshot can catch him under a lamp and in the dark (rule 12). */
  private stepStandIn(dt: number): void {
    let f = this.fighter;
    if (this.walking) {
      let x = f.x + f.facing * WALK.speed * dt;
      let facing = f.facing;
      if (x > WALK.x1) { x = WALK.x1; facing = -1; }
      if (x < WALK.x0) { x = WALK.x0; facing = 1; }
      f = { ...f, x, facing, vx: 3 * facing };
      this.fighter = f;
    }
    const joints = computePose(f, { renderMs: this.time.now, koFrames: 0, landFrames: 0 });
    this.rimNow = this.lighting.rimFor(f.x, f.y - 60);
    this.shadow.clear();
    drawShadow(this.shadow, f.x, WORLD.ROOF_Y, 0);
    this.sprite.update(f, joints, {
      rimColor: this.rimNow.color, rimSide: this.rimNow.side, gloom: this.rimNow.gloom,
      squash: 1, itemVisible: true, blinkMs: this.time.now,
    });
  }
}

new Phaser.Game({
  type: Phaser.AUTO,
  width: WORLD.WIDTH,
  height: WORLD.HEIGHT,
  parent: "stage",
  backgroundColor: CSS_P.night0,
  scene: [StagePreviewScene],
});
