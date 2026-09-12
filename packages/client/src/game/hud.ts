import type Phaser from "phaser";
import { BALANCE, MATCH, TICK, WORLD, roundWinner, type MatchState, type PlayerIndex, type Winner } from "@midnight/shared";
import { CSS_P, P } from "./palette";

/** HUD layout from design/04 § HUD. Presentation only; nothing here is a sim number. */
const BAR = { Y: 24, W: 380, H: 22, INSET: 20, BORDER: 3 } as const;
const PIP = { RADIUS: 6, GAP: 16, DY: 12 } as const;
const NAME = { DY: 6, SIZE: 14 } as const;
const TIMER = { X: 480, Y: 34, SIZE: 40, STROKE: 4 } as const;
const CAR = { INSET: 12, SIZE: 12 } as const;
const BANNER = { X: 480, Y: 240, STROKE: 6, POP_FROM: 1.4, POP_SEC: 0.13 } as const;
const BANNER_SIZE = { COUNTDOWN: 96, ROUND_END: 48, MATCH_END: 64 } as const;
const GHOST_DRAIN_SEC = 0.4;
const GHOST_ALPHA = 0.7; // stays legible when the live fill is danger too
const COUNT_STEP_TICKS = 60;
const FIGHT_BANNER_TICKS = 60;
const DEPTH = { HUD: 10, BANNER: 11 } as const;
const FONT = "system-ui, -apple-system, 'Segoe UI', sans-serif";

const DEFAULT_NAMES: [string, string] = ["THE DRIFTER", "THE CONDUCTOR"];
const CAR_LABEL: Record<MatchState["trainCar"], string> = {
  STANDARD: "STANDARD CAR",
  TUNNEL: "TUNNEL",
  FINAL_CAR: "FINAL CAR",
};

interface Banner { text: string; size: number }

/** Per-bar drain animation: the ghost lags behind hp and eases down to it over GHOST_DRAIN_SEC. */
interface BarAnim { hp: number; ghost: number; from: number; t: number }

export class Hud {
  private readonly bars: Phaser.GameObjects.Graphics;
  private readonly timer: Phaser.GameObjects.Text;
  private readonly names: [Phaser.GameObjects.Text, Phaser.GameObjects.Text];
  private readonly car: Phaser.GameObjects.Text;
  private readonly banner: Phaser.GameObjects.Text;
  private readonly anim: [BarAnim, BarAnim];
  private bannerText: string | null = null;
  private popT: number = BANNER.POP_SEC;

  constructor(scene: Phaser.Scene) {
    this.bars = scene.add.graphics().setDepth(DEPTH.HUD);

    this.timer = scene.add
      .text(TIMER.X, TIMER.Y, "", style(TIMER.SIZE, CSS_P.moon, TIMER.STROKE))
      .setOrigin(0.5, 0.5)
      .setDepth(DEPTH.HUD);

    const nameY = BAR.Y + BAR.H + NAME.DY;
    this.names = [
      scene.add.text(BAR.INSET, nameY, DEFAULT_NAMES[0], style(NAME.SIZE, CSS_P.moon, 2)).setOrigin(0, 0).setDepth(DEPTH.HUD),
      scene.add.text(WORLD.WIDTH - BAR.INSET, nameY, DEFAULT_NAMES[1], style(NAME.SIZE, CSS_P.moon, 2)).setOrigin(1, 0).setDepth(DEPTH.HUD),
    ];

    this.car = scene.add
      .text(WORLD.WIDTH - CAR.INSET, WORLD.HEIGHT - CAR.INSET, "", style(CAR.SIZE, CSS_P.steel2, 0))
      .setOrigin(1, 1)
      .setDepth(DEPTH.HUD);

    this.banner = scene.add
      .text(BANNER.X, BANNER.Y, "", style(BANNER_SIZE.COUNTDOWN, CSS_P.moon, BANNER.STROKE))
      .setOrigin(0.5, 0.5)
      .setDepth(DEPTH.BANNER)
      .setVisible(false);

    const full = BALANCE.MAX_HP;
    this.anim = [
      { hp: full, ghost: full, from: full, t: GHOST_DRAIN_SEC },
      { hp: full, ghost: full, from: full, t: GHOST_DRAIN_SEC },
    ];
  }

  /** Player names shown under the bars (integrator amendment; names are not part of MatchState). */
  setNames(names: [string, string]): void {
    this.names[0].setText(names[0] || DEFAULT_NAMES[0]);
    this.names[1].setText(names[1] || DEFAULT_NAMES[1]);
  }

  update(state: MatchState, dtSec: number): void {
    const dt = Math.max(0, dtSec);
    this.bars.clear();
    for (const index of [0, 1] as const) {
      const anim = this.anim[index];
      this.advanceDrain(anim, state.fighters[index].hp, dt);
      this.drawBar(index, anim);
      this.drawPips(index, state.roundsWon[index]);
    }

    this.timer.setText(String(Math.ceil(state.roundTicks / TICK.HZ)));
    this.car.setText(CAR_LABEL[state.trainCar]);
    this.updateBanner(bannerFor(state), dt);
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

  private drawBar(index: PlayerIndex, anim: BarAnim): void {
    const g = this.bars;
    const x0 = index === 0 ? BAR.INSET : WORLD.WIDTH - BAR.INSET;
    const dir = index === 0 ? 1 : -1;
    const span = (hp: number): [number, number] => {
      const w = Math.round(BAR.W * clamp01(hp / BALANCE.MAX_HP));
      return [dir === 1 ? x0 : x0 - w, w];
    };

    g.fillStyle(P.steel0, 1);
    g.fillRect(dir === 1 ? x0 : x0 - BAR.W, BAR.Y, BAR.W, BAR.H);

    if (anim.ghost > anim.hp) {
      const [gx, gw] = span(anim.ghost);
      g.fillStyle(P.danger, GHOST_ALPHA);
      g.fillRect(gx, BAR.Y, gw, BAR.H);
    }

    const [fx, fw] = span(anim.hp);
    if (fw > 0) {
      g.fillStyle(barColor(anim.hp), 1);
      g.fillRect(fx, BAR.Y, fw, BAR.H);
    }

    g.lineStyle(BAR.BORDER, P.outline, 1);
    g.strokeRect(dir === 1 ? x0 : x0 - BAR.W, BAR.Y, BAR.W, BAR.H);
  }

  private drawPips(index: PlayerIndex, won: number): void {
    const g = this.bars;
    const farX = index === 0 ? BAR.INSET + BAR.W : WORLD.WIDTH - BAR.INSET - BAR.W;
    const dir = index === 0 ? -1 : 1;
    const y = BAR.Y + BAR.H + PIP.DY;
    for (let pip = 0; pip < MATCH.ROUNDS_TO_WIN; pip += 1) {
      const cx = farX + dir * (PIP.RADIUS + pip * PIP.GAP);
      g.lineStyle(2, P.outline, 1);
      g.fillStyle(pip < won ? P.moon : P.steel1, 1);
      g.fillCircle(cx, y, PIP.RADIUS);
      g.strokeCircle(cx, y, PIP.RADIUS);
    }
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

function bannerFor(state: MatchState): Banner | null {
  switch (state.phase) {
    case "COUNTDOWN": {
      const n = Math.max(1, Math.ceil(state.phaseTicks / COUNT_STEP_TICKS));
      return { text: String(n), size: BANNER_SIZE.COUNTDOWN };
    }
    case "FIGHTING":
      return state.roundTicks > MATCH.ROUND_TICKS - FIGHT_BANNER_TICKS
        ? { text: "FIGHT", size: BANNER_SIZE.COUNTDOWN }
        : null;
    case "ROUND_END":
      return { text: roundEndText(state.round, roundWinner(state)), size: BANNER_SIZE.ROUND_END };
    case "MATCH_END":
      return state.winner === null ? null : { text: matchEndText(state.winner), size: BANNER_SIZE.MATCH_END };
  }
}

function roundEndText(round: number, winner: Winner | null): string {
  if (winner === "draw") return "DRAW ROUND";
  if (winner === null) return `ROUND ${round}`;
  return `ROUND ${round}: ${winner === 0 ? "DRIFTER" : "CONDUCTOR"}`;
}

function matchEndText(winner: Winner): string {
  if (winner === "draw") return "MUTUAL DERAILMENT";
  return winner === 0 ? "THE DRIFTER WINS" : "THE CONDUCTOR WINS";
}

function barColor(hp: number): number {
  const frac = hp / BALANCE.MAX_HP;
  if (frac > 0.5) return P.amber1;
  if (frac >= 0.25) return P.moon;
  return P.danger;
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
