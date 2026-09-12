import type Phaser from "phaser";
import {
  ITEMS,
  ARSENAL, BALANCE, CHARACTER_LABEL, MODES, TICK, WORLD, roundWinner, timerSeconds,
  type CharacterId, type FighterState, type HeldItem, type ItemId, type MatchState, type Phase, type PlayerIndex, type Winner,
} from "@midnight/shared";
import { CSS_P, P } from "./palette";
import { CHARACTER_RIG } from "./rig/characters";

/**
 * HUD for two to four fighters (11.04). Presentation only: every number here is a pixel of layout; the only sim
 * numbers are read through `@midnight/shared` constants.
 */

export type BarAlign = "left" | "right";
export interface BarLayout { x: number; y: number; w: number; align: BarAlign }

/** The HUD band must end above these y values so no rig head (≈ 250) is covered. */
export const HUD_BAND = { 2: 90, 3: 90, 4: 110 } as const;

const INSET = 20;
const BARS = {
  2: { w: 380, h: 22, y: 24 },
  3: { w: 300, h: 22, y: 24, centreW: 300, centreH: 14, centreY: 58 },
  4: { w: 320, h: 14, y: [22, 58] as const },
} as const;
const BORDER = { TEAM: 4, INNER: 1 } as const;
const SLOT = { SIZE: 22, GAP: 6, GAP_COLUMN: 10, CHAMFER: 6, MINI: 10, MINI_GAP: 2, RING_R: 8, RING_W: 3, PIP_W: 2, PIP_H: 3, PIP_GAP: 1 } as const;
const PIP = { R: 6, GAP: 16, DY: 12, INSET: 8, R_SMALL: 5, GAP_SMALL: 13, DY_SMALL: 8 } as const;
const NAME = { DY: 6, DY_TIGHT: 1, SIZE: 14, SIZE_SMALL: 12 } as const;
const TAG = { SIZE: 11, GAP: 6 } as const;
const TIMER = { X: 480, Y: 32, SIZE: 40, SIZE_LONG: 30, SIZE_INFINITY: 34, STROKE: 4, DANGER_BELOW: 10 } as const;
const CAR = { INSET: 12, SIZE: 12 } as const;
/** Banner centre at y 175: below the HUD band and above a standing rig's head (≈ 250), so neither is covered. */
const BANNER = { X: 480, Y: 175, STROKE: 6, POP_FROM: 1.4, POP_SEC: 0.13 } as const;
const BANNER_SIZE = { COUNTDOWN: 96, ROUND_END: 48, MATCH_END: 64 } as const;
const GHOST_DRAIN_SEC = 0.4;
const GHOST_ALPHA = 0.7; // stays legible when the live fill is danger too
const COUNT_STEP_TICKS = 60;
const FIGHT_BANNER_TICKS = 60;
const FIGHT_BANNER_SEC = FIGHT_BANNER_TICKS / TICK.HZ;
const PULSE = { SEC: 0.6, BEATS: 2, W: 5, FILL: 0.35 } as const;
const BLINK_HZ = 4;
/** 9.08 rule 2: the equip toast. Frames at 60 Hz; the panel rests beside the bar under the name row. */
export const TOAST = { W: 168, H: 34, IN: 10, HOLD: 90, OUT: 10, BROKEN_HOLD: 45, GAP: 8, ROW: 38, STRIPE: 3, GLYPH: 18, NAME: 12, STATUS: 10 } as const;
const PIP_PULSE_FRAMES = 12;
const DEPTH = { HUD: 10, BANNER: 11 } as const;
/** 12.05 rule 2: the landing's condensed railway stack, local fonts only. */
export const HUD_FONT = "'Avenir Next Condensed', Bahnschrift, 'Arial Narrow', 'Helvetica Neue', Impact, sans-serif";
const FONT = HUD_FONT;
/** 12.05: bone ink with a 2–3 px void0 stroke and a warm lamp shadow-glow instead of the old hard strokes. */
const INK_STROKE = { NAME: 2, TIMER: 3, BANNER: 3 } as const;
const INK_GLOW = "rgba(247, 199, 122, 0.35)";
const INK_GLOW_BLUR = 6;
/** 12.05 rule 1: the bar glow outside the frame, and its heartbeat under low HP (rule 5). */
export const LOW_HP_FRACTION = 0.25;
const GLOW = { LAYERS: 3, STEP: 3 } as const;
const HEARTBEAT_SEC = 1.2;
const LOW_VIGNETTE = { W: 40, STRIPS: 12, ALPHA: 0.18 } as const;
const BANNER_FADE_SEC = 0.28;
const HALO = { ALPHA0: 0.35, ALPHA1: 0.2, WIDTH: 1.4, DEPTH: 10.9 } as const;
const MAX_BARS = 4;

const CAR_LABEL: Record<MatchState["trainCar"], string> = {
  STANDARD: "STANDARD CAR",
  TUNNEL: "TUNNEL",
  FINAL_CAR: "FINAL CAR",
};

const GLYPH: Record<ItemId, string> = { molotov: "▲", sword: "/", shield: "▣", banana: "◗", flash: "✦" };

/** The slice of a Phaser Text this file recolours; `style.color` is the CSS string last given to setColor. */
export interface ColorableText { style: { color: unknown }; setColor(color: string): unknown }

/**
 * `Text.setColor` re-renders the canvas and re-uploads the texture with no equality guard (unlike setText), so
 * only call it when the colour actually changes: 7–17 Text objects per frame at 4p otherwise (11.05 budget).
 */
export function setColorIfChanged<T extends ColorableText>(text: T, css: string): T {
  if (text.style.color !== css) text.setColor(css);
  return text;
}

export interface ToastLayout { x: number; y: number; w: number; h: number; align: BarAlign; dx: number; dy: number }

/**
 * Where fighter `i`'s equip toast rests: under that side's name rows, hugging the bar's outer edge, sliding in
 * from that screen edge (`dx`, `dy` is the start offset). The centred third bar's toast drops in from above.
 */
export function toastLayout(players: number, i: PlayerIndex): ToastLayout {
  const bar = barLayout(players, i);
  const h = barHeight(players, i);
  const tight = players === 4 || (players === 3 && i === 2);
  const nameBottom = bar.y + h + (tight ? NAME.DY_TIGHT + NAME.SIZE_SMALL : NAME.DY + NAME.SIZE);
  const w = TOAST.W;
  if (players === 3 && i === 2) {
    return { x: (WORLD.WIDTH - w) / 2, y: nameBottom + TOAST.GAP, w, h: TOAST.H, align: "left", dx: 0, dy: -(TOAST.H + TOAST.GAP) };
  }
  // Four players: both of a side's bars stack, so both toasts hang under the lower name row, one per row.
  const rowBottom = players === 4 ? barLayout(players, 1).y + h + NAME.DY_TIGHT + NAME.SIZE_SMALL : nameBottom;
  const y = rowBottom + TOAST.GAP + (players === 4 ? (i % 2) * TOAST.ROW : 0);
  if (bar.align === "left") return { x: bar.x, y, w, h: TOAST.H, align: "left", dx: -(bar.x + w), dy: 0 };
  return { x: bar.x + bar.w - w, y, w, h: TOAST.H, align: "right", dx: WORLD.WIDTH - (bar.x + bar.w - w), dy: 0 };
}

/** 0 → 1 over `IN` frames, 1 through `hold`, back to 0 over `OUT`; null once the toast has ended. */
export function toastSlide(frame: number, hold: number): number | null {
  if (frame < TOAST.IN) return easeOut(frame / TOAST.IN);
  if (frame < TOAST.IN + hold) return 1;
  const out = frame - TOAST.IN - hold;
  if (out >= TOAST.OUT) return null;
  return 1 - easeIn(out / TOAST.OUT);
}

export type ItemEdge = "equip" | "use" | "break";

/** What changed in a held item between two frames: the state-side view of ITEM_EQUIP / ITEM_USE / ITEM_BREAK. */
export function itemEdge(prev: HeldItem | null, next: HeldItem | null): ItemEdge | null {
  if (next && (!prev || prev.kind !== next.kind)) return "equip";
  if (next && prev && next.ticksLeft !== null) return null; // 9.10: a timed item drains, it is not "used"
  if (next && prev && next.uses < prev.uses) return "use";
  if (!next && prev) return "break";
  return null;
}

/** 9.10: the last 3 s of a timed item flash. */
export const TIMER_FLASH_TICKS = 180;
export const TIMER_FLASH_PERIOD = 10;

/** 9.10: how full a timed item's draining bar is (1 → 0), or null for a use-counted item. */
export function itemTimerFraction(item: HeldItem | null): number | null {
  if (!item || item.ticksLeft === null) return null;
  const ttl = ITEMS[item.kind].ttl ?? 0;
  if (ttl <= 0) return 0;
  return Math.min(1, Math.max(0, item.ticksLeft / ttl));
}

/** 9.10: whether the draining bar is on its flashing "on" phase this tick (last 180 ticks, 10-tick period). */
export function itemTimerFlash(item: HeldItem | null): boolean {
  if (!item || item.ticksLeft === null || item.ticksLeft > TIMER_FLASH_TICKS) return false;
  return Math.floor(item.ticksLeft / (TIMER_FLASH_PERIOD / 2)) % 2 === 0;
}

/** 9.10: the equip toast's name line: `SWORD 10s` for a timed item, `MOLOTOV ×2` for a use-counted one. */
export function toastLabel(kind: ItemId, uses: number): string {
  const label = kind.toUpperCase(); // MOLOTOV, SWORD, SHIELD, BANANA, FLASH: the words the keys 1–5 are taught by
  const ttl = ITEMS[kind].ttl;
  if (ttl !== undefined && ttl > 0) return `${label} ${Math.round(ttl / 60)}s`;
  return `${label} ×${uses}`;
}

/** Character key colours for the team outline, from the rig data (11.01 owns the tokens). */
function keyColor(id: CharacterId): number {
  return CHARACTER_RIG[id].key;
}

// ---- Pure layout helpers (tested) ----

/** Where fighter `i`'s bar sits for a given player count. `x` is the bar's left edge; `align` is the edge it grows from. */
export function barLayout(players: number, i: PlayerIndex): BarLayout {
  const fromRight = (w: number): number => WORLD.WIDTH - INSET - w;
  if (players <= 2) {
    const { w, y } = BARS[2];
    return i === 0 ? { x: INSET, y, w, align: "left" } : { x: fromRight(w), y, w, align: "right" };
  }
  if (players === 3) {
    const { w, y, centreW, centreY } = BARS[3];
    if (i === 0) return { x: INSET, y, w, align: "left" };
    if (i === 1) return { x: fromRight(w), y, w, align: "right" };
    return { x: (WORLD.WIDTH - centreW) / 2, y: centreY, w: centreW, align: "left" };
  }
  const { w, y } = BARS[4];
  const row = y[i % 2] ?? y[0];
  return i < 2 ? { x: INSET, y: row, w, align: "left" } : { x: fromRight(w), y: row, w, align: "right" };
}

/** Bar height in px: 22 as today, 14 for the stacked four-player rows and the centred third bar. */
export function barHeight(players: number, i: PlayerIndex): number {
  if (players <= 2) return BARS[2].h;
  if (players === 3) return i === 2 ? BARS[3].centreH : BARS[3].h;
  return BARS[4].h;
}

/** Outline colour of a bar: team amber / moon in 2v2, the character key colour in free-for-all. */
export function teamColor(state: MatchState, i: PlayerIndex): number {
  const fighter = state.fighters[i];
  if (state.config.teams === "2v2") return (fighter?.team ?? i) === 0 ? P.amber1 : P.moon;
  return keyColor(fighter?.character ?? "drifter");
}

/** "∞" without a timer, MM:SS from a minute up, plain seconds below. */
export function timerText(state: MatchState): string {
  const seconds = timerSeconds(state);
  if (seconds === null) return "∞";
  if (seconds < 60) return String(seconds);
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function itemGlyph(item: HeldItem | null): string {
  return item ? GLYPH[item.kind] : "";
}

/** Whether fighter `i` carries a row of round pips: every fighter in free-for-all, the team's first fighter in 2v2. */
export function roundPipRow(state: MatchState, i: PlayerIndex): boolean {
  const f = state.fighters[i];
  if (!f) return false;
  if (state.config.teams !== "2v2") return true;
  return state.fighters.findIndex((o) => o.team === f.team) === i;
}

/** Pips per row: the rounds a team needs to win in this mode. */
export function pipCount(state: MatchState): number {
  return MODES[state.config.mode].roundsToWin;
}

/** KO'd while the round is still running (free-for-all / 2v2): the bar goes steel with an OUT tag. */
export function isOut(f: Pick<FighterState, "hp">, phase: Phase): boolean {
  return f.hp <= 0 && phase === "FIGHTING";
}

/** Dazzle marker visibility at `clock` seconds: on for the first half of every 1/BLINK_HZ s. */
export function blinkOn(clock: number): boolean {
  return Math.floor(clock * BLINK_HZ) % 2 === 0;
}

/** True on the update where the ring first becomes full again. */
export function readyEdge(wasReady: boolean, frac: number): boolean {
  return frac >= 1 && !wasReady;
}

/** How much of the laser ring is filled: 1 when ready, 0 at a full cooldown. */
export function cooldownFraction(f: Pick<FighterState, "laserCooldown">): number {
  return clamp01(1 - f.laserCooldown / ARSENAL.LASER_COOLDOWN);
}

// ---- Internal layout ----

interface Point { x: number; y: number }
interface Accessories { slot: Point; minis: [Point, Point]; ring: Point }

/** Item slot, the two loadout minis and the laser ring, hung off the bar's inner end. */
function accessories(players: number, i: PlayerIndex, bar: BarLayout, h: number): Accessories {
  const dir = bar.align === "left" ? 1 : -1;
  const inner = bar.align === "left" ? bar.x + bar.w : bar.x;
  let cursor = inner + dir * (players <= 2 ? SLOT.GAP_COLUMN : SLOT.GAP);
  const place = (w: number, gap: number): number => {
    const x = dir === 1 ? cursor : cursor - w;
    cursor += dir * (w + gap);
    return x;
  };
  if (players <= 2) {
    // Two 380 px bars leave no room in line: the column stacks slot, minis, then the ring.
    const sx = place(SLOT.SIZE, 0);
    const my = bar.y + SLOT.SIZE + 3;
    return {
      slot: { x: sx, y: bar.y },
      minis: [{ x: sx, y: my }, { x: sx + SLOT.MINI + SLOT.MINI_GAP, y: my }],
      ring: { x: sx + SLOT.SIZE / 2, y: my + SLOT.MINI + 4 + SLOT.RING_R },
    };
  }
  const cy = bar.y + h / 2;
  const sx = place(SLOT.SIZE, 4);
  const m0 = place(SLOT.MINI, SLOT.MINI_GAP);
  const m1 = place(SLOT.MINI, 6);
  const rx = place(SLOT.RING_R * 2, 0) + SLOT.RING_R;
  const my = cy - SLOT.MINI / 2;
  return { slot: { x: sx, y: cy - SLOT.SIZE / 2 }, minis: [{ x: m0, y: my }, { x: m1, y: my }], ring: { x: rx, y: cy } };
}

export interface Banner { text: string; size: number }

/** Where the name line ended: the next free x along the row, its top y and font size. */
interface NameRow { cursor: number; y: number; size: number }

/** Per-bar drain animation: the ghost lags behind hp and eases down to it over GHOST_DRAIN_SEC. */
interface BarAnim { hp: number; ghost: number; from: number; t: number }

interface FighterTexts {
  name: Phaser.GameObjects.Text;
  tag: Phaser.GameObjects.Text;
  out: Phaser.GameObjects.Text;
  dazzle: Phaser.GameObjects.Text;
  glyph: Phaser.GameObjects.Text;
  minis: [Phaser.GameObjects.Text, Phaser.GameObjects.Text];
  toastGlyph: Phaser.GameObjects.Text;
  toastName: Phaser.GameObjects.Text;
  toastStatus: Phaser.GameObjects.Text;
}

/** A running equip toast: `frame` counts render frames from the slide-in; `hold` is 90 (equip) or 45 (broken). */
interface Toast { frame: number; hold: number; broken: boolean; item: ItemId; uses: number }

export class Hud {
  private readonly g: Phaser.GameObjects.Graphics;
  private readonly timer: Phaser.GameObjects.Text;
  private readonly car: Phaser.GameObjects.Text;
  private readonly banner: Phaser.GameObjects.Text;
  private readonly texts: FighterTexts[] = [];
  private readonly anim: BarAnim[] = [];
  /** Laser ring pulse clock per fighter: seconds since the ring became ready, or null when idle. */
  private readonly pulse: (number | null)[] = [];
  private readonly wasReady: boolean[] = [];
  private readonly toasts: (Toast | null)[] = [];
  /** Last seen held item per fighter; `undefined` until the first update so a joined-in-progress item is not an equip. */
  private readonly lastItem: (HeldItem | null | undefined)[] = [];
  private readonly pulseFrames: number[] = [];
  private names: string[] = [];
  private bannerText: string | null = null;
  private popT: number = BANNER_FADE_SEC;
  private clock = 0;
  /** 12.05 rule 5: the low-HP breathing vignette (its own Graphics so the bars can be cleared per frame as before). */
  private vig!: Phaser.GameObjects.Graphics;
  /** 12.05 rule 6: the void0 halo under a banner as it bleeds in. */
  private halo!: Phaser.GameObjects.Graphics;
  private lastPhase: MatchState["phase"] | null = null;
  private fightBannerLeft = 0;
  /** Text objects stay hidden until the first update: the arena boots under the lobby before any snapshot. */
  private shown = false;

  constructor(scene: Phaser.Scene) {
    this.g = scene.add.graphics().setDepth(DEPTH.HUD);
    this.vig = scene.add.graphics().setDepth(DEPTH.HUD);
    this.halo = scene.add.graphics().setDepth(HALO.DEPTH);

    this.timer = scene.add
      .text(TIMER.X, TIMER.Y, "", style(TIMER.SIZE, CSS_P.bone, INK_STROKE.TIMER))
      .setOrigin(0.5, 0.5)
      .setDepth(DEPTH.HUD);

    this.car = scene.add
      .text(WORLD.WIDTH - CAR.INSET, WORLD.HEIGHT - CAR.INSET, "", style(CAR.SIZE, CSS_P.steel2, 0))
      .setOrigin(1, 1)
      .setDepth(DEPTH.HUD);

    this.banner = scene.add
      .text(BANNER.X, BANNER.Y, "", style(BANNER_SIZE.COUNTDOWN, CSS_P.bone, INK_STROKE.BANNER))
      .setOrigin(0.5, 0.5)
      .setDepth(DEPTH.BANNER)
      .setVisible(false);

    const text = (size: number, color: string, stroke: number): Phaser.GameObjects.Text =>
      scene.add.text(0, 0, "", style(size, color, stroke)).setDepth(DEPTH.HUD).setVisible(false);

    for (let i = 0; i < MAX_BARS; i += 1) {
      this.texts.push({
        name: text(NAME.SIZE, CSS_P.bone, INK_STROKE.NAME),
        tag: text(TAG.SIZE, CSS_P.amber1, 2),
        out: text(NAME.SIZE_SMALL, CSS_P.bone, INK_STROKE.NAME).setOrigin(0.5, 0.5),
        dazzle: text(NAME.SIZE_SMALL, CSS_P.amber1, 2),
        glyph: text(NAME.SIZE, CSS_P.bone, 0).setOrigin(0.5, 0.5),
        minis: [text(9, CSS_P.steel2, 0).setOrigin(0.5, 0.5), text(9, CSS_P.steel2, 0).setOrigin(0.5, 0.5)],
        toastGlyph: text(TOAST.GLYPH, CSS_P.bone, 0).setOrigin(0.5, 0.5),
        toastName: text(TOAST.NAME, CSS_P.amber1, 0).setOrigin(0, 0.5),
        toastStatus: text(TOAST.STATUS, CSS_P.bone, 0).setOrigin(0, 0.5),
      });
      const full = BALANCE.MAX_HP;
      this.anim.push({ hp: full, ghost: full, from: full, t: GHOST_DRAIN_SEC });
      this.pulse.push(null);
      this.wasReady.push(true);
      this.toasts.push(null);
      this.lastItem.push(undefined);
      this.pulseFrames.push(0);
    }
    this.timer.setVisible(false);
    this.car.setVisible(false);
  }

  /** Frames left of the slot-pip pulse after a use (0 when idle); the arena's tests read it. */
  pipPulse(i: PlayerIndex): number {
    return this.pulseFrames[i] ?? 0;
  }

  /** Player names shown under the bars; a missing name falls back to the fighter's character label. */
  setNames(names: readonly string[]): void {
    this.names = [...names];
  }

  update(state: MatchState, dtSec: number): void {
    const dt = Math.max(0, dtSec);
    this.clock += dt;
    if (!this.shown) {
      this.shown = true;
      this.timer.setVisible(true);
      this.car.setVisible(true);
    }
    if (state.phase !== this.lastPhase) {
      if (state.phase === "FIGHTING" && this.lastPhase !== null) this.fightBannerLeft = FIGHT_BANNER_SEC;
      this.lastPhase = state.phase;
    }
    this.fightBannerLeft = Math.max(0, this.fightBannerLeft - dt);

    const players = state.config.players;
    this.g.clear();
    this.drawLowVignette(state);
    for (let i = 0; i < MAX_BARS; i += 1) {
      const fighter = state.fighters[i];
      const texts = this.texts[i]!;
      if (!fighter || i >= players) {
        hideAll(texts);
        continue;
      }
      this.drawFighter(state, i as PlayerIndex, fighter, texts, dt);
    }

    this.updateTimer(state);
    this.car.setText(CAR_LABEL[state.trainCar]);
    this.updateBanner(bannerFor(state, this.fightBannerLeft > 0), dt);
  }

  private drawFighter(state: MatchState, i: PlayerIndex, f: FighterState, t: FighterTexts, dt: number): void {
    const players = state.config.players;
    const bar = barLayout(players, i);
    const h = barHeight(players, i);
    const anim = this.anim[i]!;
    const ko = isOut(f, state.phase);
    const color = teamColor(state, i);

    this.advanceDrain(anim, f.hp, dt);
    const low = !ko && state.phase === "FIGHTING" && f.hp > 0 && f.hp / BALANCE.MAX_HP <= LOW_HP_FRACTION;
    this.drawBar(bar, h, anim, ko ? P.steel2 : color, low);
    const after = this.drawNameRow(state, i, f, bar, h, t, color, ko);
    this.drawRoundPips(state, i, bar, h, after);

    const acc = accessories(players, i, bar, h);
    this.trackItem(state, i, f);
    this.drawSlot(i, f, acc, t);
    this.drawRing(i, f, acc.ring, dt);
    this.drawToast(players, i, t, color);
  }

  /** Item edges from the state (equip / use / break) drive the toast and the pip pulse; round resets are not breaks. */
  private trackItem(state: MatchState, i: PlayerIndex, f: FighterState): void {
    const prev = this.lastItem[i];
    const next: HeldItem | null = f.item ? { kind: f.item.kind, uses: f.item.uses, ticksLeft: f.item.ticksLeft } : null;
    this.lastItem[i] = next;
    if (prev === undefined || state.phase !== "FIGHTING") return;
    const edge = itemEdge(prev, next);
    if (!edge) return;
    const toast = this.toasts[i] ?? null;
    if (edge === "equip" && next) {
      this.toasts[i] = { frame: 0, hold: TOAST.HOLD, broken: false, item: next.kind, uses: next.uses };
    } else if (edge === "use" && next) {
      this.pulseFrames[i] = PIP_PULSE_FRAMES;
      if (toast && !toast.broken) toast.uses = next.uses;
    } else if (edge === "break" && prev) {
      // Already resting: keep the panel where it is and swap the words; else slide in fresh.
      const resting = toast && toast.frame >= TOAST.IN && toast.frame < TOAST.IN + toast.hold;
      this.toasts[i] = { frame: resting ? TOAST.IN : 0, hold: TOAST.BROKEN_HOLD, broken: true, item: prev.kind, uses: 0 };
    }
  }

  /** The equip toast: a night panel with an accent stripe on its leading edge, glyph, name × uses and a status line. */
  private drawToast(players: number, i: PlayerIndex, t: FighterTexts, teamColor: number): void {
    const toast = this.toasts[i] ?? null;
    const k = toast ? toastSlide(toast.frame, toast.hold) : null;
    if (!toast || k === null) {
      this.toasts[i] = null;
      t.toastGlyph.setVisible(false);
      t.toastName.setVisible(false);
      t.toastStatus.setVisible(false);
      return;
    }
    toast.frame += 1;
    const l = toastLayout(players, i);
    const x = l.x + l.dx * (1 - k);
    const y = l.y + l.dy * (1 - k);
    const g = this.g;
    const accent = toast.broken ? P.danger : teamColor;
    g.fillStyle(P.night0, 0.9 * k);
    g.fillRect(x, y, l.w, l.h);
    g.lineStyle(1, P.steel2, k);
    g.strokeRect(x + 0.5, y + 0.5, l.w - 1, l.h - 1);
    const left = l.align === "left";
    const stripeX = left ? x : x + l.w - TOAST.STRIPE;
    g.fillStyle(accent, k);
    g.fillRect(stripeX, y, TOAST.STRIPE, l.h);

    const cy = y + l.h / 2;
    const glyphX = left ? x + 20 : x + l.w - 20;
    const textX = left ? x + 36 : x + 36; // text block always reads left → right; it sits after the glyph on the left side
    t.toastGlyph.setText(GLYPH[toast.item]).setPosition(glyphX, cy - 1).setAlpha(k).setVisible(true);
    setColorIfChanged(t.toastGlyph, toast.broken ? CSS_P.steel2 : CSS_P.bone);
    const label = toast.item.toUpperCase();
    const name = toast.broken ? label : toastLabel(toast.item, toast.uses);
    t.toastName.setText(name).setAlpha(k).setVisible(true);
    setColorIfChanged(t.toastName, toast.broken ? CSS_P.bone : CSS_P.amber1);
    t.toastStatus.setText(toast.broken ? "BROKEN" : "EQUIPPED").setAlpha(k).setVisible(true);
    setColorIfChanged(t.toastStatus, toast.broken ? CSS_P.danger : CSS_P.bone);
    if (left) {
      t.toastName.setOrigin(0, 0.5).setPosition(textX, cy - 7);
      t.toastStatus.setOrigin(0, 0.5).setPosition(textX, cy + 8);
    } else {
      // Mirrored: glyph on the outer (right) edge, text right-aligned toward it.
      const right = x + l.w - 36;
      t.toastName.setOrigin(1, 0.5).setPosition(right, cy - 7);
      t.toastStatus.setOrigin(1, 0.5).setPosition(right, cy + 8);
    }
  }

  private advanceDrain(anim: BarAnim, hp: number, dt: number): void {
    if (hp < anim.hp) {
      anim.from = anim.ghost;
      anim.t = 0;
    } else if (hp > anim.hp) {
      anim.ghost = hp;
      anim.from = hp;
      anim.t = GHOST_DRAIN_SEC;
    }
    anim.hp = hp;
    if (anim.ghost > hp) {
      anim.t = Math.min(GHOST_DRAIN_SEC, anim.t + dt);
      anim.ghost = lerp(anim.from, hp, anim.t / GHOST_DRAIN_SEC);
    }
  }

  private drawBar(bar: BarLayout, h: number, anim: BarAnim, outline: number, low = false): void {
    const g = this.g;
    const span = (hp: number): [number, number] => {
      const w = Math.round(bar.w * clamp01(hp / BALANCE.MAX_HP));
      return [bar.align === "left" ? bar.x : bar.x + bar.w - w, w];
    };
    const fill = barColor(anim.hp);

    // 12.05 rule 1: a glow outside the frame that grows as health drops, beating under low HP (rule 5)
    const beat = low ? 0.6 + 0.4 * lowHpPulse(this.clock) : 1;
    const glow = barGlowAlpha(anim.hp) * beat;
    for (let k = GLOW.LAYERS; k >= 1; k -= 1) {
      const pad = BORDER.TEAM / 2 + k * GLOW.STEP;
      g.fillStyle(fill, glow / GLOW.LAYERS);
      g.fillRect(bar.x - pad, bar.y - pad, bar.w + 2 * pad, h + 2 * pad);
    }

    // the recessed channel: void0 with a night2 line along its bottom edge
    g.fillStyle(P.void0, 1);
    g.fillRect(bar.x, bar.y, bar.w, h);
    g.fillStyle(P.night2, 1);
    g.fillRect(bar.x, bar.y + h - 1, bar.w, 1);

    if (anim.ghost > anim.hp) {
      const [gx, gw] = span(anim.ghost);
      g.fillStyle(P.danger, GHOST_ALPHA);
      g.fillRect(gx, bar.y, gw, h);
    }

    const [fx, fw] = span(anim.hp);
    if (fw > 0) {
      g.fillStyle(fill, 1);
      g.fillRect(fx, bar.y, fw, h);
      // a bone highlight along the top, an outline inner shadow along the bottom
      g.fillStyle(P.bone, 0.85);
      g.fillRect(fx, bar.y, fw, 1);
      g.fillStyle(P.outline, 0.45);
      g.fillRect(fx, bar.y + h - 2, fw, 2);
    }

    // Team colour outside, a hairline of outline inside it so an amber fill never merges with an amber edge.
    g.lineStyle(BORDER.INNER, P.outline, 1);
    g.strokeRect(bar.x + 0.5, bar.y + 0.5, bar.w - 1, h - 1);
    g.lineStyle(BORDER.TEAM, outline, 1);
    g.strokeRect(bar.x - BORDER.TEAM / 2, bar.y - BORDER.TEAM / 2, bar.w + BORDER.TEAM, h + BORDER.TEAM);
  }

  /** 12.05 rule 5: a breathing danger vignette on the screen edges while any live fighter is at low HP. */
  private drawLowVignette(state: MatchState): void {
    const g = this.vig;
    g.clear();
    if (state.phase !== "FIGHTING") return;
    const low = state.fighters.some((f) => f.hp > 0 && f.hp / BALANCE.MAX_HP <= LOW_HP_FRACTION);
    if (!low) return;
    const peak = LOW_VIGNETTE.ALPHA * (0.35 + 0.65 * lowHpPulse(this.clock));
    const strip = LOW_VIGNETTE.W / LOW_VIGNETTE.STRIPS;
    for (let k = 0; k < LOW_VIGNETTE.STRIPS; k += 1) {
      const a = peak * (1 - k / LOW_VIGNETTE.STRIPS);
      g.fillStyle(P.danger, a);
      g.fillRect(k * strip, 0, strip, WORLD.HEIGHT);
      g.fillRect(WORLD.WIDTH - (k + 1) * strip, 0, strip, WORLD.HEIGHT);
      g.fillRect(0, k * strip, WORLD.WIDTH, strip);
      g.fillRect(0, WORLD.HEIGHT - (k + 1) * strip, WORLD.WIDTH, strip);
    }
  }

  /**
   * Round pips: one row per team in 2v2 (on the team's first bar), per fighter otherwise. Under the bar's inner end,
   * except the three-player side bars, whose inner end sits over the centred bar: theirs follow the name.
   */
  private drawRoundPips(state: MatchState, i: PlayerIndex, bar: BarLayout, h: number, after: NameRow): void {
    if (!roundPipRow(state, i)) return;
    const f = state.fighters[i]!;
    const players = state.config.players;
    const sideOfThree = players === 3 && i < 2;
    const small = players > 2 && !sideOfThree;
    const r = small ? PIP.R_SMALL : PIP.R;
    const gap = small ? PIP.GAP_SMALL : PIP.GAP;
    let cy = bar.y + h + (small ? PIP.DY_SMALL : PIP.DY);
    let inner = bar.align === "left" ? bar.x + bar.w - PIP.INSET : bar.x + PIP.INSET;
    let dir = bar.align === "left" ? -1 : 1;
    if (sideOfThree) {
      cy = after.y + after.size / 2 + 1;
      inner = after.cursor;
      dir = bar.align === "left" ? 1 : -1;
    }
    const won = state.roundsWon[f.team] ?? 0;
    const g = this.g;
    for (let pip = 0; pip < pipCount(state); pip += 1) {
      const cx = inner + dir * (r + pip * gap);
      // 12.05 rule 3: a carved diamond with an outline edge and a bone facet on the upper-left of a won pip
      const wonPip = pip < won;
      g.lineStyle(2, P.outline, 1);
      g.fillStyle(wonPip ? P.moon : P.steel1, 1);
      g.beginPath();
      g.moveTo(cx, cy - r);
      g.lineTo(cx + r, cy);
      g.lineTo(cx, cy + r);
      g.lineTo(cx - r, cy);
      g.closePath();
      g.fillPath();
      g.strokePath();
      if (wonPip) {
        g.lineStyle(1, P.bone, 1);
        g.lineBetween(cx - r + 2, cy, cx, cy - r + 2);
      }
    }
  }

  private drawNameRow(
    state: MatchState, i: PlayerIndex, f: FighterState, bar: BarLayout, h: number, t: FighterTexts, color: number, ko: boolean,
  ): NameRow {
    const players = state.config.players;
    const tight = players === 4 || (players === 3 && i === 2);
    const size = tight ? NAME.SIZE_SMALL : NAME.SIZE;
    const y = bar.y + h + (tight ? NAME.DY_TIGHT : NAME.DY);
    const left = bar.align === "left";
    const dir = left ? 1 : -1;
    let cursor = left ? bar.x : bar.x + bar.w;

    const name = t.name;
    name.setFontSize(size);
    name.setText(this.names[i] || CHARACTER_LABEL[f.character]);
    name.setOrigin(left ? 0 : 1, 0).setPosition(cursor, y).setVisible(true);
    cursor += dir * (name.displayWidth + TAG.GAP);

    const tag = t.tag;
    if (state.config.teams === "2v2") {
      setColorIfChanged(tag.setText(f.team === 0 ? "A" : "B"), cssOf(color));
      tag.setOrigin(left ? 0 : 1, 0).setPosition(cursor, y + (size - TAG.SIZE) / 2 + 1).setVisible(true);
      cursor += dir * (tag.displayWidth + TAG.GAP);
    } else {
      tag.setVisible(false);
    }

    const dazzled = f.dazzle > 0;
    t.dazzle.setText("✦").setOrigin(left ? 0 : 1, 0).setPosition(cursor, y).setVisible(dazzled && blinkOn(this.clock));
    if (dazzled) cursor += dir * (t.dazzle.displayWidth + TAG.GAP);

    setColorIfChanged(t.out.setText("OUT").setPosition(bar.x + bar.w / 2, bar.y + h / 2), CSS_P.bone).setVisible(ko);
    return { cursor, y, size };
  }

  /** The held item in a chamfered 22 px slot with uses pips, then the two loadout minis: dim, lit while held, struck once used. */
  private drawSlot(i: PlayerIndex, f: FighterState, acc: Accessories, t: FighterTexts): void {
    const g = this.g;
    const pulse = this.pulseFrames[i] ?? 0;
    if (pulse > 0) this.pulseFrames[i] = pulse - 1;
    const beat = pulse / PIP_PULSE_FRAMES; // 1 on the use frame → 0
    const { x, y } = acc.slot;
    const s = SLOT.SIZE;
    const c = SLOT.CHAMFER;
    const held = f.item;

    g.fillStyle(P.void0, 0.92);
    g.lineStyle(2, held ? P.moon : P.steel2, 1);
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + s - c, y);
    g.lineTo(x + s, y + c);
    g.lineTo(x + s, y + s);
    g.lineTo(x, y + s);
    g.closePath();
    g.fillPath();
    g.strokePath();
    // 12.05 rule 4: a recessed bezel — shadow inside the top and left, a lip inside the bottom and right
    g.fillStyle(P.night2, 1);
    g.fillRect(x + 1, y + 1, s - c - 1, 1);
    g.fillRect(x + 1, y + 1, 1, s - 2);
    g.fillStyle(P.steel2, 0.8);
    g.fillRect(x + 1, y + s - 2, s - 2, 1);
    g.fillRect(x + s - 2, y + c + 1, 1, s - c - 3);

    t.glyph.setText(itemGlyph(held)).setPosition(x + s / 2, y + s / 2 - 2).setVisible(held !== null);

    const timer = itemTimerFraction(held);
    if (held && timer !== null) {
      // 9.10: a timed item drains a bar along the slot's bottom instead of counting pips; the last 3 s flash
      const flash = itemTimerFlash(held);
      const barW = s - 4;
      g.fillStyle(P.night2, 1);
      g.fillRect(x + 2, y + s - SLOT.PIP_H - 2, barW, SLOT.PIP_H);
      g.fillStyle(flash ? P.white : P.amber1, 1);
      g.fillRect(x + 2, y + s - SLOT.PIP_H - 2, Math.round(barW * timer), SLOT.PIP_H);
      if (flash) {
        g.lineStyle(2, P.white, 0.8);
        g.strokeRect(x - 1, y - 1, s + 2, s + 2);
      }
    } else if (held) {
      const pitch = SLOT.PIP_W + SLOT.PIP_GAP;
      const total = held.uses * pitch - SLOT.PIP_GAP;
      let px = x + (s - total) / 2;
      const grow = Math.round(2 * beat); // the pips swell and whiten for 12 frames after a use
      g.fillStyle(beat > 0.5 ? P.white : P.amber1, 1);
      for (let u = 0; u < held.uses; u += 1) {
        g.fillRect(px - grow / 2, y + s - SLOT.PIP_H - 2 - grow, SLOT.PIP_W + grow, SLOT.PIP_H + grow);
        px += pitch;
      }
      if (beat > 0) {
        g.lineStyle(2, P.white, beat);
        g.strokeRect(x - 1 - 3 * (1 - beat), y - 1 - 3 * (1 - beat), s + 2 + 6 * (1 - beat), s + 2 + 6 * (1 - beat));
      }
    }

    for (const k of [0, 1] as const) {
      const kind = f.loadout[k];
      const m = acc.minis[k];
      const size = SLOT.MINI;
      const isHeld = held?.kind === kind;
      const used = !isHeld && f.itemsUsed.includes(kind);
      g.fillStyle(P.void0, 0.75);
      g.fillRect(m.x, m.y, size, size);
      g.fillStyle(P.night2, 1);
      g.fillRect(m.x + 1, m.y + 1, size - 2, 1);
      g.lineStyle(1, isHeld ? P.moon : used ? P.steel1 : P.steel2, 1);
      g.strokeRect(m.x + 0.5, m.y + 0.5, size - 1, size - 1);
      const mini = t.minis[k];
      setColorIfChanged(mini.setText(GLYPH[kind]), isHeld ? CSS_P.bone : used ? CSS_P.steel1 : CSS_P.steel2);
      mini.setPosition(m.x + size / 2, m.y + size / 2 - 1).setVisible(true);
      if (used) {
        g.lineStyle(2, P.steel2, 1);
        g.lineBetween(m.x - 1, m.y + size + 1, m.x + size + 1, m.y - 1);
      }
    }
  }

  /** Laser ring: a steel track, an amber arc filling clockwise from the top, moon once full, two amber beats on the edge. */
  private drawRing(i: PlayerIndex, f: FighterState, ring: Point, dt: number): void {
    const g = this.g;
    const frac = cooldownFraction(f);
    const ready = frac >= 1;
    if (readyEdge(this.wasReady[i] ?? true, frac)) this.pulse[i] = 0;
    this.wasReady[i] = ready;

    g.lineStyle(SLOT.RING_W + 2, P.void0, 1);
    g.strokeCircle(ring.x, ring.y, SLOT.RING_R);
    g.lineStyle(SLOT.RING_W, P.night2, 1);
    g.strokeCircle(ring.x, ring.y, SLOT.RING_R);
    if (ready) {
      g.lineStyle(SLOT.RING_W, P.moon, 1);
      g.strokeCircle(ring.x, ring.y, SLOT.RING_R);
    } else if (frac > 0) {
      const start = -Math.PI / 2;
      g.lineStyle(SLOT.RING_W, P.amber2, 1);
      g.beginPath();
      g.arc(ring.x, ring.y, SLOT.RING_R, start, start + Math.PI * 2 * frac, false);
      g.strokePath();
    }

    const p = this.pulse[i] ?? null;
    if (p === null) return;
    const next = p + dt;
    if (next >= PULSE.SEC || !ready) {
      this.pulse[i] = null;
      return;
    }
    this.pulse[i] = next;
    const beat = Math.max(0, Math.sin((next / PULSE.SEC) * Math.PI * PULSE.BEATS));
    g.fillStyle(P.amber1, beat * PULSE.FILL);
    g.fillCircle(ring.x, ring.y, SLOT.RING_R + 2);
    g.lineStyle(PULSE.W, P.amber1, beat);
    g.strokeCircle(ring.x, ring.y, SLOT.RING_R + 1);
  }

  private updateTimer(state: MatchState): void {
    const text = timerText(state);
    const seconds = timerSeconds(state);
    this.timer.setText(text);
    this.timer.setFontSize(seconds === null ? TIMER.SIZE_INFINITY : text.length > 2 ? TIMER.SIZE_LONG : TIMER.SIZE);
    setColorIfChanged(this.timer, seconds !== null && seconds < TIMER.DANGER_BELOW ? CSS_P.danger : CSS_P.bone);
  }

  private updateBanner(next: Banner | null, dt: number): void {
    const text = next?.text ?? null;
    if (text !== this.bannerText) {
      this.bannerText = text;
      if (next) {
        this.banner.setFontSize(next.size);
        this.banner.setText(next.text);
        this.banner.setVisible(true);
        this.popT = 0;
      } else {
        this.banner.setVisible(false);
      }
    }
    this.halo.clear();
    if (!next) return;
    // 12.05 rule 6: ink-bleed — alpha and tint bloom up from dark under a void0 halo; no scale pop
    this.popT = Math.min(BANNER_FADE_SEC, this.popT + dt);
    const fade = bannerFade(this.popT);
    this.banner.setScale(1).setAlpha(fade.alpha).setTint(fade.tint);
    const w = this.banner.displayWidth * HALO.WIDTH;
    const h = this.banner.displayHeight * 1.1;
    this.halo.fillStyle(P.void0, lerp(HALO.ALPHA0, HALO.ALPHA1, fade.alpha));
    this.halo.fillEllipse(BANNER.X, BANNER.Y, w, h);
  }
}

function hideAll(t: FighterTexts): void {
  for (const text of [t.name, t.tag, t.out, t.dazzle, t.glyph, t.minis[0], t.minis[1], t.toastGlyph, t.toastName, t.toastStatus]) {
    text.setVisible(false);
  }
}

/** Banner text and size for the phase; `fightEdge` is the one-second window after entering FIGHTING (deathmatch has no timer to read it from). */
export function bannerFor(state: MatchState, fightEdge: boolean): Banner | null {
  switch (state.phase) {
    case "COUNTDOWN": {
      const n = Math.max(1, Math.ceil(state.phaseTicks / COUNT_STEP_TICKS));
      return { text: String(n), size: BANNER_SIZE.COUNTDOWN };
    }
    case "FIGHTING": {
      const total = MODES[state.config.mode].roundTicks;
      const timed = total !== null && state.roundTicks > total - FIGHT_BANNER_TICKS;
      return timed || fightEdge ? { text: "FIGHT", size: BANNER_SIZE.COUNTDOWN } : null;
    }
    case "ROUND_END":
      return { text: roundEndText(state, roundWinner(state)), size: BANNER_SIZE.ROUND_END };
    case "MATCH_END":
      return state.winner === null ? null : { text: matchEndText(state, state.winner), size: BANNER_SIZE.MATCH_END };
  }
}

/** A team's banner name: "TEAM A/B" in 2v2, else the character label of the team's first fighter. */
function teamLabel(state: MatchState, team: number): string {
  if (state.config.teams === "2v2") return team === 0 ? "TEAM A" : "TEAM B";
  const first = state.fighters.find((f) => f.team === team);
  return first ? CHARACTER_LABEL[first.character] : `PLAYER ${team + 1}`;
}

function roundEndText(state: MatchState, winner: Winner | null): string {
  if (winner === "draw") return "DRAW ROUND";
  if (winner === null) return `ROUND ${state.round}`;
  if (state.config.teams === "2v2") return `${teamLabel(state, winner)} TAKES THE ROUND`;
  return `ROUND ${state.round}: ${teamLabel(state, winner).replace(/^THE /, "")}`;
}

function matchEndText(state: MatchState, winner: Winner): string {
  if (winner === "draw") return "MUTUAL DERAILMENT";
  return `${teamLabel(state, winner)} WINS`;
}

function barColor(hp: number): number {
  const frac = hp / BALANCE.MAX_HP;
  if (frac > 0.5) return P.amber1;
  if (frac >= 0.25) return P.moon;
  return P.danger;
}

function cssOf(color: number): string {
  return `#${color.toString(16).padStart(6, "0")}`;
}

function style(size: number, color: string, stroke: number): Phaser.Types.GameObjects.Text.TextStyle {
  return {
    fontFamily: FONT,
    fontSize: `${size}px`,
    fontStyle: "800",
    color,
    stroke: CSS_P.void0,
    strokeThickness: stroke,
    shadow: { offsetX: 0, offsetY: 0, color: INK_GLOW, blur: INK_GLOW_BLUR, stroke: false, fill: true },
  };
}

/** 12.05 rule 1: glow alpha outside a bar's frame, growing as health drops. Pure. */
export function barGlowAlpha(hp: number): number {
  return 0.1 + 0.4 * (1 - clamp01(hp / BALANCE.MAX_HP));
}

/** 12.05 rule 5: a 0..1 heartbeat, two beats per 1.2 s cycle (lub-dub), used by the low-HP bar and vignette. Pure. */
export function lowHpPulse(sec: number): number {
  const k = ((sec % HEARTBEAT_SEC) + HEARTBEAT_SEC) % HEARTBEAT_SEC / HEARTBEAT_SEC;
  const beat = (at: number, w: number): number => Math.max(0, 1 - Math.abs(k - at) / w);
  return Math.min(1, beat(0.1, 0.1) + 0.7 * beat(0.32, 0.1));
}

/** 12.05 rule 6: the banner's ink-bleed entrance — alpha and tint bloom up from dark over 0.28 s, no scale. Pure. */
export function bannerFade(sec: number): { alpha: number; tint: number } {
  const k = easeOut(clamp01(sec / BANNER_FADE_SEC));
  const ch = (shift: number): number => Math.round(((P.void0 >> shift) & 0xff) + (0xff - ((P.void0 >> shift) & 0xff)) * k) & 0xff;
  return { alpha: k, tint: (ch(16) << 16) | (ch(8) << 8) | ch(0) };
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function lerp(a: number, b: number, k: number): number {
  return a + (b - a) * k;
}

function easeOut(k: number): number {
  const t = clamp01(k);
  return 1 - (1 - t) * (1 - t);
}

function easeIn(k: number): number {
  const t = clamp01(k);
  return t * t;
}
