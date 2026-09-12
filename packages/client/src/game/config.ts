import Phaser from "phaser";
import { WORLD } from "@midnight/shared";
import { ArenaScene } from "./ArenaScene";

export const gameConfig: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  width: WORLD.WIDTH,
  height: WORLD.HEIGHT,
  parent: "game",
  backgroundColor: "#070B18",
  // 12.01: camera and game-object positions land on whole pixels so walking sprites stop crawling. Scale.FIT stays.
  render: { roundPixels: true },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [ArenaScene],
};

let game: Phaser.Game | null = null;

export function startGame(): void {
  game ??= new Phaser.Game(gameConfig);
}
