/**
 * Rig preview page (owner gate 4.03): both fighters in every pose at 2x. Uses computePose and drawFighter
 * unchanged, on the real 4.04 stage (createBackgrounds / scrollBackgrounds / applyTrainCar). The top row
 * stands on a preview-only ledge because the stage has a single roof line at ROOF_Y.
 */
import Phaser from "phaser";
import {
  WORLD, createMatch, hurtbox, punchHitbox,
  type CharacterId, type FighterState, type TrainCar,
} from "@midnight/shared";
import { applyTrainCar, createBackgrounds, scrollBackgrounds, type Layers } from "./game/backgrounds";
import { CSS_P, P } from "./game/palette";
import { computePose, type Clock, type RigState } from "./game/rig/pose";
import { drawFighter, drawShadow } from "./game/rig/draw";

/** Roof scroll speed per car (the slider label when no override is set); matches the stage, the tunnel wall scrolls faster on its own. */
const WIND: Record<TrainCar, number> = { STANDARD: 240, TUNNEL: 240, FINAL_CAR: 180 };

type ColumnId = "idle" | "walk" | "jumpUp" | "jumpApex" | "jumpDown" | "punch" | "block" | "hit" | "ko" | "offbounds" | "win";
interface Column { id: ColumnId; label: string; w: number; anchor: number }
const COLUMNS: Column[] = [
  { id: "idle", label: "idle", w: 78, anchor: 0.5 },
  { id: "walk", label: "walk", w: 78, anchor: 0.5 },
  { id: "jumpUp", label: "jump rising", w: 78, anchor: 0.5 },
  { id: "jumpApex", label: "jump apex", w: 78, anchor: 0.5 },
  { id: "jumpDown", label: "jump falling", w: 78, anchor: 0.5 },
  { id: "punch", label: "punch", w: 124, anchor: 0.3 },
  { id: "block", label: "block", w: 78, anchor: 0.5 },
  { id: "hit", label: "hit", w: 78, anchor: 0.5 },
  { id: "ko", label: "ko", w: 130, anchor: 0.7 },
  { id: "offbounds", label: "offbounds", w: 78, anchor: 0.5 },
  { id: "win", label: "win", w: 78, anchor: 0.5 },
];
const ROWS: Array<{ character: CharacterId; index: 0 | 1; facing: 1 | -1; groundY: number }> = [
  { character: "drifter", index: 0, facing: 1, groundY: 218 },
  { character: "conductor", index: 1, facing: -1, groundY: WORLD.ROOF_Y },
];
const JUMP_HEIGHT = { jumpUp: 36, jumpApex: 48, jumpDown: 28 } as const;

/** Page state, driven by the DOM controls and the `window.__rig` dev hook. */
const ui = {
  punchTick: 4,
  flip: false,
  car: "STANDARD" as TrainCar,
  wind: null as number | null,
  flashFrames: 0,
  overlays: false,
  /** Pinned ticks per state: punch elapsed, ko frames, hit hitstun, walk x, idle/block/win render ms. */
  pins: {} as Partial<Record<RigState, number>>,
};

class RigPreviewScene extends Phaser.Scene {
  private layers!: Layers;
  private car: TrainCar = "STANDARD";
  private ledge!: Phaser.GameObjects.Graphics;
  private ledgeScroll = 0;
  private shadows!: Phaser.GameObjects.Graphics;
  private fighters: Phaser.GameObjects.Graphics[] = [];
  private overlay!: Phaser.GameObjects.Graphics;
  private labels: Phaser.GameObjects.Text[] = [];
  private frame = 0;

  constructor() { super("rig-preview"); }

  create(): void {
    this.cameras.main.setZoom(2).centerOn(WORLD.WIDTH / 2, WORLD.HEIGHT / 2);
    this.layers = createBackgrounds(this);
    this.ledge = this.add.graphics();
    this.shadows = this.add.graphics();
    for (let i = 0; i < ROWS.length * COLUMNS.length; i++) this.fighters.push(this.add.graphics());
    this.overlay = this.add.graphics();
    for (const row of ROWS) {
      for (const col of COLUMNS) {
        const t = this.add.text(0, row.groundY + 4, col.label, { fontFamily: "system-ui, sans-serif", fontSize: "12px", color: CSS_P.steel2 });
        t.setOrigin(0.5, 0).setResolution(2);
        this.labels.push(t);
      }
    }
  }

  update(_time: number, delta: number): void {
    this.frame += 1;
    const now = performance.now();
    if (ui.car !== this.car) {
      this.car = ui.car;
      applyTrainCar(this, this.layers, this.car);
    }
    // The wind slider overrides the roof scroll too, so the rigs and the stage agree; a car change resets it.
    if (ui.wind !== null) this.layers.roofSpeed = ui.wind;
    const wind = this.layers.roofSpeed;
    scrollBackgrounds(this.layers, delta / 1000);
    this.drawLedge(delta / 1000);
    this.shadows.clear();
    this.overlay.clear();

    let k = 0;
    for (const row of ROWS) {
      const facing: 1 | -1 = ui.flip ? (-row.facing as 1 | -1) : row.facing;
      const xs = columnCentres(facing);
      for (let c = 0; c < COLUMNS.length; c++) {
        const col = COLUMNS[c]!;
        const cx = xs[c]!;
        const label = this.labels[k]!;
        label.setPosition(cx, row.groundY + 4);
        const { f, clock, dx } = fakeState(col.id, row, facing, cx, now, this.frame);
        const joints = computePose(f, clock);
        const g = this.fighters[k]!;
        g.clear();
        g.setPosition(dx, 0);
        const opts = { facing, rim: P.amber1, windSpeed: wind };
        drawShadow(this.shadows, f.x + dx, row.groundY, row.groundY - f.y);
        drawFighter(g, joints, row.character, opts);
        if (ui.flashFrames > 0) {
          const white = ui.flashFrames > 4;
          drawFighter(g, joints, row.character, { ...opts, fillOverride: white ? P.white : P.danger, fillAlpha: white ? 0.7 : 0.3 });
        }
        if (ui.overlays) {
          const hb = hurtbox(f);
          this.overlay.lineStyle(1, P.moon, 0.9).strokeRect(hb.x + dx, hb.y, hb.w, hb.h);
          const pb = punchHitbox(f);
          if (pb) this.overlay.lineStyle(1, P.danger, 1).strokeRect(pb.x + dx, pb.y, pb.w, pb.h);
        }
        k += 1;
      }
    }
    if (ui.flashFrames > 0) ui.flashFrames -= 1;
  }

  /** Preview-only ledge for the top row (the real roof is at ROOF_Y); scrolls with the roof so the two rows agree. */
  private drawLedge(dtSec: number): void {
    const g = this.ledge;
    const top = ROWS[0]!.groundY;
    this.ledgeScroll = (this.ledgeScroll + this.layers.roofSpeed * dtSec) % 48;
    g.clear();
    g.fillStyle(P.steel1, 1).fillRect(0, top, WORLD.WIDTH, 30);
    g.fillStyle(P.steel0, 1).fillRect(0, top + 22, WORLD.WIDTH, 8);
    g.lineStyle(2, P.steel2, 1).lineBetween(0, top, WORLD.WIDTH, top);
    g.fillStyle(P.steel2, 1);
    for (let x = -this.ledgeScroll; x < WORLD.WIDTH; x += 48) g.fillCircle(x, top + 26, 1.5);
  }
}

function columnCentres(facing: 1 | -1): number[] {
  const total = COLUMNS.reduce((s, c) => s + c.w, 0);
  let x = (WORLD.WIDTH - total) / 2;
  return COLUMNS.map((c) => {
    const anchor = facing === 1 ? c.anchor : 1 - c.anchor;
    const cx = x + c.w * anchor;
    x += c.w;
    return cx;
  });
}

/** A fake FighterState plus clock for one column; `dx` translates the Graphics when the pose needs a different x. */
function fakeState(id: ColumnId, row: (typeof ROWS)[number], facing: 1 | -1, cx: number, now: number, frame: number): { f: FighterState; clock: Clock; dx: number } {
  const f: FighterState = { ...createMatch().fighters[row.index]!, x: cx, y: row.groundY, facing };
  const pins = ui.pins;
  const clock: Clock = { renderMs: now, koFrames: 0, landFrames: 0 };
  let dx = 0;
  switch (id) {
    case "idle": if (pins.idle !== undefined) clock.renderMs = pins.idle; break;
    case "walk": {
      const x = pins.walk ?? 100 + ((now / 1000) * 180) % 400;
      f.x = x; f.vx = 3 * facing; dx = cx - x;
      break;
    }
    case "jumpUp": case "jumpApex": case "jumpDown": {
      f.grounded = false; f.jumpTicks = 6; f.vx = 3 * facing;
      f.vy = id === "jumpUp" ? -6 : id === "jumpDown" ? 6 : 0;
      f.y = row.groundY - JUMP_HEIGHT[id];
      break;
    }
    case "punch": f.action = { kind: "punch", arm: "R", elapsed: pins.punch ?? ui.punchTick, landed: false, sword: false }; break;
    case "block": f.blocking = true; if (pins.block !== undefined) clock.renderMs = pins.block; break;
    case "hit": f.hitstun = pins.hit ?? 8; break;
    case "ko": f.hp = 0; clock.koFrames = pins.ko ?? frame % 120; break;
    case "offbounds": {
      const x = facing === 1 ? 0 : WORLD.WIDTH;
      f.x = x; dx = cx - x;
      break;
    }
    case "win": clock.win = true; if (pins.win !== undefined) clock.renderMs = pins.win; break;
  }
  return { f, clock, dx };
}

// ---------------------------------------------------------------------------------------------
// DOM controls

function byId<T extends HTMLElement>(id: string): T { return document.getElementById(id) as T; }
const punchTick = byId<HTMLInputElement>("punchTick");
const punchTickOut = byId<HTMLOutputElement>("punchTickOut");
const facingBox = byId<HTMLInputElement>("facing");
const carSelect = byId<HTMLSelectElement>("car");
const windRange = byId<HTMLInputElement>("wind");
const windOut = byId<HTMLOutputElement>("windOut");
const overlaysBox = byId<HTMLInputElement>("overlays");

punchTick.addEventListener("input", () => { ui.punchTick = Number(punchTick.value); punchTickOut.value = punchTick.value; });
facingBox.addEventListener("change", () => { ui.flip = facingBox.checked; });
carSelect.addEventListener("change", () => { ui.car = carSelect.value as TrainCar; ui.wind = null; windRange.value = String(WIND[ui.car]); windOut.value = windRange.value; });
windRange.addEventListener("input", () => { ui.wind = Number(windRange.value); windOut.value = windRange.value; });
byId<HTMLButtonElement>("flash").addEventListener("click", () => { ui.flashFrames = 6; });
overlaysBox.addEventListener("change", () => { ui.overlays = overlaysBox.checked; });

/** Dev hook for the headless driver (integrator amendment 2). */
declare global { interface Window { __rig?: RigHook } }
interface RigHook {
  setState(state: RigState, tick: number): void;
  setFacing(f: 1 | -1): void;
  setCar(car: TrainCar): void;
  setWind(px: number): void;
  flash(): void;
  overlays(on: boolean): void;
}
window.__rig = {
  setState: (state, tick) => { ui.pins[state] = tick; if (state === "punch") { ui.punchTick = tick; punchTick.value = String(tick); punchTickOut.value = String(tick); } },
  setFacing: (f) => { ui.flip = f === -1; facingBox.checked = ui.flip; },
  setCar: (car) => { ui.car = car; ui.wind = null; carSelect.value = car; windRange.value = String(WIND[car]); windOut.value = windRange.value; },
  setWind: (px) => { ui.wind = px; windRange.value = String(px); windOut.value = String(px); },
  flash: () => { ui.flashFrames = 6; },
  overlays: (on) => { ui.overlays = on; overlaysBox.checked = on; },
};

new Phaser.Game({
  type: Phaser.AUTO,
  width: WORLD.WIDTH * 2,
  height: WORLD.HEIGHT * 2,
  parent: "game",
  backgroundColor: CSS_P.night1,
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_HORIZONTALLY },
  scene: [RigPreviewScene],
});
