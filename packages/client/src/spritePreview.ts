/**
 * Sprite preview page (owner gate 11.01): every character in every state at 3×, plus one 6× row where each
 * fighter holds a different item. Frames cycle on a timer. `?rig=vector` draws the old vector rig beside
 * each cell. Exposes `window.__sprites` for the headless driver and logs the SpriteFighter.update cost.
 */
import Phaser from "phaser";
import { ARSENAL, BALANCE, CHARACTERS, ITEM_IDS, WORLD, createMatch, type CharacterId, type FighterState, type ItemId, type PlayerIndex } from "@midnight/shared";
import { CSS_P, P } from "./game/palette";
import { computePose, type Clock, type Joints } from "./game/rig/pose";
import { drawFighter } from "./game/rig/draw";
import { SPRITE_SCALE } from "./game/sprites/compose";
import { SpriteFighter } from "./game/sprites/SpriteFighter";

type StateId = "idle" | "walk" | "jump" | "punch" | "block" | "hit" | "ko" | "win" | "throw" | "laser";
const STATES: StateId[] = ["idle", "walk", "jump", "punch", "block", "hit", "ko", "win", "throw", "laser"];
const VECTOR = new URLSearchParams(location.search).get("rig") === "vector";

/** Column widths in px (the KO sprawl and the punch reach need room) and where the feet sit in the column. */
const COLUMN: Record<StateId, { w: number; anchor: number }> = {
  idle: { w: 130, anchor: 0.5 }, walk: { w: 130, anchor: 0.5 }, jump: { w: 130, anchor: 0.5 }, punch: { w: 160, anchor: 0.4 },
  block: { w: 130, anchor: 0.5 }, hit: { w: 130, anchor: 0.5 }, ko: { w: 230, anchor: 0.65 }, win: { w: 130, anchor: 0.5 },
  throw: { w: 160, anchor: 0.4 }, laser: { w: 130, anchor: 0.5 },
};
/** With `?rig=vector` every column doubles: the vector rig is drawn in the right half. */
const VECTOR_EXTRA = VECTOR ? 150 : 0;
const CELL_H = 240;
const HERO_SCALE = 6;
const HERO_H = 56 * HERO_SCALE + 40;
const MARGIN_X = 40;
const TOP = 40;
const WIDTH = MARGIN_X * 2 + STATES.reduce((sum, s) => sum + COLUMN[s].w + VECTOR_EXTRA, 0);
const HEIGHT = TOP + CELL_H * CHARACTERS.length + HERO_H + 20;
/** Items for the 6× row: one per character. */
const HERO_ITEMS: ItemId[] = ["sword", "molotov", "shield", "banana"];

const ui = {
  flip: false,
  rimBoth: false,
  item: "" as ItemId | "",
  speed: 1,
  flashFrames: 0,
  pins: {} as Partial<Record<StateId, number>>,
};

interface Cell {
  character: CharacterId;
  state: StateId;
  x: number;
  groundY: number;
  scale: number;
  item: ItemId | null;
  sprite: SpriteFighter;
  vector: Phaser.GameObjects.Graphics | null;
  /** Feet x of the vector-rig comparison copy (`?rig=vector`). */
  vectorX: number;
}

class SpritePreviewScene extends Phaser.Scene {
  private cells: Cell[] = [];
  private ledges!: Phaser.GameObjects.Graphics;
  private frame = 0;
  private perfSum = 0;
  private perfN = 0;
  private t = 0;

  constructor() { super("sprite-preview"); }

  create(): void {
    this.ledges = this.add.graphics();
    const label = (x: number, y: number, text: string, color: string = CSS_P.steel2): void => {
      this.add.text(x, y, text, { fontFamily: "system-ui, sans-serif", fontSize: "12px", color }).setOrigin(0.5, 0).setResolution(2);
    };
    let index = 0;
    CHARACTERS.forEach((character, r) => {
      const groundY = TOP + CELL_H * (r + 1) - 24;
      this.ledges.fillStyle(P.steel1, 1).fillRect(0, groundY, WIDTH, 8);
      this.ledges.fillStyle(P.steel2, 1);
      for (let x = 8; x < WIDTH; x += 48) this.ledges.fillRect(x, groundY + 3, 2, 2);
      this.add.text(MARGIN_X, groundY - CELL_H + 34, character, { fontFamily: "system-ui, sans-serif", fontSize: "13px", color: CSS_P.amber1 }).setResolution(2);
      let colX = MARGIN_X;
      for (const state of STATES) {
        const col = COLUMN[state];
        const x = colX + col.w * col.anchor;
        label(colX + (col.w + VECTOR_EXTRA) / 2, groundY + 10, state);
        this.cells.push(this.makeCell(character, state, x, groundY, 1, index++ as PlayerIndex, null, colX + col.w + VECTOR_EXTRA * 0.5));
        colX += col.w + VECTOR_EXTRA;
      }
    });
    const heroGround = HEIGHT - 30;
    this.ledges.fillStyle(P.steel1, 1).fillRect(0, heroGround, WIDTH, 10);
    CHARACTERS.forEach((character, i) => {
      const x = WIDTH / 2 + (i - 1.5) * 320;
      const item = HERO_ITEMS[i]!;
      label(x, heroGround + 12, `${character} · ${item} · 6×`);
      this.cells.push(this.makeCell(character, i % 2 === 0 ? "idle" : "walk", x, heroGround, HERO_SCALE / SPRITE_SCALE, index++ as PlayerIndex, item));
    });
  }

  private makeCell(character: CharacterId, state: StateId, x: number, groundY: number, scale: number, index: PlayerIndex, item: ItemId | null = null, vectorX = 0): Cell {
    const sprite = new SpriteFighter(this, index, 10);
    if (scale !== 1) sprite.setScaleMultiplier(scale);
    const vector = VECTOR && vectorX ? this.add.graphics().setDepth(5) : null;
    return { character, state, x, groundY, scale, item, sprite, vector, vectorX };
  }

  update(_time: number, delta: number): void {
    this.frame += 1;
    this.t += delta * ui.speed;
    const now = this.t;
    for (const cell of this.cells) {
      const facing: 1 | -1 = ui.flip ? -1 : 1;
      const { f, joints } = fakeState(cell, facing, now, this.frame);
      const flash = ui.flashFrames > 0 ? (ui.flashFrames > 4 ? P.white : P.danger) : undefined;
      const t0 = performance.now();
      cell.sprite.update(f, joints, {
        rimBoth: ui.rimBoth,
        flash,
        flashAlpha: ui.flashFrames > 4 ? 0.7 : 0.3,
        squash: 1,
        itemVisible: true,
        blinkMs: now,
      });
      this.perfSum += performance.now() - t0;
      this.perfN += 1;
      if (cell.vector) {
        cell.vector.clear();
        cell.vector.setPosition(cell.vectorX - cell.x, 0);
        drawFighter(cell.vector, joints, cell.character, { facing, rim: P.amber1, rimBoth: ui.rimBoth, windSpeed: 240 });
      }
    }
    if (ui.flashFrames > 0) ui.flashFrames -= 1;
    if (this.perfN >= 600) {
      const ms = this.perfSum / this.perfN;
      perf.ms = ms;
      perfOut.textContent = `update: ${ms.toFixed(3)} ms / fighter`;
      console.log(`[sprites] SpriteFighter.update avg ${ms.toFixed(3)} ms per fighter over ${this.perfN} calls`);
      this.perfSum = 0;
      this.perfN = 0;
    }
  }
}

/**
 * A fake FighterState plus joints for one cell. `poseF` drives computePose, `drawF` is what the sprite sees:
 * they differ where pose.ts has no pose yet (throw and laser are 11.05) and for the walk, which is posed at
 * a moving x and translated back into the cell.
 */
function fakeState(cell: Cell, facing: 1 | -1, now: number, frame: number): { f: FighterState; joints: Joints } {
  // posed at a safe world x (cells past WORLD.WIDTH would read as offbounds), then translated into the cell
  const base: FighterState = { ...createMatch().fighters[0]!, character: cell.character, x: WORLD.WIDTH / 2, y: cell.groundY, facing };
  const item: ItemId | null = ui.item || cell.item;
  if (item) base.item = { kind: item, uses: 1 };
  const clock: Clock = { renderMs: now, koFrames: 0, landFrames: 0 };
  const pins = ui.pins;
  const cycle = (n: number, ms: number): number => Math.floor((now / ms) % n);
  const punchTotal = BALANCE.PUNCH_STARTUP + BALANCE.PUNCH_ACTIVE + BALANCE.PUNCH_RECOVERY;
  let poseF = base;
  let drawF: FighterState | null = null;
  switch (cell.state) {
    case "idle": if (pins.idle !== undefined) clock.renderMs = pins.idle; break;
    case "walk": poseF = { ...base, x: pins.walk ?? ((now / 1000) * 180) % 400, vx: 3 * facing }; break;
    case "jump": {
      const vy = pins.jump ?? Math.sin(now / 400) * 6;
      poseF = { ...base, grounded: false, jumpTicks: 6, vx: 3 * facing, vy, y: cell.groundY - 40 - Math.cos(now / 400) * 30 };
      break;
    }
    case "punch": {
      const elapsed = Math.min(pins.punch ?? cycle(punchTotal + 6, 80), punchTotal - 1);
      poseF = { ...base, action: { kind: "punch", arm: "R", elapsed, landed: false, sword: item === "sword" } };
      break;
    }
    case "block": poseF = { ...base, blocking: true }; if (pins.block !== undefined) clock.renderMs = pins.block; break;
    case "hit": poseF = { ...base, hitstun: pins.hit ?? BALANCE.HITSTUN_TICKS - cycle(BALANCE.HITSTUN_TICKS, 100) }; break;
    case "ko": poseF = { ...base, hp: 0 }; clock.koFrames = pins.ko ?? frame % 150; break;
    case "win": clock.win = true; if (pins.win !== undefined) clock.renderMs = pins.win; break;
    case "throw": {
      const total = ARSENAL.THROW_STARTUP + ARSENAL.THROW_RECOVERY;
      const elapsed = pins.throw ?? cycle(total, 80);
      const kind = item === "banana" ? "banana" : "molotov";
      const released = elapsed >= ARSENAL.THROW_STARTUP;
      poseF = { ...base, action: { kind: "punch", arm: "R", elapsed: Math.min(elapsed, punchTotal - 1), landed: false, sword: false } };
      drawF = { ...base, item: released ? null : { kind, uses: 1 }, action: { kind: "throw", item: kind, arm: "R", phase: "release", charge: 0, elapsed, released } };
      break;
    }
    case "laser": {
      const elapsed = pins.laser ?? cycle(ARSENAL.LASER_CHARGE + ARSENAL.LASER_ACTIVE + ARSENAL.LASER_RECOVERY, 40);
      poseF = { ...base, blocking: true };
      drawF = { ...base, action: { kind: "laser", elapsed, hit: [] } };
      break;
    }
  }
  const joints = computePose(poseF, clock);
  const dx = cell.x - poseF.x;
  const shift = (p: { x: number; y: number }): void => { p.x += dx; };
  shift(joints.hip); shift(joints.neck); shift(joints.head);
  for (const arm of [joints.arms.F, joints.arms.B]) { shift(arm.shoulder); shift(arm.elbow); shift(arm.wrist); shift(arm.fist); }
  for (const leg of [joints.legs.F, joints.legs.B]) { shift(leg.hip); shift(leg.knee); shift(leg.foot); }
  joints.ghosts.forEach(shift);
  return { f: { ...(drawF ?? poseF), x: cell.x }, joints };
}

// ---------------------------------------------------------------------------------------------
// DOM controls and dev hook

function byId<T extends HTMLElement>(id: string): T { return document.getElementById(id) as T; }
const facingBox = byId<HTMLInputElement>("facing");
const rimBox = byId<HTMLInputElement>("rimBoth");
const itemSelect = byId<HTMLSelectElement>("item");
const speedRange = byId<HTMLInputElement>("speed");
const speedOut = byId<HTMLOutputElement>("speedOut");
const perfOut = byId<HTMLSpanElement>("perf");
const perf = { ms: 0 };

facingBox.addEventListener("change", () => { ui.flip = facingBox.checked; });
rimBox.addEventListener("change", () => { ui.rimBoth = rimBox.checked; });
itemSelect.addEventListener("change", () => { ui.item = itemSelect.value as ItemId | ""; });
speedRange.addEventListener("input", () => { ui.speed = Number(speedRange.value) / 100; speedOut.value = speedRange.value; });
byId<HTMLButtonElement>("flash").addEventListener("click", () => { ui.flashFrames = 6; });
if (VECTOR) byId<HTMLAnchorElement>("rigLink").textContent = "Vector rig shown beside each cell";

declare global { interface Window { __sprites?: SpritesHook } }
interface SpritesHook {
  setFacing(f: 1 | -1): void;
  setRimBoth(on: boolean): void;
  setItem(item: ItemId | null): void;
  pin(state: StateId, tick: number): void;
  setSpeed(k: number): void;
  flash(): void;
  /** Average SpriteFighter.update cost in ms per fighter over the last window. */
  perf(): number;
  states: StateId[];
  items: readonly ItemId[];
}
window.__sprites = {
  setFacing: (f) => { ui.flip = f === -1; facingBox.checked = ui.flip; },
  setRimBoth: (on) => { ui.rimBoth = on; rimBox.checked = on; },
  setItem: (item) => { ui.item = item ?? ""; itemSelect.value = ui.item; },
  pin: (state, tick) => { ui.pins[state] = tick; },
  setSpeed: (k) => { ui.speed = k; speedRange.value = String(Math.round(k * 100)); speedOut.value = speedRange.value; },
  flash: () => { ui.flashFrames = 6; },
  perf: () => perf.ms,
  states: STATES,
  items: ITEM_IDS,
};

new Phaser.Game({
  type: Phaser.AUTO,
  width: WIDTH,
  height: HEIGHT,
  parent: "game",
  backgroundColor: CSS_P.night1,
  pixelArt: true,
  scene: [SpritePreviewScene],
});
