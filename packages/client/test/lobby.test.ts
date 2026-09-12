// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CONFIG, type LobbyPlayer, type MatchConfig } from "@midnight/shared";
import { Lobby } from "../src/app/lobby";

function player(name: string, ready = false): LobbyPlayer {
  return { name, ready, connected: true, character: "drifter", loadout: ["molotov", "shield"] };
}

function lobby(handlers: Partial<ConstructorParameters<typeof Lobby>[0]> = {}): Lobby {
  return new Lobby({
    onReady: vi.fn(), onEnableCamera: vi.fn(), onConfig: vi.fn(), onCustomize: vi.fn(), ...handlers,
  });
}

const root = (): HTMLElement => document.getElementById("lobby")!;
const readyButton = (): HTMLButtonElement => root().querySelector<HTMLButtonElement>("button.btn-primary")!;

describe("Lobby.renderRoom", () => {
  beforeEach(() => { document.body.innerHTML = '<div id="lobby" class="overlay" hidden></div>'; });
  afterEach(() => { document.body.innerHTML = ""; });

  it("draws one roster row per configured seat, empty seats included", () => {
    const l = lobby();
    const four: MatchConfig = { ...DEFAULT_CONFIG, players: 4 };
    l.renderRoom("K7QX", [player("Ana"), null, null, null], four, 0, 0, false, "button");
    expect(root().querySelectorAll(".seat").length).toBe(4);
    l.renderRoom("K7QX", [player("Ana"), null, null, null], DEFAULT_CONFIG, 0, 0, false, "button");
    expect(root().querySelectorAll(".seat").length).toBe(2);
    expect(root().textContent).toContain("K7QX");
  });

  it("marks the host, the team colour in 2v2 and the ready state on each seat", () => {
    const l = lobby();
    const cfg: MatchConfig = { players: 4, teams: "2v2", mode: "rounds", map: "roof", items: true };
    l.renderRoom("K7QX", [player("Ana", true), player("Bo"), player("Cy"), null], cfg, 1, 0, false, "hidden");
    const seats = root().querySelectorAll<HTMLElement>(".seat");
    expect(seats[0]!.dataset["ready"]).toBe("true");
    expect(seats[1]!.dataset["ready"]).toBe("false");
    expect(seats[1]!.dataset["host"]).toBe("true");
    expect(seats[0]!.dataset["host"]).toBeUndefined();
    expect(seats[0]!.dataset["team"]).toBe("0");
    expect(seats[2]!.dataset["team"]).toBe("1");
    expect(seats[3]!.textContent).toMatch(/empty/i);
  });

  it("disables every host control for a guest and explains the config in a sentence", () => {
    const l = lobby();
    l.renderRoom("K7QX", [player("Ana"), player("Bo")], { ...DEFAULT_CONFIG, map: "gaps" }, 0, 1, false, "button");
    const controls = [...root().querySelectorAll<HTMLButtonElement>(".route button")];
    expect(controls.length).toBeGreaterThan(0);
    expect(controls.every((b) => b.disabled)).toBe(true);
    expect(root().textContent).toContain("2 players, free-for-all, best of 3 on Gaps, items on");
  });

  it("keeps the host's controls live and forwards the config", () => {
    vi.useFakeTimers();
    const onConfig = vi.fn();
    const l = lobby({ onConfig });
    l.renderRoom("K7QX", [player("Ana"), player("Bo")], DEFAULT_CONFIG, 0, 0, false, "button");
    root().querySelector<HTMLButtonElement>('.route [data-field="map"] button[data-value="chaos"]')!.click();
    vi.advanceTimersByTime(200);
    expect(onConfig).toHaveBeenCalledWith({ ...DEFAULT_CONFIG, map: "chaos" });
    vi.useRealTimers();
  });

  it("disables Ready and counts the missing players until the room is full", () => {
    const l = lobby();
    const three: MatchConfig = { ...DEFAULT_CONFIG, players: 3 };
    l.renderRoom("K7QX", [player("Ana"), null, null], three, 0, 0, false, "button");
    expect(readyButton().disabled).toBe(true);
    expect(readyButton().textContent).toBe("Waiting for 2 more");
    l.renderRoom("K7QX", [player("Ana"), player("Bo"), null], three, 0, 0, false, "button");
    expect(readyButton().textContent).toBe("Waiting for 1 more");
    l.renderRoom("K7QX", [player("Ana"), player("Bo"), player("Cy")], three, 0, 0, false, "button");
    expect(readyButton().disabled).toBe(false);
    expect(readyButton().textContent).toBe("Ready");
  });

  it("reflects the local player's ready state from the server and toggles it", () => {
    const onReady = vi.fn();
    const l = lobby({ onReady });
    l.renderRoom("K7QX", [player("Ana", true), player("Bo")], DEFAULT_CONFIG, 0, 0, false, "button");
    expect(readyButton().textContent).toBe("Not ready");
    readyButton().click();
    expect(onReady).toHaveBeenCalledWith(false);
  });

  it("forwards a customise pick with the local player's current loadout", () => {
    const onCustomize = vi.fn();
    const l = lobby({ onCustomize });
    l.renderRoom("K7QX", [player("Ana"), player("Bo")], DEFAULT_CONFIG, 0, 0, false, "button");
    root().querySelector<HTMLButtonElement>('.portrait[data-character="claude"]')!.click();
    expect(onCustomize).toHaveBeenCalledWith("claude", ["molotov", "shield"]);
  });
});
