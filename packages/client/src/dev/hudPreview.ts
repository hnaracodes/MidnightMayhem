// Dev-only HUD preview. Not a build input. Mounts a 960 x 540 scene over a flat sky and roof band, constructs
// the real Hud, and lets the screenshot driver feed fake MatchStates through window.__hud.set(...).
import Phaser from "phaser";
import { createMatch, WORLD, type MatchState } from "@midnight/shared";
import { Hud } from "../game/hud";
import { P } from "../game/palette";

type Partial2<T> = { [K in keyof T]?: T[K] extends object ? Partial2<T[K]> : T[K] };
interface PreviewPatch extends Partial2<MatchState> { names?: [string, string] }

declare global {
  interface Window { __hud: { set(stateJson: string | PreviewPatch): void; ready: boolean } }
}

let state: MatchState = createMatch();
let hud: Hud | null = null;

function merge<T extends object>(base: T, patch: Partial2<T>): T {
  const out: T = Array.isArray(base) ? ([...(base as unknown[])] as unknown as T) : { ...base };
  for (const key of Object.keys(patch) as (keyof T)[]) {
    const value = patch[key];
    const current = base[key];
    if (value !== undefined && value !== null && typeof value === "object" && current && typeof current === "object") {
      out[key] = merge(current as object, value as object) as T[typeof key];
    } else if (value !== undefined) {
      out[key] = value as T[typeof key];
    }
  }
  return out;
}

window.__hud = {
  ready: false,
  set(stateJson) {
    const patch: PreviewPatch = typeof stateJson === "string" ? JSON.parse(stateJson) : stateJson;
    const { names, ...rest } = patch;
    state = merge(state, rest);
    if (names && hud) hud.setNames(names);
  },
};

class HudPreviewScene extends Phaser.Scene {
  constructor() {
    super("hud-preview");
  }

  create(): void {
    const stage = this.add.graphics();
    stage.fillStyle(P.night1, 1);
    stage.fillRect(0, 0, WORLD.WIDTH, WORLD.ROOF_Y);
    stage.fillStyle(P.steel1, 1);
    stage.fillRect(0, WORLD.ROOF_Y, WORLD.WIDTH, WORLD.HEIGHT - WORLD.ROOF_Y);
    stage.fillStyle(P.steel2, 1);
    stage.fillRect(0, WORLD.ROOF_Y + 12, WORLD.WIDTH, 3);
    hud = new Hud(this);
    hud.update(state, 0);
    window.__hud.ready = true;
  }

  update(_time: number, delta: number): void {
    hud?.update(state, delta / 1000);
  }
}

new Phaser.Game({
  type: Phaser.AUTO,
  width: WORLD.WIDTH,
  height: WORLD.HEIGHT,
  parent: "game",
  backgroundColor: "#101A33",
  scene: [HudPreviewScene],
});
