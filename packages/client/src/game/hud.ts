import type Phaser from "phaser";
import {
  ARSENAL, BALANCE, CHARACTER_LABEL, MODES, TICK, WORLD, roundWinner,
  type CharacterId, type FighterState, type HeldItem, type ItemId, type MatchState, type PlayerIndex, type Winner,
} from "@midnight/shared";
import { CSS_P, P } from "./palette";

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
const DEPTH = { HUD: 10, BANNER: 11 } as const;
const FONT = "system-ui, -apple-system, 'Segoe UI', sans-serif";
const MAX_BARS = 4;

const CAR_LABEL: Record<MatchState["trainCar"], string> = {
  STANDARD: "STANDARD CAR",
  TUNNEL: "TUNNEL",
  FINAL_CAR: "FINAL CAR",
};

const GLYPH: Record<ItemId, string> = { molotov: "▲", sword: "/", shield: "▣", banana: "◗", flash: "✦" };

// INTEGRATOR: collapse after merge — 11.01 (sprites) owns `palette.ts` / `rig/characters.ts` and adds the stoker and
// claude key colours there; until then the HUD carries its own copy of the four key colours.
const KEY_COLOR: Record<CharacterId, number> = {
  drifter: P.drifterKey,
  conductor: P.conductorKey,
  stoker: 0x4A4A52,
  claude: 0xE8873A,
};

// INTEGRATOR: collapse after merge — 10.02 (sim-modes) exports `timerSeconds` from `@midnight/shared` with this
// exact shape; replace this local copy with the import.
function timerSeconds(s: MatchState): number | null {
  return MODES[s.config.mode].roundTicks === null ? null : Math.ceil(s.roundTicks / TICK.HZ);
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
  return KEY_COLOR[fighter?.character ?? "drifter"];
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

interface Banner { text: string; size: number }

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
}

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
  private names: string[] = [];
  private bannerText: string | null = null;
  private popT: number = BANNER.POP_SEC;
  private clock = 0;
  private lastPhase: MatchState["phase"] | null = null;
  private fightBannerLeft = 0;
  /** Text objects stay hidden until the first update: the arena boots under the lobby before any snapshot. */
  private shown = false;

  constructor(scene: Phaser.Scene) {
    this.g = scene.add.graphics().setDepth(DEPTH.HUD);

    this.timer = scene.add
      .text(TIMER.X, TIMER.Y, "", style(TIMER.SIZE, CSS_P.moon, TIMER.STROKE))
      .setOrigin(0.5, 0.5)
      .setDepth(DEPTH.HUD);

    this.car = scene.add
      .text(WORLD.WIDTH - CAR.INSET, WORLD.HEIGHT - CAR.INSET, "", style(CAR.SIZE, CSS_P.steel2, 0))
      .setOrigin(1, 1)
      .setDepth(DEPTH.HUD);

    this.banner = scene.add
      .text(BANNER.X, BANNER.Y, "", style(BANNER_SIZE.COUNTDOWN, CSS_P.moon, BANNER.STROKE))
      .setOrigin(0.5, 0.5)
      .setDepth(DEPTH.BANNER)
      .setVisible(false);

    const text = (size: number, color: string, stroke: number): Phaser.GameObjects.Text =>
      scene.add.text(0, 0, "", style(size, color, stroke)).setDepth(DEPTH.HUD).setVisible(false);

    for (let i = 0; i < MAX_BARS; i += 1) {
      this.texts.push({
        name: text(NAME.SIZE, CSS_P.moon, 2),
        tag: text(TAG.SIZE, CSS_P.amber1, 2),
        out: text(NAME.SIZE_SMALL, CSS_P.moon, 2).setOrigin(0.5, 0.5),
        dazzle: text(NAME.SIZE_SMALL, CSS_P.amber1, 2),
        glyph: text(NAME.SIZE, CSS_P.moon, 0).setOrigin(0.5, 0.5),
        minis: [text(9, CSS_P.steel2, 0).setOrigin(0.5, 0.5), text(9, CSS_P.steel2, 0).setOrigin(0.5, 0.5)],
      });
      const full = BALANCE.MAX_HP;
      this.anim.push({ hp: full, ghost: full, from: full, t: GHOST_DRAIN_SEC });
      this.pulse.push(null);
      this.wasReady.push(true);
    }
    this.timer.setVisible(false);
    this.car.setVisible(false);
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
    const ko = f.hp <= 0 && state.phase === "FIGHTING";
    const color = teamColor(state, i);

    this.advanceDrain(anim, f.hp, dt);
    this.drawBar(bar, h, anim, ko ? P.steel2 : color);
    const after = this.drawNameRow(state, i, f, bar, h, t, color, ko);
    this.drawRoundPips(state, i, bar, h, after);

    const acc = accessories(players, i, bar, h);
    this.drawSlot(f, acc, t);
    this.drawRing(i, f, acc.ring, dt);
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

  private drawBar(bar: BarLayout, h: number, anim: BarAnim, outline: number): void {
    const g = this.g;
    const span = (hp: number): [number, number] => {
      const w = Math.round(bar.w * clamp01(hp / BALANCE.MAX_HP));
      return [bar.align === "left" ? bar.x : bar.x + bar.w - w, w];
    };

    g.fillStyle(P.steel0, 1);
    g.fillRect(bar.x, bar.y, bar.w, h);

    if (anim.ghost > anim.hp) {
      const [gx, gw] = span(anim.ghost);
      g.fillStyle(P.danger, GHOST_ALPHA);
      g.fillRect(gx, bar.y, gw, h);
    }

    const [fx, fw] = span(anim.hp);
    if (fw > 0) {
      g.fillStyle(barColor(anim.hp), 1);
      g.fillRect(fx, bar.y, fw, h);
    }

    // Team colour outside, a hairline of outline inside it so an amber fill never merges with an amber edge.
    g.lineStyle(BORDER.INNER, P.outline, 1);
    g.strokeRect(bar.x + 0.5, bar.y + 0.5, bar.w - 1, h - 1);
    g.lineStyle(BORDER.TEAM, outline, 1);
    g.strokeRect(bar.x - BORDER.TEAM / 2, bar.y - BORDER.TEAM / 2, bar.w + BORDER.TEAM, h + BORDER.TEAM);
  }

  /**
   * Round pips: one row per team in 2v2 (on the team's first bar), per fighter otherwise. Under the bar's inner end,
   * except the three-player side bars, whose inner end sits over the centred bar: theirs follow the name.
   */
  private drawRoundPips(state: MatchState, i: PlayerIndex, bar: BarLayout, h: number, after: NameRow): void {
    const f = state.fighters[i]!;
    if (state.config.teams === "2v2" && state.fighters.findIndex((o) => o.team === f.team) !== i) return;
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
    for (let pip = 0; pip < MODES[state.config.mode].roundsToWin; pip += 1) {
      const cx = inner + dir * (r + pip * gap);
      g.lineStyle(2, P.outline, 1);
      g.fillStyle(pip < won ? P.moon : P.steel1, 1);
      g.fillCircle(cx, cy, r);
      g.strokeCircle(cx, cy, r);
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
      tag.setText(f.team === 0 ? "A" : "B").setColor(cssOf(color));
      tag.setOrigin(left ? 0 : 1, 0).setPosition(cursor, y + (size - TAG.SIZE) / 2 + 1).setVisible(true);
      cursor += dir * (tag.displayWidth + TAG.GAP);
    } else {
      tag.setVisible(false);
    }

    const dazzled = f.dazzle > 0;
    const blinkOn = Math.floor(this.clock * BLINK_HZ) % 2 === 0;
    t.dazzle.setText("✦").setOrigin(left ? 0 : 1, 0).setPosition(cursor, y).setVisible(dazzled && blinkOn);
    if (dazzled) cursor += dir * (t.dazzle.displayWidth + TAG.GAP);

    t.out.setText("OUT").setPosition(bar.x + bar.w / 2, bar.y + h / 2).setColor(CSS_P.moon).setVisible(ko);
    return { cursor, y, size };
  }

  /** The held item in a chamfered 22 px slot with uses pips, then the two loadout minis: dim, lit while held, struck once used. */
  private drawSlot(f: FighterState, acc: Accessories, t: FighterTexts): void {
    const g = this.g;
    const { x, y } = acc.slot;
    const s = SLOT.SIZE;
    const c = SLOT.CHAMFER;
    const held = f.item;

    g.fillStyle(P.night0, 0.85);
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

    t.glyph.setText(itemGlyph(held)).setPosition(x + s / 2, y + s / 2 - 2).setVisible(held !== null);

    if (held) {
      const pitch = SLOT.PIP_W + SLOT.PIP_GAP;
      const total = held.uses * pitch - SLOT.PIP_GAP;
      let px = x + (s - total) / 2;
      g.fillStyle(P.amber1, 1);
      for (let u = 0; u < held.uses; u += 1) {
        g.fillRect(px, y + s - SLOT.PIP_H - 2, SLOT.PIP_W, SLOT.PIP_H);
        px += pitch;
      }
    }

    for (const k of [0, 1] as const) {
      const kind = f.loadout[k];
      const m = acc.minis[k];
      const size = SLOT.MINI;
      const isHeld = held?.kind === kind;
      const used = !isHeld && f.itemsUsed.includes(kind);
      g.fillStyle(P.night0, 0.6);
      g.fillRect(m.x, m.y, size, size);
      g.lineStyle(1, isHeld ? P.moon : used ? P.steel1 : P.steel2, 1);
      g.strokeRect(m.x + 0.5, m.y + 0.5, size - 1, size - 1);
      const mini = t.minis[k];
      mini.setText(GLYPH[kind]).setColor(isHeld ? CSS_P.moon : used ? CSS_P.steel1 : CSS_P.steel2);
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
    if (ready && !this.wasReady[i]) this.pulse[i] = 0;
    this.wasReady[i] = ready;

    g.lineStyle(SLOT.RING_W, P.steel1, 1);
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
    this.timer.setColor(seconds !== null && seconds < TIMER.DANGER_BELOW ? CSS_P.danger : CSS_P.moon);
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
    if (!next) return;
    this.popT = Math.min(BANNER.POP_SEC, this.popT + dt);
    const k = easeOut(this.popT / BANNER.POP_SEC);
    this.banner.setScale(lerp(BANNER.POP_FROM, 1, k));
  }
}

function hideAll(t: FighterTexts): void {
  for (const text of [t.name, t.tag, t.out, t.dazzle, t.glyph, t.minis[0], t.minis[1]]) text.setVisible(false);
}

function bannerFor(state: MatchState, fightEdge: boolean): Banner | null {
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
    fontStyle: "bold",
    color,
    stroke: CSS_P.outline,
    strokeThickness: stroke,
  };
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
