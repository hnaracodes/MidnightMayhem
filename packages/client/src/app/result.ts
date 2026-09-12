import type { PlayerIndex, Winner } from "@midnight/shared";

export class ResultOverlay {
  private readonly root: HTMLElement;

  constructor(private readonly onRematch: () => void) {
    const root = document.getElementById("result");
    if (!root) throw new Error("Missing #result");
    this.root = root;
  }

  show(winner: Winner, localIndex: PlayerIndex): void {
    this.root.replaceChildren();
    this.root.hidden = false;

    const heading = document.createElement("h1");
    heading.textContent = winner === "draw"
      ? "MUTUAL DERAILMENT"
      : winner === localIndex ? "YOU WIN" : "YOU LOSE";
    const detail = document.createElement("p");
    detail.textContent = winner === "draw"
      ? "Neither fighter leaves the train standing."
      : `${winner === 0 ? "THE DRIFTER" : "THE CONDUCTOR"} WINS`;
    const rematch = document.createElement("button");
    rematch.type = "button";
    rematch.textContent = "Rematch";
    rematch.addEventListener("click", () => {
      this.hide();
      this.onRematch();
    });
    this.root.append(heading, detail, rematch);
  }

  hide(): void {
    this.root.hidden = true;
  }
}
