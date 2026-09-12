import { CHARACTER_LABEL, type MatchState, type PlayerIndex, type Winner } from "@midnight/shared";
import { AMBER_FACE, DANGER_FACE, MOON_FACE, pixelText } from "./pixelFont";

export class ResultOverlay {
  private readonly root: HTMLElement;

  constructor(private readonly onRematch: () => void) {
    const root = document.getElementById("result");
    if (!root) throw new Error("Missing #result");
    this.root = root;
  }

  /**
   * `winner` is a team index; `state` (the final snapshot) maps it to names and the local fighter's team.
   * FFA: the winning character's label. 2v2: "TEAM A/B WINS" with both fighters' names under it.
   */
  show(winner: Winner, state: MatchState | null, localIndex: PlayerIndex): void {
    this.root.replaceChildren();
    this.root.hidden = false;
    const localTeam = state?.fighters[localIndex]?.team ?? localIndex;
    const won = winner !== "draw" && winner === localTeam;
    this.root.dataset["verdict"] = winner === "draw" ? "draw" : won ? "win" : "lose";

    // 13.01: the verdict in the pixel face, coloured by outcome; the winner's name under it in moon.
    const heading = document.createElement("h1");
    const verdict = winner === "draw" ? "MUTUAL DERAILMENT" : won ? "YOU WIN" : "YOU LOSE";
    heading.append(pixelText(verdict, {
      weight: "heavy", depth: 2,
      fill: winner === "draw" ? MOON_FACE : won ? AMBER_FACE : DANGER_FACE, className: "px-title",
    }));
    const detail = winner === "draw"
      ? document.createElement("p")
      : document.createElement("h2");
    if (winner === "draw") detail.textContent = "Neither fighter leaves the train standing.";
    else detail.append(pixelText(`${winnerName(winner, state)} WINS`, { cell: 4, fill: MOON_FACE, depth: 1 }));
    this.root.append(heading, detail);
    if (winner !== "draw" && state?.config.teams === "2v2") {
      const names = document.createElement("p");
      names.className = "result-team";
      names.textContent = teamMembers(winner, state).join(" and ");
      this.root.append(names);
    }
    const rematch = document.createElement("button");
    rematch.type = "button";
    rematch.className = "btn btn-primary";
    rematch.textContent = "Rematch";
    rematch.addEventListener("click", () => {
      this.hide();
      this.onRematch();
    });
    this.root.append(rematch);
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

/** Character labels of every fighter on `team`, in seat order. */
export function teamMembers(team: number, state: MatchState): string[] {
  return state.fighters.filter((f) => f.team === team).map((f) => CHARACTER_LABEL[f.character]);
}
