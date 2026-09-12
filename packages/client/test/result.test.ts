// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMatch, type MatchState, type RosterEntry } from "@midnight/shared";
import { ResultOverlay } from "../src/app/result";

function state(players: 2 | 3 | 4, teams: "ffa" | "2v2" = "ffa"): MatchState {
  const roster: RosterEntry[] = [
    { character: "drifter", loadout: ["molotov", "shield"] },
    { character: "claude", loadout: ["molotov", "shield"] },
    { character: "stoker", loadout: ["molotov", "shield"] },
    { character: "conductor", loadout: ["molotov", "shield"] },
  ];
  return createMatch({ players, teams, mode: "rounds", map: "roof", items: true }, roster.slice(0, players));
}

describe("ResultOverlay.show", () => {
  beforeEach(() => { document.body.innerHTML = '<div id="result" class="overlay" hidden></div>'; });

  it("names the winning character in free-for-all with three", () => {
    new ResultOverlay(vi.fn()).show(1, state(3), 0);
    const root = document.getElementById("result")!;
    expect(root.textContent).toContain("CLAUDE CODE WINS");
    expect(root.dataset["verdict"]).toBe("lose");
  });

  it("uses team wording with both names in 2v2", () => {
    new ResultOverlay(vi.fn()).show(1, state(4, "2v2"), 3);
    const root = document.getElementById("result")!;
    expect(root.textContent).toContain("TEAM B WINS");
    expect(root.textContent).toContain("THE STOKER");
    expect(root.textContent).toContain("THE CONDUCTOR");
    expect(root.dataset["verdict"]).toBe("win");
  });

  it("keeps the draw text", () => {
    new ResultOverlay(vi.fn()).show("draw", state(2), 0);
    expect(document.getElementById("result")!.textContent).toContain("MUTUAL DERAILMENT");
  });

  it("rematch hides the overlay and calls back", () => {
    const onRematch = vi.fn();
    new ResultOverlay(onRematch).show(0, state(2), 0);
    document.querySelector<HTMLButtonElement>("#result button")!.click();
    expect(onRematch).toHaveBeenCalled();
    expect(document.getElementById("result")!.hidden).toBe(true);
  });
});
