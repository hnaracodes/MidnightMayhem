import { CHARACTER_LABEL, type MatchState, type PlayerIndex, type Winner } from "@midnight/shared";

export class ResultOverlay {
  private readonly root: HTMLElement;

  constructor(private readonly onRematch: () => void) {
    const root = document.getElementById("result");
    if (!root) throw new Error("Missing #result");
    this.root = root;
  }

  /** `winner` is a team index; `state` (the final snapshot) maps it to a name and the local fighter's team. */
  show(winner: Winner, localIndex: PlayerIndex, state: MatchState | null = null): void {
    this.root.replaceChildren();
    this.root.hidden = false;
    const localTeam = state?.fighters[localIndex]?.team ?? localIndex;
    const won = winner !== "draw" && winner === localTeam;
    this.root.dataset["verdict"] = winner === "draw" ? "draw" : won ? "win" : "lose";

    const heading = document.createElement("h1");
    heading.textContent = winner === "draw"
      ? "MUTUAL DERAILMENT"
      : won ? "YOU WIN" : "YOU LOSE";
    const detail = winner === "draw"
      ? document.createElement("p")
      : document.createElement("h2");
    detail.textContent = winner === "draw"
      ? "Neither fighter leaves the train standing."
      : `${winnerName(winner, state)} WINS`;
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

/** The winning team's name: "TEAM A/B" in 2v2, else the character label of the team's first fighter. */
export function winnerName(team: number, state: MatchState | null): string {
  if (state?.config.teams === "2v2") return team === 0 ? "TEAM A" : "TEAM B";
  const first = state?.fighters.find((f) => f.team === team);
  const character = first?.character ?? (team === 0 ? "drifter" : "conductor");
  return CHARACTER_LABEL[character];
}
