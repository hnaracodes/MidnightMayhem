/**
 * Dev-only stage preview: mounts createBackgrounds + scrollBackgrounds in a bare 960 x 540 scene and exposes
 * `window.__stage` so the screenshot driver can switch cars. No drawing logic lives here.
 */
import Phaser from "phaser";
import { WORLD, type TrainCar } from "@midnight/shared";
import { CSS_P } from "../game/palette";
import { applyTrainCar, createBackgrounds, scrollBackgrounds, type Layers } from "../game/backgrounds";

declare global {
  interface Window {
    __stage?: { setCar(car: TrainCar): void; scroll(sec: number): void };
  }
}

const CARS: Record<string, TrainCar> = { Digit1: "STANDARD", Digit2: "TUNNEL", Digit3: "FINAL_CAR" };

class StagePreviewScene extends Phaser.Scene {
  private layers!: Layers;

  constructor() {
    super("stage-preview");
  }

  create(): void {
    this.layers = createBackgrounds(this);
    window.__stage = {
      setCar: (car) => applyTrainCar(this, this.layers, car),
      scroll: (sec) => {
        // Advance in render-sized steps so the clamp inside scrollBackgrounds never trims a long jump.
        for (let left = sec; left > 0; left -= 1 / 60) scrollBackgrounds(this.layers, Math.min(left, 1 / 60));
      },
    };
    this.input.keyboard?.on("keydown", (event: KeyboardEvent) => {
      const car = CARS[event.code];
      if (car) applyTrainCar(this, this.layers, car);
    });
  }

  update(_time: number, delta: number): void {
    scrollBackgrounds(this.layers, delta / 1000);
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
