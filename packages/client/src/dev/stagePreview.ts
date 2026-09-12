/**
 * Dev-only stage preview: mounts createBackgrounds + scrollBackgrounds in a bare 960 x 540 scene and exposes
 * `window.__stage` so the screenshot driver can switch cars and maps. `?map=` and `?car=` set the start state.
 * The frame cost of scrollBackgrounds (which drives Motion and the map layer) is logged below the canvas.
 * No drawing logic lives here.
 */
import Phaser from "phaser";
import { MAP_IDS, WORLD, type MapId, type TrainCar } from "@midnight/shared";
import { CSS_P } from "../game/palette";
import { applyTrainCar, createBackgrounds, scrollBackgrounds, type Layers } from "../game/backgrounds";

declare global {
  interface Window {
    __stage?: {
      setCar(car: TrainCar): void;
      setMap(map: MapId): void;
      scroll(sec: number): void;
      /** Force a lightning strike, held for `frames` render frames (default: the real 2). */
      strike(frames?: number): void;
      /** Exponential moving average of scrollBackgrounds ms per frame. */
      cost(): number;
    };
  }
}

const CARS: Record<string, TrainCar> = { Digit1: "STANDARD", Digit2: "TUNNEL", Digit3: "FINAL_CAR" };
const MAP_KEYS: Record<string, MapId> = { KeyQ: "roof", KeyW: "gaps", KeyE: "platforms", KeyR: "chaos" };
const CAR_IDS: TrainCar[] = ["STANDARD", "TUNNEL", "FINAL_CAR"];

const query = new URLSearchParams(window.location.search);
const startMap = MAP_IDS.find((m) => m === query.get("map")) ?? "roof";
const startCar = CAR_IDS.find((c) => c === query.get("car")) ?? "STANDARD";

class StagePreviewScene extends Phaser.Scene {
  private layers!: Layers;
  private costMs = 0;
  private frames = 0;

  constructor() {
    super("stage-preview");
  }

  create(): void {
    this.layers = createBackgrounds(this, startMap);
    if (startCar !== "STANDARD") applyTrainCar(this, this.layers, startCar);
    window.__stage = {
      setCar: (car) => applyTrainCar(this, this.layers, car),
      setMap: (map) => this.layers.map.setMap(map),
      scroll: (sec) => {
        // Advance in render-sized steps so the clamp inside scrollBackgrounds never trims a long jump.
        for (let left = sec; left > 0; left -= 1 / 60) scrollBackgrounds(this.layers, Math.min(left, 1 / 60));
      },
      strike: (frames) => this.layers.motion.strike(frames),
      cost: () => this.costMs,
    };
    this.input.keyboard?.on("keydown", (event: KeyboardEvent) => {
      const car = CARS[event.code];
      if (car) applyTrainCar(this, this.layers, car);
      const map = MAP_KEYS[event.code];
      if (map) this.layers.map.setMap(map);
      if (event.code === "KeyL") this.layers.motion.strike();
    });
  }

  update(_time: number, delta: number): void {
    const start = performance.now();
    scrollBackgrounds(this.layers, delta / 1000);
    this.costMs += (performance.now() - start - this.costMs) * 0.05;
    if (++this.frames % 30 === 0) {
      const el = document.getElementById("cost");
      if (el) el.textContent = `scrollBackgrounds + Motion.update: ${this.costMs.toFixed(3)} ms/frame (budget 1 ms)`;
    }
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
