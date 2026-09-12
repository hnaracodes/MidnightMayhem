import Phaser from "phaser";
import { MATCH, WORLD, type SimEvent } from "@midnight/shared";
import { session } from "./session";

const COLORS = {
  roof: 0x5B6375,
  drifter: 0x8A6B4A,
  conductor: 0x1B2A5C,
  flash: 0xFFFFFF,
  text: "#E8F0FF",
} as const;

export class ArenaScene extends Phaser.Scene {
  private fighters!: [Phaser.GameObjects.Graphics, Phaser.GameObjects.Graphics];
  private hp!: [Phaser.GameObjects.Text, Phaser.GameObjects.Text];
  private roundPips!: Phaser.GameObjects.Text;
  private timer!: Phaser.GameObjects.Text;
  private phase!: Phaser.GameObjects.Text;
  private readonly flashFrames: [number, number] = [0, 0];

  constructor() {
    super("arena");
  }

  create(): void {
    const roof = this.add.graphics();
    roof.lineStyle(2, COLORS.roof, 1);
    roof.lineBetween(0, WORLD.ROOF_Y, WORLD.WIDTH, WORLD.ROOF_Y);

    this.fighters = [this.add.graphics(), this.add.graphics()];
    this.hp = [
      this.add.text(24, 24, "P1 40", textStyle()),
      this.add.text(WORLD.WIDTH - 24, 24, "P2 40", textStyle()).setOrigin(1, 0),
    ];
    this.roundPips = this.add.text(WORLD.WIDTH / 2, 22, "○○  ○○", textStyle()).setOrigin(0.5, 0);
    this.timer = this.add.text(WORLD.WIDTH / 2, 52, "30", textStyle(28)).setOrigin(0.5, 0);
    this.phase = this.add.text(WORLD.WIDTH / 2, 88, "COUNTDOWN", textStyle(16)).setOrigin(0.5, 0);
  }

  update(_time: number, _delta: number): void {
    const state = session.buffer.sample(performance.now());
    if (!state) return;

    this.consumeEvents(session.events.splice(0));
    for (const index of [0, 1] as const) {
      const fighter = state.fighters[index];
      const graphic = this.fighters[index];
      const color = this.flashFrames[index] > 0
        ? COLORS.flash
        : index === 0 ? COLORS.drifter : COLORS.conductor;
      graphic.clear();
      graphic.fillStyle(color, 1);
      graphic.fillRect(
        fighter.x - WORLD.HURTBOX_W / 2,
        fighter.y - WORLD.HURTBOX_H,
        WORLD.HURTBOX_W,
        WORLD.HURTBOX_H,
      );
      if (this.flashFrames[index] > 0) this.flashFrames[index] -= 1;
      this.hp[index].setText(`P${index + 1} ${fighter.hp}`);
    }

    this.roundPips.setText(
      `${pips(state.roundsWon[0])}  ${pips(state.roundsWon[1])}`,
    );
    this.timer.setText(String(Math.ceil(state.roundTicks / 60)));
    this.phase.setText(`${state.phase} · ROUND ${state.round}/${MATCH.MAX_ROUNDS}`);
  }

  private consumeEvents(events: SimEvent[]): void {
    for (const event of events) {
      if (event.type === "HIT") this.flashFrames[event.target] = 4;
    }
  }
}

function pips(wins: number): string {
  return `${wins > 0 ? "●" : "○"}${wins > 1 ? "●" : "○"}`;
}

function textStyle(fontSize = 20): Phaser.Types.GameObjects.Text.TextStyle {
  return {
    color: COLORS.text,
    fontFamily: "system-ui, sans-serif",
    fontSize: `${fontSize}px`,
    fontStyle: "bold",
  };
}
