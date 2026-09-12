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
    this.root.dataset["verdict"] = winner === "draw" ? "draw" : winner === localIndex ? "win" : "lose";

    const heading = document.createElement("h1");
    heading.textContent = winner === "draw"
      ? "MUTUAL DERAILMENT"
      : winner === localIndex ? "YOU WIN" : "YOU LOSE";
    const detail = winner === "draw"
      ? document.createElement("p")
      : document.createElement("h2");
    detail.textContent = winner === "draw"
      ? "Neither fighter leaves the train standing."
      : `${winner === 0 ? "THE DRIFTER" : "THE CONDUCTOR"} WINS`;
    const rematch = document.createElement("button");
    rematch.type = "button";
    rematch.className = "btn btn-primary";
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
